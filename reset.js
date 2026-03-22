import Database from 'better-sqlite3';

const db = new Database('./data/fb-agent.db');
const result = db.prepare("UPDATE settings SET value = '0' WHERE key IN ('upgrade_tokens_in', 'upgrade_tokens_out', 'upgrade_cost_usd')").run();
console.log('Reset complete, changes:', result.changes);
