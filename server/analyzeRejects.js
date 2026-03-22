const Database = require('better-sqlite3');
const db = new Database('../data/fb-agent.db');

const rows = db.prepare(`SELECT id, file_path, title, description FROM upgrade_proposals WHERE status = 'rejected' ORDER BY id DESC`).all();

console.log(`TOTAL REJECTED: ${rows.length}`);

// group by error type
const stats = {
    quota: 0,
    syntax: 0,
    boot: 0,
    planning: 0,
    sandbox: 0,
    validation: 0,
    other: 0,
    failedToImplement: 0,
    timeout: 0
}

for (const r of rows) {
    const d = r.description?.toLowerCase() || '';
    if (d.includes('quota') || d.includes('429')) stats.quota++;
    else if (d.includes('esbuild failed') || d.includes('syntax')) stats.syntax++;
    else if (d.includes('boot test failed') || d.includes('boot_rejected')) stats.boot++;
    else if (d.includes('[planning phase]')) stats.planning++;
    else if (d.includes('protected core server')) stats.sandbox++;
    else if (d.includes('[pre-validation]')) stats.validation++;
    else if (d.includes('all implementation specialists failed')) stats.failedToImplement++;
    else if (d.includes('time') || d.includes('timeout')) stats.timeout++;
    else stats.other++;
    
    // print top 10
    if (rows.indexOf(r) < 10) {
        console.log(`[#${r.id}] ${r.title}\n   File: ${r.file_path}\n   Desc: ${r.description.substring(0, 150)}...\n`);
    }
}
console.log(stats);
