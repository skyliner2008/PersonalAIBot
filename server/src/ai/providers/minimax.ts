import type { AIProvider, AIMessage, AICompletionOptions, AIChatResponse } from '../types.js';
import { getSetting } from '../../database/db.js';
import { getProviderApiKey } from '../../config/settingsSecurity.js';

const BASE_URL = 'https://api.minimaxi.chat/v1';

export class MiniMaxProvider implements AIProvider {
  id = 'minimax' as const;
  name = 'MiniMax';

  private getKey(): string {
    return getProviderApiKey('minimax') || '';
  }
  private getModel(): string {
    return getSetting('ai_minimax_model') || 'MiniMax-M2.5';
  }

  async chat(messages: AIMessage[], options?: AICompletionOptions): Promise<AIChatResponse> {
    if (!messages || messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    // Validate message structure
    for (const msg of messages) {
      if (!msg.role || !msg.content) {
        throw new Error('Invalid message structure: each message must have role and content');
      }
    }

    const key = this.getKey();
    if (!key) throw new Error('MiniMax API key not configured');

    const isStream = (options as any)?.stream ?? false;
    
    const body: Record<string, unknown> = {
      model: options?.model || this.getModel(),
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 500,
    };
    
    if (isStream) {
      body.stream = true;
    }

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`MiniMax error ${res.status}: ${err.error?.message || res.statusText}`);
    }

    if (isStream) {
      if (!res.body) throw new Error('No response body');
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.choices?.[0]?.delta?.content) {
              fullText += data.choices[0].delta.content;
            }
          } catch { /* skip invalid JSON */ }
        }
      }
      return { text: fullText, usage: undefined };
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    const usage = data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0,
    } : undefined;
    return { text, usage };
  }

  async testConnection(): Promise<boolean> {
    try {
      const key = this.getKey();
      if (!key) {
        console.warn('[Minimax] API key not configured');
        return false;
      }
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'MiniMax-M2.5',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(`[Minimax] Connection test failed: ${res.status} - ${err.error?.message || res.statusText}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Minimax] API validation failed:', String(e));
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return ['MiniMax-M2.5', 'MiniMax-M2.5-Flash', 'MiniMax-M2', 'abab6.5s-chat'];
  }
}
