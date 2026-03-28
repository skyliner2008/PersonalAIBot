import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('server/data/fb-agent.db');
const db = new Database(dbPath);

try {
  const row = db.prepare("SELECT enabled_tools FROM bot_instances WHERE id = 'jarvis'").get();
  console.log(JSON.stringify(row, null, 2));
} catch (e) {
  console.error(e);
}
