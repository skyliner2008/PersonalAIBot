import { GoogleGenAI, Content, Part } from '@google/genai';
import type { AIProvider, AIResponse, AIMessage, AITool } from './baseProvider.js';
import type { ToolCall } from '../types.js';
import { withRetry } from '../../utils/retry.js';
import { createLogger } from '../../utils/logger.js';
import { getProvider, updateProvider } from '../../providers/registry.js';
import * as path from 'path';

const logger = createLogger('GeminiProvider');

interface GeminiProviderOptions {
  includeEmbeddingsInList?: boolean;
  includeTTSInList?: boolean;
  includeAqaInList?: boolean;
  providerId?: string;
  /** If true, use Vertex AI mode (OAuth Bearer token instead of API key) */
  vertexai?: boolean;
  /** Google Cloud project ID (for Vertex AI) */
  project?: string;
  /** Google Cloud location (for Vertex AI) */
  location?: string;
}

/** API versions to try, in order. v1beta is default but some newer models only work on v1. */
const API_VERSIONS = ['v1beta', 'v1'] as const;

export class GeminiProvider implements AIProvider {
  private ai: GoogleGenAI;
  /** Secondary client with fallback API version (lazily created) */
  private aiFallback: GoogleGenAI | null = null;
  private apiKey: string;
  private options: GeminiProviderOptions;
  /** Cache of models that need v1 API version */
  private v1Models = new Set<string>();
  private isVertexAI: boolean;

  constructor(apiKey: string, options: GeminiProviderOptions = {}) {
    this.apiKey = apiKey;
    this.options = options;
    this.isVertexAI = !!options.vertexai;

    if (this.isVertexAI) {
      const vertexAiOptions = {
        vertexai: true,
        project: options.project || '',
        location: options.location || 'us-central1',
        httpOptions: {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        },
      };
      this.ai = new GoogleGenAI(vertexAiOptions);
    } else {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  /** Convert universal AIMessage to Gemini Content */
  private mapToGeminiContent(messages: AIMessage[]): Content[] {
    return messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: m.parts.map(p => {
        if (p.text) return { text: p.text };
        if (p.inlineData) return { inlineData: p.inlineData };
        if (p.fileData) return { fileData: p.fileData };
        if (p.functionCall) return { functionCall: p.functionCall } as any;
        if (p.functionResponse) return { functionResponse: p.functionResponse } as any;
        return { text: '' };
      })
    }));
  }

  /** Convert universal AITool to Gemini FunctionDeclaration */
  private mapToGeminiTools(tools: AITool[]): any[] {
    return tools.map(t => ({
      functionDeclarations: [{
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }]
    }));
  }

  private getClientForModel(modelName: string): GoogleGenAI {
    if (this.isVertexAI) return this.ai;
    if (this.v1Models.has(modelName)) {
      if (!this.aiFallback) {
        this.aiFallback = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { apiVersion: 'v1' } });
      }
      return this.aiFallback;
    }
    return this.ai;
  }

  async generateResponse(
    modelName: string,
    systemInstruction: string,
    history: AIMessage[],
    tools?: AITool[],
    useGoogleSearch?: boolean
  ): Promise<AIResponse> {
    const contents = this.mapToGeminiContent(history);
    
    return withRetry(async () => {
      const toolsConfig: any[] = [];
      if (tools && tools.length > 0) {
        toolsConfig.push({ functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        })) });
      } else if (useGoogleSearch) {
        toolsConfig.push({ googleSearch: {} });
      }

      const requestPayload: any = {
        model: modelName,
        contents,
        systemInstruction,
        tools: toolsConfig.length > 0 ? toolsConfig : undefined,
        config: {
          temperature: 0.7,
          maxOutputTokens: 16384,
        }
      };

      let client = this.getClientForModel(modelName);
      let response: any;
      try {
        response = await client.models.generateContent(requestPayload);
      } catch (genErr: any) {
        const errMsg = String(genErr?.message || genErr || '');
        if (!this.isVertexAI && /404|NOT_FOUND|INVALID_ARGUMENT|Unknown name/i.test(errMsg) && !this.v1Models.has(modelName)) {
          this.v1Models.add(modelName);
          if (!this.aiFallback) {
            this.aiFallback = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { apiVersion: 'v1' } });
          }
          response = await this.aiFallback.models.generateContent(requestPayload);
        } else {
          throw genErr;
        }
      }

      const candidateParts: any[] = (response.candidates?.[0] as any)?.content?.parts || [];
      const textParts = candidateParts.map((part: any) => String(part?.text || '').trim()).filter(Boolean);
      let responseText = textParts.join('\n').trim();

      const functionCalls: ToolCall[] = [];
      candidateParts.forEach((part: any) => {
        if (part?.functionCall) {
          functionCalls.push({
            name: String(part.functionCall.name),
            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
        }
      });

      if (!responseText && functionCalls.length === 0) {
        responseText = response.text || '';
      }

      // Grounding summary
      const grounding = (response.candidates?.[0] as any)?.groundingMetadata;
      if (grounding?.searchEntryPoint?.renderedContent) {
        const chunks = grounding.groundingChunks || [];
        const sources = chunks.filter((c: any) => c.web?.uri).map((c: any, i: number) => `${i + 1}. ${c.web.title || 'Source'}: ${c.web.uri}`).join('\n');
        if (sources) responseText += `\n\n📚 แหล่งอ้างอิง:\n${sources}`;
      }

      return {
        text: responseText,
        toolCalls: functionCalls.length > 0 ? functionCalls : undefined,
        rawModelContent: response.candidates?.[0]?.content,
        usage: response.usageMetadata ? {
          promptTokens: response.usageMetadata.promptTokenCount || 0,
          completionTokens: response.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata.totalTokenCount || 0
        } : undefined
      };
    }, { context: 'Gemini' });
  }

  async syncModels(): Promise<{ success: boolean; updatedCount: number; models: string[] }> {
    try {
      const pager: any = await this.ai.models.list();
      const allModels: string[] = [];
      let guard = 0;

      while (pager && guard < 50) {
        guard++;
        const modelsPage = pager.page || pager.pageInternal || [];
        for (const model of modelsPage) {
          const name = (model.name || '').replace('models/', '').trim();
          if (name) allModels.push(name);
        }
        if (!pager.hasNextPage || typeof pager.nextPage !== 'function') break;
        await pager.nextPage();
      }

      if (allModels.length > 0) {
        const providerId = this.options.providerId || 'gemini';
        updateProvider(providerId, { models: allModels });
        logger.info(`Synced ${allModels.length} models for ${providerId}`);
        return { success: true, updatedCount: allModels.length, models: allModels };
      }
      return { success: false, updatedCount: 0, models: [] };
    } catch (err) {
      logger.error('Failed to sync models:', err);
      return { success: false, updatedCount: 0, models: [] };
    }
  }

  async listModels(): Promise<string[]> {
    const provider = getProvider(this.options.providerId || 'gemini');
    if (provider?.models && provider.models.length > 0) {
      return provider.models;
    }
    const res = await this.syncModels();
    return res.models.length > 0 ? res.models : ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-3.1-flash'];
  }

  async generateImage(prompt: string, modelName?: string, options?: Record<string, any>): Promise<{ b64_json?: string; buffer?: Buffer }[]> {
    const model = modelName || 'imagen-3.0-generate-001';
    const client = this.getClientForModel(model);
    const response = await client.models.generateImages({
      model,
      prompt,
      config: {
        numberOfImages: options?.n || 1,
        outputMimeType: options?.response_format === 'png' ? 'image/png' : 'image/jpeg',
        personGeneration: 'ALLOW_ALL' as any
      }
    });
    return (response.generatedImages || []).map(img => ({
      b64_json: img.image?.imageBytes,
      buffer: img.image?.imageBytes ? Buffer.from(img.image.imageBytes, 'base64') : undefined
    }));
  }

  async generateSpeech(text: string, modelName?: string, voice?: string): Promise<Buffer> {
    const model = modelName || 'gemini-2.5-flash';
    const client = this.getClientForModel(model);
    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: { responseModalities: ["AUDIO"] } as any
    });
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.mimeType?.startsWith('audio')) {
        return Buffer.from(part.inlineData.data || '', 'base64');
      }
    }
    throw new Error('No audio generated');
  }
}
