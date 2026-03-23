
const db = require('better-sqlite3')('C:/Users/MSI/PersonalAIBotV2/data/fb-agent.db');
const fs = require('fs');

const rejected = db.prepare('SELECT id, title, file_path, status FROM upgrade_proposals WHERE status = ''rejected'' ORDER BY id DESC LIMIT 50').all();

console.log('Total Rejected:', rejected.length);

for (const prop of rejected) {
  const logPath = 'C:/Users/MSI/PersonalAIBotV2/data/upgrade_logs/proposal_' + prop.id + '_rejected.log';
  let logContent = 'No log file found';
  if (fs.existsSync(logPath)) {
    logContent = fs.readFileSync(logPath, 'utf8').substring(0, 500).replace(/\r?\n/g, ' | ');
  }
  console.log('[Proposal #' + prop.id + '] ' + prop.title + ' (' + prop.file_path + ')');
  console.log('  Reason: ' + logContent);
}

