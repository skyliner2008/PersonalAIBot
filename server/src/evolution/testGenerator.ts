import { getSwarmCoordinator } from '../swarm/swarmCoordinator.js';
import { getRootAdminIdentity } from '../system/rootAdmin.js';
import { createLogger } from '../utils/logger.js';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = util.promisify(exec);
const log = createLogger('TestGenerator');

/**
 * 1. สั่งให้ AI สร้าง Unit Test (Vitest) สำหรับโค้ดที่ถูกแก้ไข
 */
export async function generateTestForChange(
  originalCode: string,
  modifiedCode: string,
  filePath: string,
  changeDescription: string,
  specialistName: string = 'coder'
): Promise<string> {
  const prompt = `
You are an expert TypeScript/Node.js testing engineer.
I have modified a file: ${filePath}

Description of change:
${changeDescription}

Original Code:
${originalCode}

Modified Code:
${modifiedCode}

Please generate a COMPLETE and EXECUTABLE \`vitest\` test file that verifies the correctness of the modified code.
It should include necessary imports (assume you can import from the target file or mock dependencies using \`vi.mock\`).
Make sure the tests cover the specific changes described.

IMPORTANT: Return ONLY the raw TypeScript code for the test file enclosed in \`\`\`typescript ... \`\`\` tags.
Do not include any other explanations.
`;

  const coordinator = getSwarmCoordinator();
  const rootAdmin = getRootAdminIdentity();
  
  const botContext = {
    ...rootAdmin,
    platform: 'system' as any,
    replyWithFile: async () => 'Not supported'
  };

  const taskId = await coordinator.delegateTask(
    botContext,
    'code_generation',
    { message: prompt, context: 'Generate Vitest Unit Test for self-upgrade proposal' },
    { toSpecialist: specialistName, priority: 1, timeout: 60000, maxRetries: 1 }
  );

  const result = await coordinator.waitForTaskResult(taskId, 65000);
  if (result.status !== 'completed' || !result.result) {
    throw new Error(`Failed to generate test: ${result.error || 'Unknown error'}`);
  }

  // Extract code from response
  const codeMatch = result.result.match(/```(?:typescript|ts)\n([\s\S]*?)```/i) || 
                    result.result.match(/```\n([\s\S]*?)```/i);
                    
  const extractedCode = codeMatch ? codeMatch[1].trim() : result.result.trim();
  
  if (!extractedCode || extractedCode.length < 20) {
    throw new Error('Generated test code is too short or invalid.');
  }

  return extractedCode;
}

/**
 * 2. รัน Unit Test ที่สร้างขึ้นด้วย Vitest
 */
export async function runGeneratedTest(testCode: string, proposalId: number): Promise<{ success: boolean; log: string; testFilePath: string }> {
  // สร้างไฟล์ชั่วคราวสำหรับ Test
  const testDir = path.resolve(process.cwd(), '../data/upgrade_tests');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testFilePath = path.join(testDir, `proposal_${proposalId}.test.ts`);
  fs.writeFileSync(testFilePath, testCode, 'utf-8');

  try {
    // รัน vitest แบบ run once (ไม่ watch) เฉพาะไฟล์นี้
    log.info(`[TestGenerator] Running vitest for proposal #${proposalId}...`);
    const { stdout, stderr } = await execPromise(`npx vitest run ${testFilePath} --passWithNoTests`, {
      timeout: 30000 // ให้เวลา 30 วิ รันเทส
    });
    
    return {
      success: true,
      log: stdout + '\n' + stderr,
      testFilePath
    };
  } catch (err: any) {
    // Error จาก execPromise มักจะมี stdout, stderr ถ้า command fail
    const outLog = err.stdout || '';
    const errLog = err.stderr || '';
    const fullLog = `${outLog}\n${errLog}\n${err.message}`;

    return {
      success: false,
      log: fullLog,
      testFilePath
    };
  } finally {
    // Cleanup: remove temporary test file to prevent disk accumulation
    try { fs.unlinkSync(testFilePath); } catch { /* best effort */ }
  }
}
