import OpenAI from 'openai';
import type { AIProvider, AIResponse, AIMessage, AITool } from './baseProvider.js';
import type { ToolCall } from '../types.js';
import { withRetry } from '../../utils/retry.js';

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
    history: AIMessage[],
    tools?: AITool[]
  ): Promise<AIResponse> {
    const messages: any[] = [
      { role: 'system', content: systemInstruction }
    ];

    for (const msg of history) {
      const role = msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user';
      // For OpenAI, we simplify parts to text for now
      const text = msg.parts.map(p => p.text || '').join('\n');
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
      if (!choice) return { text: '', toolCalls: undefined };

      const toolCalls: ToolCall[] | undefined = choice.message.tool_calls
        ?.filter((tc: any) => tc.function?.name)
        .map((tc: any) => ({
          name: tc.function.name as string,
          args: JSON.parse(tc.function.arguments || '{}')
        }));

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

  async generateImage(prompt: string, modelName?: string, options?: Record<string, any>): Promise<{ b64_json?: string; buffer?: Buffer }[]> {
    const response = await this.client.images.generate({
      prompt,
      model: modelName || 'dall-e-3',
      n: options?.n || 1,
      response_format: 'b64_json'
    });
    return (response.data || []).map(img => ({
      b64_json: img.b64_json,
      buffer: img.b64_json ? Buffer.from(img.b64_json, 'base64') : undefined
    }));
  }

  async generateSpeech(text: string, modelName?: string, voice?: string): Promise<Buffer> {
    const response = await this.client.audio.speech.create({
      model: modelName || 'tts-1',
      voice: (voice as any) || 'alloy',
      input: text
    });
    return Buffer.from(await response.arrayBuffer());
  }

  async listModels(): Promise<string[]> {
    const isMiniMax = (this.client as any).baseURL?.includes('minimax');

    try {
      const response = await this.client.models.list();
      return (response.data || []).map(m => m.id).sort();
    } catch {
      if (isMiniMax) {
        return [
          'MiniMax-M2.7',
          'MiniMax-M2.7-highspeed',
          'MiniMax-M2.5',
          'MiniMax-M2.5-highspeed',
          'MiniMax-M2.1',
          'MiniMax-M2.1-highspeed',
          'abab7-chat-preview',
          'abab6.5s-chat',
        ];
      }
      return ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1-mini'];
    }
  }

  async syncModels(): Promise<{ success: boolean; updatedCount: number; models: string[] }> {
    const models = await this.listModels();
    return { success: models.length > 0, updatedCount: models.length, models };
  }
}
