import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

// Read API Key from .env or config
async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY || 'YOUR_API_KEY_HERE';
    console.log('Using API Key:', apiKey.slice(0, 10) + '...');
    
    // Try both v1beta and v1
    for (const version of ['v1beta', 'v1']) {
        console.log(`\n--- Testing API Version: ${version} ---`);
        try {
            const genAI = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: version } });
            const result = await genAI.models.list();
            const models = (result as any).pageInternal || [];
            console.log(`Found ${models.length} models:`);
            models.forEach((m: any) => {
                console.log(`- ${m.name.replace('models/', '')} (Actions: ${m.supportedActions?.join(', ') || 'N/A'})`);
            });
        } catch (err: any) {
            console.error(`Error with ${version}:`, err.message);
        }
    }
}

listModels();
