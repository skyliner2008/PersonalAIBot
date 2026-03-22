import OpenAI from 'openai';
import type { Content, FunctionDeclaration } from '@google/genai';
import type { AIProvider, AIResponse } from './baseProvider.js';
import type { ToolCall } from '../types.js';
import { withRetry } from '../../utils/retry.js';

/** Minimal OpenAI-format message shape */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  private client: OpenAI;
  private providerId: string;

  constructor(apiKey: string, baseURL?: string, providerId?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL
    });
    this.providerId = providerId || '';
  }

  async generateResponse(
    modelName: string,
    systemInstruction: string,
    contents: Content[],
    tools?: FunctionDeclaration[]
  ): Promise<AIResponse> {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemInstruction }
    ];

    for (const content of contents) {
      const role = content.role === 'model' ? 'assistant' : 'user';
      const text = content.parts?.map(p => p.text).join('\n') || '';
      messages.push({ role, content: text });
    }

    const openAiTools = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: modelName,
        messages: messages as any,
        tools: openAiTools as any,
        tool_choice: openAiTools ? 'auto' : undefined
      });

      const choice = response.choices[0];
      if (!choice) {
        return {
          text: '',
          toolCalls: undefined,
          usage: undefined,
        };
      }

      const toolCalls: ToolCall[] | undefined = choice.message.tool_calls
        ?.filter((tc: any) => tc.function?.name)
        .map((tc: any) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            args = { _raw: tc.function.arguments };
          }
          return { name: tc.function.name as string, args };
        });

      return {
        text: choice.message.content || '',
        toolCalls,
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens
        } : undefined
      };
    }, { context: `OpenAI:${this.providerId}` });
  }

  async generateImage(prompt: string, modelName?: string, options?: Record<string, any>): Promise<{ url?: string; b64_json?: string; revised_prompt?: string }[]> {
    const response = await this.client.images.generate({
      prompt,
      model: modelName || 'dall-e-3',
      n: options?.n || 1,
      size: options?.size || '1024x1024',
      response_format: options?.response_format || 'url',
    });
    
    // Safety check for response.data
    const data = (response as any).data || [];
    return data.map((d: any) => ({
      url: d.url,
      b64_json: d.b64_json,
      revised_prompt: d.revised_prompt
    }));
  }

  async generateSpeech(text: string, modelName?: string, voice?: string): Promise<Buffer> {
    const response = await this.client.audio.speech.create({
      model: modelName || 'tts-1',
      voice: (voice as any) || 'alloy',
      input: text,
      response_format: 'mp3',
    });
    return Buffer.from(await response.arrayBuffer());
  }

  async listModels(): Promise<string[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await (this.client.models as any).list({
          signal: controller.signal as any,
        });
        clearTimeout(timeout);
        const data = response.data || [];
        const modelIds = data.map((m: any) => m.id).filter(Boolean).sort();
        if (modelIds.length > 0) return modelIds;
        return [];
      } catch (err: any) {
        clearTimeout(timeout);
        const baseUrl = this.client.baseURL || '';
        const silentProviders = ['minimax', 'anthropic', 'perplexity'];
        const isSilent = silentProviders.some(p => baseUrl.includes(p));
        if (!isSilent) {
          console.warn(`[ListModels:${this.providerId || 'unknown'}] API call failed: ${err.message}`);
        }
        return [];
      }
    } catch {
      return [];
    }
  }
}
