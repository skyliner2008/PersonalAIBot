import fs from 'fs';
import path from 'path';
import { getDb, initDb } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { fileURLToPath } from 'url';

const log = createLogger('AuditUpgrade');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Support running from both /src/evolution and project root
const rootDir = __dirname.endsWith(path.join('src', 'evolution')) 
  ? path.resolve(__dirname, '../../') 
  : path.resolve(process.cwd());

interface UpgradeProposal {
  id: number;
  status: string;
  file_path: string;
  title: string;
  suggested_fix?: string;
  reviewed_at?: string;
  description?: string;
}

interface TraceInfo {
  proposalId: number;
  timestamp: string;
  transcript: Array<{ role: string; parts: Array<{ text?: string }> }>;
}

/**
 * 🕵️ Audit Tool: Verifies implemented changes and analyzes failure patterns
 */
async function auditProposals() {
  console.log('\n\x1b[34m╔═══════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[34m║           🕵️  PersonalAIBot Upgrade Integrity Audit           ║\x1b[0m');
  console.log('\x1b[34m╚═══════════════════════════════════════════════════════════════╝\x1b[0m\n');

  try {
    const db = getDb();
    const proposals = db.prepare(`
      SELECT id, status, file_path, title, suggested_fix, reviewed_at, description
      FROM upgrade_proposals 
      WHERE status IN ('implemented', 'review_diff', 'rejected')
      ORDER BY reviewed_at DESC 
      LIMIT 30
    `).all() as UpgradeProposal[];

    if (proposals.length === 0) {
      console.log('No proposals found to audit.\n');
      return;
    }

    let issuesFound = 0;
    let verifiedCount = 0;
    let rejectedAnalysis: Record<string, number> = {};

    console.log('\x1b[33m[1/2] Verifying Implemented Changes on Disk...\x1b[0m');
    for (const p of proposals.filter(p => p.status !== 'rejected')) {
      const fullPath = path.resolve(rootDir, 'src', p.file_path);
      
      if (!fs.existsSync(fullPath)) {
        console.log(`  [#${p.id}] \x1b[31m❌ ERROR: File missing: ${p.file_path}\x1b[0m`);
        issuesFound++;
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      
      if (p.suggested_fix) {
          const fixLines = p.suggested_fix.split('\n').map(l => l.trim()).filter(l => l.length > 8);
          if (fixLines.length === 0) {
              console.log(`  [#${p.id}] \x1b[90m❔ INFO: Snippet too short to verify automatically.\x1b[0m`);
              continue;
          }
          const matchedLines = fixLines.filter(line => content.includes(line));
          const matchPercent = matchedLines.length / fixLines.length;

          if (matchPercent > 0.6) {
            verifiedCount++;
          } else {
            console.log(`  [#${p.id}] \x1b[31m❌ FAILED: Changes not found in ${p.file_path} (${Math.round(matchPercent * 100)}% match)\x1b[0m`);
            issuesFound++;
          }
      }
    }
    console.log(`  -> Summary: ${verifiedCount} Verified, ${issuesFound} Issues\n`);

    console.log('\x1b[33m[2/2] Analyzing Failure Patterns (Rejected Proposals)...\x1b[0m');
    const rejected = proposals.filter(p => p.status === 'rejected');
    for (const r of rejected) {
      const desc = r.description || '';
      let category = 'Unknown Failure';
      
      if (desc.includes('Compilation Error') || desc.includes('TSC')) category = 'TypeScript Error';
      else if (desc.includes('syntax error') || desc.includes('syntax')) category = 'Syntax Error';
      else if (desc.includes('xcopy') || desc.includes('sandbox')) category = 'Sandbox/IO Error';
      else if (desc.includes('too complex') || desc.includes('too many files')) category = 'Complexity Guard';
      else if (desc.includes('Immortal Core')) category = 'Security Block';
      else if (desc.includes('429') || desc.includes('Quota')) category = 'API Quota';

      rejectedAnalysis[category] = (rejectedAnalysis[category] || 0) + 1;
    }

    Object.entries(rejectedAnalysis)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        console.log(`  - ${cat.padEnd(20)} : ${count} times`);
      });

    // ── Trace Scanner ──
    await scanTraces();

  } catch (err: any) {
    log.error('Audit failed', { error: err.message });
  }
}

async function scanTraces() {
  const traceDir = path.resolve(rootDir, '../logs/upgrade_traces');
  if (!fs.existsSync(traceDir)) return;

  console.log('\n\x1b[33m[3/3] Scanning Upgrade Traces for Failure Patterns...\x1b[0m');
  const files = fs.readdirSync(traceDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .slice(-20); // Check last 20 traces

  let noModifyFails = 0;
  let toolErrorFails = 0;
  let truncatedTraces = 0;
  let alreadyFixedCount = 0;
  const failedProposals: number[] = [];

  for (const file of files) {
    try {
      const trace: TraceInfo = JSON.parse(fs.readFileSync(path.join(traceDir, file), 'utf-8'));
      const transcript = trace.transcript || [];

      // Collect all text content from the transcript
      const allText = transcript.flatMap(m => m.parts || []).map(p => p.text || '').join('\n');

      // Pattern 1: "completed the task but did not modify any target file"
      if (allText.includes('did not modify any target file')) {
        noModifyFails++;
        failedProposals.push(trace.proposalId);

        // Sub-classify: already fixed vs real failure
        if (allText.match(/already\s+(implemented|safe|exists|present|handled)/i)) {
          alreadyFixedCount++;
          console.log(`  - Proposal #${trace.proposalId} (${file}): \x1b[33m⚠ NO_MODIFY — code was already correct\x1b[0m`);
        } else {
          console.log(`  - Proposal #${trace.proposalId} (${file}): \x1b[31m❌ NO_MODIFY — specialist failed to apply fix\x1b[0m`);
        }
      }

      // Pattern 2: Tool errors (e.g. "Unbalanced square brackets")
      if (allText.includes('Unbalanced square brackets') || allText.includes('syntax error') || allText.includes('replace_code_block') && allText.includes('failed')) {
        toolErrorFails++;
        console.log(`  - Proposal #${trace.proposalId} (${file}): \x1b[31m🔧 TOOL_ERROR — replace_code_block failed\x1b[0m`);
      }

      // Pattern 3: Truncated transcript (AI never responded)
      const modelMessages = transcript.filter(m => m.role === 'model' || m.role === 'assistant');
      if (modelMessages.length === 0) {
        truncatedTraces++;
        console.log(`  - Proposal #${trace.proposalId} (${file}): \x1b[90m⏳ INCOMPLETE — no model response (truncated?)\x1b[0m`);
      }
    } catch { /* skip malformed files */ }
  }

  console.log('');
  console.log(`  Summary of last ${files.length} traces:`);
  console.log(`    ❌ No-modify failures  : ${noModifyFails} (of which ${alreadyFixedCount} were already-correct)`);
  console.log(`    🔧 Tool errors         : ${toolErrorFails}`);
  console.log(`    ⏳ Incomplete traces   : ${truncatedTraces}`);

  if (noModifyFails > 3) {
    console.log(`\n\x1b[31m🚨 HIGH FAILURE RATE: ${noModifyFails}/${files.length} traces show NO-MODIFY failures.\x1b[0m`);
    console.log(`   Consider reviewing specialist tool availability and prompt clarity.`);
  }
  if (alreadyFixedCount > 0) {
    console.log(`\n\x1b[33m💡 ${alreadyFixedCount} proposals failed because the fix was already in place.\x1b[0m`);
    console.log(`   These should have been marked 'implemented', not rejected.`);
    console.log(`   Tip: Ensure specialists use "ALREADY_FIXED: [reason]" when code is already correct.`);
  }
  if (toolErrorFails > 0) {
    console.log(`\n\x1b[33m⚙️  ${toolErrorFails} proposals hit tool errors (e.g. Unbalanced square brackets).\x1b[0m`);
    console.log(`   These likely need manual review or re-running with a different specialist.`);
  }
  console.log('');
}

// Run audit
async function main() {
  await initDb();
  await auditProposals();
}

main();

