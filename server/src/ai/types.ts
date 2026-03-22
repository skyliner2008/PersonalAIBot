export type AIProviderType = 'openai' | 'azure' | 'anthropic' | 'google' | 'gemini' | 'minimax' | 'openrouter';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  stop?: string[];
  stream?: boolean;
}

export interface AIProvider {
  type?: AIProviderType;
  id: AIProviderType;
  name: string;
  description?: string;
  chat(messages: AIMessage[], options?: AICompletionOptions): Promise<AIChatResponse | ReadableStream>;
  testConnection(): Promise<boolean>;
  listModels(): Promise<string[]>;
  openaiSpecificMethod?(): Promise<void>;
}

// Token usage tracking
export interface AITokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIChatResponse {
  text: string;
  usage?: AITokenUsage;
}

export interface AIConfig {
  provider: AIProviderType;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

// Task-specific AI routing
export type AITask = 'chat' | 'content' | 'comment' | 'summary';

export interface TaskAIConfig {
  default: { provider: AIProviderType; model: string; };
  overrides?: Partial<Record<AITask, {
    provider?: AIProviderType;
    model?: string;
    systemPrompt?: string;
    speaking_style?: string | undefined;
    personality_traits?: string | null | undefined;
    temperature?: number;
    max_tokens?: number;
  }>>;
}
