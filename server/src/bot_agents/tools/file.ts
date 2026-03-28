import * as fs from 'fs';
import * as path from 'path';
import type { AITool } from '../providers/baseProvider.js';
import { astEditor } from '../../evolution/astEditor.js';
import { refactorManager } from '../../evolution/refactorManager.js';

declare global {
  var onFileWrittenByTool: ((filePath: string) => void) | undefined;
}

// ============================================================
// 🔒 Path Security — prevent path traversal & system file access
// ============================================================
const BLOCKED_DIRS = [
  /[/\\]windows[/\\]system32/i,
  /[/\\]program files/i,
  /[/\\]programdata/i,
  /^[a-zA-Z]:[/\\]windows/i,
  /^\/etc/i,
  /^\/usr[/\\]bin/i,
  /^\/sys/i,
  /^\/proc/i,
];
const BLOCKED_EXTENSIONS = new Set(['.exe', '.dll', '.sys', '.bat', '.cmd', '.msi', '.scr', '.reg']);

async function executeFileOperation(
  filePath: string,
  mode: 'read' | 'write',
  errorPrefix: string,
  operation: (resolvedPath: string) => string | Promise<string>
): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  const check = validateFilePath(filePath, mode);
  if (!check.safe) return check.reason!;
  try {
    return await operation(resolvedPath);
  } catch (error: any) {
    return `${errorPrefix}: ${error.message}`;
  }
}

function validateFilePath(filePath: string, mode: 'read' | 'write' = 'write'): { safe: boolean; reason?: string } {
  const resolved = path.resolve(filePath);
  const normalized = resolved.replace(/\\/g, '/');

  // Block system directories (both read and write)
  for (const pattern of BLOCKED_DIRS) {
    if (pattern.test(normalized)) {
      return { safe: false, reason: `🚫 ไม่อนุญาตให้เข้าถึง system directory: ${resolved}` };
    }
  }

  // Write/Delete: stricter checks
  if (mode === 'write') {
    // Block path traversal — must stay within cwd
    const cwdResolved = path.resolve(process.cwd());
    if (!resolved.startsWith(cwdResolved)) {
      return { safe: false, reason: '🚫 Path traversal — เข้าถึงบริเวณที่ไม่อนุญาต' };
    }
    // Block dangerous file extensions (write/delete only)
    const ext = path.extname(resolved).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return { safe: false, reason: `🚫 ไม่อนุญาตให้แก้ไขไฟล์ประเภท ${ext}` };
    }
  }

  return { safe: true };
}

/**
 * 🕵️ Pre-flight Syntax Validation — basic structural check before writing to disk
 * Catches: unbalanced brackets, unterminated strings, and obvious syntax wreckage.
 */
function validateCodeSyntax(filePath: string, content: string): { ok: boolean; error?: string } {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx', '.json'].includes(ext)) return { ok: true };

  const basename = path.basename(filePath);
  let braces = 0, parens = 0, brackets = 0;
  let inString = false, stringChar = '', isEscaped = false;
  let inTemplate = false;
  let inLineComment = false, inBlockComment = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];

    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    
    if (inString) {
      if (isEscaped) { isEscaped = false; continue; }
      if (c === '\\') { isEscaped = true; continue; }
      if (c === stringChar) inString = false;
      continue;
    }
    
    if (inTemplate) {
      if (isEscaped) { isEscaped = false; continue; }
      if (c === '\\') { isEscaped = true; continue; }
      if (c === '`') inTemplate = false;
      continue;
    }

    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'") { inString = true; stringChar = c; continue; }
    if (c === '`') { inTemplate = true; continue; }

    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
  }

  if (inString) return { ok: false, error: `❌ ${basename}: Unterminated string literal (${stringChar})` };
  if (inTemplate) return { ok: false, error: `❌ ${basename}: Unterminated template literal (\`)` };
  if (braces !== 0) return { ok: false, error: `❌ ${basename}: Unbalanced braces { } (diff: ${braces})` };
  if (parens !== 0) return { ok: false, error: `❌ ${basename}: Unbalanced parentheses ( ) (diff: ${parens})` };
  if (brackets !== 0) return { ok: false, error: `❌ ${basename}: Unbalanced square brackets [ ] (diff: ${brackets})` };

  return { ok: true };
}


// ==========================================
// 1. List Files in Directory
// ==========================================
export const listFilesDeclaration: AITool = {
  name: "list_files",
  description: "แสดงรายชื่อไฟล์และโฟลเดอร์ในไดเรกทอรีที่ระบุ เพื่อดูว่ามีไฟล์อะไรอยู่บ้าง",
  parameters: {
    type: 'object',
    properties: {
      directory_path: {
        type: 'string',
        description: "พาธของไดเรกทอรี (เช่น 'C:\\Users\\MSI\\Documents' หรือ '.')",
      },
    },
    required: ["directory_path"],
  },
};

export async function listFiles({ directory_path }: { directory_path: string }): Promise<string> {
  const check = validateFilePath(directory_path, 'read');
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(directory_path);
    const files = await fs.promises.readdir(resolvedPath);
    return `รายชื่อไฟล์ใน ${resolvedPath}:\n${files.join('\n')}`;
  } catch (error: any) {
    return `ไม่สามารถอ่านไดเรกทอรีได้: ${error.message}`;
  }
}

// ==========================================
// 2. Read File Content
// ==========================================
export const readFileContentDeclaration: AITool = {
  name: "read_file_content",
  description: "อ่านเนื้อหาภายในไฟล์ (รองรับเฉพาะไฟล์ข้อความ .txt, .js, .ts, .json, .md)",
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: "พาธของไฟล์ที่ต้องการอ่าน",
      },
    },
    required: ["file_path"],
  },
};

export async function readFileContent({ file_path }: { file_path: string }): Promise<string> {
  const check = validateFilePath(file_path, 'read'); // updated
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');
    const numberedContent = lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
    return `เนื้อหาในไฟล์ ${resolvedPath} (พร้อมเลขบรรทัด):\n---\n${numberedContent}\n---`;
  } catch (error: any) {
    return `ไม่สามารถอ่านไฟล์ได้: ${error.message}`;
  }
}

// Alias for read_file_content
export const readFileDeclaration: AITool = {
  name: "read_file",
  description: "อ่านเนื้อหาภายในไฟล์ (Alias ของ read_file_content)",
  parameters: readFileContentDeclaration.parameters,
};
export const readFile = readFileContent;

// ==========================================
// 2.5 View File (Optimized for larger files)
// ==========================================
export const viewFileDeclaration: AITool = {
  name: "view_file",
  description: "ดูเนื้อหาไฟล์แบบระบุช่วงบรรทัด เพื่อประหยัด Token สำหรับไฟล์ขนาดใหญ่",
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: "พาธของไฟล์" },
      start_line: { type: 'number', description: "เริ่มที่บรรทัด (เริ่มต้นที่ 1)", default: 1 },
      end_line: { type: 'number', description: "จบที่บรรทัด (ไม่ระบุจะอ่านจนจบไฟล์)" },
    },
    required: ["file_path"],
  },
};

export async function viewFile({ file_path, start_line = 1, end_line }: { file_path: string, start_line?: number, end_line?: number }): Promise<string> {
  const check = validateFilePath(file_path, 'read');
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const allLines = content.split('\n');
    
    const start = Math.max(0, start_line - 1);
    const end = end_line ? Math.min(allLines.length, end_line) : allLines.length;
    
    const sliced = allLines.slice(start, end);
    const numberedContent = sliced.map((line, index) => `${start + index + 1}: ${line}`).join('\n');
    
    return `ไฟล์: ${resolvedPath} (บรรทัดที่ ${start + 1} ถึง ${end} จากทั้งหมด ${allLines.length} บรรทัด):\n---\n${numberedContent}\n---`;
  } catch (error: any) {
    return `Error viewing file: ${error.message}`;
  }
}

// ==========================================
// 3. Write/Create File
// ==========================================
export const writeFileContentDeclaration: AITool = {
  name: "write_file_content",
  description: "สร้างไฟล์ใหม่หรือเขียนทับไฟล์เดิมด้วยเนื้อหาที่ระบุ",
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: "พาธของไฟล์ที่ต้องการสร้างหรือแก้ไข",
      },
      content: {
        type: 'string',
        description: "เนื้อหาที่ต้องการเขียนลงในไฟล์",
      },
    },
    required: ["file_path", "content"],
  },
};

export async function writeFileContent({ file_path, content }: { file_path: string, content: string }): Promise<string> {
  const check = validateFilePath(file_path);
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const syntaxCheck = validateCodeSyntax(resolvedPath, content);
    if (!syntaxCheck.ok) {
      return `Error: การบันทึกถูกระงับเนื่องจากพบ Syntax Error - ${syntaxCheck.error}. กรุณาตรวจสอบโค้ดให้ถูกต้องก่อนลองใหม่อีกครั้ง`;
    }

    fs.writeFileSync(resolvedPath, content, 'utf8');
    
    // Allow external listeners (e.g. SelfUpgrade) to react before the server restarts
    if (typeof (global as any).onFileWrittenByTool === 'function') {
      (global as any).onFileWrittenByTool(resolvedPath);
    }

    return `เขียนไฟล์ลงใน ${resolvedPath} สำเร็จแล้ว`;
  } catch (error: any) {
    return `ไม่สามารถเขียนไฟล์ได้: ${error.message}`;
  }
}

// ==========================================
// 4. Delete File
// ==========================================
export const deleteFileDeclaration: AITool = {
  name: "delete_file",
  description: "ลบไฟล์ออกจากระบบอย่างถาวร (โปรดระมัดระวัง)",
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: "พาธของไฟล์ที่ต้องการลบ",
      },
    },
    required: ["file_path"],
  },
};

export async function deleteFile({ file_path }: { file_path: string }): Promise<string> {
  const check = validateFilePath(file_path);
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
      return `ลบไฟล์ ${resolvedPath} สำเร็จแล้ว`;
    }
    return `ไม่พบไฟล์ที่ต้องการลบ: ${resolvedPath}`;
  } catch (error: any) {
    return `เกิดข้อผิดพลาดในการลบไฟล์: ${error.message}`;
  }
}

// ==========================================
// 5. Surgical Code Replacement (Agentic Core)
// ==========================================
export const replaceCodeBlockDeclaration: AITool = {
  name: "replace_code_block",
  description: "ผ่าตัดโค้ด: แทนที่ข้อความหรือบล็อคโค้ดเดิมด้วยโค้ดใหม่ (ปลอดภัยกว่าการเขียนทับทั้งไฟล์)",
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: "พาธของไฟล์ที่ต้องการแก้ไข",
      },
      exact_old_string: {
        type: 'string',
        description: "ข้อความ/โค้ดเดิมเป๊ะๆ ที่ต้องการจะแก้ (รวม Tab/Space ให้ตรง)",
      },
      new_string: {
        type: 'string',
        description: "ข้อความ/โค้ดใหม่ที่จะใส่ลงไปแทนที่",
      },
    },
    required: ["file_path", "exact_old_string", "new_string"],
  },
};

export async function replaceCodeBlock({ file_path, exact_old_string, new_string }: { file_path: string, exact_old_string: string, new_string: string }): Promise<string> {
  const check = validateFilePath(file_path);
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    if (!fs.existsSync(resolvedPath)) {
      return `Error: ไม่พบไฟล์ที่กำหนด: ${resolvedPath}`;
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    if (!content.includes(exact_old_string)) {
      return `Error: ค้นหา exact_old_string ไม่เจอ กรุณาตรวจสอบว่าก็อปปี้มารวม \n และช่องว่าง (Space/Tab) ตรงตามต้นฉบับหรือไม่`;
    }
    const newContent = content.replace(exact_old_string, new_string);

    const syntaxCheck = validateCodeSyntax(resolvedPath, newContent);
    if (!syntaxCheck.ok) {
      return `Error: การแก้ไขถูกระงับเนื่องจากพบ Syntax Error - ${syntaxCheck.error}. กรุณาตรวจสอบโค้ดให้ถูกต้องก่อนลองใหม่อีกครั้ง`;
    }

    fs.writeFileSync(resolvedPath, newContent, 'utf8');
    
    // Allow external listeners (e.g. SelfUpgrade) to react
    if (typeof (global as any).onFileWrittenByTool === 'function') {
      (global as any).onFileWrittenByTool(resolvedPath);
    }

    return `Successfully replaced the exactly matched code block in ${resolvedPath}.`;
  } catch (error: any) {
    return `Error failed to replace code block: ${error.message}`;
  }

}

// ==========================================
// 5.5 Multi-Replace File Content
// ==========================================
export const multiReplaceFileContentDeclaration: AITool = {
  name: "multi_replace_file_content",
  description: "ผ่าตัดโค้ดหลายจุด: แทนที่บล็อคโค้ดหลายๆ จุดในไฟล์เดียวพร้อมกัน (มีประสิทธิภาพมากกว่าการรัน replace_code_block หลายรอบ)",
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: "พาธของไฟล์" },
      replacements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            exact_old_string: { type: 'string', description: "โค้ดเดิมเป๊ะๆ" },
            new_string: { type: 'string', description: "โค้ดใหม่" },
          },
          required: ["exact_old_string", "new_string"],
        },
        description: "รายการที่จะแทนที่",
      },
    },
    required: ["file_path", "replacements"],
  },
};

export async function multiReplaceFileContent({ file_path, replacements }: { file_path: string, replacements: { exact_old_string: string, new_string: string }[] }): Promise<string> {
  const check = validateFilePath(file_path);
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    if (!fs.existsSync(resolvedPath)) return `Error: ไม่พบไฟล์ ${resolvedPath}`;
    
    let content = fs.readFileSync(resolvedPath, 'utf8');
    let successfulCount = 0;
    
    for (const r of replacements) {
      if (content.includes(r.exact_old_string)) {
        content = content.replace(r.exact_old_string, r.new_string);
        successfulCount++;
      }
    }
    
    if (successfulCount === 0) {
      return `Error: ค้นหา exact_old_string ไม่เจอเลยสักจุดใน ${replacements.length} รายการที่ส่งมา`;
    }

    const syntaxCheck = validateCodeSyntax(resolvedPath, content);
    if (!syntaxCheck.ok) {
      return `Error: การแก้ไขถูกระงับเนื่องจากพบ Syntax Error - ${syntaxCheck.error}`;
    }

    fs.writeFileSync(resolvedPath, content, 'utf8');
    
    if (typeof (global as any).onFileWrittenByTool === 'function') {
      (global as any).onFileWrittenByTool(resolvedPath);
    }

    return `Successfully applied ${successfulCount}/${replacements.length} replacements in ${resolvedPath}.`;
  } catch (error: any) {
    return `Error in multi-replace: ${error.message}`;
  }
}

// ==========================================
// 6. Search Codebase (grep-like)
// ==========================================
export const searchCodebaseDeclaration: AITool = {
  name: "search_codebase",
  description: "ค้นหาข้อความ ตัวแปร หรือชื่อฟังก์ชัน (grep-like) ทั่วทั้งโปรเจกต์ เพื่อดูลำดับการเรียกใช้และ Dependencies",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: "คำประโยคที่ต้องการค้นหา เช่น 'validateBody'",
      },
      directory: {
        type: 'string',
        description: "พาธหรือโฟลเดอร์สำหรับค้นหา (ค่าเริ่มต้นคือ ./server/src)",
      }
    },
    required: ["query"],
  },
};

export async function searchCodebase({ query, directory }: { query: string, directory?: string }): Promise<string> {
  try {
    const startDir = path.resolve(directory && directory.trim() !== '' ? directory : path.join(process.cwd(), 'src'));
    const results: string[] = [];
    const MAX_RESULTS = 50;
    const MAX_DEPTH = 15;

    function walkDir(currentDir: string, depth: number = 0) {
      if (depth >= MAX_DEPTH || results.length >= MAX_RESULTS) return;
      const files = fs.readdirSync(currentDir);
      for (const file of files) {
        if (results.length >= MAX_RESULTS) return;
        const fullPath = path.join(currentDir, file);
        if (file === 'node_modules' || file === 'dist' || file === '.git' || file === '.gemini' || file === 'data' || file.startsWith('.')) continue;
        
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walkDir(fullPath, depth + 1);
          } else if (stat.isFile() && (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.css') || file.endsWith('.md'))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            let fileHasMatch = false;
            lines.forEach((line, index) => {
              if (line.includes(query)) {
                if (!fileHasMatch) {
                  results.push(`\n[${path.relative(process.cwd(), fullPath)}]`);
                  fileHasMatch = true;
                }
                results.push(`  ${index + 1}: ${line.trim()}`);
              }
            });
          }
        } catch (e) {
          // ignore
        }
      }
    }

    walkDir(startDir);

    if (results.length === 0) {
      return `ไม่พบผลลัพธ์การค้นหาคำว่า "${query}" ใน ${startDir}`;
    }

    const output = results.join('\n');
    if (results.length >= MAX_RESULTS) {
      return output + '\n... (มีผลลัพธ์อีกมาก แต่แสดงเพียง 50 รายการแรก)';
    }
    return output;
  } catch (error: any) {
    return `Error searching codebase: ${error.message}`;
  }
}

// ==========================================
// 7. AST: Replace Function/Method
// ==========================================
export const astReplaceFunctionDeclaration: AITool = {
  name: "ast_replace_function",
  description: "AST-Aware: แก้ไข/แทนที่ฟังก์ชันเป้าหมายโดยไม่ต้องสนเว้นวรรค (space/tab) หรือรูปแบบเก่า เพียงบอกชื่อและให้โค้ดใหม่ทั้งหมด",
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: "พาธของไฟล์เป้าหมาย",
      },
      function_name: {
        type: 'string',
        description: "ชื่อฟังก์ชัน ตัวแปรที่เป็นฟังก์ชัน หรือเมธอดในคลาส",
      },
      new_function_code: {
        type: 'string',
        description: "โค้ดใหม่ทั้งหมดของฟังก์ชันนี้ (รวม signature และ body)",
      },
    },
    required: ["file_path", "function_name", "new_function_code"],
  },
};

export async function astReplaceFunction({ file_path, function_name, new_function_code }: { file_path: string, function_name: string, new_function_code: string }): Promise<string> {
  const check = validateFilePath(file_path);
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    astEditor.replaceFunction(resolvedPath, function_name, new_function_code);
    await astEditor.saveFile(resolvedPath);
    
    // Trigger external listeners
    if (typeof (global as any).onFileWrittenByTool === 'function') {
      (global as any).onFileWrittenByTool(resolvedPath);
    }
    
    return `Successfully updated function '${function_name}' in ${resolvedPath} using AST.`;
  } catch (error: any) {
    return `AST Error: ${error.message}`;
  }
}

// ==========================================
// 8. AST: Add Import
// ==========================================
export const astAddImportDeclaration: AITool = {
  name: "ast_add_import",
  description: "AST-Aware: เพิ่มคำสั่ง import ใหม่เข้าไปในไฟล์อย่างชาญฉลาด (ช่วยควบรวมกับ import ที่มีอยู่แล้วได้)",
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: "พาธของไฟล์",
      },
      module_specifier: {
        type: 'string',
        description: "ชื่อโมดูลเป้าหมายหรือพาธ relative (เช่น 'fs', '../utils', 'react')",
      },
      named_imports: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: "รายชื่อ import แบบปีกกา { } (ถ้ามี)",
      },
      default_import: {
        type: 'string',
        description: "ชื่อ import default (ถ้ามี)",
      },
    },
    required: ["file_path", "module_specifier"],
  },
};

export async function astAddImport({ file_path, module_specifier, named_imports, default_import }: { file_path: string, module_specifier: string, named_imports?: string[], default_import?: string }): Promise<string> {
  const check = validateFilePath(file_path);
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    astEditor.addImport(resolvedPath, module_specifier, named_imports, default_import);
    await astEditor.saveFile(resolvedPath);
    
    // Trigger external listeners
    if (typeof (global as any).onFileWrittenByTool === 'function') {
      (global as any).onFileWrittenByTool(resolvedPath);
    }
    
    return `Successfully added import from '${module_specifier}' in ${resolvedPath} using AST.`;
  } catch (error: any) {
    return `AST Error: ${error.message}`;
  }
}

// ==========================================
// 9. AST: Find References (Global)
// ==========================================
export const findReferencesDeclaration: AITool = {
  name: "find_references",
  description: "Global Search: ค้นหาว่าชื่อฟังก์ชัน/ตัวแปรนี้ ถูกใช้งานที่ไหนบ้างทั่วทั้งโปรเจกต์ (ช่วยวางแผนก่อน Refactor)",
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: "พาธของไฟล์ที่นิยามชื่อนั้นไว้ (เช่น 'src/utils/math.ts')",
      },
      symbol_name: {
        type: 'string',
        description: "ชื่อฟังก์ชัน ตัวแปร หรือคลาสที่ต้องการหา",
      },
    },
    required: ["file_path", "symbol_name"],
  },
};

export async function findReferences({ file_path, symbol_name }: { file_path: string, symbol_name: string }): Promise<string> {
  const check = validateFilePath(file_path, 'read');
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    const impacts = await refactorManager.findReferences(symbol_name, resolvedPath);
    
    if (impacts.length === 0) {
      return `ไม่พบการเรียกใช้งานชื่อ '${symbol_name}' ในไฟล์อื่น (ยกเว้นในตัวมันเอง)`;
    }

    const report = impacts.map(imp => {
      const rel = path.relative(process.cwd(), imp.file);
      return `- [${rel}:${imp.line}]: ${imp.snippet.trim()}`;
    }).join('\n');

    return `พบการใช้งาน '${symbol_name}' ทั้งหมด ${impacts.length} จุด:\n${report}`;
  } catch (error: any) {
    return `Refactor Error: ${error.message}`;
  }
}

// ==========================================
// 10. AST: Global Rename
// ==========================================
export const astRenameDeclaration: AITool = {
  name: "ast_rename",
  description: "Global Refactor: เปลี่ยนชื่อฟังก์ชัน/ตัวแปร/คลาส ทุกที่ที่มีการเรียกใช้งานทั่วทั้งโปรเจกต์อย่างปลอดภัย",
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: "พาธของไฟล์ที่นิยามชื่อเดิม",
      },
      old_name: {
        type: 'string',
        description: "ชื่อเดิมที่ต้องการเปลี่ยน",
      },
      new_name: {
        type: 'string',
        description: "ชื่อใหม่ที่ต้องการ",
      },
    },
    required: ["file_path", "old_name", "new_name"],
  },
};

export async function astRename({ file_path, old_name, new_name }: { file_path: string, old_name: string, new_name: string }): Promise<string> {
  const check = validateFilePath(file_path);
  if (!check.safe) return check.reason!;
  try {
    const resolvedPath = path.resolve(file_path);
    const affectedFiles = await refactorManager.globalRename(resolvedPath, old_name, new_name);
    
    return `Successfully renamed '${old_name}' to '${new_name}' in ${affectedFiles.length} files:\n${affectedFiles.map(f => path.relative(process.cwd(), f)).join('\n')}`;
  } catch (error: any) {
    return `Refactor Error: ${error.message}`;
  }
}
