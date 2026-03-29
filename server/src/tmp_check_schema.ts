
import { getDb, initDb } from './database/db.ts';
import path from 'path';

async function checkSchema() {
  const rootDir = process.cwd();
  initDb(path.join(rootDir, 'data/brain.db'));
  
  const db = getDb();
  const info = db.prepare("PRAGMA table_info(agent_plans);").all();
  console.log('--- agent_plans Schema ---');
  console.table(info);
}

checkSchema();
