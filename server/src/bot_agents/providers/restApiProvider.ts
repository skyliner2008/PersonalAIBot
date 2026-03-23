import type { Content, FunctionDeclaration } from '@google/genai';
import type { AIProvider, AIResponse } from './baseProvider.js';
import type { ProviderDefinition } from '../../providers/registry.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('RestApiProvider');

export class RestApiProvider implements AIProvider {
  private config: ProviderDefinition;
  private apiKey: string;

  constructor(apiKey: string, config: ProviderDefinition) {
    this.apiKey = apiKey;
    this.config = config;
  }

  async generateResponse(
    modelName: string,
    systemInstruction: string,
    contents: Content[],
    tools?: FunctionDeclaration[]
  ): Promise<AIResponse> {
    log.warn(`[RestApiProvider] text-out not natively supported yet. Please use OpenAI-Compatible definition for text generation.`, { modelName });
    return { text: "Error: generic REST provider currently only supports Media Generation." };
  }

  async listModels(): Promise<string[]> {
    return this.config.models || [];
  }

  async generateImage(prompt: string, modelName?: string, options?: Record<string, any>): Promise<{ url?: string; b64_json?: string; buffer?: Buffer; revised_prompt?: string }[]> {
    const endpoint = this.config.endpointTemplate || this.config.baseUrl || '';
    if (!endpoint) throw new Error(`RestApiProvider requires an endpointTemplate or baseUrl.`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...(this.config.customHeaders || {})
    };

    // Generic body for Cloudflare or Replicate etc.
    // Mapped via extraConfig
    const bodyPayload = {
      prompt,
      model: modelName,
      ...options
    };

    let serializedBody: string;
    try {
      serializedBody = JSON.stringify(bodyPayload);
    } catch (e) {
      throw new Error(`Failed to serialize request body to JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: serializedBody
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`REST API Image Generate Error: ${res.status} ${errText}`);
    }
    
    // Attempt standard parsing
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('image/')) {
       // Direct Buffer Return
       const arrayBuf = await res.arrayBuffer();
       return [{ buffer: Buffer.from(arrayBuf) }];
    } else {
       // JSON formatting (like Cloudflare or OpenAI payload)
       let json;
       const resCloneForError = res.clone();
       try {
         json = await res.json();
       } catch (e) {
         // If res.json() fails, it means the content was not valid JSON.
         // Read as text to include in error for debugging.
         const errText = await resCloneForError.text();
         throw new Error(`REST API Image Generate Error: Invalid JSON response after successful call. Original error: ${(e as Error).message}. Response body: ${errText}`);
       }

       // Try standard formats or return stringified if we can't find it
       if (json.result?.image) { // Cloudflare
         return [{ b64_json: json.result.image }]; 
       } else if (json.output && Array.isArray(json.output)) { // Replicate
         return json.output.map((u: string) => ({ url: u }));
       } else if (json.data && Array.isArray(json.data)) { // standard Dalle
         return json.data;
       } else {
         return [{ url: String(json) }];
       }
    }
  }
}
