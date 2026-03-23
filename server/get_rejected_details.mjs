import Database from 'better-sqlite3';
const db = new Database('C:/Users/MSI/PersonalAIBotV2/data/fb-agent.db');
const rejected = db.prepare(`SELECT id, title, description FROM upgrade_proposals WHERE status = 'rejected' ORDER BY id DESC LIMIT 5`).all();
for (const p of rejected) {
  console.log(`[Proposal #${p.id}] ${p.title}`);
  console.log(`Desc: ${p.description.substring(Math.max(0, p.description.length - 800)).replace(/\n/g, ' ')}`);
}
