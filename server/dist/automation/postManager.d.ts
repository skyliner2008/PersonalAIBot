import type { Server as SocketServer } from 'socket.io';
export declare const POST_STATUS_PENDING = "pending";
export declare const POST_STATUS_GENERATING = "generating";
export declare const POST_STATUS_READY = "ready";
export declare const POST_STATUS_POSTING = "posting";
export declare const POST_STATUS_POSTED = "posted";
export declare const POST_STATUS_FAILED = "failed";
export interface ScheduledPost {
    id: number;
    content: string | null;
    ai_topic: string | null;
    post_type: string;
    target: string;
    target_id: string | null;
    target_name: string | null;
    scheduled_at: string;
    cron_expression: string | null;
    status: string;
    error_message?: string | null;
}
/**
 * Schedule a new post (either with pre-written content or AI-generated).
 */
export declare function schedulePost(data: {
    content?: string;
    aiTopic?: string;
    postType?: string;
    target?: string;
    targetId?: string;
    targetName?: string;
    scheduledAt: string;
    cronExpression?: string;
}): number;
/**
 * Process pending scheduled posts (called by scheduler).
 */
export declare function processPendingPosts(io: SocketServer): Promise<void>;
/**
 * Get all scheduled posts.
 */
export declare function getScheduledPosts(limit?: number): any[];
/**
 * Delete a scheduled post.
 */
export declare function deleteScheduledPost(id: number): void;
