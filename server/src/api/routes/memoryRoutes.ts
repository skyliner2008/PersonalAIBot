import { Router, Response } from 'express';
import { asyncHandler } from '../../utils/errorHandler.js';
import { addLog, dbAll, dbGet, dbRun, getDb } from '../../database/db.js';
import { formatCoreMemory, getCoreMemory, getMemoryStats, getWorkingMemory } from '../../memory/unifiedMemory.js';
import { parseIntParam } from './shared.js';
import { requireReadWriteAuth } from '../../utils/auth.js';

const memoryRoutes = Router();
memoryRoutes.use(requireReadWriteAuth('viewer'));

// Helper functions for common database queries
async function getConversationDetails(convId: string) {
  return await dbGet<{ fb_user_name: string | null; summary: string; summary_msg_count: number }>(
    'SELECT * FROM conversations WHERE id = ?',
    [convId],
  );
}

async function getUserProfile(userId: string) {
  return await dbGet<{ facts: string; tags: string; total_messages: number; first_contact: string }>(
    'SELECT * FROM user_profiles WHERE user_id = ?',
    [userId],
  );
}

async function getMessageCount(conversationId: string) {
  const res = await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?', [conversationId]);
  return res?.c || 0;
}

// FB conversation memory info
memoryRoutes.get('/memory/fb/:convId', asyncHandler(async (req, res) => {
  const convId = String(req.params.convId);
  const conv = await getConversationDetails(convId);
  if (!conv) return res.status(404).json({ success: false, error: 'Conversation not found' });

  const profile = await getUserProfile(convId);
  const msgCount = await getMessageCount(convId);

  const safeParse = (str: string) => {
    try { return JSON.parse(str); } catch { return []; }
  };

  res.json({
    conversationId: convId,
    userName: conv.fb_user_name,
    messageCount: msgCount,
    summary: conv.summary || '',
    summaryMsgCount: conv.summary_msg_count || 0,
    profile: profile ? {
      facts: safeParse(profile.facts),
      tags: safeParse(profile.tags),
      totalMessages: profile.total_messages,
      firstContact: profile.first_contact,
    } : null,
  });
}));

// Clear all legacy FB memory
memoryRoutes.delete('/memory/all', asyncHandler(async (_req, res) => {
  const db = getDb();
  db.transaction(() => {
    console.log('Starting transaction: Clear all legacy FB memory');
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM user_profiles').run();
    db.prepare('DELETE FROM conversations').run();
    console.log('Transaction completed: Clear all legacy FB memory');
  })();
  addLog('system', 'Wiped AI Memory', 'Cleared all conversations, messages, and profiles', 'warning');
  res.json({ success: true });
}));

// Clear one legacy FB conversation
memoryRoutes.delete('/memory/fb/:convId', asyncHandler(async (req, res) => {
  const convId = String(req.params.convId);
  const db = getDb();
  db.transaction(() => {
    console.log(`Starting transaction: Clear legacy FB memory for ID: ${convId}`);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId);
    db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(convId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
    console.log(`Transaction completed: Clear legacy FB memory for ID: ${convId}`);
  })();
  addLog('system', 'Cleared User Memory', `Cleared memory for ID: ${convId}`, 'info');
  res.json({ success: true });
}));

// Helper for paginated conversation fetching
async function getConversations(limit: number, offset: number) {
  const rows = await dbAll(`
    SELECT c.*, COUNT(m.id) as message_count
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.last_message_at DESC LIMIT ? OFFSET ?
  `, [limit, offset]);
  const totalResult = await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM conversations');
  return { items: rows, total: totalResult?.c ?? 0 };
}

// Conversations (with pagination)
memoryRoutes.get('/conversations', asyncHandler(async (req, res) => {
  const limit = parseIntParam(req.query.limit, 50, 1, 200);
  const offset = parseIntParam(req.query.offset, 0, 0, 100000);
  const { items, total } = await getConversations(limit, offset);
  res.json({ items, total, limit, offset });
}));

memoryRoutes.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const id = String(req.params.id);

  // Validate ID format (UUID, integer, or platform-specific ID) to prevent SQL injection or malformed requests
  if (!id || !/^[a-zA-Z0-9\-_]+$/.test(id)) {
    return res.status(400).json({ success: false, error: 'Invalid conversation ID format' });
  }

  const limit = parseIntParam(req.query.limit, 50, 1, 500);
  const rows = await dbAll(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?',
    [id, limit],
  );
  res.json(rows);
}));

// Memory viewer (with pagination)
memoryRoutes.get('/memory/chats', (req, res) => {
  const db = getDb();
  const limit = parseIntParam(req.query.limit, 50, 1, 200);
  const offset = parseIntParam(req.query.offset, 0, 0, 100000);
  try {
    // Combine data and total count into one query using a window function
    const rows = db.prepare(`
      SELECT e.chat_id,
             COUNT(e.id) as episodeCount,
             MAX(e.timestamp) as lastSeen,
             COUNT(*) OVER() as totalCount
      FROM episodes e
      GROUP BY e.chat_id
      ORDER BY lastSeen DESC
      LIMIT ? OFFSET ?
    `).all([limit, offset]) as any[];

    const total = rows.length > 0 ? rows[0].totalCount : 0;
    const items = rows.map(({ totalCount, ...rest }) => rest);

    res.json({ items, total, limit, offset });
  } catch {
    res.json({ items: [], total: 0, limit, offset });
  }
});

// Keep static memory routes before /memory/:chatId to avoid route shadowing.
memoryRoutes.get('/memory/vector-stats', async (_req, res) => {
  try {
    const { getVectorStore } = await import('../../memory/vectorStore.js');
    const { getEmbeddingStats } = await import('../../memory/embeddingProvider.js');
    const vs = await getVectorStore();
    const vectorStats = await vs.getStats();
    const embeddingStats = getEmbeddingStats();

    res.json({
      success: true,
      vectorStore: {
        totalDocuments: vectorStats.totalDocuments,
        indexSizeBytes: vectorStats.indexSize,
      },
      embeddingProvider: embeddingStats,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error fetching vector stats:', err);
    addLog('system', 'Vector Stats Error', err.message || 'Unknown error', 'error');
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

memoryRoutes.post('/memory/rebuild-index', async (_req, res) => {
  try {
    const { getVectorStore } = await import('../../memory/vectorStore.js');
    const vs = await getVectorStore();
    const result = await vs.rebuildFromSQLite();

    addLog('system', 'Vector index rebuilt', `migrated=${result.migrated}, errors=${result.errors}`, 'info');

    res.json({
      success: true,
      migrated: result.migrated,
      errors: result.errors,
      message: `Rebuilt vector index: ${result.migrated} documents indexed, ${result.errors} errors`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

memoryRoutes.get('/memory/:chatId', (req, res) => {
  const chatId = String(req.params.chatId);

  // Validate ID format (UUID, integer, or platform-specific ID) to prevent SQL injection or malformed requests
  if (!chatId || !/^[a-zA-Z0-9\-_]+$/.test(chatId)) {
    return res.status(400).json({ success: false, error: 'Invalid chat ID format' });
  }

  const db = getDb();
  const archivalLimit = parseIntParam(req.query.archivalLimit, 30, 1, 200);
  const archivalOffset = parseIntParam(req.query.archivalOffset, 0, 0, 100000);
  try {
    const stats = getMemoryStats(chatId);
    const coreBlocks = getCoreMemory(chatId);
    const coreText = formatCoreMemory(coreBlocks);
    const workingMessages = getWorkingMemory(chatId);
    const archival = db.prepare(
      'SELECT id, fact, created_at FROM archival_memory WHERE chat_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ).all([chatId, archivalLimit, archivalOffset]) as any[];
    const archivalTotal = (db.prepare('SELECT COUNT(*) as c FROM archival_memory WHERE chat_id = ?').get([chatId]) as any)?.c ?? 0;
    const episodeCount = (db.prepare('SELECT COUNT(*) as c FROM episodes WHERE chat_id = ?').get([chatId]) as any)?.c ?? 0;

    res.json({
      chatId,
      stats,
      core: { text: coreText, blocks: coreBlocks },
      working: workingMessages,
      archival: { items: archival, total: archivalTotal, limit: archivalLimit, offset: archivalOffset },
      episodeCount,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

memoryRoutes.delete('/memory/:chatId', asyncHandler(async (req, res) => {
  const chatId = String(req.params.chatId);

  // Validate ID format (UUID, integer, or platform-specific ID) to prevent SQL injection or malformed requests
  if (!chatId || !/^[a-zA-Z0-9\-_]+$/.test(chatId)) {
    return res.status(400).json({ success: false, error: 'Invalid chat ID format' });
  }

  // Use dbRun for consistent parameterized query execution and logging
  await dbRun('DELETE FROM archival_memory WHERE chat_id = ?', [chatId]);
  await dbRun('DELETE FROM core_memory WHERE chat_id = ?', [chatId]);
  await dbRun('DELETE FROM episodes WHERE chat_id = ?', [chatId]);

  try {
    const { getVectorStore } = await import('../../memory/vectorStore.js');
    const vs = await getVectorStore();
    await vs.deleteByFilter({ chatId });
  } catch {
    // Vector store may not be ready.
  }

  addLog('system', 'Memory cleared', chatId, 'info');
  res.json({ success: true });
}));

export default memoryRoutes;
