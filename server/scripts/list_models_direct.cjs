const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// Manual lookup for GEMINI_API_KEY if needed, but let's try to load from server's DB or .env
// We can just look at the root .env or server/.env actually
function getApiKey() {
    const rootEnv = path.resolve(__dirname, '..', '.env');
    const serverEnv = path.resolve(__dirname, '..', 'server', '.env');
    
    let content = '';
    if (fs.existsSync(rootEnv)) content += fs.readFileSync(rootEnv, 'utf8');
    if (fs.existsSync(serverEnv)) content += fs.readFileSync(serverEnv, 'utf8');
    
    const match = content.match(/GEMINI_API_KEY=(.*)/);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    
    const match2 = content.match(/GOOGLE_AI_API_KEY=(.*)/);
    if (match2) return match2[1].trim().replace(/^["']|["']$/g, '');
    
    return null;
}

async function listModels() {
    const apiKey = getApiKey();
    if (!apiKey) {
        console.error('No API key found in .env files');
        // Let's check common locations for credentials if migrated to DB (we might not reach it easily)
        process.exit(1);
    }
    
    console.log('Using API Key found in .env');
    
    for (const version of ['v1beta', 'v1']) {
        console.log(`\n--- Models for ${version} ---`);
        try {
            const genAI = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: version } });
            // In SDK v1.x, we use listModels() differently or check fetch?
            // Actually, the SDK might not have a direct listModels method on the main class anymore in some versions.
            // Let's use fetch directly if needed, but try the class first.
            const response = await fetch(`https://generativelanguage.googleapis.com/${version}/models?key=${apiKey}`);
            const data = await response.json();
            if (data.models) {
                data.models.forEach(m => console.log(`- ${m.name} (${m.supportedGenerationMethods.join(', ')})`));
            } else {
                console.log('No models found or error:', data);
            }
        } catch (err) {
            console.error(`Error listing models for ${version}:`, err.message);
        }
    }
}

listModels();
