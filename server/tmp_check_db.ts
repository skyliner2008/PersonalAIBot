import { getDb, initDb } from './src/database/db.js';
import path from 'path';

async function checkProposals() {
  await initDb();
  const db = getDb();
  const ids = [897, 898, 899, 900];
  const proposals = db.prepare(`SELECT id, status, file_path, description FROM upgrade_proposals WHERE id IN (${ids.join(',')})`).all();
  console.log(JSON.stringify(proposals, null, 2));
}

checkProposals();
