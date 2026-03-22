import type { FunctionDeclaration } from '@google/genai';
import type { BotContext, ToolHandlerMap } from '../types.js';
import { type SystemToolContext } from './system.js';
export type { BotContext, SystemToolContext };
export declare const sendFileToChatDeclaration: FunctionDeclaration;
export declare const createSendFileHandler: (ctx: BotContext) => ({ file_path, caption }: {
    file_path: string;
    caption?: string;
}) => Promise<string>;
export declare const memorySearchDeclaration: FunctionDeclaration;
export declare const memorySaveDeclaration: FunctionDeclaration;
export declare const tools: FunctionDeclaration[];
export declare const getFunctionHandlers: (ctx: BotContext, sysCtx?: SystemToolContext) => ToolHandlerMap;
/** Set the current chatId for memory tools — called by agent before tool execution */
export declare function setCurrentChatId(chatId: string): void;
