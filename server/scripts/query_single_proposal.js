import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../../data/bot_data.db');

try {
  const db = new Database(dbPath);
  const proposal = db.prepare('SELECT id, status, description, title FROM upgrade_proposals WHERE id = 801').get();
  console.log(JSON.stringify(proposal, null, 2));
  db.close();
} catch (err) {
  console.error('Database query failed:', err.message);
  process.exit(1);
}
