import type { AIProvider, AIResponse, AIMessage, AITool } from './baseProvider.js';
import type { ToolCall } from '../types.js';

export class AnthropicProvider implements AIProvider {
  private apiKey: string;
  private baseUrl: string = 'https://api.anthropic.com/v1';
  private apiVersion: string = '2024-06-01';

  constructor(apiKey: string, baseUrl?: string) {
    if (!apiKey) throw new Error('Anthropic API key is required');
    this.apiKey = apiKey;
    if (baseUrl) this.baseUrl = baseUrl;
  }

  async generateResponse(
    model: string,
    systemPrompt: string,
    history: AIMessage[],
    tools?: AITool[]
  ): Promise<AIResponse> {
    const anthropicMessages = history.map(msg => {
      const role = msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user';
      const content = msg.parts.map(p => p.text || '').join('\n');
      return { role, content };
    });

    const payload: any = {
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: anthropicMessages,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Anthropic error: ${response.status} ${await response.text()}`);
    const data = await response.json();

    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of data.content || []) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ name: block.name, args: block.input || {} });
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      } : undefined
    };
  }

  async listModels(): Promise<string[]> {
    return [
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229'
    ];
  }

  async syncModels(): Promise<{ success: boolean; updatedCount: number; models: string[] }> {
    const models = await this.listModels();
    return { success: true, updatedCount: models.length, models };
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: { 'x-api-key': this.apiKey, 'anthropic-version': this.apiVersion, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      return res.ok;
    } catch { return false; }
  }
}
