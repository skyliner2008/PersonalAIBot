import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function testPayload() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error('No API key found in .env');
    return;
  }

  const modelName = 'gemini-2.0-flash'; // Let's test with a known good one first
  const genAI = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });

  console.log(`Testing model: ${modelName} with new payload structure...`);

  const requestPayload = {
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: 'Hello, are you working?' }] }],
    systemInstruction: 'You are a helpful assistant.', // TOP LEVEL
    config: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    }
  };

  try {
    const response = await genAI.models.generateContent(requestPayload);
    console.log('Success! Response:', response.text);
  } catch (err) {
    console.error('Failed with new structure:', err.message);
    console.log('Full error:', JSON.stringify(err, null, 2));
  }
}

testPayload();
