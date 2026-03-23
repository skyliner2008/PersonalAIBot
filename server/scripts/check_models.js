import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error('No API key found in .env');
    return;
  }

  console.log('--- Testing v1beta ---');
  const genAI = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
  try {
    const models = await genAI.models.list();
    console.log('Available models (v1beta):');
    models.forEach(m => console.log(`- ${m.name} (Supports: ${m.supportedGenerationMethods.join(', ')})`));
  } catch (err) {
    console.error('Error listing models (v1beta):', err.message);
  }

  console.log('\n--- Testing v1 ---');
  const genAIv1 = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1' } });
  try {
    const models = await genAIv1.models.list();
    console.log('Available models (v1):');
    models.forEach(m => console.log(`- ${m.name}`));
  } catch (err) {
    console.error('Error listing models (v1):', err.message);
  }
}

listModels();
