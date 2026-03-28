import type { ToolCall, TokenUsage, AIMessagePart, AIMessage, AITool, AIResponse } from '../types.js';
export type { ToolCall, TokenUsage, AIMessagePart, AIMessage, AITool, AIResponse };

export interface AIProvider {
  /**
   * Main generation method using universal types
   */
  generateResponse(
    modelName: string,
    systemInstruction: string,
    history: AIMessage[],
    tools?: AITool[],
    useGoogleSearch?: boolean
  ): Promise<AIResponse>;

  listModels(): Promise<string[]>;

  /** Optional: Test connection to the provider and check for latest models */
  syncModels?(): Promise<{ success: boolean; updatedCount: number; models: string[] }>;

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
