import Database from 'better-sqlite3';

const db = new Database('C:/Users/MSI/PersonalAIBot/data/bot_data.db');
const proposals = db.prepare('SELECT id, title, status FROM upgrade_proposals ORDER BY id DESC LIMIT 20').all();
console.log(JSON.stringify(proposals, null, 2));
db.close();
