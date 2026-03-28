import { getDb } from '../../database/db.js';
import { searchArchival } from '../../memory/unifiedMemory.js';
import type { AITool } from '../providers/baseProvider.js';

// ==========================================
// 1. Search Knowledge (Memory + Codebase Map)
// ==========================================
export const searchKnowledgeDeclaration: AITool = {
  name: "search_knowledge",
  description: "ค้นหาความรู้จากฐานข้อมูล (ความทรงจำเหตุการณ์, ข้อมูลทางเทคนิค, และสรุปโค้ดเบส) ใช้เมื่อต้องการคำตอบจากสิ่งที่เคยเรียนรู้มา",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: "คำค้นหาที่ต้องการ (เช่น 'วิธีเชื่อมต่อ DB', 'ฟังก์ชันคำนวณภาษีอยู่ที่ไหน')",
      },
    },
    required: ["query"],
  },
};

/** global holder for current chatId set by agent */
let _currentChatId = '';
export function setKnowledgeChatId(id: string) { _currentChatId = id; }

export async function searchKnowledge({ query }: { query: string }): Promise<string> {
  const results: string[] = [];

  // 1. Search Archival Memory (Semantic)
  try {
    const archival = await searchArchival(_currentChatId, query, 3, 0.5);
    if (archival.length > 0) {
      results.push("--- จากความทรงจำระยะยาว ---");
      archival.forEach((f, i) => results.push(`${i + 1}. ${f}`));
    }
  } catch (e) {
    console.error('[searchKnowledge] archival error:', e);
  }

  // 2. Search Codebase Map (Layer 2 - Summary search)
  try {
    const db = getDb();
    const codebaseMatches = db.prepare(`
      SELECT file_path, summary FROM codebase_map 
      WHERE file_path LIKE ? OR summary LIKE ? 
      LIMIT 5
    `).all(`%${query}%`, `%${query}%`) as any[];

    if (codebaseMatches.length > 0) {
      results.push("\n--- จากสรุปโครงสร้างโค้ดเบส (Second Brain) ---");
      codebaseMatches.forEach((m) => {
        results.push(` ไฟล์: ${m.file_path}\n สรุป: ${m.summary}\n`);
      });
    }
  } catch (e) {
    console.error('[searchKnowledge] codebase_map error:', e);
  }

  if (results.length === 0) {
    return `ไม่พบข้อมูลที่เกี่ยวข้องกับ "${query}" ในระบบความรู้`;
  }

  return results.join('\n');
}
