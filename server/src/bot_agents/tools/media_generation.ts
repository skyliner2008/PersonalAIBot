import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Type, FunctionDeclaration } from '@google/genai';
import { ProviderFactory } from '../../providers/providerFactory.js';
import type { BotContext } from '../types.js';
import { config } from '../../config.js';

// Auto-detect public URL (cloned from general tools)
let cachedPublicUrl: string | null = null;
let lastUrlCheck = 0;
const URL_CHECK_INTERVAL = 30_000;

async function getPublicBaseUrl(): Promise<string> {
  const now = Date.now();
  if (cachedPublicUrl && now - lastUrlCheck < URL_CHECK_INTERVAL) {
    return cachedPublicUrl;
  }
  try {
    const res = await fetch('http://localhost:4040/api/tunnels', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      const httpsTunnel = data.tunnels?.find((t: any) => t.proto === 'https');
      const tunnel = httpsTunnel || data.tunnels?.[0];
      if (tunnel?.public_url) {
        cachedPublicUrl = tunnel.public_url;
        lastUrlCheck = now;
        return cachedPublicUrl as string;
      }
    }
  } catch {}
  if (process.env.PUBLIC_URL) {
    cachedPublicUrl = process.env.PUBLIC_URL.replace(/\/$/, '');
    lastUrlCheck = now;
    return cachedPublicUrl;
  }
  return 'http://localhost:3000';
}

async function prepareFileReply(ctx: BotContext, absolutePath: string): Promise<string> {
  if (ctx.platform === 'line') {
    const baseUrl = await getPublicBaseUrl();
    const relativePart = path.relative(config.uploadsDir, absolutePath).replace(/\\/g, '/');
    return `${baseUrl}/media/${encodeURI(relativePart)}`;
  }
  return absolutePath;
}

// ===============================================
// Tool Declarations
// ===============================================

export const generateImageDeclaration: FunctionDeclaration = {
  name: "generate_image",
  description: "สร้างรูปภาพตามคำบรรยาย (Prompt) ที่ผู้ใช้ต้องการ (รองรับ DALL-E, Imagen และอื่นๆ)",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: "คำบรรยายรูปภาพที่ต้องการ ให้ใช้ภาษาที่โมเดลเข้าใจได้ดี (ภาษาอังกฤษจะดีที่สุด)",
      },
      n: {
        type: Type.INTEGER,
        description: "จำนวนรูปที่ต้องการสร้าง (default 1)",
      }
    },
    required: ["prompt"],
  },
};

export const generateSpeechDeclaration: FunctionDeclaration = {
  name: "generate_speech",
  description: "แปลงข้อความเป็นเสียงพูด (Text-to-Speech) และส่งไฟล์เสียงให้ผู้ใช้ (รองรับ OpenAI TTS, Gemini TTS)",
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: {
        type: Type.STRING,
        description: "ข้อความที่ต้องการให้ AI พูดออกมา",
      },
      voice: {
        type: Type.STRING,
        description: "ชื่อของเสียง ถ้ามี (เช่น alloy, echo, fable, onyx, nova, shimmer) หรือถ้าไม่แน่ใจให้ปล่อยว่าง",
      }
    },
    required: ["text"],
  },
};

export const generateVideoDeclaration: FunctionDeclaration = {
  name: "generate_video",
  description: "สร้างวิดีโอจากคำบรรยาย (รองรับผ่าน RestAPI provider ภายนอกเช่น Runway/Luma เมื่อตั้งค่าไว้)",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: "คำบรรยายวิดีโอที่ต้องการสร้าง (แนะนำภาษาอังกฤษยาวๆ)",
      }
    },
    required: ["prompt"],
  },
};

// ===============================================
// Handlers
// ===============================================

export const createMediaHandlers = (ctx: BotContext) => {
  return {
    generate_image: async ({ prompt, n = 1 }: { prompt: string, n?: number }) => {
      const providerDef = await ProviderFactory.getPrimaryProvider('image');
      if (!providerDef || !providerDef.instance.generateImage) {
        return '❌ Error: ไม่พบผู้ให้บริการสร้างรูปภาพ (Image Provider) ที่เปิดใช้งานอยู่ในระบบ';
      }

      try {
        const results = await providerDef.instance.generateImage(prompt, providerDef.id, { n });
        if (!fs.existsSync(config.uploadsDir)) {
          fs.mkdirSync(config.uploadsDir, { recursive: true });
        }

        const messages: string[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const fileName = `img_${Date.now()}_${i}.jpg`;
          const fp = path.join(config.uploadsDir, fileName);

          if (r.buffer) {
            fs.writeFileSync(fp, r.buffer);
            const deliveryPayload = await prepareFileReply(ctx, fp);
            await ctx.replyWithFile(deliveryPayload, `🎨 ${prompt}`);
            messages.push(`[System: จัดส่งรูปภาพ ${i+1} เรียบร้อย]`);
          } else if (r.b64_json) {
            fs.writeFileSync(fp, Buffer.from(r.b64_json, 'base64'));
            const deliveryPayload = await prepareFileReply(ctx, fp);
            await ctx.replyWithFile(deliveryPayload, `🎨 ${prompt}`);
            messages.push(`[System: จัดส่งรูปภาพ ${i+1} เรียบร้อย]`);
          } else if (r.url) {
            messages.push(`![Image](${r.url})`);
          }
        }
        return `✅ สร้างรูปภาพสำเร็จ\n${messages.join('\n')}`;
      } catch (err: any) {
        return `❌ เกิดข้อผิดพลาดในการสร้างรูปภาพ: ${err.message}`;
      }
    },

    generate_speech: async ({ text, voice }: { text: string, voice?: string }) => {
      const providerDef = await ProviderFactory.getPrimaryProvider('tts');
      if (!providerDef || !providerDef.instance.generateSpeech) {
        return '❌ Error: ไม่พบผู้ให้บริการ Text-to-Speech (TTS Provider) ที่เปิดใช้งานอยู่ในระบบ';
      }

      try {
        const buffer = await providerDef.instance.generateSpeech(text, providerDef.id, voice);
        if (!fs.existsSync(config.uploadsDir)) {
          fs.mkdirSync(config.uploadsDir, { recursive: true });
        }
        const fileName = `voice_${Date.now()}.mp3`;
        const fp = path.join(config.uploadsDir, fileName);
        fs.writeFileSync(fp, buffer);

        const deliveryPayload = await prepareFileReply(ctx, fp);
        await ctx.replyWithFile(deliveryPayload);
        return `✅ สร้างเสียงพูดสำเร็จและส่งชิ้นงานให้ผู้ใช้เรียบร้อย จำนวนตัวอักษร: ${text.length}`;
      } catch (err: any) {
        return `❌ เกิดข้อผิดพลาดในการสร้างเสียงพูด: ${err.message}`;
      }
    },

    generate_video: async ({ prompt }: { prompt: string }) => {
      // In the future for natively supported endpoints, mapped to REST Config
      const providerDef = await ProviderFactory.getPrimaryProvider('image'); // Note: fallbacks to image interface structurally
      if (!providerDef || typeof providerDef.instance.generateVideo !== 'function') {
        return '❌ Error: ระบบยังไม่พร้อมให้บริการสร้างวิดีโอ (No Video Provider detected)';
      }

      try {
        const results = await providerDef.instance.generateVideo(prompt, providerDef.id, {});
        const r = results[0];
        if (r && r.buffer) {
           const fp = path.join(config.uploadsDir, `vid_${Date.now()}.mp4`);
           fs.writeFileSync(fp, r.buffer);
           const deliveryPayload = await prepareFileReply(ctx, fp);
           await ctx.replyWithFile(deliveryPayload, prompt);
           return `✅ สร้างวิดีโอสำเร็จและส่งชิ้นงานไปแล้ว`;
        }
        if (r && r.url) {
           return `✅ วิดีโอพร้อมแล้ว: ${r.url}`;
        }
        return `❌ ไม่ได้ข้อมูลวิดีโอกลับมา`;
      } catch (err: any) {
        return `❌ เกิดข้อผิดพลาดในการสร้างวิดีโอ: ${err.message}`;
      }
    }
  };
};
