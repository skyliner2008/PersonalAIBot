import * as fs from 'fs';
import * as path from 'path';
import { Content, Part, GoogleGenAI } from '@google/genai';
import { tools, getFunctionHandlers, setCurrentChatId } from './tools/index.js';
import type { BotContext, SystemToolContext } from './tools/index.js';
import { getBot } from './registries/botRegistry.js';
import type {
  AgentStats as IAgentStats,
  ToolTelemetry,
  ToolHandlerMap,
  CircuitState,
  ToolCall,
  ToolExecutionResult,
} from './types.js';
import {
  addMessage as umAddMessage, addEpisode, buildContext,
  setCoreMemory, shouldExtractCore, shouldExtractArchival,
  saveArchivalFact, setEmbeddingProvider,
} from '../memory/unifiedMemory.js';
import { setSummarizeProvider } from '../memory/conversationSummarizer.js';
import { classifyTask, TaskType, getBestModelForTask, type MultiModelConfig } from './config/aiConfig.js';
import { configManager } from './config/configManager.js';
import { personaManager } from '../ai/personaManager.js';
import { OpenAICompatibleProvider } from './providers/openaiCompatibleProvider.js';
import { getProvider, getRegistry } from '../providers/registry.js';
import type { AIProvider } from './providers/baseProvider.js';
import { createAgentRuntimeProvider } from '../providers/agentRuntime.js';
import { shouldReflect, triggerReflection } from '../evolution/selfReflection.js';
import { runHealthCheck } from '../evolution/selfHealing.js';
import { buildLearningsContext } from '../evolution/learningJournal.js';
import { createLogger } from '../utils/logger.js';
import { notifyUserActivity } from '../evolution/selfUpgrade.js';

const log = createLogger('Agent');

// ============================================================
// Timing & Limits
// ============================================================
const AGENT_TIMEOUT_MS = 120_000;
const TOOL_TIMEOUT_MS = 45_000;
const MAX_TURNS = 20;
const MAX_TOOL_OUTPUT = 12_000;
const PARALLEL_TOOL_MAX = 5;
const PLANNING_TASK_TYPES = new Set([TaskType.COMPLEX, TaskType.CODE, TaskType.DATA, TaskType.THINKING]);

// ============================================================
// Circuit Breaker
// ============================================================
const toolCircuits: Map<string, CircuitState> = new Map();
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_BASE_MS = 10_000;
const CIRCUIT_MAX_MS = 120_000;

function isCircuitOpen(toolName: string): boolean {
  const c = toolCircuits.get(toolName);
  if (!c) return false;
  if (c.openUntil > Date.now()) return true;
  c.failures = Math.floor(c.failures / 2);
  c.openUntil = 0;
  if (c.failures === 0) toolCircuits.delete(toolName);
  else toolCircuits.set(toolName, c);
  return false;
}

function recordToolResult(toolName: string, success: boolean): void {
  if (success) {
    const c = toolCircuits.get(toolName);
    if (c) {
      c.failures = Math.max(0, c.failures - 1);
      if (c.failures === 0) toolCircuits.delete(toolName);
      else toolCircuits.set(toolName, c);
    }
    return;
  }
  const c = toolCircuits.get(toolName) ?? { failures: 0, openUntil: 0, recoveries: 0, totalOpens: 0 };
  c.failures++;
  if (c.failures >= CIRCUIT_THRESHOLD) {
    const backoffMs = Math.min(CIRCUIT_BASE_MS * Math.pow(2, c.failures - CIRCUIT_THRESHOLD), CIRCUIT_MAX_MS);
    c.openUntil = Date.now() + backoffMs;
    console.warn(`[CircuitBreaker] ${toolName} OPEN for ${backoffMs / 1000}s`);
  }
  toolCircuits.set(toolName, c);
}

// Processing Queue with Timeout and Bounded Chaining
const processingQueues: Map<string, Promise<string>> = new Map();
const queueCounts: Map<string, number> = new Map();
const MAX_QUEUE_DEPTH = 5;

function enqueueForUser(chatId: string, task: () => Promise<string>): Promise<string> {
  const currentCount = queueCounts.get(chatId) ?? 0;
  if (currentCount >= MAX_QUEUE_DEPTH) {
    console.warn(`[AgentQueue] Dropped task for ${chatId} - Queue full`);
    return Promise.reject(new Error('Agent queue is full. Please wait.'));
  }
  
  queueCounts.set(chatId, currentCount + 1);
  const prev = processingQueues.get(chatId) ?? Promise.resolve('');
  
  // Wrap task in an independent execution promise
  const executeWithTimeout = async () => {
    try {
      const result = await Promise.race([
        task(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Task Queue Timeout')), AGENT_TIMEOUT_MS + 10000))
      ]);
      return result;
    } catch (err: any) {
      console.warn(`[AgentQueue] Task Queue Error: ${err.message}`);
      return `❌ System Error: ${err.message}`;
    } finally {
      const cnt = queueCounts.get(chatId) ?? 1;
      if (cnt <= 1) queueCounts.delete(chatId);
      else queueCounts.set(chatId, cnt - 1);
    }
  };

  const next = prev.catch(() => { }).then(executeWithTimeout);
  processingQueues.set(chatId, next);
  
  next.finally(() => {
    if (processingQueues.get(chatId) === next) {
      processingQueues.delete(chatId);
    }
  });
  
  return next;
}

function newStats(): IAgentStats {
  return { turns: 0, toolCalls: [] as ToolTelemetry[], totalTokens: 0, startTime: Date.now() };
}

export interface AgentRun {
  id: string; chatId: string; message: string; startTime: number; endTime?: number;
  durationMs?: number; turns: number; toolCalls: ToolTelemetry[]; totalTokens: number;
  reply?: string; error?: string; taskType?: string;
}

const _runHistory: AgentRun[] = [];
const MAX_RUN_HISTORY = 100;
let _runCounter = 0;

function startRun(chatId: string, message: string, taskType: string): AgentRun {
  const run: AgentRun = {
    id: `run_${++_runCounter}_${Date.now()}`,
    chatId, message: message.substring(0, 200),
    startTime: Date.now(), turns: 0, toolCalls: [], totalTokens: 0, taskType,
  };
  _runHistory.push(run);
  if (_runHistory.length > MAX_RUN_HISTORY) _runHistory.shift();
  return run;
}

function finishRun(run: AgentRun, stats: IAgentStats, reply?: string, error?: string) {
  run.endTime = Date.now();
  run.durationMs = run.endTime - run.startTime;
  run.turns = stats.turns;
  run.toolCalls = stats.toolCalls;
  run.totalTokens = stats.totalTokens;
  run.reply = reply?.substring(0, 300);
  run.error = error;
}

export class Agent {
  constructor() {
    import('../memory/embeddingProvider.js').then(module => {
      setEmbeddingProvider(module.embedText);
    }).catch(e => console.error("Failed to inject embedding provider", e));

    setSummarizeProvider(async (prompt: string) => {
      const { config } = configManager.resolveModelConfig(TaskType.SYSTEM, undefined);
      const p = createAgentRuntimeProvider(config.active.provider);
      if (p) {
        const res = await p.generateResponse(config.active.modelName, 'สรุปบทสนทนาให้กระชับ ไม่เกิน 3 บรรทัด ภาษาไทย', [{ role: 'user', parts: [{ text: prompt }] }]);
        return res.text?.trim() || '';
      }
      return '';
    });
  }

  public processMessage(chatId: string, message: string, ctx: BotContext, attachments?: Part[]): Promise<string> {
    notifyUserActivity(); // Mark system as active for ANY AI intelligence operation (Chat, Cron, API)
    return enqueueForUser(chatId, () => this._processMessageCore(chatId, message, ctx, attachments));
  }

  private async _processMessageCore(chatId: string, message: string, ctx: BotContext, attachments?: Part[]): Promise<string> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);
    const stats = newStats();
    let cleanMessage = message.includes('User request:\n') ? message.split('User request:\n').pop()!.trim() : message;
    
    const classification = classifyTask(cleanMessage, !!attachments);
    const taskType = classification.confidence === 'low' ? TaskType.GENERAL : classification.type;
    const agentRun = startRun(chatId, message, taskType);

    try {
      // 1. Resolve Multi-Model Choices
      const { config, autoRouting } = this.resolveModelConfig(ctx?.botId, taskType);
      
      const configuredFallbacks = config.fallbacks || [];
      
      const modelChoicesList = [
        config.active,
        ...configuredFallbacks,
        ...this.getFallbackChainFromMd().map(f => ({ provider: f.provider, modelName: f.model }))
      ].filter((v, i, a) => a.findIndex(t => t.provider === v.provider && t.modelName === v.modelName) === i);

      log.info(`[Router] ${taskType} | Mode: ${autoRouting ? 'Adaptive' : 'Manual'} | Choices: ${modelChoicesList.length}`);

      // 2. Build Context
      const memoryCtx = await buildContext(chatId, cleanMessage, { maxArchival: 5, archivalThreshold: 0.55 });
      umAddMessage(chatId, 'user', cleanMessage);
      addEpisode(chatId, 'user', cleanMessage);

      const history: Content[] = memoryCtx.workingMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

      const userParts: Part[] = [{ text: message }];
      if (attachments) userParts.push(...attachments);

      // Pre-search for web
      if (taskType === TaskType.WEB_BROWSER) {
        try {
          const { webSearch } = await import('./tools/limitless.js');
          const searchResults = await webSearch({ query: cleanMessage });
          if (searchResults && !searchResults.includes('ไม่พบผลลัพธ์')) {
            userParts.push({ text: `\n\n[ผลการค้นหา]:\n${searchResults}` });
          }
        } catch {}
      }

      let currentContents: Content[] = [...history, { role: 'user', parts: userParts }];

      // Persona & Identity
      const personaConfig = personaManager.loadPersona(ctx?.platform ?? 'telegram');
      let enabledToolNames = personaConfig.enabledTools || [];
      const botInstance = ctx?.botId ? getBot(ctx.botId) : null;
      if (botInstance?.enabled_tools) {
        enabledToolNames = Array.from(new Set([...enabledToolNames, ...botInstance.enabled_tools]));
      }

      // Tool Handlers
      const sysCtx: SystemToolContext = {
        ctx: ctx || { botId: 'default', botName: 'AI', platform: 'telegram', replyWithFile: async () => '' },
        listModels: (p) => this.getAvailableModels(p),
        getProviderNames: () => {
          return Object.keys(getRegistry().providers);
        }
      };
      const allHandlers = getFunctionHandlers(ctx || sysCtx.ctx, sysCtx);
      const activeHandlers: ToolHandlerMap = {};
      for (const [name, fn] of Object.entries(allHandlers)) {
        if (enabledToolNames.includes(name)) activeHandlers[name] = fn;
      }

      let activeTools = tools.filter(t => t.name && enabledToolNames.includes(t.name));
      
      // Prevent web search spam during autonomous execution tasks
      if (taskType === TaskType.CODE || taskType === TaskType.SYSTEM) {
         activeTools = activeTools.filter(t => t.name !== 'web_search' && t.name !== 'google_search');
      }

      const useGoogleSearch = enabledToolNames.includes('google_search') && taskType !== TaskType.CODE;

      // --- DYNAMIC TOOL ROUTING (Token Optimization) ---
      // Apply to all task types if tool count is high (> 10)
      if (activeTools.length > 10) {
        try {
          const routerPrompt = `You are a tool filter. Your ONLY job is to select up to 5 tool names that might be needed to answer the user request.

User Request: "${cleanMessage}"
Available Tools: ${activeTools.map(t => t.name).join(', ')}

Strict Rules:
1. Output ONLY a JSON array of strings, for example: ["read_file", "write_file"]
2. NEVER call the tools yourself.
3. NEVER use <think> or markdown.
4. If no specific tool is needed, return [].
5. RESPONSE MUST START WITH '[' AND END WITH ']'`;

          const supportConfig = configManager.resolveModelConfig(TaskType.SYSTEM, ctx?.botId).config;
          const p = createAgentRuntimeProvider(supportConfig.active.provider);
          if (p) {
            const routerRes = await p.generateResponse(supportConfig.active.modelName, 'Output only a JSON array of strings.', [{ role: 'user', parts: [{ text: routerPrompt }] }]);
            let text = routerRes.text || '';
            
            if (text) {
              // Pre-process: Clean the response
              text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
              text = text.replace(/```(?:json)?([\s\S]*?)```/gi, '$1');
              text = text.trim();
              
              let selected: string[] = [];
              
              // Try standard parsing
              const matches = text.match(/\[\s*".*?"\s*(?:,\s*".*?"\s*)*\]/gs) || text.match(/\[[\s\S]*?\]/gs);
              
              if (matches) {
                for (let jsonStr of matches) {
                   try {
                     // Cleanup single quotes and other garbage inside brackets if it looks like malformed JSON
                     if (jsonStr.includes("'") && !jsonStr.includes('"')) jsonStr = jsonStr.replace(/'/g, '"');
                     const parsed = JSON.parse(jsonStr);
                     if (Array.isArray(parsed)) {
                       selected = parsed.filter(s => typeof s === 'string');
                       if (selected.length > 0) break;
                     }
                   } catch {}
                }
              }
              
              // Fallback: More aggressive extraction if JSON.parse failed to produce results
              if (selected.length === 0) {
                 const bracketContentMatches = text.match(/\[([\s\S]*?)\]/g);
                 if (bracketContentMatches) {
                   for (const content of bracketContentMatches) {
                      // Find all double or single quoted strings
                      const strings = content.match(/(?:"|')([^"']+)(?:"|')/g);
                      if (strings) {
                        selected = strings.map(s => s.replace(/["']/g, '').trim());
                        if (selected.length > 0) break;
                      }
                   }
                 }
              }

              if (selected.length > 0) {
                const essential = [
                  'memory_save', 'search_knowledge', 'replace_code_block', 'run_command', 'read_file', 'system_terminal',
                  'read_file_content', 'write_file_content', 'search_codebase', 'ast_replace_function', 'ast_add_import', 
                  'find_references', 'ast_rename', 'list_files', 'get_current_time', 'system_info', 'view_file', 'multi_replace_file_content', 'notify_user'
                ];
                activeTools = activeTools.filter(t => t.name && (selected.includes(t.name) || essential.includes(t.name)));
                console.log(`[DynamicRouter] Handled ${selected.length} selections. Active tools: ${activeTools.length}`);
              } else {
                console.warn('[DynamicRouter] Could not find tool names in response. Raw snippet:', text.substring(0, 100));
              }
            }
          }
        } catch (e) {
          console.warn('[DynamicRouter] Fallback triggered:', String(e));
        }
      }
      // -------------------------------------------------

      let finalResponseText = '';
      let currentTurn = 0;
      let lastError: any = null;

      // ──── GENERATION LOOP WITH FAILOVER ────
      for (let i = 0; i < modelChoicesList.length; i++) {
        const choice = modelChoicesList[i] as { provider: string, modelName: string };
        const { provider, providerName, modelName } = this.resolveProvider(choice);
        if (!provider) continue;

        try {
          console.log(`[Agent] Attempting ${modelName} (${providerName})...`);
          
          while (currentTurn < MAX_TURNS) {
            if (abortController.signal.aborted) return this.buildTimeoutResponse(stats);
            
            const systemInstruction = `${personaConfig.systemInstruction}\n- Model: ${modelName} (${providerName})\n- Task: ${taskType}\n${memoryCtx.coreMemoryText}`;

            // Use correctly defined generateResponse from AIProvider
            const response = await provider.generateResponse(
              modelName,
              systemInstruction,
              currentContents as any,
              activeTools.length > 0 ? (activeTools as any) : undefined,
              useGoogleSearch
            );
            
            // Self-Healing
            if (autoRouting && i > 0) {
              try {
                const { configManager: cm } = await import('./config/configManager.js');
                cm.updateActiveModel(taskType, choice, ctx?.botId);
              } catch (e) {
                console.error('[Agent] Auto-promotion failed:', e);
              }
            }

            if (response.usage) stats.totalTokens += response.usage.totalTokens;
            currentTurn++;
            stats.turns = currentTurn;

            // Handle Tool Calls
            if (response.toolCalls && response.toolCalls.length > 0) {
              currentContents.push(response.rawModelContent || {
                role: 'model',
                parts: (response.toolCalls as ToolCall[]).map(c => ({ functionCall: { name: c.name, args: c.args } }))
              });

              const responseParts: Part[] = [];
              for (const call of response.toolCalls as ToolCall[]) {
                const toolStart = Date.now();
                if (isCircuitOpen(call.name)) {
                  responseParts.push({ functionResponse: { name: call.name, response: { output: 'Circuit open' } } } as any);
                  continue;
                }
                try {
                  const handler = activeHandlers[call.name];
                  let result = handler ? await handler(call.args) : 'Tool not enabled';
                  result = typeof result === 'string' ? result : JSON.stringify(result);
                  if (result.length > MAX_TOOL_OUTPUT) result = result.substring(0, MAX_TOOL_OUTPUT) + '...';
                  responseParts.push({ functionResponse: { name: call.name, response: { output: result } } } as any);
                  recordToolResult(call.name, true);
                  stats.toolCalls.push({ name: call.name, durationMs: Date.now() - toolStart, success: true });
                } catch (e: any) {
                  responseParts.push({ functionResponse: { name: call.name, response: { output: `Error: ${e.message}` } } } as any);
                  recordToolResult(call.name, false);
                  stats.toolCalls.push({ name: call.name, durationMs: Date.now() - toolStart, success: false });
                }
              }
              currentContents.push({ role: 'user', parts: responseParts });
              continue;
            }

            if (response.text) {
              finalResponseText = response.text;
              umAddMessage(chatId, 'assistant', finalResponseText);
              addEpisode(chatId, 'model', finalResponseText);
              break;
            }
            break;
          } // End Turn While

          if (finalResponseText || stats.toolCalls.length > 0) break;
        } catch (err: any) {
          console.error(`[Agent] Model ${modelName} failed:`, err.message);
          lastError = err;
        }
      } // End Choice For

      if (!finalResponseText && stats.toolCalls.length === 0) throw lastError || new Error('All models failed');

      // Memory Extraction
      if (cleanMessage.length > 10) {
        setImmediate(() => this.extractFact(chatId, cleanMessage, finalResponseText));
        setImmediate(() => this.extractCoreProfile(chatId, cleanMessage, finalResponseText));
      }

      finishRun(agentRun, stats, finalResponseText);
      return finalResponseText || '✅ Done';

    } catch (error: any) {
      console.error('[Agent Error]:', error);
      finishRun(agentRun, stats, undefined, error.message);

      // Friendly error messages for common issues
      const msg = error.message || String(error);
      const status = error.status || error.code;

      if (status === 401 || /unauthorized|user not found|invalid.*key|authentication/i.test(msg)) {
        return '❌ API Key ไม่ถูกต้อง หรือหมดอายุ — กรุณาตรวจสอบ API Key ในหน้า Settings ของ Dashboard';
      }
      if (status === 429 || /rate.?limit|quota|too many/i.test(msg)) {
        return '⏳ API ถูกจำกัดการใช้งาน (Rate Limit) — กรุณารอสักครู่แล้วลองใหม่';
      }
      if (/no.*provider|no.*key|all models failed/i.test(msg)) {
        return '⚙️ ยังไม่ได้ตั้งค่า AI Provider — กรุณาเพิ่ม API Key ในหน้า Settings ของ Dashboard';
      }

      return `❌ Error: ${msg}`;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private resolveModelConfig(botId: string | undefined, taskType: TaskType): { config: MultiModelConfig; autoRouting: boolean } {
    return configManager.resolveModelConfig(taskType, botId);
  }

  private resolveProvider(config: { provider: string; modelName: string }): { provider: AIProvider | null; providerName: string; modelName: string } {
    const pDef = getProvider(config.provider);
    if (pDef && pDef.enabled) {
      const p = createAgentRuntimeProvider(config.provider);
      if (p) return { provider: p, providerName: config.provider, modelName: config.modelName };
    }

    const fallbackChain = this.getFallbackChainFromMd();
    for (const fb of fallbackChain) {
      const fbDef = getProvider(fb.provider);
      if (fbDef && fbDef.enabled) {
        const fbP = createAgentRuntimeProvider(fb.provider);
        if (fbP) return { provider: fbP, providerName: fb.provider, modelName: fb.model };
      }
    }
    return { provider: null, providerName: 'none', modelName: '' };
  }

  private getFallbackChainFromMd(): Array<{ provider: string; model: string }> {
    try {
      // Try multiple possible locations for ROUTING.md (cwd may be project root or server/)
      const candidates = [
        path.join(process.cwd(), 'server', 'personas', 'system', 'ROUTING.md'),
        path.join(process.cwd(), 'personas', 'system', 'ROUTING.md'),
        path.resolve(__dirname, '..', '..', 'personas', 'system', 'ROUTING.md'),
      ];
      for (const filePath of candidates) {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          const matches = content.matchAll(/^\d+\.\s*([^:]+):\s*(.+)$/gm);
          const chain = Array.from(matches).map(m => ({ provider: m[1].trim().toLowerCase(), model: m[2].trim() }));
          if (chain.length > 0) return chain;
        }
      }
    } catch {}
    // Improved default fallback — prefer modern models
    // Improved default fallback — prefer models from config if possible
    const routes = configManager.getConfig().routes;
    return [
      { provider: routes[TaskType.GENERAL].active.provider, model: routes[TaskType.GENERAL].active.modelName },
      { provider: 'gemini', model: 'gemini-1.5-flash' },
      { provider: 'minimax', model: 'MiniMax-M2.7' },
    ];
  }

  private buildTimeoutResponse(stats: IAgentStats): string {
    return `⏰ Timeout. Completed: ${stats.toolCalls.filter(t => t.success).map(t => t.name).join(', ')}`;
  }

  private async extractFact(chatId: string, userMsg: string, aiMsg: string) {
    try {
      const { config } = configManager.resolveModelConfig(TaskType.SYSTEM, undefined);
      const p = createAgentRuntimeProvider(config.active.provider);
      if (p) {
        const res = await p.generateResponse(config.active.modelName, 'Extract one fact about the user.', [{ role: 'user', parts: [{ text: `U:${userMsg}\nA:${aiMsg}` }] }]);
        if (res.text && res.text !== 'NONE') await saveArchivalFact(chatId, res.text);
      }
    } catch {}
  }

  private async extractCoreProfile(chatId: string, userMsg: string, aiMsg: string) {
    try {
      const { config } = configManager.resolveModelConfig(TaskType.SYSTEM, undefined);
      const p = createAgentRuntimeProvider(config.active.provider);
      if (p) {
        const res = await p.generateResponse(config.active.modelName, 'Summarize user profile.', [{ role: 'user', parts: [{ text: `U:${userMsg}\nA:${aiMsg}` }] }]);
        if (res.text) setCoreMemory(chatId, 'human', res.text);
      }
    } catch {}
  }

  public async getAvailableModels(providerName: string): Promise<string[]> {
    try {
      const p = createAgentRuntimeProvider(providerName);
      if (p && 'listModels' in p && typeof p.listModels === 'function') {
        return await p.listModels();
      }
      return [];
    } catch {
      return [];
    }
  }
}
