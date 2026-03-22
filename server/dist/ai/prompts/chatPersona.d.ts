import type { MemoryContext } from '../../memory/types.js';
import type { AIMessage } from '../types.js';
export declare function buildChatMessages(systemPrompt: string, memory: MemoryContext, newMessage: string): AIMessage[];
/**
 * Legacy fallback: Build messages without memory system.
 * Used when memory is not available (e.g., test replies).
 */
export declare function buildChatMessagesLegacy(persona: {
    systemPrompt: string;
    speaking_style?: string;
    personality_traits?: string | null;
}, conversationHistory: AIMessage[], newMessage: string): AIMessage[];
