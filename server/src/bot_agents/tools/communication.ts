import { broadcast } from '../../utils/socketBroadcast.js';
import type { AITool } from '../providers/baseProvider.js';

// ==========================================
// 1. Notify User (Dashboard + Platform)
// ==========================================
export const notifyUserDeclaration: AITool = {
  name: "notify_user",
  description: "ส่งการแจ้งเตือนพิเศษ หรือข้อความสถานะสำคัญไปยังผู้ใช้ (Dashboard และแชท) ใช้เมื่อต้องการแจ้งความคืบหน้าที่สำคัญหรือสิ่งที่ต้องได้รับการยืนยัน",
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: "ข้อความแจ้งเตือน (เช่น 'ระบบอัปเกรดเสร็จสมบูรณ์แล้ว', 'มีไฟล์ที่ต้องการการตรวจสอบ')",
      },
      level: {
        type: 'string',
        enum: ['info', 'success', 'warning', 'error'],
        description: "ระดับความสำคัญของการแจ้งเตือน (ค่าเริ่มต้น: info)",
      },
    },
    required: ["message"],
  },
};

export const createCommunicationHandlers = (ctx: { replyWithText: (text: string) => Promise<any> }, chatId?: string) => {
  return {
    notify_user: async ({ message, level = 'info' }: { message: string, level?: string }) => {
      try {
        // 1. Broadcast to Dashboard
        broadcast('agent:notification', {
          chatId,
          message,
          level,
          timestamp: new Date().toISOString()
        });

        // 2. Also send as a reply if it's a critical level or significant update
        if (level === 'error' || level === 'warning') {
          await ctx.replyWithText(`🔔 [${level.toUpperCase()}]: ${message}`);
        }

        return `✅ ส่งการแจ้งเตือนระดับ ${level} สำเร็จ: "${message}"`;
      } catch (err: any) {
        return `❌ Failed to notify user: ${err.message}`;
      }
    }
  };
};
