import fs from 'fs';
const content = fs.readFileSync('src/bot_agents/registries/toolRegistry.ts', 'utf8');
console.log(content.split('\n').slice(150).join('\n'));
