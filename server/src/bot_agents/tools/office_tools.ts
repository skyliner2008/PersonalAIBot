import * as fs from 'fs';
import * as path from 'path';
import { Type, FunctionDeclaration } from '@google/genai';
import { BotContext } from '../types.js';
import { config } from '../../config.js';
import * as cheerio from 'cheerio';

// Lazy-load to avoid slowing down bot startup
let pdfParse: any;
let PDFDocument: any;
let mammoth: any;
let docx: any;
let xlsx: any;

async function loadDependencies() {
  const pParse: any = await import('pdf-parse');
  if (!pdfParse) pdfParse = pParse.default || pParse;
  if (!PDFDocument) PDFDocument = (await import('pdfkit')).default;
  if (!mammoth) mammoth = (await import('mammoth')).default;
  if (!docx) docx = await import('docx');
  if (!xlsx) xlsx = await import('xlsx');
}

// ===============================================
// Tool Declarations
// ===============================================

export const readDocumentDeclaration: FunctionDeclaration = {
  name: "read_document",
  description: "อ่านเนื้อหาและข้อความจากไฟล์เอกสาร Local (รองรับ .pdf, .docx, .xlsx, .csv, .txt) เพื่อนำข้อความเหล่านั้นมาให้ AI วิเคราะห์หรือสรุป",
  parameters: {
    type: Type.OBJECT,
    properties: {
      file_path: {
        type: Type.STRING,
        description: "Absolute path ของไฟล์ที่ต้องการอ่าน เช่น C:\\Users\\MSI\\Documents\\report.pdf",
      }
    },
    required: ["file_path"],
  },
};

export const createDocumentDeclaration: FunctionDeclaration = {
  name: "create_document",
  description: "สร้างไฟล์เอกสารใหม่ (PDF, DOCX, XLSX) จากเนื้อหาที่ AI คิดขึ้นมา แล้วบันทึกลงเครื่อง",
  parameters: {
    type: Type.OBJECT,
    properties: {
      format: {
        type: Type.STRING,
        description: "ชนิดของไฟล์ที่ต้องการสร้าง ('pdf', 'docx', 'xlsx')",
      },
      content: {
        type: Type.STRING,
        description: "เนื้อหาของเอกสาร ถ้าเป็น xlsx ให้ส่งมาเป็น JSON String ของ Array of Objects (เช่น '[{\"Name\":\"A\",\"Age\":20}]') ถ้าเป็น pdf/docx ให้ส่งข้อความธรรมดา",
      },
      filename: {
        type: Type.STRING,
        description: "ชื่อไฟล์ที่ต้องการบันทึก (ระบุแค่ชื่อ เช่น 'report' ไม่ต้องใส่สกุลไฟล์)",
      }
    },
    required: ["format", "content", "filename"],
  },
};

export const editDocumentDeclaration: FunctionDeclaration = {
  name: "edit_document",
  description: "แก้ไขเอกสารที่มีอยู่เดิม (เฉพาะ .xlsx หรือ .csv) สำหรับเพิ่มแถวหรือแก้ไขข้อมูลตาราง (การแก้ไข PDF/Word โดยตรงทำได้ยาก แนะนำให้อ่านและสร้างใหม่แทน)",
  parameters: {
    type: Type.OBJECT,
    properties: {
      file_path: {
        type: Type.STRING,
        description: "Absolute path ของไฟล์ตาราง Excel/CSV ที่ต้องการแก้ไข",
      },
      json_data: {
        type: Type.STRING,
        description: "ข้อมูล JSON String ที่เป็น Array of Objects ที่จะนำไปต่อท้าย (Append) ในตารางเดิม",
      }
    },
    required: ["file_path", "json_data"],
  },
};

export const readGoogleDocDeclaration: FunctionDeclaration = {
  name: "read_google_doc",
  description: "อ่านข้อความจากลิงก์ Google Docs, Google Sheets หรือ Notion แบบ Public",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: {
        type: Type.STRING,
        description: "Public URL ของเอกสารออนไลน์ที่ต้องการให้อ่าน",
      }
    },
    required: ["url"],
  },
};

// ===============================================
// Handlers
// ===============================================

function getUploadDir() {
  if (!fs.existsSync(config.uploadsDir)) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
  }
  return config.uploadsDir;
}

export const createOfficeHandlers = (ctx: BotContext) => {
  return {
    read_document: async ({ file_path }: { file_path: string }) => {
      try {
        if (!fs.existsSync(file_path)) return `❌ Error: ไม่พบไฟล์ที่ตำแหน่ง ${file_path}`;
        await loadDependencies();

        const ext = path.extname(file_path).toLowerCase();
        if (ext === '.pdf') {
          const dataBuffer = fs.readFileSync(file_path);
          const data = await pdfParse(dataBuffer);
          return `📄 เนื้อหา PDF:\n${data.text}`;
        } 
        
        if (ext === '.docx') {
          const result = await mammoth.extractRawText({ path: file_path });
          return `📄 เนื้อหา Word:\n${result.value}`;
        }
        
        if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
          const workbook = xlsx.readFile(file_path);
          if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            return `❌ Error: ไฟล์ Excel/CSV ไม่มี Sheet ให้ประมวลผล`;
          }
          const sheetName = workbook.SheetNames[0];
          const json = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
          return `📊 ข้อมูลตาราง (JSON):\n${JSON.stringify(json, null, 2)}`;
        }
        
        if (ext === '.txt' || ext === '.md' || ext === '.json') {
          return fs.readFileSync(file_path, 'utf8');
        }

        return `❌ Error: ไม่รองรับการอ่านนามสกุลไฟล์ชนิดนี้ (${ext})`;
      } catch (err: any) {
        return `❌ Read Error: ${err.message}`;
      }
    },

    create_document: async ({ format, content, filename }: { format: string, content: string, filename: string }) => {
      try {
        await loadDependencies();
        const cleanName = filename.replace(/[^a-zA-Z0-9_\u0E00-\u0E7F-]/g, '');
        let targetPath = '';

        if (format === 'pdf') {
          targetPath = path.join(getUploadDir(), `${cleanName}.pdf`);
          const doc = new PDFDocument();
          const stream = fs.createWriteStream(targetPath);
          await new Promise<void>((resolve, reject) => {
            stream.on('finish', resolve);
            stream.on('error', (err) => {
              doc.end(); // Ensure doc is ended even on stream error
              reject(err);
            });
            doc.pipe(stream);
            doc.fontSize(12).text(content, 50, 50);
            doc.end();
          });
        } 
        else if (format === 'docx') {
          targetPath = path.join(getUploadDir(), `${cleanName}.docx`);
          const d_docx = new docx.Document({
             creator: "Jarvis AI",
             sections: [{
                 properties: {},
                 children: content.split('\n').map(line => new docx.Paragraph({ children: [new docx.TextRun(line)] }))
             }]
          });
          const buffer = await docx.Packer.toBuffer(d_docx);
          fs.writeFileSync(targetPath, buffer);
        }
        else if (format === 'xlsx') {
          targetPath = path.join(getUploadDir(), `${cleanName}.xlsx`);
          let jsonData = [];
          try {
             jsonData = JSON.parse(content);
             if (!Array.isArray(jsonData)) throw new Error('Not an array');
          } catch {
             // Fallback if AI didn't provide JSON array
             jsonData = content.split('\n').map(line => ({ Data: line }));
          }
          const ws = xlsx.utils.json_to_sheet(jsonData);
          const wb = xlsx.utils.book_new();
          xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
          xlsx.writeFile(wb, targetPath);
        } else {
          return `❌ Error: รองรับเฉพาะ format: pdf, docx, xlsx เท่านั้น`;
        }

        return `✅ สร้างไฟล์สำเร็จแล้ว! บันทึกอยู่ที่:\n${targetPath}\n\nคุณสามารถใช้ Tool 'send_file_to_chat' เพื่อส่งไฟล์นี้ให้ผู้ใช้ได้เลยครับ`;
      } catch (err: any) {
        return `❌ Create Error: ${err.message}`;
      }
    },

    edit_document: async ({ file_path, json_data }: { file_path: string, json_data: string }) => {
      try {
        if (!fs.existsSync(file_path)) return `❌ Error: ไม่พบไฟล์ที่ ${file_path}`;
        const ext = path.extname(file_path).toLowerCase();
        
        if (ext === '.xlsx' || ext === '.csv') {
          await loadDependencies();
          const workbook = xlsx.readFile(file_path);
          if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            return `❌ Error: ไฟล์ Excel/CSV ไม่มี Sheet ให้แก้ไข`;
          }
          const sheetName = workbook.SheetNames[0];
          const existingData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
          
          let newData = [];
          try {
            newData = JSON.parse(json_data);
            if (!Array.isArray(newData)) newData = [newData];
          } catch {
            return `❌ Error: json_data ต้องเป็น JSON Array ที่ถูกต้อง`;
          }
          
          const combined = [...existingData, ...newData];
          const newWs = xlsx.utils.json_to_sheet(combined);
          workbook.Sheets[sheetName] = newWs;
          xlsx.writeFile(workbook, file_path);
          return `✅ แก้ไขอัปเดตไฟล์ Excel เรียบร้อยแล้ว (เพิ่มข้อมูลใหม่ต่อท้ายแถวเดิม)`;
        }

        return `❌ Error: edit_document รองรับเฉพาะไฟล์ Excel (.xlsx, .csv) เท่านั้นในตอนนี้ ส่วนไฟล์รูปแบบอื่นกรุณาอ่านแล้วสร้างไฟล์ใหม่ขึ้นมาแทน`;
      } catch (err: any) {
        return `❌ Edit Error: ${err.message}`;
      }
    },

    read_google_doc: async ({ url }: { url: string }) => {
      try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
        if (!response.ok) return `❌ Error: ไม่สามารถเข้าถึง URL ได้ (Status: ${response.status}) อาจจะไม่ได้ตั้งค่าเป็นแบบ Public`;
        
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Remove scripts and styles
        $('script, style, noscript, iframe, img, svg').remove();
        let text = $('body').text().replace(/\s+/g, ' ').trim();
        
        if (text.length > 50000) text = text.substring(0, 50000) + '... (ข้อมูลยาวเกินไปถูกตัดออก)';
        return `📄 ข้อมูลจากหน้าเว็บ/อกสารออนไลน์:\n${text}`;
      } catch (err: any) {
        return `❌ Web Fetch Error: ${err.message}`;
      }
    }
  };
};
