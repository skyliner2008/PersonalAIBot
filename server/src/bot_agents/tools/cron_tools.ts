import { Type, type FunctionDeclaration } from '@google/genai';
import { dbAll, dbRun, dbGet } from '../../database/db.js';
import { v4 as uuidv4 } from 'uuid';
import { refreshCronJobs } from '../../scheduler/scheduler.js';
import { getSocketIO } from '../../utils/socketBroadcast.js';

// ==========================================
// Tool Declarations
// ==========================================

export const createCronJobDeclaration: FunctionDeclaration = {
  name: "create_cron_job",
  description: "ตั้งเวลาให้ตัวเอง (AI) ทำงานบางอย่างในอนาคต หรือทำซ้ำๆ ตามรอบเวลา โดยใช้ Cron Expression (เช่น '0 8 * * *' สำหรับ 8 โมงเช้าทุกวัน). หากผู้ใช้สั่งให้ 'เตือนฉัน', 'เช็คราคา', หรือ 'สรุปข่าวทุกๆ...' ให้ใช้เครื่องมือนี้",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: "ชื่องานแบบสั้นๆ ให้จำง่าย (เช่น 'Daily News', 'Gold Price Check')",
      },
      cron_expression: {
        type: Type.STRING,
        description: "รูปแบบเวลาแบบ Cron Expression 5 ตำแหน่ง (เช่น '0 8 * * *', '*/30 * * * *'). หมายเหตุ: Server ใช้เวลา Timezone ของระบบ (Asia/Bangkok)",
      },
      prompt: {
        type: Type.STRING,
        description: "คำสั่งเต็มรูปแบบที่จะให้ตัวเองทำเมื่อถึงเวลา เช่น 'สรุปข่าวไอทีล่าสุด 3 ข่าว แล้วส่งมาให้หน่อย'",
      }
    },
    required: ["name", "cron_expression", "prompt"],
  },
};

export const listCronJobsDeclaration: FunctionDeclaration = {
  name: "list_cron_jobs",
  description: "ดูรายการงานทั้งหมดที่คุณ (AI) ถูกตั้งเวลาไว้ในแชทนี้ เพื่อตรวจสอบหรือบอกผู้ใช้ว่ามีคิวงานอะไรบ้าง",
  parameters: {
    type: Type.OBJECT,
    properties: {}, // No params needed, relies on context
  },
};

export const deleteCronJobDeclaration: FunctionDeclaration = {
  name: "delete_cron_job",
  description: "ลบหรือยกเลิกการตั้งเวลาทำงาน (Cron Job) ตาม ID งานที่ระบุ. ให้ใช้ list_cron_jobs ก่อนเพื่อหา ID งานที่จะลบ",
  parameters: {
    type: Type.OBJECT,
    properties: {
      job_id: {
        type: Type.STRING,
        description: "ID ของงานที่ต้องการลบ (เช่น 'some-uuid-1234')",
      }
    },
    required: ["job_id"],
  },
};

// ==========================================
// Handlers
// ==========================================

export function createCronHandlers(context: any) {
  const safeContext = context || {};
  return {
    create_cron_job: async (args: any) => {
      try {
        const { name, cron_expression, prompt } = args;
        
        // Basic cron validation
        const parts = cron_expression.trim().split(/\s+/);
        if (parts.length !== 5) {
          return `ล้มเหลว:รูปแบบ Cron Expression ไม่ถูกต้อง (${cron_expression}) ต้องมี 5 ตำแหน่ง`;
        }

        const id = uuidv4();
        const botId = context.botId || 'default';
        const chatId = context.session_id || 'unknown';
        const platform = context.platform || 'web'; // web, line, telegram

        dbRun(`
          INSERT INTO cron_jobs (id, name, cron_expression, prompt, bot_id, chat_id, platform, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `, [id, name, cron_expression, prompt, botId, chatId, platform]);

        // Refresh internal scheduler
        const io = getSocketIO();
        if (io) {
            refreshCronJobs(io);
        }

        return `✅ สร้างงานตั้งเวลาสำเร็จ!
- งาน: ${name}
- เวลา (Cron): ${cron_expression}
- คำสั่ง: ${prompt}
ID อ้างอิง: ${id}`;
      } catch (err: any) {
        return `❌ เกิดข้อผิดพลาดในการสร้าง Cron Job: ${err.message}`;
      }
    },

    list_cron_jobs: async () => {
      try {
        const chatId = context.session_id || 'unknown';
        const jobs = dbAll(
          'SELECT id, name, cron_expression, prompt, is_active FROM cron_jobs WHERE chat_id = ? ORDER BY created_at DESC',
          [chatId]
        ) as any[];

        if (jobs.length === 0) {
          return "ไม่มีงานที่ถูกตั้งเวลาไว้ในแชทนี้ครับ";
        }

        const listStr = jobs.map((j: any) => 
          `ID: ${j.id}\n- ชื่อ: ${j.name}\n- เวลา: ${j.cron_expression}\n- คำสั่ง: ${j.prompt}\n- สถานะ: ${j.is_active ? '✅ (ทำงานอยู่)' : '⏸️ (หยุดพัก)'}`
        ).join('\n\n');

        return `รายการตารางงานที่ตั้งไว้ทั้งหมดของคุณ:\n\n${listStr}`;
      } catch (err: any) {
         return `❌ ดูรายการไม่สำเร็จ: ${err.message}`;
      }
    },

    delete_cron_job: async (args: any) => {
      try {
        const { job_id } = args;
        const chatId = context.session_id || 'unknown';
        
        // Ensure user only deletes their own jobs
        const existing = dbGet('SELECT id FROM cron_jobs WHERE id = ? AND chat_id = ?', [job_id, chatId]);
        
        if (!existing) {
           return `❌ ไม่พบงาน ID ${job_id} หรือคุณไม่มีสิทธิ์ลบงานนี้`;
        }

        dbRun('DELETE FROM cron_jobs WHERE id = ?', [job_id]);

        // Refresh internal scheduler
        const io = getSocketIO();
        if (io) {
            refreshCronJobs(io);
        }

        return `🗑️ ยกเลิกงาน ID '${job_id}' เรียบร้อยแล้ว`;
      } catch (err: any) {
        return `❌ ลบงานไม่สำเร็จ: ${err.message}`;
      }
    }
  };
}
