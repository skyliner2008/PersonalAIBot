import type { AIProvider, AIMessage, AICompletionOptions, AIChatResponse } from '../types.js';
export declare class GeminiProvider implements AIProvider {
    static API_VERSIONS: string[];
    id: "gemini";
    name: string;
    private getKey;
    private getModel;
    chat(messages: AIMessage[], options?: AICompletionOptions): Promise<AIChatResponse>;
    testConnection(): Promise<boolean>;
    listModels(): Promise<string[]>;
}
