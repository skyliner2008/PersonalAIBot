import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Relative to server/scripts/
const dbPath = path.resolve(__dirname, '../../data/bot_data.db');

try {
  const db = new Database(dbPath);
  const proposals = db.prepare('SELECT id, title, status FROM upgrade_proposals ORDER BY id DESC LIMIT 20').all();
  console.log(JSON.stringify(proposals, null, 2));
  db.close();
} catch (err) {
  console.error('Database query failed:', err.message);
  process.exit(1);
}
