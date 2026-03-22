const Database = require('better-sqlite3');
const db = new Database('../data/fb-agent.db');

const rows = db.prepare(`SELECT id, file_path, title, description FROM upgrade_proposals WHERE status = 'rejected' ORDER BY id DESC`).all();

console.log(`TOTAL REJECTED: ${rows.length}`);

const stats = {
    quota: 0,
    syntax: 0,
    boot: 0,
    planning: 0,
    sandbox: 0,
    validation: 0,
    failedToImplement: 0,
    timeout: 0,
    other: 0
};

// Also keep track of the most problematic files
const files = {};

for (const r of rows) {
    const d = r.description?.toLowerCase() || '';
    
    // Categorize errors
    if (d.includes('quota') || d.includes('429')) stats.quota++;
    else if (d.includes('esbuild failed') || d.includes('syntax') || d.includes('tsc failed')) stats.syntax++;
    else if (d.includes('boot test failed') || d.includes('boot_rejected')) stats.boot++;
    else if (d.includes('[planning phase]')) stats.planning++;
    else if (d.includes('protected core server')) stats.sandbox++;
    else if (d.includes('[pre-validation]')) stats.validation++;
    else if (d.includes('all implementation specialists failed')) stats.failedToImplement++;
    else if (d.includes('time') || d.includes('timeout')) stats.timeout++;
    else { stats.other++; console.log('OTHER ERROR:', r.description); }
    
    // Track file frequency
    files[r.file_path] = (files[r.file_path] || 0) + 1;
    
    // Print top 15 samples
    if (rows.indexOf(r) < 15) {
        console.log(`\n[#${r.id}] ${r.title}\nFILE: ${r.file_path}\nREASON: ${r.description.replace(/\n/g, ' ').substring(0, 150)}`);
    }
}

console.log('\n--- ERROR DISTRIBUTION ---');
console.log(JSON.stringify(stats, null, 2));

console.log('\n--- MOST PROBLEMATIC FILES ---');
const sortedFiles = Object.entries(files).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(JSON.stringify(sortedFiles, null, 2));
