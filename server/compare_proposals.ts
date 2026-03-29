import fs from 'fs';
import path from 'path';

function showDiff(id: number) {
  const historyDir = 'data/upgrade_history';
  const beforeFile = path.join(historyDir, `proposal_${id}_before.txt`);
  const afterFiles = fs.readdirSync(historyDir).filter(f => f.startsWith(`proposal_${id}_after_`));
  
  if (!fs.existsSync(beforeFile)) {
    console.log(`Before file for #${id} not found.`);
    return;
  }
  
  const beforeContent = fs.readFileSync(beforeFile, 'utf-8');
  console.log(`\n--- Proposal #${id} Changes ---`);
  
  if (afterFiles.length === 0) {
    console.log(`No 'after' files found for #${id}.`);
    return;
  }
  
  afterFiles.forEach(afterFile => {
    const afterContent = fs.readFileSync(path.join(historyDir, afterFile), 'utf-8');
    if (beforeContent === afterContent) {
      console.log(`[${afterFile}]: NO CHANGES DETECTED (Contents match before file).`);
    } else {
      console.log(`[${afterFile}]: CHANGES DETECTED.`);
      // Show first 10 different lines or something
      const bLines = beforeContent.split('\n');
      const aLines = afterContent.split('\n');
      for (let i = 0; i < Math.max(bLines.length, aLines.length); i++) {
        if (bLines[i] !== aLines[i]) {
          console.log(`  Line ${i+1}:`);
          console.log(`    - ${bLines[i]?.trim()}`);
          console.log(`    + ${aLines[i]?.trim()}`);
          break; // just show the first diff for brevity
        }
      }
    }
  });
}

showDiff(924);
showDiff(991);
showDiff(930);
showDiff(931);
