import { getDb } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { createAgentRuntimeProvider, getAgentCompatibleProviders } from '../providers/agentRuntime.js';
import { z } from 'zod';

const log = createLogger('GraphMemory');

/** Zod schema for LLM-extracted knowledge graph triples */
const TripleSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
});
const TriplesArraySchema = z.array(TripleSchema);

export interface GraphNode {
  id: string;
  chatId: string;
  label: string;
  nodeType: string;
}

export interface GraphEdge {
  id: number;
  chatId: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
}

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

/**
 * Normalizes a label for use as an ID to prevent duplicates (e.g., "John Doe" -> "john_doe")
 */
function normalizeLabel(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_]+/gu, '_')
        .replace(/^_+|_+$/g, '');
}

/**
 * Simple HTML escaping to prevent XSS when rendering graph data in web views
 */
function escapeHtml(unsafe: string): string {
    return (unsafe || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Truncates text to a maximum length while trying to preserve word/sentence boundaries.
 */
function truncateToBoundary(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) return text || '';

    const sub = text.substring(0, maxLength);
    const lastSpace = sub.lastIndexOf(' ');
    const lastNewline = sub.lastIndexOf('\n');
    const lastPunctuation = Math.max(sub.lastIndexOf('.'), sub.lastIndexOf('?'), sub.lastIndexOf('!'));

    const bestBoundary = Math.max(lastSpace, lastNewline, lastPunctuation);

    // If we found a boundary within the last 20% of the limit, use it.
    if (bestBoundary > maxLength * 0.8) {
        return sub.substring(0, bestBoundary).trim();
    }

    return sub;
}

/**
 * Add or update a node in the graph
 */
export function addNode(chatId: string, label: string, type: string = 'entity'): string {
    const db = getDb();
    const normalized = normalizeLabel(label);
    const nodeId = `${chatId}_${normalized}`;

    db.prepare(`
        INSERT INTO knowledge_nodes (id, chat_id, label, node_type)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `).run(nodeId, chatId, label.trim(), type);

    return nodeId;
}

/**
 * Add a relationship (edge) between two nodes
 */
export function addEdge(chatId: string, sourceLabel: string, targetLabel: string, relationship: string): void {
    const db = getDb();

    // Generate IDs locally
    const sourceId = `${chatId}_${normalizeLabel(sourceLabel)}`;
    const targetId = `${chatId}_${normalizeLabel(targetLabel)}`;

    // Use a transaction to ensure atomicity and avoid redundant node updates if possible
    // Note: We still need to ensure nodes exist to maintain referential integrity
    try {
        db.transaction(() => {
            // Ensure nodes exist (using the existing addNode which handles ON CONFLICT)
            addNode(chatId, sourceLabel);
            addNode(chatId, targetLabel);

            db.prepare(`
                INSERT INTO knowledge_edges (chat_id, source_id, target_id, relationship)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(chat_id, source_id, target_id, relationship) DO NOTHING
            `).run(chatId, sourceId, targetId, relationship.trim().toLowerCase());
        })();
        log.debug(`Processed Graph Edge: [${sourceLabel}] -(${relationship})-> [${targetLabel}]`);
    } catch (err: any) {
        log.error('Failed to add edge', { error: err.message, sourceLabel, targetLabel, relationship });
        throw err;
    }
}

/**
 * Adds multiple triples to the graph
 */
export function addTriples(chatId: string, triples: Triple[]): void {
    const db = getDb();

    try {
        db.transaction(() => {
            // 1. Collect and deduplicate unique nodes
            const uniqueNodes = new Map<string, string>(); // id -> label
            for (const t of triples) {
                const subject = t.subject.trim();
                const object = t.object.trim();
                uniqueNodes.set(`${chatId}_${normalizeLabel(subject)}`, subject);
                uniqueNodes.set(`${chatId}_${normalizeLabel(object)}`, object);
            }

            // 2. Batch insert nodes (to improve performance and handle SQLite parameter limits)
            const nodeEntries = Array.from(uniqueNodes.entries());
            const BATCH_SIZE = 200; // Each node has 3 parameters + 1 literal

            if (nodeEntries.length > 0) {
                for (let i = 0; i < nodeEntries.length; i += BATCH_SIZE) {
                    const batch = nodeEntries.slice(i, i + BATCH_SIZE);
                    const placeholders = batch.map(() => '(?, ?, ?, \'entity\')').join(', ');
                    const params = batch.flatMap(([id, label]) => [id, chatId, label]);

                    db.prepare(`
                        INSERT INTO knowledge_nodes (id, chat_id, label, node_type)
                        VALUES ${placeholders}
                        ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                    `).run(...params);
                }
            }

            // 3. Insert edges
            const insertEdge = db.prepare(`
                INSERT INTO knowledge_edges (chat_id, source_id, target_id, relationship)
                VALUES (?, ?, ?, ?)
            `);

            for (const t of triples) {
                const subject = t.subject.trim();
                const object = t.object.trim();
                const predicate = t.predicate.trim().toLowerCase();
                const srcId = `${chatId}_${normalizeLabel(subject)}`;
                const tgtId = `${chatId}_${normalizeLabel(object)}`;

                try {
                    insertEdge.run(chatId, srcId, tgtId, predicate);
                    log.debug(`Added Graph Edge: [${subject}] -(${predicate})-> [${object}]`);
                } catch (err: any) {
                    if (!err.message.includes('UNIQUE constraint failed')) {
                        log.error('Critical error inserting edge, rolling back', { error: err.message, triple: t });
                        throw err; // Trigger transaction rollback
                    }
                }
            }
        })();
    } catch (err: any) {
        log.error('addTriples transaction failed', { error: err.message, chatId });
    }
}

/**
 * Queries the graph for relationships around specific keywords
 */
export function queryGraph(chatId: string, keywords: string[], limit: number = 10): string {
    if (!keywords || keywords.length === 0) return '';

    const db = getDb();
    const validKeywords = keywords.map(k => k.trim()).filter(k => k.length > 0);
    if (validKeywords.length === 0) return '';

    // Use placeholders for all dynamic parts of the query to prevent SQL injection.
    // The 'conditions' string itself only contains placeholders and static SQL.
    const conditions = validKeywords.map(() => `(n1.label LIKE ? OR n2.label LIKE ?)`).join(' OR ');
    const params = [
        chatId,
        ...validKeywords.flatMap(k => [`%${k}%`, `%${k}%`]),
        limit
    ];

    const rows = db.prepare(`
        SELECT DISTINCT n1.label as subject, e.relationship, n2.label as object
        FROM knowledge_edges e
        JOIN knowledge_nodes n1 ON e.source_id = n1.id
        JOIN knowledge_nodes n2 ON e.target_id = n2.id
        WHERE e.chat_id = ? AND (${conditions})
        ORDER BY e.created_at DESC
        LIMIT ?
    `).all(...params) as any[];

    if (rows.length === 0) return '';

    return rows.map(r => `[${r.subject}] -> (${r.relationship}) -> [${r.object}]`).join('\n');
}

/**
 * Cache for the selected GraphRAG provider to avoid redundant lookups
 */
let cachedGraphRAGProvider: { provider: any; model: string; providerId: string } | null = null;
let lastProvidersFingerprint: string | null = null;

/**
 * Selects an available LLM provider for GraphRAG extraction
 */
function selectGraphRAGProvider() {
    const compatibleProviders = getAgentCompatibleProviders({ enabledOnly: true });
    
    // Generate a fingerprint of current enabled providers to detect changes
    const currentFingerprint = compatibleProviders.map(p => p.id).join(',');

    if (cachedGraphRAGProvider && currentFingerprint === lastProvidersFingerprint) {
        return cachedGraphRAGProvider;
    }

    for (const p of compatibleProviders) {
        try {
            const runtimeProvider = createAgentRuntimeProvider(p.id);
            if (runtimeProvider) {
                const model = p.id === 'gemini' ? 'gemini-2.0-flash-lite' : (p.defaultModel || 'gpt-4o-mini');
                const config = { provider: runtimeProvider, model, providerId: p.id };
                
                // Update cache
                cachedGraphRAGProvider = config;
                lastProvidersFingerprint = currentFingerprint;
                
                return config;
            }
        } catch (err: any) {
            log.debug(`Provider ${p.id} not available for GraphRAG: ${err.message}`);
        }
    }

    // Reset cache if no provider found
    cachedGraphRAGProvider = null;
    lastProvidersFingerprint = currentFingerprint;
    return null;
}

/**
 * Parses and validates triples from LLM response text
 */
function parseTriplesFromText(text: string, chatId: string): Triple[] {
    const jsonMatch = text.match(/\[.*\]/s);
    if (!jsonMatch) return [];

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        const result = TriplesArraySchema.safeParse(parsed);
        if (result.success) {
            return result.data;
        } else {
            log.debug('Graph triple validation failed', { error: result.error.message, chatId });
        }
    } catch (err) {
        log.debug(`GraphRAG JSON parse failed for ${chatId}`);
    }
    return [];
}

const graphExtractionCooldowns = new Map<string, number>();
const GRAPH_EXTRACTION_COOLDOWN_MS = 60000; // 1 minute

/**
 * Use LLM to extract triples from conversation text
 */
export async function extractGraphKnowledge(chatId: string, text: string): Promise<void> {
    if (!text || text.length < 15) {
        log.debug(`Skipping GraphRAG for ${chatId}: text too short (${text?.length || 0} chars)`);
        return;
    }

    // Rate limiting: prevent excessive LLM calls for the same chat
    const now = Date.now();
    const lastExecution = graphExtractionCooldowns.get(chatId) || 0;
    if (now - lastExecution < GRAPH_EXTRACTION_COOLDOWN_MS) {
        log.debug(`GraphRAG extraction rate limited for ${chatId}. Next available in ${Math.round((GRAPH_EXTRACTION_COOLDOWN_MS - (now - lastExecution)) / 1000)}s`);
        return;
    }

    // Update cooldown timestamp immediately to prevent race conditions during async execution
    graphExtractionCooldowns.set(chatId, now);

    try {
        const providerConfig = selectGraphRAGProvider();
        if (!providerConfig) {
            log.warn(`No enabled LLM providers available for GraphRAG extraction (chatId: ${chatId})`);
            return;
        }

        const { provider, model, providerId } = providerConfig;
        log.debug(`Using provider "${providerId}" (model: ${model}) for GraphRAG extraction`);

        const prompt = `ดึงความสัมพันธ์เป็นกราฟความรู้ (Knowledge Graph) จากข้อความต่อไปนี้
ให้ดึงเฉพาะข้อเท็จจริงที่สำคัญเกี่ยวกับผู้ใช้ ประสบการณ์ของเขา หรือสิ่งที่เขาพูดถึง
ถ้าไม่มีความสัมพันธ์ที่ชัดเจน ให้คืนค่าอาร์เรย์ว่าง []

ตอบเป็น JSON array ของวัตถุที่มีรูปแบบดังนี้:
[
  { "subject": "ประธาน", "predicate": "ความสัมพันธ์", "object": "กรรม" }
]
* ห้ามตอบอะไรนอกเหนือจาก JSON
* ใช้ภาษาไทย (หรือภาษาเดียวกันกับต้นฉบับ) กระชับที่สุด

ข้อความ: "${text.substring(0, 2000)}"`;

        // Timeout protection (30s)
        let isTimeout = false;
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => {
            isTimeout = true;
            resolve(null);
        }, 30000));

        const responsePromise = provider.generateResponse(
            model,
            'คุณเป็นผู้เชี่ยวชาญด้าน Knowledge Graph Extraction ให้ทำงานตามสั่งและตอบเป็น JSON เท่านั้น',
            [{ role: 'user', parts: [{ text: prompt }] }]
        ).catch((err: any) => {
            log.error('GraphRAG provider error during extraction', { error: String(err), chatId });
            return null;
        });

        const res = await Promise.race([responsePromise, timeoutPromise]);

        if (!res) {
            if (isTimeout) {
                log.warn(`GraphRAG extraction timed out for ${chatId} (provider: ${providerId})`);
            }
            return;
        }

        if (res.text) {
            const triples = parseTriplesFromText(res.text, chatId);
            if (triples.length > 0) {
                addTriples(chatId, triples);
                log.info(`Extracted ${triples.length} triples for ${chatId} (provider: ${providerId})`);
            }
        }
    } catch (err) {
        log.error('Graph extraction failed', { error: String(err), chatId });
        throw err;
    }
}
