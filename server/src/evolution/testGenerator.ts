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
You are an expert TypeScript/Node.js testing engineer specializing in high-quality, meaningful tests.
I have modified a file: ${filePath}

Description of change:
${changeDescription}

Original Code:
${originalCode}

Modified Code:
${modifiedCode}

Generate a COMPLETE and EXECUTABLE \`vitest\` test file. Follow these STRICT requirements:

## MANDATORY RULES
1. **Minimum 3 assertions**: You MUST include at least 3 expect() assertions. Tests with fewer will be REJECTED.
2. **Negative test case**: Include at least 1 test that verifies the OLD buggy behavior is GONE (e.g., test that the bug no longer occurs).
3. **Call the actual function**: You MUST call the function/method being tested and assert on its return value or side effects. Do NOT just import and check types.
4. **Edge cases**: Test at least 1 edge case (null input, empty array, boundary value, etc.)
5. **Mock external deps**: Use \`vi.mock()\` for any external dependencies (database, network, file system).

## FORMAT
- Use \`describe()\` and \`it()\` blocks with clear descriptive names
- Import from the target file using relative path
- Use \`vi.mock()\` for dependencies that are NOT the function under test

## EXAMPLE of a GOOD test:
\`\`\`typescript
import { describe, it, expect, vi } from 'vitest';
import { calculateScore } from '../src/scoring.js';

vi.mock('../src/database/db.js', () => ({
  getDb: () => ({ prepare: () => ({ get: () => null }) })
}));

describe('calculateScore', () => {
  it('should return correct score for valid input', () => {
    const result = calculateScore({ success: 8, total: 10 });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
    expect(typeof result).toBe('number');
  });

  it('should handle edge case: zero total', () => {
    const result = calculateScore({ success: 0, total: 0 });
    expect(result).toBe(0);
  });

  it('should NOT return negative scores (old bug)', () => {
    // Negative test: the old code returned -1 for invalid input
    const result = calculateScore({ success: -1, total: 5 });
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
\`\`\`

## EXAMPLE of a BAD test (will be REJECTED):
\`\`\`typescript
import { myFunction } from '../src/module.js';
// BAD: No assertions, just imports!
// BAD: No describe/it blocks
// BAD: No edge cases or negative tests
\`\`\`

IMPORTANT: Return ONLY the raw TypeScript code enclosed in \`\`\`typescript ... \`\`\` tags.
Do not include any other explanations.
`;

  const coordinator = getSwarmCoordinator();
  const rootAdmin = getRootAdminIdentity();
  
  const botContext = {
    ...rootAdmin,
    platform: 'system' as any,
    replyWithFile: async () => 'Not supported',
    replyWithText: async () => '',
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
/**
 * Validate test code quality BEFORE running it.
 * Checks for minimum assertion count and proper test structure.
 */
function validateTestQuality(testCode: string): { valid: boolean; reason?: string; assertionCount: number } {
  // Count expect() assertions (the core quality metric)
  const assertionMatches = testCode.match(/expect\s*\(/g);
  const assertionCount = assertionMatches ? assertionMatches.length : 0;

  // Check for describe/it blocks
  const hasDescribe = /describe\s*\(/.test(testCode);
  const hasItBlock = /\bit\s*\(/.test(testCode) || /\btest\s*\(/.test(testCode);

  if (assertionCount < 3) {
    return {
      valid: false,
      reason: `Test has only ${assertionCount} assertion(s), minimum 3 required. Tests without meaningful assertions are vacuous.`,
      assertionCount,
    };
  }

  if (!hasDescribe || !hasItBlock) {
    return {
      valid: false,
      reason: 'Test must use describe() and it()/test() blocks for proper structure.',
      assertionCount,
    };
  }

  // Check it's not just importing without calling anything
  const hasImport = /import\s/.test(testCode);
  const hasFunctionCall = /\w+\s*\(/.test(testCode.replace(/import\s.*?;/g, '').replace(/describe\s*\(/g, '').replace(/\bit\s*\(/g, '').replace(/expect\s*\(/g, '').replace(/vi\.\w+\s*\(/g, ''));
  if (hasImport && !hasFunctionCall) {
    return {
      valid: false,
      reason: 'Test only imports modules but never calls the functions under test.',
      assertionCount,
    };
  }

  return { valid: true, assertionCount };
}

export async function runGeneratedTest(testCode: string, proposalId: number): Promise<{ success: boolean; log: string; testFilePath: string }> {
  // === Pre-run quality validation ===
  const quality = validateTestQuality(testCode);
  if (!quality.valid) {
    log.warn(`[TestGenerator] Test quality check FAILED for proposal #${proposalId}: ${quality.reason}`);
    return {
      success: false,
      log: `[Quality Check Failed] ${quality.reason}\nAssertions found: ${quality.assertionCount}`,
      testFilePath: '',
    };
  }
  log.info(`[TestGenerator] Test quality OK: ${quality.assertionCount} assertions found`);

  // สร้างไฟล์ชั่วคราวสำหรับ Test
  const testDir = path.resolve(process.cwd(), '../data/upgrade_tests');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testFilePath = path.join(testDir, `proposal_${proposalId}.test.ts`);
  fs.writeFileSync(testFilePath, testCode, 'utf-8');

  try {
    // รัน vitest แบบ run once (ไม่ watch) เฉพาะไฟล์นี้
    // NOTE: --passWithNoTests removed intentionally — empty tests must fail
    log.info(`[TestGenerator] Running vitest for proposal #${proposalId}...`);
    const { stdout, stderr } = await execPromise(`npx vitest run ${testFilePath}`, {
      timeout: 30000 // ให้เวลา 30 วิ รันเทส
    });

    const fullOutput = stdout + '\n' + stderr;

    // === Post-run validation: verify assertions actually ran ===
    // Vitest outputs "Tests  X passed" or "X passed (X)" — check at least 1 test passed
    const passedMatch = fullOutput.match(/(\d+)\s+passed/i);
    const passedCount = passedMatch ? parseInt(passedMatch[1], 10) : 0;

    if (passedCount === 0) {
      log.warn(`[TestGenerator] No tests actually passed for proposal #${proposalId}. Possible vacuous test.`);
      return {
        success: false,
        log: `[Validation] No test suites passed.\n${fullOutput}`,
        testFilePath
      };
    }

    log.info(`[TestGenerator] Proposal #${proposalId}: ${passedCount} test(s) passed`);
    return {
      success: true,
      log: fullOutput,
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
    try { if (testFilePath) fs.unlinkSync(testFilePath); } catch { /* best effort */ }
  }
}
