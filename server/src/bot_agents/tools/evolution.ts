// ============================================================
// Self-Evolution Tools — ให้ AI แก้ไขและปรับปรุงตัวเองได้
// ============================================================
// Safety: ทุก operation มี guardrails — backup ก่อนแก้, จำกัด scope,
// ห้ามแก้ core files, ทุกการเปลี่ยน log ลง evolution_log
import * as fs from 'fs';
import * as path from 'path';
import type { AITool } from '../providers/baseProvider.js';
import { logEvolution, getEvolutionLog, getLearnings, addLearning, type LearningCategory } from '../../evolution/learningJournal.js';
import { shouldReflect, triggerReflection } from '../../evolution/selfReflection.js';
import { runHealthCheck } from '../../evolution/selfHealing.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('EvolutionTools');
// ── Safety Constants ──
const PROJECT_ROOT = path.resolve(process.cwd());
const PERSONAS_DIR = path.join(PROJECT_ROOT, 'personas');
const EVOLUTION_DIR = path.join(PROJECT_ROOT, 'evolution_data');
// Files that CANNOT be modified (core system files)
const PROTECTED_FILES = new Set([
    'agent.ts', 'index.ts', 'db.ts', 'schema.sql',
    'botManager.ts', 'queue.ts', 'unifiedMemory.ts',
]);
/**
 * Ensure evolution_data directory exists
 */
function ensureEvolutionDir(): void {
    if (!fs.existsSync(EVOLUTION_DIR)) {
        fs.mkdirSync(EVOLUTION_DIR, { recursive: true });
    }
}
/**
 * Create a backup of a file before modifying it
 */
function backupFile(filePath: string): string {
    const backupPath = filePath + `.bak.${Date.now()}`;
    if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
    }
    return backupPath;
}
/**
 * Validate that a path is within allowed scope
 */
function isPathAllowed(filePath: string, scope: 'personas' | 'source' | 'evolution'): boolean {
    const resolved = path.resolve(filePath);
    switch (scope) {
        case 'personas': return resolved.startsWith(PERSONAS_DIR);
        case 'source': return resolved.startsWith(path.join(PROJECT_ROOT, 'src'));
        case 'evolution': return resolved.startsWith(EVOLUTION_DIR);
        default: return false;
    }
}
// ============================================================
// Tool 1: self_read_source — อ่าน source code ของตัวเอง
// ============================================================
export const selfReadSourceDeclaration: AITool = {
    name: 'self_read_source',
    description: 'อ่าน source code ของตัวเอง เพื่อเข้าใจการทำงานและหาจุดปรับปรุง (read-only, จำกัดเฉพาะ server/src/)',
    parameters: {
        type: 'object',
        properties: {
            file_path: {
                type: 'string',
                description: 'พาธไฟล์ที่ต้องการอ่าน (สัมพัทธ์จาก server/ เช่น "src/bot_agents/agent.ts")',
            },
        },
        required: ['file_path'],
    },
};
export async function selfReadSource({ file_path }: { file_path: string }): Promise<string> {
    try {
        const fullPath = path.resolve(PROJECT_ROOT, file_path);
        if (!isPathAllowed(fullPath, 'source') && !isPathAllowed(fullPath, 'personas')) {
            return '🚫 ไม่อนุญาต: สามารถอ่านได้เฉพาะไฟล์ใน src/ และ personas/ เท่านั้น';
        }
        if (!fs.existsSync(fullPath)) return `❌ ไม่พบไฟล์: ${file_path}`;
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n').length;
        return `📄 ${file_path} (${lines} lines):\n---\n${content.substring(0, 5000)}\n---${content.length > 5000 ? `\n[...truncated, total ${content.length} chars]` : ''}`;
    } catch (err: any) {
        return `❌ อ่านไฟล์ไม่ได้: ${err.message}`;
    }
}
// ============================================================
// Tool 2: self_edit_persona — แก้ไข persona files
// ============================================================
export const selfEditPersonaDeclaration: AITool = {
    name: 'self_edit_persona',
    description: 'แก้ไข persona ของตัวเอง (AGENTS.md, IDENTITY.md, SOUL.md, TOOLS.md) เพื่อปรับปรุงพฤติกรรมและการตอบ (auto-backup ก่อนแก้)',
    parameters: {
        type: 'object',
        properties: {
            platform: {
                type: 'string',
                description: 'platform ที่ต้องการแก้ เช่น "telegram", "line"',
            },
            file_name: {
                type: 'string',
                description: 'ชื่อไฟล์: AGENTS.md, IDENTITY.md, SOUL.md, TOOLS.md',
            },
            new_content: {
                type: 'string',
                description: 'เนื้อหาใหม่ทั้งหมดที่ต้องการเขียน',
            },
            reason: {
                type: 'string',
                description: 'เหตุผลที่ต้องการแก้ไข (จะถูกบันทึกใน evolution log)',
            },
        },
        required: ['platform', 'file_name', 'new_content', 'reason'],
    },
};
export async function selfEditPersona(
    { platform, file_name, new_content, reason }: { platform: string; file_name: string; new_content: string; reason: string }
): Promise<string> {
    const allowedFiles = ['AGENTS.md', 'IDENTITY.md', 'SOUL.md', 'TOOLS.md'];
    if (!allowedFiles.includes(file_name)) {
        return `🚫 ไม่อนุญาต: ไฟล์ที่แก้ได้มีแค่ ${allowedFiles.join(', ')}`;
    }
    const filePath = path.join(PERSONAS_DIR, platform, file_name);
    if (!isPathAllowed(filePath, 'personas')) {
        return '🚫 ไม่อนุญาต: path อยู่นอก personas directory';
    }
    try {
        const backupPath = backupFile(filePath);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, new_content, 'utf8');
        logEvolution('self_edit', `Edited persona: ${platform}/${file_name} — ${reason}`, {
            platform, file_name, reason,
            backup: backupPath,
            newContentLength: new_content.length,
        });
        log.info('Persona edited', { platform, file_name, reason });
        return `✅ แก้ไข ${platform}/${file_name} สำเร็จ!\nBackup: ${backupPath}\nReason: ${reason}`;
    } catch (err: any) {
        return `❌ แก้ไขไม่ได้: ${err.message}`;
    }
}
// ============================================================
// Tool 3: self_add_learning — บันทึกสิ่งที่เรียนรู้
// ============================================================
export const selfAddLearningDeclaration: AITool = {
    name: 'self_add_learning',
    description: 'บันทึกสิ่งที่เรียนรู้จากการทำงาน เช่น error solution, user pattern, prompt improvement — จะถูกนำไปใช้ปรับปรุงการตอบในอนาคต',
    parameters: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description: 'หมวดหมู่: user_patterns, tool_usage, error_solutions, prompt_improvements, performance, general',
            },
            insight: {
                type: 'string',
                description: 'สิ่งที่เรียนรู้ เช่น "ผู้ใช้มักถามเรื่อง crypto pricing ด้วยคำว่า เช็คราคา"',
            },
        },
        required: ['category', 'insight'],
    },
};
export async function selfAddLearning(
    { category, insight }: { category: string; insight: string }
): Promise<string> {
    try {
        const validCategories = ['user_patterns', 'tool_usage', 'error_solutions', 'prompt_improvements', 'performance', 'general'];
        if (!validCategories.includes(category)) {
            return `❌ category ไม่ถูกต้อง ต้องเป็น: ${validCategories.join(', ')}`;
        }
        addLearning(category as LearningCategory, insight, 'self_tool', 0.6);
        return `✅ บันทึกการเรียนรู้แล้ว: [${category}] ${insight}`;
    } catch (err: any) {
        return `❌ Error: ${err.message}`;
    }
}
// ============================================================
// Tool 4: self_view_evolution — ดู history การ evolve ตัวเอง
// ============================================================
export const selfViewEvolutionDeclaration: AITool = {
    name: 'self_view_evolution',
    description: 'ดู history การ evolve ตัวเอง: การแก้ไข, การเรียนรู้, การซ่อมตัวเอง ทั้งหมด',
    parameters: {
        type: 'object',
        properties: {
            view_type: {
                type: 'string',
                description: '"log" = evolution log, "learnings" = learning journal, "health" = health check',
            },
            limit: {
                type: 'number',
                description: 'จำนวนรายการ (ค่าเริ่มต้น 10)',
            },
        },
    },
};
export async function selfViewEvolution(
    { view_type, limit }: { view_type?: string; limit?: number }
): Promise<string> {
    try {
        const n = limit || 10;
        switch (view_type) {
            case 'learnings': {
                const learnings = getLearnings(undefined, n);
                if (learnings.length === 0) return '📓 ยังไม่มี learnings ที่บันทึก';
                return `📓 Learning Journal (${learnings.length} entries):\n` +
                    learnings.map((l, i) => `${i + 1}. [${l.category}] ${l.insight} (confidence: ${l.confidence}, used: ${l.times_applied}x)`).join('\n');
            }
            case 'health': {
                const result = runHealthCheck();
                if (result.issues.length === 0) return '✅ Health check passed — ไม่พบปัญหา';
                return `🏥 Health Check: ${result.issues.length} issues found, ${result.fixed} fixed\n` +
                    result.issues.map(i => `  ${i.severity === 'high' ? '🔴' : '🟡'} [${i.type}] ${i.description}`).join('\n');
            }
            default: {
                const logs = getEvolutionLog(n);
                if (logs.length === 0) return '📋 ยังไม่มี evolution log';
                return `📋 Evolution Log (${logs.length} entries):\n` +
                    logs.map((l: any, i: number) => {
                        if (!l) return `${i + 1}. [Invalid Log Entry]`;
                        return `${i + 1}. [${l.action_type}] ${l.description} (${l.created_at})`;
                    }).join('\n');
            }
        }
    } catch (err: any) {
        return `❌ Error: ${err.message}`;
    }
}
// ============================================================
// Tool 5: self_reflect — บังคับทำ self-reflection ตอนนี้
// ============================================================
export const selfReflectDeclaration: AITool = {
    name: 'self_reflect',
    description: 'วิเคราะห์ตัวเอง: error patterns, performance, tool usage แล้วสร้าง insights เพื่อปรับปรุง',
    parameters: { type: 'object', properties: {} },
};
export async function selfReflect(): Promise<string> {
    try {
        const report = await triggerReflection();
        if (!report) return '📊 ข้อมูลไม่เพียงพอสำหรับการวิเคราะห์ (ต้องมี >= 5 runs)';
        let output = `🧠 Self-Reflection Report:\n\n`;
        output += `📋 Findings (${report.findings.length}):\n`;
        output += report.findings.map(f => `  ${f}`).join('\n');
        output += `\n\n💡 Suggestions (${report.suggestions.length}):\n`;
        output += report.suggestions.map(s => `  • ${s}`).join('\n');
        output += `\n\n⚡ Auto-Actions: ${report.autoActions.filter(a => a.applied).length}/${report.autoActions.length} applied`;
        return output;
    } catch (err: any) {
        return `❌ Error: ${err.message}`;
    }
}
// ============================================================
// Tool 6: self_heal — บังคับทำ health check + auto-fix
// ============================================================
export const selfHealDeclaration: AITool = {
    name: 'self_heal',
    description: 'ตรวจสอบสุขภาพระบบและซ่อมแซมปัญหาที่พบอัตโนมัติ: auto-switch model, clear stuck queues',
    parameters: { type: 'object', properties: {} },
};
export async function selfHeal(): Promise<string> {
    try {
        const result = runHealthCheck();
        if (result.issues.length === 0) {
            return '✅ ระบบสุขภาพดี — ไม่พบปัญหาที่ต้องแก้ไข';
        }
        let output = `🔧 Self-Healing Report:\n`;
        output += `Issues: ${result.issues.length} | Fixed: ${result.fixed} | Skipped: ${result.skipped}\n\n`;
        for (const issue of result.issues) {
            const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
            output += `${icon} ${issue.description}\n  → ${issue.suggestedFix}\n`;
        }
        return output;
    } catch (err: any) {
        return `❌ Error: ${err.message}`;
    }
}
// ============================================================
// Tool 7: create_tool — Create new dynamic tools
// ============================================================
import { registerDynamicTool, unregisterDynamicTool, listDynamicTools, getDynamicTool } from './dynamicTools.js';
export const createToolDeclaration: AITool = {
    name: 'create_tool',
    description: 'สร้างเครื่องมือใหม่ที่ฉันสามารถใช้ได้ ให้ระบุชื่อ, คำอธิบาย, schema ของ parameter, และ code implementation',
    parameters: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'ชื่อเครื่องมือ (kebab-case, เช่น fetch-weather, convert-units)',
            },
            description: {
                type: 'string',
                description: 'คำอธิบายว่าเครื่องมือนี้ทำอะไร',
            },
            parameters: {
                type: 'object',
                description: 'JSON Schema สำหรับ parameter ของเครื่องมือ (ใช้ type object)',
            },
            code: {
                type: 'string',
                description: 'TypeScript/JavaScript code สำหรับ handler ฟังก์ชัน (async function body, return ผลลัพธ์เป็น string)',
            },
        },
        required: ['name', 'description', 'code'],
    },
};
export async function createTool({
    name,
    description,
    code,
    parameters,
}: {
    name: string;
    description: string;
    code: string;
    parameters?: Record<string, unknown>;
}): Promise<string> {
    try {
        const result = await registerDynamicTool(name, description, code, parameters);

        const errors = Array.isArray(result.errors) ? result.errors : [];
        const warnings = Array.isArray(result.warnings) ? result.warnings : [];

        if (!result.valid) {
            let errorMsg = `❌ ไม่สามารถสร้างเครื่องมือได้:\n`;
            errorMsg += errors.map((e) => `  • ${e}`).join('\n');
            if (warnings.length > 0) {
                errorMsg += `\n\n⚠️ Warnings:\n`;
                errorMsg += warnings.map((w) => `  • ${w}`).join('\n');
            }
            return errorMsg;
        }

        let successMsg = `✅ สร้างเครื่องมือ '${name}' สำเร็จแล้ว!`;
        if (warnings.length > 0) {
            successMsg += `\n\n⚠️ Warnings:\n`;
            successMsg += warnings.map((w) => `  • ${w}`).join('\n');
        }
        return successMsg;
    } catch (err: any) {
        return `❌ Error: ${err.message}`;
    }
}
// ============================================================
// Tool 8: list_dynamic_tools — List all custom tools
// ============================================================
export const listDynamicToolsDeclaration: AITool = {
    name: 'list_dynamic_tools',
    description: 'แสดงรายการเครื่องมือที่เราสร้างขึ้นเองทั้งหมด',
    parameters: { type: 'object', properties: {} },
};
export async function listDynamicToolsHandler(): Promise<string> {
    try {
        const tools = listDynamicTools();
        if (tools.length === 0) {
            return '📋 ยังไม่มีเครื่องมือที่สร้างขึ้นเอง';
        }
        let output = `📋 Custom Tools (${tools.length}):\n\n`;
        for (const tool of tools) {
            output += `• ${tool.name}\n`;
            output += `  ${tool.description}\n`;
            if (tool.parameters) {
                const hasProperties = (tool.parameters as any)?.properties;
                if (tool.parameters && typeof tool.parameters === 'object' && !hasProperties) {
                    log.warn(`Dynamic tool '${tool.name}' has a 'parameters' schema without 'properties' field, or 'properties' is not an object. Displaying as simple type.`, { toolParameters: tool.parameters });
                }
                if (hasProperties) {
                    const paramList = Object.keys(hasProperties)
                        .map((p) => `${p}`)
                        .join(', ');
                    output += `  Parameters: ${paramList}\n`;
                }
            }
            output += '\n';
        }
        return output;
    } catch (err: any) {
        return `❌ Error: ${err.message}`;
    }
}
// ============================================================
// Tool 9: delete_dynamic_tool — Delete a custom tool
// ============================================================
export const deleteDynamicToolDeclaration: AITool = {
    name: 'delete_dynamic_tool',
    description: 'ลบเครื่องมือที่สร้างขึ้นเอง (ไม่สามารถคืนได้)',
    parameters: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'ชื่อของเครื่องมือที่ต้องการลบ',
            },
        },
        required: ['name'],
    },
};
export async function deleteDynamicTool({ name }: { name: string }): Promise<string> {
    try {
        const tool = getDynamicTool(name);
        if (!tool) {
            return `❌ ไม่พบเครื่องมือ: ${name}`;
        }
        const result = await unregisterDynamicTool(name);
        if (!result.valid) {
            return `❌ ไม่สามารถลบเครื่องมือได้: ${result.errors.join(', ')}`;
        }
        return `✅ ลบเครื่องมือ '${name}' สำเร็จแล้ว`;
    } catch (err: any) {
        return `❌ Error: ${err.message}`;
    }
}
// ============================================================
// Tool: easy_create_tool — User-Friendly Tool Wizard
// สร้าง tool ใหม่แบบง่าย ไม่ต้องเขียนโค้ดเอง
// บอกแค่ว่าต้องการทำอะไร + input ที่ต้องการ
// ระบบจะสร้างโค้ดและบันทึกไฟล์ JSON ให้อัตโนมัติ
// ============================================================
export const easyCreateToolDeclaration: AITool = {
    name: 'easy_create_tool',
    description: 'สร้าง tool ใหม่แบบง่าย — ไม่ต้องเขียนโค้ด บอกแค่ว่าต้องการทำอะไร ระบบจะสร้างและบันทึกให้เอง',
    parameters: {
        type: 'object',
        properties: {
            tool_name: {
                type: 'string',
                description: 'ชื่อ tool (ภาษาอังกฤษ, ใช้ underscore เช่น get_gold_price, send_line_message)',
            },
            what_it_does: {
                type: 'string',
                description: 'อธิบายว่า tool นี้ทำอะไร เช่น "ดึงราคาทองคำจากเว็บสมาคมค้าทองคำ" หรือ "แปลงอุณหภูมิจาก C เป็น F"',
            },
            inputs: {
                type: 'string',
                description: 'รายการ input ที่ต้องการ เขียนแบบง่ายๆ เช่น "city=ชื่อเมือง" หรือ "amount=จำนวนเงิน, from_currency=สกุลเงินต้นทาง" หรือ "ไม่มี input"',
            },
            api_url: {
                type: 'string',
                description: '(ถ้ามี) URL ของ API ที่ต้องการเรียก เช่น https://api.example.com/gold',
            },
            example_output: {
                type: 'string',
                description: '(ถ้ามี) ตัวอย่างผลลัพธ์ที่ต้องการ เช่น "ราคาทองคำ: 45,000 บาท/บาท"',
            },
        },
        required: ['tool_name', 'what_it_does'],
    },
};

export async function easyCreateTool({
    tool_name,
    what_it_does,
    inputs,
    api_url,
    example_output,
}: {
    tool_name: string;
    what_it_does: string;
    inputs?: string;
    api_url?: string;
    example_output?: string;
}): Promise<string> {
    try {
        // ── 1. Normalize tool name ──
        const name = tool_name.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (!name) return '❌ ชื่อ tool ไม่ถูกต้อง กรุณาใช้ตัวอักษรภาษาอังกฤษและ underscore เท่านั้น';

        // ── 2. Parse inputs into parameter schema ──
        const paramProperties: Record<string, { type: string; description: string }> = {};
        const paramRequired: string[] = [];

        if (inputs && inputs !== 'ไม่มี' && inputs !== 'ไม่มี input' && inputs.trim() !== '') {
            const pairs = inputs.split(',').map(s => s.trim()).filter(Boolean);
            for (const pair of pairs) {
                const [key, desc] = pair.split('=').map(s => s.trim());
                if (key) {
                    const paramKey = key.toLowerCase().replace(/\s+/g, '_');
                    paramProperties[paramKey] = { type: 'string', description: desc || key };
                    paramRequired.push(paramKey);
                }
            }
        }

        const parameters = Object.keys(paramProperties).length > 0 ? {
            type: 'object',
            properties: paramProperties,
            required: paramRequired,
        } : { type: 'object', properties: {} };

        // ── 3. Generate JavaScript code based on description ──
        let code = '';
        const paramVarLines = Object.keys(paramProperties)
            .map(k => `const ${k} = String(args.${k} ?? '');`)
            .join('\n');

        if (api_url) {
            // HTTP fetch template
            const hasParams = Object.keys(paramProperties).length > 0;
            const queryPart = hasParams
                ? `?${Object.keys(paramProperties).map(k => `${k}=\${encodeURIComponent(${k})}`).join('&')}`
                : '';
            code = `${paramVarLines ? paramVarLines + '\n' : ''}// 📡 เรียก API: ${what_it_does}
try {
  const res = await fetch(\`${api_url}${queryPart}\`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'PersonalAIBot/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return \`❌ API ตอบกลับ \${res.status}: \${res.statusText}\`;
  const data = await res.json();
  // TODO: ปรับ format ผลลัพธ์ตามโครงสร้าง JSON ที่ได้รับ
  return \`✅ ผลลัพธ์:\\n\${JSON.stringify(data, null, 2).substring(0, 1000)}\`;
} catch (err) {
  return \`❌ เรียก API ไม่สำเร็จ: \${err.message}\`;
}`;
        } else {
            // Generic template
            const exampleLine = example_output ? `\n// ตัวอย่างผลลัพธ์ที่ต้องการ: ${example_output}` : '';
            code = `${paramVarLines ? paramVarLines + '\n' : ''}// 🔧 ${what_it_does}${exampleLine}
// TODO: เพิ่ม logic การทำงานที่นี่
// เช่น: const result = ... หรือ const res = await fetch(...)
return \`✅ ${name}: ยังต้องเพิ่ม logic — แก้ไขได้ที่ dynamic_tools/${name}.json\`;`;
        }

        // ── 4. Register the tool ──
        const result = await registerDynamicTool(name, what_it_does, code, parameters as any);

        if (!result.valid) {
            return `❌ ไม่สามารถสร้าง tool ได้:\n${(result.errors || []).join('\n')}`;
        }

        // ── 5. Return clear summary ──
        const paramSummary = Object.keys(paramProperties).length > 0
            ? `\n📥 Input: ${Object.entries(paramProperties).map(([k, v]) => `${k} (${v.description})`).join(', ')}`
            : '\n📥 Input: ไม่มี (ใช้งานได้เลย)';
        const filePath = `server/dynamic_tools/${name}.json`;

        let msg = `✅ สร้าง tool "${name}" สำเร็จ!\n`;
        msg += `📋 หน้าที่: ${what_it_does}${paramSummary}\n`;
        msg += `💾 บันทึกไว้ที่: ${filePath}\n`;
        if (!api_url) {
            msg += `\n⚙️ หมายเหตุ: tool นี้ยังต้องเพิ่ม logic — เปิดไฟล์ ${filePath} แล้วแก้ไข code ส่วน TODO`;
        } else {
            msg += `\n🌐 เชื่อมต่อ API: ${api_url}`;
        }
        return msg;

    } catch (err: any) {
        return `❌ Error: ${err.message}`;
    }
}

// ============================================================
// Export all declarations and handlers
// ============================================================
export const evolutionToolDeclarations: AITool[] = [
    selfReadSourceDeclaration,
    selfEditPersonaDeclaration,
    selfAddLearningDeclaration,
    selfViewEvolutionDeclaration,
    selfReflectDeclaration,
    selfHealDeclaration,
    createToolDeclaration,
    easyCreateToolDeclaration,
    listDynamicToolsDeclaration,
    deleteDynamicToolDeclaration,
];
export function getEvolutionToolHandlers(): Record<string, (args: any) => Promise<string>> {
    return {
        self_read_source: selfReadSource,
        self_edit_persona: selfEditPersona,
        self_add_learning: selfAddLearning,
        self_view_evolution: selfViewEvolution,
        self_reflect: selfReflect,
        self_heal: selfHeal,
        create_tool: createTool,
        easy_create_tool: easyCreateTool,
        list_dynamic_tools: listDynamicToolsHandler,
        delete_dynamic_tool: deleteDynamicTool,
    };
}
