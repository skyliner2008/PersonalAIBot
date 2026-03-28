import { Telegraf } from 'telegraf';
import { middleware as lineMiddleware, Client as LineClient, WebhookEvent } from '@line/bot-sdk';
import express from 'express';
import * as dotenv from 'dotenv';
import { Agent } from './agent.js';
import { clearMemory } from '../memory/unifiedMemory.js';
import { configManager } from './config/configManager.js';
import { getDb, upsertConversation } from '../database/db.js';
import { listBots, getBot, updateBot, createBot, type BotInstance } from './registries/botRegistry.js';
import axios from 'axios';
import type { AIMessagePart } from './types.js';
import { isAdminCommand, handleAdminCommand, isBossModeActive } from '../terminal/messagingBridge.js';
import { approvalSystem } from '../utils/approvalSystem.js';
import { getProviderApiKey } from '../config/settingsSecurity.js';
import { getAgentCompatibleProviders } from '../providers/agentRuntime.js';
import { verifyCliConnections } from '../terminal/commandRouter.js';
import { createLogger } from '../utils/logger.js';
import { getAutoReplyEnabled } from '../config/runtimeSettings.js';
import { startChatMonitor, stopChatMonitor } from '../automation/chatBot.js';
import { startCommentMonitor, stopCommentMonitor } from '../automation/commentBot.js';
import { getSocketIO } from '../utils/socketBroadcast.js';
import { getAdminIds } from '../terminal/messagingBridge.js';

dotenv.config();

const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;
const TELEGRAM_TYPING_PULSE_MS = 4500;
const TELEGRAM_HANDLER_TIMEOUT_MS = 240_000;
const STARTUP_COMPACT = process.env.STARTUP_COMPACT === '1';
const logger = createLogger('BotManager');

function botInfo(message: string): void {
    if (!STARTUP_COMPACT) {
        logger.info(message);
    }
}

/**
 * Utility to truncate long messages and append ellipsis.
 * Prevents performance issues with extremely large strings and respects platform limits.
 */
function truncateMessage(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/** Standardizes chatId construction across platforms */
function formatChatId(platform: string, id: string | number): string {
    return `${platform}_${id}`;
}

function hasConfiguredLlmApiKey(): boolean {
    try {
        return getAgentCompatibleProviders({ enabledOnly: true }).some((provider) => Boolean(getProviderApiKey(provider.id)));
    } catch (err) {
        logger.warn('Failed to check configured providers, falling back to environment variables:', err);
        return Boolean(
            process.env.GEMINI_API_KEY?.trim() ||
            process.env.OPENAI_API_KEY?.trim() ||
            process.env.MINIMAX_API_KEY?.trim()
        );
    }
}

// Shared AI Agent (singleton)
let aiAgent: Agent | null = null;

function getAiAgent(): Agent | null {
    if (aiAgent) {
        return aiAgent;
    }

    if (!hasConfiguredLlmApiKey()) {
        return null;
    }

    try {
        aiAgent = new Agent();
        return aiAgent;
    } catch (err) {
        logger.error('[BotManager] Failed to initialize shared AI Agent:', err);
        return null;
    }
}

/** Helper to mark a bot as error in the registry */
function updateBotStatusOnError(botId: string, errorMessage: string): void {
    updateBot(botId, { status: 'error', last_error: errorMessage });
}

// Active bot instances
// Maps bot registry ID to the running instance handle
const activeBots = new Map<string, { type: string; instance: any; stop: () => void }>();

// Maps LINE bot ID -> its currently active Express router
const lineRouters = new Map<string, express.Router>();

// Store Express app reference for dynamic bot start/stop from dashboard
let _expressApp: express.Express | null = null;

// Helpers

async function getPartFromTelegram(ctx: any, fileId: string, mimeType: string): Promise<AIMessagePart> {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink.toString(), { responseType: 'arraybuffer' });
    const data = Buffer.from(response.data).toString('base64');
    return { inlineData: { data, mimeType } };
}

async function sendTelegramText(bot: Telegraf<any>, chatId: number | string, text: string): Promise<void> {
    const message = String(text || '').trim() || '(no output)';
    for (let i = 0; i < message.length; i += TELEGRAM_MESSAGE_MAX_LENGTH) {
        const chunk = message.substring(i, i + TELEGRAM_MESSAGE_MAX_LENGTH);
        await bot.telegram.sendMessage(chatId, chunk);
    }
}

function runTelegramAdminCommandAsync(
    bot: Telegraf<any>,
    botId: string,
    chatId: number,
    userMessage: string,
    userId: string
): void {
    const typingPulse = setInterval(() => {
        void bot.telegram.sendChatAction(chatId, 'typing').catch((err) => {
            logger.debug(`[Telegram:${botId}] Failed to send typing action: ${err.message}`);
        });
    }, TELEGRAM_TYPING_PULSE_MS);

    void (async () => {
        try {
            const result = await handleAdminCommand(userMessage, 'telegram', userId);
            await sendTelegramText(bot, chatId, result);
        } catch (err: any) {
            console.error(`[Telegram:${botId}] Admin command error:`, err);
            await sendTelegramText(bot, chatId, `[Error] ${err?.message || 'Admin command failed'}`);
        } finally {
            clearInterval(typingPulse);
        }
    })();
}

// Telegram bot helpers

async function handleTelegramMultimodal(ctx: any, agent: Agent, botConfig: BotInstance) {
    const chatId = formatChatId('telegram', ctx.chat.id);
    let fileId = '';
    let mimeType = '';

    if ('document' in ctx.message) {
        fileId = ctx.message.document.file_id;
        mimeType = ctx.message.document.mime_type || 'application/octet-stream';
    } else if ('photo' in ctx.message) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = photo.file_id;
        mimeType = 'image/jpeg';
    }

    if (fileId) {
        await ctx.reply('Analyzing file/image with multimodal pipeline...');
        try {
            const attachmentPart = await getPartFromTelegram(ctx, fileId, mimeType);
            const caption = ('caption' in ctx.message ? ctx.message.caption : null) || 'Please analyze this file/image.';
            upsertConversation(chatId, ctx.chat.id.toString(), 'Telegram User');
            const agentResponse = await agent.processMessage(
                chatId,
                caption,
                {
                    botId: botConfig.id,
                    botName: botConfig.name,
                    platform: 'telegram',
                    replyWithFile: async (fp: string, cap?: string) => {
                        await ctx.replyWithDocument({ source: fp }, { caption: cap });
                        return 'File sent successfully';
                    },
                    replyWithText: async (text: string) => {
                        return await ctx.reply(text);
                    },
                },
                [attachmentPart],
            );
            await ctx.reply(agentResponse);
        } catch (err) {
            console.error(`[Telegram:${botConfig.id}] Multimodal Error:`, err);
            await ctx.reply('Failed to analyze the attached file/image.');
        }
    }
}

async function handleTelegramText(ctx: any, bot: Telegraf<any>, agent: Agent, botConfig: BotInstance) {
    const userMessage = ctx.message.text;
    const chatId = formatChatId('telegram', ctx.chat.id);
    // Allow admin commands and empty messages (in boss mode) to pass
    if (userMessage.startsWith('/') && !userMessage.startsWith('/admin')) return;

    const userId = ctx.from?.id?.toString() || '';

    // Intercept admin commands AND active Boss Mode sessions from text
    if (isAdminCommand(userMessage) || isBossModeActive('telegram', userId)) {
        runTelegramAdminCommandAsync(bot, botConfig.id, ctx.chat.id, userMessage, userId);
        return;
    }

    if (!getAutoReplyEnabled()) {
        return; // Auto-reply disabled globally
    }

    logger.info(`[Telegram:${botConfig.id}] ${chatId}: ${userMessage}`);
    await ctx.sendChatAction('typing').catch((err: any) => logger.debug(`[Telegram:${botConfig.id}] Failed to send typing action: ${err?.message}`));

    try {
        upsertConversation(chatId, ctx.chat.id.toString(), "Telegram User");
        const responseText = await agent.processMessage(chatId, userMessage, {
            botId: botConfig.id,
            botName: botConfig.name,
            platform: 'telegram',
            replyWithFile: async (filePath: string, caption?: string) => {
                await ctx.replyWithDocument({ source: filePath }, { caption });
                return `Sent file ${filePath} successfully`;
            },
            replyWithText: async (text: string) => {
                return await ctx.reply(text);
            }
        });
        await sendTelegramText(bot, ctx.chat.id, responseText);
    } catch (err: any) {
        console.error(`[Telegram:${botConfig.id}] Reply Error:`, err);
        await sendTelegramText(bot, ctx.chat.id, 'An error occurred while sending a reply.');
    }
}

function setupTelegramBotHandlers(bot: Telegraf<any>, agent: Agent, botConfig: BotInstance) {
    bot.catch(async (err, ctx) => {
        const errorText = String((err as any)?.message || err || '');
        logger.error(`[Telegram:${botConfig.id}] Update handler error:`, err);
        if (/Promise timed out/i.test(errorText)) {
            try {
                await ctx.reply('Command is taking too long. Please try again.');
            } catch (replyErr) {
                logger.warn(`[Telegram:${botConfig.id}] Failed to send timeout notification:`, replyErr);
            }
        }
    });

    bot.start((ctx) => {
        ctx.reply(`Hello! I am ${botConfig.name} - Personal AI Assistant`);
    });

    bot.command('clear', (ctx) => {
        const chatId = formatChatId('telegram', ctx.chat.id);
        clearMemory(chatId);
        ctx.reply('Memory cleared successfully.');
    });

    bot.on(['document', 'photo'], (ctx) => handleTelegramMultimodal(ctx, agent, botConfig));

    // Handle Approval System Inline Callbacks
    bot.action(/^(approve|reject)_(.+)$/, async (ctx) => {
        const action = ctx.match[1];
        const approvalId = ctx.match[2];
        const isApproved = action === 'approve';
        
        const resolved = approvalSystem.resolveApproval(approvalId, isApproved);
        
        if (resolved) {
            await ctx.editMessageText(`[OK] Request ${isApproved ? 'approved' : 'rejected'} successfully.`);
        } else {
            await ctx.answerCbQuery('This approval request is expired or already handled.');
        }
    });

    bot.on('text', (ctx) => handleTelegramText(ctx, bot, agent, botConfig));
}

// Telegram bot factory

function startTelegramBot(botConfig: BotInstance): void {
    const agent = getAiAgent();
    if (!agent) {
        updateBotStatusOnError(botConfig.id, 'No configured LLM provider key');
        return;
    }
    const token = botConfig.credentials.bot_token;
    if (!token) {
        console.warn(`[BotManager] Telegram bot "${botConfig.id}" - missing bot_token`);
        updateBotStatusOnError(botConfig.id, 'Missing bot_token');
        return;
    }

    // Check if another active bot is already using the same token (prevent 409)
    for (const [activeId, activeBot] of activeBots.entries()) {
        if (activeId !== botConfig.id && activeBot.type === 'telegram') {
            const otherConfig = getBot(activeId);
            if (otherConfig?.credentials?.bot_token === token) {
                const msg = `Cannot start — same Telegram token already in use by active bot "${activeId}"`;
                console.warn(`[BotManager] ${msg}`);
                updateBotStatusOnError(botConfig.id, msg);
                return;
            }
        }
    }

    try {
        const bot = new Telegraf(token, { handlerTimeout: TELEGRAM_HANDLER_TIMEOUT_MS });
        setupTelegramBotHandlers(bot, agent, botConfig);

        botInfo(`[BotManager] Telegram bot "${botConfig.id}" starting...`);
        updateBot(botConfig.id, { status: 'active', last_error: null });

        const launchBot = async (retryCount = 0) => {
            try {
                // Ensure no old webhooks are present before polling
                await bot.telegram.deleteWebhook({ drop_pending_updates: true });
                await bot.launch({ dropPendingUpdates: true });
                botInfo(`[BotManager] Telegram bot "${botConfig.id}" ready`);
            } catch (err: any) {
                const raw = String(err?.description || err?.message || err || '');
                const isConflict = /409|terminated by other getUpdates request|Conflict/i.test(raw);

                if (isConflict && retryCount < 1) {
                    logger.warn(`[BotManager] Telegram bot "${botConfig.id}" conflict (409). Waiting 2s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return launchBot(retryCount + 1);
                }

                console.error(`[BotManager] Telegram bot "${botConfig.id}" launch failed:`, err);
                const humanMessage = isConflict
                    ? '409 Telegram polling conflict: token is being used by another running bot/process. Try restarting the server after a few seconds.'
                    : raw;
                updateBotStatusOnError(botConfig.id, humanMessage);
                if (isConflict) activeBots.delete(botConfig.id);
            }
        };

        void launchBot();

        activeBots.set(botConfig.id, {
            type: 'telegram',
            instance: bot,
            stop: () => {
                try {
                    bot.stop('SHUTDOWN');
                } catch (e) {
                    logger.debug(`[BotManager] Telegram bot stop error (${botConfig.id}):`, e);
                }
            },
        });
    } catch (err: any) {
        console.error(`[BotManager] Telegram bot "${botConfig.id}" error:`, err);
        updateBotStatusOnError(botConfig.id, err.message);
    }
}

// LINE bot helpers

async function handleLineFileReply(lineClient: LineClient, userId: string, fileUrl: string, caption?: string): Promise<string> {
    if (!userId) {
        logger.error('[LINE] handleLineFileReply: userId is missing');
        return 'Failed to send file: missing user ID';
    }
    try {
        // Sanitize the URL to prevent XSS and ensure it's properly encoded
        const sanitizedUrl = encodeURI(fileUrl);
        const ext = sanitizedUrl.split('.').pop()?.toLowerCase() || '';
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const videoExts = ['mp4', 'mpeg', 'mov'];
        const audioExts = ['mp3', 'wav', 'm4a'];
        let message: any;
        
        if (imageExts.includes(ext)) {
            message = { type: 'image', originalContentUrl: sanitizedUrl, previewImageUrl: sanitizedUrl };
        } else if (videoExts.includes(ext)) {
            message = { type: 'video', originalContentUrl: sanitizedUrl, previewImageUrl: sanitizedUrl };
        } else if (audioExts.includes(ext)) {
            message = { type: 'audio', originalContentUrl: sanitizedUrl, duration: 60000 };
        } else {
            const fileName = sanitizedUrl.split('/').pop() || 'file';
            // Basic escaping for text content to mitigate XSS in downstream consumers (e.g. dashboards)
            const safeCaption = (caption || fileName).replace(/[<>]/g, '');
            message = { type: 'text', text: `File: ${safeCaption}` + "\\n" + `Download: ${sanitizedUrl}` };
        }
        try {
            await lineClient.pushMessage(userId, [message]);
        } catch (pushErr: any) {
            logger.error(`[LINE] pushMessage error: ${pushErr.message}`, pushErr);
            return `Failed to send file: ${pushErr.message}`;
        }
        return `Sent file link successfully`;
    } catch (err: any) {
        logger.error(`[LINE] handleLineFileReply overall error: ${err.message}`, err);
        return `Failed to send file: ${err.message}`;
    }
}

async function handleLineEvent(event: WebhookEvent, agent: Agent, botConfig: BotInstance, lineClient: LineClient): Promise<void> {
    if (event.type !== 'message' || event.message.type !== 'text') return;

    const userMessage = event.message.text;
    const userId = event.source.userId;
    if (!userId) return;
    const chatId = formatChatId('line', userId);

    try {
        // Intercept admin commands AND active Boss Mode sessions from LINE
        if (isAdminCommand(userMessage) || isBossModeActive('line', userId)) {
            const result = await handleAdminCommand(userMessage, 'line', userId);
            const trimmed = result.length > 5000 ? result.substring(0, 4997) + '...' : result;
            await lineClient.pushMessage(userId, { type: 'text', text: trimmed });
            return;
        }

        if (!getAutoReplyEnabled()) {
            return; // Auto-reply disabled globally
        }

        logger.info(`[LINE:${botConfig.id}] ${chatId}: ${userMessage}`);
        upsertConversation(chatId, userId, "LINE User");
        const responseText = await agent.processMessage(chatId, userMessage, {
            botId: botConfig.id,
            botName: botConfig.name,
            platform: 'line',
            replyWithFile: async (fileUrl: string, caption?: string) => handleLineFileReply(lineClient, userId, fileUrl, caption),
            replyWithText: async (text: string) => {
                return await lineClient.pushMessage(userId, { type: 'text', text });
            }
        });
        const text = responseText.length > 5000 ? responseText.substring(0, 4997) + '...' : responseText;
        await lineClient.pushMessage(userId, { type: 'text', text });
    } catch (err) {
        logger.error(`[LINE:${botConfig.id}] Error chat=${chatId}:`, err);
        throw err;
    }
}

// LINE bot factory

function startLineBot(app: express.Express, botConfig: BotInstance): void {
    const agent = getAiAgent();
    if (!agent) {
        updateBotStatusOnError(botConfig.id, 'No configured LLM provider key');
        return;
    }
    const accessToken = botConfig.credentials.channel_access_token;
    const secret = botConfig.credentials.channel_secret;

    if (!accessToken || !secret) {
        console.warn(`[BotManager] LINE bot "${botConfig.id}" - missing credentials`);
        updateBotStatusOnError(botConfig.id, 'Missing channel_access_token or channel_secret');
        return;
    }

    try {
        const lineConfig = { channelAccessToken: accessToken, channelSecret: secret };
        const lineClient = new LineClient(lineConfig);

        const webhookPaths = [`/webhook/line/${botConfig.id}`];
        if (String(botConfig.id || '').toLowerCase() === 'env-line') {
            webhookPaths.push('/webhook/line');
        }

        const lineRouter = express.Router();

        for (const webhookPath of webhookPaths) {
            lineRouter.post(webhookPath, lineMiddleware(lineConfig), (req, res) => {
                res.status(200).json({});
                const eventPromises = (req.body.events || []).map((event: WebhookEvent) => 
                    handleLineEvent(event, agent, botConfig, lineClient)
                );
                Promise.allSettled(eventPromises).then(results => {
                    const failures = results.filter(r => r.status === 'rejected');
                    if (failures.length > 0) {
                        console.error(`[LINE:${botConfig.id}] ${failures.length} event(s) failed:`,
                            failures.map(f => (f as PromiseRejectedResult).reason));
                    }
                });
            });
        }

        (lineRouter as any).botId = botConfig.id;
        app.use('/', lineRouter);
        lineRouters.set(botConfig.id, lineRouter);

        botInfo(`[BotManager] LINE bot "${botConfig.id}" webhook ready at ${webhookPaths.join(', ')}`);
        updateBot(botConfig.id, { status: 'active', last_error: null });

        activeBots.set(botConfig.id, {
            type: 'line',
            instance: lineClient,
            stop: () => {
                const stack = (app as any)._router?.stack;
                if (stack) {
                    const idx = stack.findIndex((layer: any) => layer.handle && layer.handle.botId === botConfig.id);
                    if (idx >= 0) {
                        stack.splice(idx, 1);
                        botInfo(`[BotManager] Removed Express router for LINE bot "${botConfig.id}"`);
                    }
                }
                lineRouters.delete(botConfig.id);
            },
        });
    } catch (err: any) {
        console.error(`[BotManager] LINE bot "${botConfig.id}" error:`, err);
        updateBotStatusOnError(botConfig.id, err.message);
    }
}

// Legacy .env migration removed — all bot credentials are now stored in DB (bot_instances table).
// If process.env.TELEGRAM_BOT_TOKEN or LINE_CHANNEL_ACCESS_TOKEN still exist in .env,
// they are safely ignored. Bot management is fully handled via dashboard + DB registry.

// Public API

/** Start a single bot by registry ID (uses stored app reference) */
export function startBotInstance(app: express.Express | null, botId: string): boolean {
    const effectiveApp = app || _expressApp;
    if (!effectiveApp) {
        console.error(`[BotManager] Cannot start bot "${botId}" - no Express app reference`);
        return false;
    }
    if (!getAiAgent()) {
        console.error(`[BotManager] Cannot start bot "${botId}" - no configured LLM provider key`);
        updateBotStatusOnError(botId, 'Missing LLM provider API key (e.g. Gemini). Please configure one.');
        return false;
    }

    const botConfig = getBot(botId);
    if (!botConfig) return false;

    // Stop existing instance if running
    stopBotInstance(botId);

    switch (botConfig.platform) {
        case 'telegram':
            startTelegramBot(botConfig);
            return true;
        case 'line':
            startLineBot(effectiveApp, botConfig);
            return true;
        case 'facebook':
            const io = getSocketIO();
            if (!io) {
                console.error(`[BotManager] Cannot start Facebook bot "${botId}" - Socket.IO not initialized`);
                updateBotStatusOnError(botId, 'Socket.IO subsystem not ready for Facebook Automation');
                return false;
            }
            
            // Start both Chat and Comment monitors
            startChatMonitor(io).catch(err => {
                logger.error('[BotManager] Error starting FB Chat Monitor:', err);
            });
            startCommentMonitor(io).catch(err => {
                logger.error('[BotManager] Error starting FB Comment Monitor:', err);
            });

            // Register in activeBots so it can be stopped
            activeBots.set(botConfig.id, {
                type: 'facebook',
                instance: null,
                stop: () => {
                    const activeIo = getSocketIO();
                    if (activeIo) {
                        stopChatMonitor(activeIo);
                        stopCommentMonitor(activeIo);
                    }
                }
            });
            updateBot(botConfig.id, { status: 'active', last_error: null });
            return true;
        default:
            console.warn(`[BotManager] Platform "${botConfig.platform}" not yet implemented for bot "${botId}"`);
            updateBotStatusOnError(botId, `Platform "${botConfig.platform}" not supported yet`);
            return false;
    }
}

/** Stop a single bot by registry ID */
export function stopBotInstance(botId: string): void {
    const active = activeBots.get(botId);
    if (active) {
        try {
            active.stop();
        } catch (e) {
            logger.error(`[BotManager] Failed to stop bot instance "${botId}":`, e);
        }
        activeBots.delete(botId);
        logger.info(`[BotManager] Stopped bot "${botId}" process`);
    }
    updateBot(botId, { status: 'stopped', last_error: null });
}

/** Async version of stopBotInstance — waits for Telegram polling to fully close */
export async function stopBotInstanceAsync(botId: string): Promise<void> {
    const active = activeBots.get(botId);
    if (active) {
        try {
            // Telegraf.stop() returns a Promise; wait for polling to fully close
            await Promise.resolve(active.stop());
            // Give Telegram API a moment to release the polling session
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
            logger.error(`[BotManager] Failed to stop bot instance "${botId}":`, e);
        }
        activeBots.delete(botId);
        logger.info(`[BotManager] Stopped bot "${botId}" process (async)`);
    }
    updateBot(botId, { status: 'stopped', last_error: null });
}

/** Start all bots (called at server startup) */
export function startBots(app: express.Express) {
    // Store app reference for later dynamic start/stop
    _expressApp = app;

    if (!getAiAgent()) {
        console.error("[BotManager] Missing LLM provider keys. Telegram/LINE bots cannot start.");
        console.error("[BotManager] 💡 กรุณาเพิ่ม API Key (เช่น OpenRouter, Gemini) ผ่าน Dashboard > Settings");
    }

    // All bot credentials are stored in DB — no .env migration needed

    // Start all registered bots that are marked 'active'
    // (newly migrated bots are set to 'active', manually stopped bots stay 'stopped')
    // IMPORTANT: Detect duplicate tokens to prevent 409 Conflict errors
    const bots = listBots();
    const launchedTokens = new Map<string, string>(); // token -> bot.id that launched it

    for (const bot of bots) {
        if (bot.status === 'active' || bot.status === 'error') {
            // Check for duplicate Telegram tokens before launching
            if (bot.platform === 'telegram') {
                const token = bot.credentials?.bot_token;
                if (token) {
                    const existingBotId = launchedTokens.get(token);
                    if (existingBotId) {
                        console.warn(`[BotManager] SKIPPING bot "${bot.id}" — same Telegram token already launched by "${existingBotId}". This would cause 409 Conflict.`);
                        updateBot(bot.id, { status: 'stopped', last_error: `Duplicate token — already used by "${existingBotId}". Remove duplicate or use a different token.` });
                        continue;
                    }
                    launchedTokens.set(token, bot.id);
                }
            }
            startBotInstance(app, bot.id);
        }
    }

    // Verify CLI API Health in the background
    verifyCliConnections().catch((err: any) => {
        console.error('[BotManager] Error verifying CLI connections:', err);
    });
}

/** Broadcast an alert message to all configured Admin Telegram/Line IDs */
export async function broadcastToAdmins(message: string): Promise<void> {
    const formattedMessage = `🚨 [SYSTEM ALERT]\n${message}`;
    
    // Broadcast via active Telegram Bots
    const telegramAdmins = getAdminIds('telegram');
    if (telegramAdmins.size > 0) {
        for (const [id, botData] of activeBots.entries()) {
            if (botData.type === 'telegram' && botData.instance) {
                const telegraf = botData.instance as Telegraf;
                for (const adminId of telegramAdmins) {
                    try {
                        await telegraf.telegram.sendMessage(adminId, formattedMessage);
                    } catch (e) {
                        logger.error(`[AdminAlert] Failed to notify Telegram admin ${adminId} via bot ${id}`, e);
                    }
                }
            }
        }
    }

    // Broadcast via active LINE Bots
    const lineAdmins = getAdminIds('line');
    if (lineAdmins.size > 0) {
        for (const [id, botData] of activeBots.entries()) {
            if (botData.type === 'line' && botData.instance) {
                const lineClient = botData.instance as LineClient;
                for (const adminId of lineAdmins) {
                    try {
                        await lineClient.pushMessage(adminId, { type: 'text', text: formattedMessage });
                    } catch (e) {
                        logger.error(`[AdminAlert] Failed to notify LINE admin ${adminId} via bot ${id}`, e);
                    }
                }
            }
        }
    }
}

export function setupBotManagerRoutes(app: express.Express) {
    // Dashboard API and static files
    app.use('/personal-ai', express.static('public_personal_ai'));

    app.get('/api/config', (_req, res) => {
        res.json(configManager.getConfig());
    });

    app.post('/api/config', (req, res) => {
        configManager.updateConfig(req.body);
        res.json({ success: true });
    });

    app.get('/api/memory/episodes', (_req, res) => {
        const episodes = getDb().prepare('SELECT * FROM episodes ORDER BY id DESC LIMIT 100').all();
        res.json(episodes);
    });

    app.get('/api/memory/knowledge', (_req, res) => {
        const knowledge = getDb().prepare('SELECT id, chat_id, fact, timestamp FROM knowledge ORDER BY id DESC').all();
        res.json(knowledge);
    });

    app.delete('/api/memory/knowledge/:id', (req, res) => {
        getDb().prepare('DELETE FROM knowledge WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    });

    app.post('/api/cli/chat', async (req, res) => {
        const agent = getAiAgent();
        if (!agent) {
            res.status(500).json({ error: 'AI Agent is not initialized' });
            return;
        }

        const { message, chatId = 'web_dashboard_user', platform = 'web', botId = 'web-cli' } = req.body;
        if (!message) {
            res.status(400).json({ error: 'Message is required' });
            return;
        }

        try {
            upsertConversation(chatId, 'web_dashboard', 'Web Dashboard User');

            const ctx = {
                botId,
                botName: 'Web CLI Bot',
                platform: platform as any,
                replyWithText: async (_text: string) => {
                    // For Web CLI, we don't stream back intermediate text yet, 
                    // we just return the final response.
                },
                replyWithFile: async (_filePath: string, _caption?: string) => {
                    return 'File sent successfully (file preview is limited in this simple CLI mode)';
                }
            };

            const responseText = await agent.processMessage(chatId, message, ctx);
            res.json({ reply: responseText });
        } catch (err: any) {
            console.error('[Web CLI] Error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/models/:provider', async (req, res) => {
        const agent = getAiAgent();
        let models: any[] = [];
        if (agent) {
            try {
                models = await agent.getAvailableModels(req.params.provider);
            } catch (err: any) {
                console.error(`[BotManager] Error getting models for provider ${req.params.provider}:`, err);
                return res.status(500).json({ error: `Failed to retrieve models: ${err.message}` });
            }
        }
        res.json(models);
    });
}

/** Stop all bot agents gracefully */
export function stopBots(): void {
    for (const [id, bot] of activeBots) {
        try {
            bot.stop();
            logger.info(`[BotManager] Stopped bot "${id}"`);
        } catch (err) {
            logger.error(`[BotManager] Error stopping bot "${id}":`, err);
        }
    }
    activeBots.clear();
}

/** Async version — waits for all bots to fully stop (use in graceful shutdown) */
export async function stopBotsAsync(): Promise<void> {
    const stopPromises = Array.from(activeBots.entries()).map(async ([id, bot]) => {
        try {
            await Promise.resolve(bot.stop());
            logger.info(`[BotManager] Stopped bot "${id}" (async)`);
        } catch (err) {
            logger.error(`[BotManager] Error stopping bot "${id}":`, err);
        }
    });
    await Promise.allSettled(stopPromises);
    activeBots.clear();
}

/** Get list of active bot IDs */
export function getActiveBotIds(): string[] {
    return Array.from(activeBots.keys());
}

/** Headless message sending for Agents and Cron Jobs */
export async function sendDirectMessage(botId: string, chatPlatformId: string, text: string): Promise<boolean> {
    const act = activeBots.get(botId);
    if (!act || !act.instance) {
        console.warn(`[BotManager] Cannot send direct message: bot ${botId} is not active`);
        return false;
    }

    try {
        if (act.type === 'telegram') {
            const telegraf = act.instance as Telegraf;
            // platform_userid -> userid
            const uidStr = chatPlatformId.replace(/^telegram_/, '');
            const uidInt = parseInt(uidStr, 10) || uidStr;
            await sendTelegramText(telegraf, uidInt, text);
            return true;
        } else if (act.type === 'line') {
            const lineClient = act.instance as LineClient;
            const uidStr = chatPlatformId.replace(/^line_/, '');
            const trimmed = text.length > 5000 ? text.substring(0, 4997) + '...' : text;
            await lineClient.pushMessage(uidStr, { type: 'text', text: trimmed });
            return true;
        }
        return false;
    } catch (e: any) {
        console.error(`[BotManager] Headless send error for ${botId}: ${e.message}`);
        return false;
    }
}



