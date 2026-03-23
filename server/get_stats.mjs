import Database from 'better-sqlite3';
const db = new Database('C:/Users/MSI/PersonalAIBotV2/data/fb-agent.db');
const total = db.prepare('SELECT COUNT(*) as c FROM upgrade_proposals').get().c;
const impl = db.prepare("SELECT COUNT(*) as c FROM upgrade_proposals WHERE status='implemented'").get().c;
const rej = db.prepare("SELECT COUNT(*) as c FROM upgrade_proposals WHERE status='rejected'").get().c;
const pend = db.prepare("SELECT COUNT(*) as c FROM upgrade_proposals WHERE status='pending'").get().c;
const appr = db.prepare("SELECT COUNT(*) as c FROM upgrade_proposals WHERE status='approved'").get().c;
const successRate = Math.round(impl / (impl + rej) * 100);
console.log(`Total: ${total} | Implemented: ${impl} | Rejected: ${rej} | Pending: ${pend} | Approved: ${appr} | Success Rate: ${successRate}%`);
