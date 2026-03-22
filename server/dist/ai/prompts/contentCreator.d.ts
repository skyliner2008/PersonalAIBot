import type { AIMessage } from '../types.js';
export declare const MAX_TOPIC_LENGTH = 500;
export declare const MAX_CONTENT_LENGTH = 5000;
export declare const MAX_COMMENT_LENGTH = 1000;
export declare function buildContentPrompt(topic: string, style?: string, language?: string, extraInstructions?: string): AIMessage[];
export declare function buildCommentReplyPrompt(postContent: string, commentText: string, commenterName: string, replyStyle?: string): AIMessage[];
