import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { setCredential, initDb } from './database/db.js';

dotenv.config();

const SENSITIVE_KEYS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'MINIMAX_API_KEY',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'SOCKET_AUTH_TOKEN',
  'ADMIN_PASSWORD'
];

async function migrate() {
  console.log('🚀 Starting Migration: .env to Database...');
  
  await initDb();
  
  let count = 0;
  for (const key of SENSITIVE_KEYS) {
    const value = process.env[key];
    if (value) {
      console.log(`📦 Migrating ${key}...`);
      await setCredential(key, value);
      count++;
    } else {
      console.log(`⏭️  ${key} not found in .env, skipping.`);
    }
  }

  console.log(`\n✅ Migration Complete. ${count} keys moved.`);
  console.log('💡 You can now safely remove these keys from your .env file.');
}

migrate().catch(err => {
  console.error('❌ Migration Failed:', err);
  process.exit(1);
});
