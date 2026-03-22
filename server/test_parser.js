const fs = require('fs');
const content = fs.readFileSync('../data/upgrade_history/proposal_860_after.txt', 'utf8');
let braces = 0, parens = 0, brackets = 0;
let inString = false, stringChar = '', inTemplate = 0, inLineComment = false, inBlockComment = false;

for (let i = 0; i < content.length; i++) {
  const c = content[i];
  const next = content[i + 1];

  if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
  if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
  if (inString) {
    if (c === '\\') { i++; continue; }
    if (c === stringChar) inString = false;
    continue;
  }
  if (inTemplate > 0) {
    if (c === '\\') { i++; continue; }
    if (c === '`') inTemplate = 0;
    continue;
  }
  if (c === '/' && next === '/') { inLineComment = true; continue; }
  if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
  if (c === '"' || c === "'") { inString = true; stringChar = c; continue; }
  if (c === '`') { inTemplate = 1; continue; }

  if (c === '{') braces++;
  else if (c === '}') braces--;
  else if (c === '(') parens++;
  else if (c === ')') parens--;
  else if (c === '[') brackets++;
  else if (c === ']') brackets--;
}

console.log('Result:', { braces, parens, brackets });
