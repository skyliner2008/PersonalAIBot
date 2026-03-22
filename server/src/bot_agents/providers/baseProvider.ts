import type { Content, FunctionDeclaration } from '@google/genai';
import type { ToolCall, TokenUsage } from '../types.js';

export interface AIResponse {
  text: string;
  toolCalls?: ToolCall[];
  /** Raw model Content object (with functionCall parts) — used by Gemini agentic loop */
  rawModelContent?: Content;
  usage?: TokenUsage;
}

export interface AIProvider {
  generateResponse(
    modelName: string,
    systemInstruction: string,
    contents: Content[],
    tools?: FunctionDeclaration[],
    useGoogleSearch?: boolean
  ): Promise<AIResponse>;

  listModels(): Promise<string[]>;

  generateImage?(
    prompt: string,
    modelName?: string,
    options?: Record<string, any>
  ): Promise<{ url?: string; b64_json?: string; buffer?: Buffer; revised_prompt?: string }[]>;

  generateSpeech?(
    text: string,
    modelName?: string,
    voice?: string
  ): Promise<Buffer>;

  generateVideo?(
    prompt: string,
    modelName?: string,
    options?: Record<string, any>
  ): Promise<{ url?: string; buffer?: Buffer }[]>;
}
