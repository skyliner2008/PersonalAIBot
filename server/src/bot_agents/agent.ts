import * as fs from 'fs';
import * as path from 'path';
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
import { getSetting } from '../database/db.js';
import { setSummarizeProvider } from '../memory/conversationSummarizer.js';
import { classifyTask, TaskType, getBestModelForTask, type MultiModelConfig } from './config/aiConfig.js';
import { configManager } from './config/configManager.js';
import { personaManager } from '../ai/personaManager.js';
import { OpenAICompatibleProvider } from './providers/openaiCompatibleProvider.js';
import { getProvider, getRegistry } from '../providers/registry.js';
import type { AIProvider, AIMessage, AIMessagePart, AITool } from './providers/baseProvider.js';
import { createAgentRuntimeProvider } from '../providers/agentRuntime.js';
import { shouldReflect, triggerReflection } from '../evolution/selfReflection.js';
import { runHealthCheck } from '../evolution/selfHealing.js';
import { buildLearningsContext } from '../evolution/learningJournal.js';
import { createLogger } from '../utils/logger.js';
import { notifyUserActivity } from '../evolution/selfUpgrade.js';
import { getFeedbackLoop } from '../evolution/feedbackLoop.js';

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
const TASK_TIMEOUT_MS = 60_000; // 60s max per individual agent task to prevent deadlock

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
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Task Queue Timeout')), TASK_TIMEOUT_MS))
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
  transcript?: AIMessage[]; // Full conversation transcript (including tool calls/responses)
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

function finishRun(run: AgentRun, stats: IAgentStats, reply?: string, error?: string, transcript?: AIMessage[]) {
  run.endTime = Date.now();
  run.durationMs = run.endTime - run.startTime;
  run.turns = stats.turns;
  run.toolCalls = stats.toolCalls;
  run.totalTokens = stats.totalTokens;
  run.reply = reply?.substring(0, 300);
  run.error = error;
  run.transcript = transcript;

  // Record performance feedback for agent optimization
  try {
    const outcome = error ? 'failure' : (reply ? 'success' : 'partial');
    getFeedbackLoop().recordOutcome(
      run.chatId,
      run.taskType || 'general',
      outcome,
      run.durationMs || 0,
      run.totalTokens || 0
    );
  } catch { /* non-critical — don't break agent flow */ }
}

export function getRunHistory(): AgentRun[] {
  return [..._runHistory];
}

export function getLatestRun(chatId: string): AgentRun | undefined {
  return [..._runHistory].reverse().find(r => r.chatId === chatId);
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

  public async processMessage(
    chatId: string,
    message: string,
    ctx?: BotContext,
    attachments?: AIMessagePart[],
    taskTypeOverride?: TaskType
  ): Promise<string> {
    return enqueueForUser(chatId, async () => {
      return this._processMessageCore(chatId, message, ctx, attachments, taskTypeOverride);
    });
  }

  private async _processMessageCore(
    chatId: string,
    message: string,
    ctx?: BotContext,
    attachments?: AIMessagePart[],
    taskTypeOverride?: TaskType
  ): Promise<string> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);
    const stats = newStats();
    let cleanMessage = message.includes('User request:\n') ? message.split('User request:\n').pop()!.trim() : message;
    // Task Classification (with Override support)
    const classification = taskTypeOverride 
      ? { type: taskTypeOverride, confidence: 'high' as const, topScore: 10, secondScore: 0 }
      : classifyTask(cleanMessage, !!attachments);
    const taskType = classification.type;
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
      const memoryMetadata = {
        botId: ctx?.botId || undefined,
        botName: ctx?.botName || undefined,
        platform: ctx?.platform || undefined,
        specialist: ctx?.botId?.startsWith('specialist_') ? ctx.botId.replace(/^specialist_/, '') : undefined,
      };
      umAddMessage(chatId, 'user', cleanMessage, 'chat', memoryMetadata);
      addEpisode(chatId, 'user', cleanMessage);

      const history: AIMessage[] = memoryCtx.workingMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        parts: [{ text: m.content }]
      }));

      const userParts: AIMessagePart[] = [{ text: message }];
      if (attachments) userParts.push(...attachments);

      // Pre-search for web — inject results directly into context before LLM call
      let preSearchSuccess = false;
      if (taskType === TaskType.WEB_BROWSER) {
        try {
          const { webSearch } = await import('./tools/limitless.js');
          console.log(`[PreSearch] Searching for: "${cleanMessage}"`);
          const searchResults = await webSearch({ query: cleanMessage });
          if (searchResults && !searchResults.includes('ไม่พบผลลัพธ์') && !searchResults.includes('❌')) {
            userParts.push({ text: `\n\n[ข้อมูลจากอินเทอร์เน็ต - ค้นหาล่วงหน้า]:\n${searchResults}` });
            preSearchSuccess = true;
            console.log(`[PreSearch] ✅ Success (${searchResults.length} chars)`);
          } else {
            console.warn(`[PreSearch] ⚠️ No results or error: ${searchResults?.substring(0, 100)}`);
          }
        } catch (err: any) {
          console.warn(`[PreSearch] ❌ Failed: ${err.message} — LLM will use tool call instead`);
        }
      }

      let currentContents: AIMessage[] = [...history, { role: 'user', parts: userParts }];

      // Persona & Identity
      const personaConfig = personaManager.loadPersona(ctx?.platform ?? 'telegram', ctx?.botId);
      let enabledToolNames = personaConfig.enabledTools || [];
      
      // Specialist Protocol Injection (Ensures AI stays in "Agent" mode)
      const isSpecialist = ctx?.botId?.startsWith('specialist_');
      let specialistPrompt = '';
      if (isSpecialist) {
        specialistPrompt = `\n\n[🚨 SPECIALIST PROTOCOL ACTIVE]\n- You are a specialized AGENT working for Jarvis.\n- Goal: Execute the delegated task with SURGICAL PRECISION.\n- Rule: ALWAYS use the available tools to achieve the goal. NEVER simulate or describe tool use in markdown.\n- Rule: If you need to edit files, use 'replace_code_block' or 'write_file_content'.\n- Rule: Do not say "I've updated the file" unless you have actually called the tool and received a success result.`;
      }
      
      const botInstance = ctx?.botId ? getBot(ctx.botId) : null;
      if (botInstance?.enabled_tools) {
        enabledToolNames = Array.from(new Set([...enabledToolNames, ...botInstance.enabled_tools]));
      }

      // Tool Handlers
      const sysCtx: SystemToolContext = {
        ctx: ctx || { botId: 'default', botName: 'AI', platform: 'telegram', replyWithFile: async () => '', replyWithText: async () => '' },
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

      // --- DYNAMIC TOOL ROUTING (Context-Aware, Token Optimization) ---
      // Apply to all task types if tool count is high (> 10)
      if (activeTools.length > 10) {
        try {
          // ── 1. Task-type-aware essential tools ─────────────────────────────
          // Essential tools are ALWAYS kept regardless of LLM router selection.
          // Each TaskType has its own set to avoid bleeding Self-Upgrade tools
          // into general chat (and vice versa).
          const essentialByTaskType: Record<string, string[]> = {
            // Code editing / Self-Upgrade tasks — heavy file & AST tools
            [TaskType.CODE]: [
              'run_command', 'system_terminal', 'read_file', 'read_file_content',
              'write_file_content', 'replace_code_block', 'multi_replace_file_content',
              'search_codebase', 'ast_replace_function', 'ast_add_import',
              'find_references', 'ast_rename', 'list_files', 'view_file', 'notify_user',
            ],
            // System / self-evolution tasks — same code tools + evolution tools
            [TaskType.SYSTEM]: [
              'run_command', 'system_terminal', 'read_file', 'read_file_content',
              'write_file_content', 'replace_code_block', 'multi_replace_file_content',
              'search_codebase', 'ast_replace_function', 'ast_add_import',
              'find_references', 'ast_rename', 'list_files', 'view_file', 'notify_user',
              'get_system_status', 'self_read_source', 'self_reflect', 'self_heal',
            ],
            // Real-time web / info tasks — web search is mandatory
            [TaskType.WEB_BROWSER]: [
              'web_search', 'read_webpage', 'get_current_time', 'memory_save', 'notify_user',
            ],
            // Data analysis tasks
            [TaskType.DATA]: [
              'run_python', 'read_file_content', 'read_document', 'list_files',
              'get_current_time', 'memory_save',
            ],
            // Complex reasoning / long-form writing
            [TaskType.COMPLEX]: [
              'get_current_time', 'memory_search', 'memory_save', 'search_knowledge',
            ],
            // Deep thinking / step-by-step reasoning
            [TaskType.THINKING]: [
              'get_current_time', 'memory_search', 'memory_save', 'search_knowledge',
            ],
            // Vision / image-attached tasks
            [TaskType.VISION]: [
              'get_current_time', 'send_file_to_chat', 'memory_save',
            ],
            // General chat — minimal, just time + memory
            [TaskType.GENERAL]: [
              'get_current_time', 'memory_search', 'memory_save',
            ],
          };

          const essential: string[] = essentialByTaskType[taskType] ?? essentialByTaskType[TaskType.GENERAL];

          // ── 2. Tool category map (helps the LLM router reason better) ──────
          const toolCategoryHint = `
Tool categories (choose from these groups based on the task):
- MEMORY (recall past info): memory_search, memory_save, search_knowledge
- WEB SEARCH (real-time / internet data): web_search, read_webpage
- BROWSER CONTROL (click/navigate UI): browser_navigate, browser_click, browser_type, browser_close
- FILES (read/write local files): list_files, read_file, read_file_content, write_file_content, delete_file, view_file, send_file_to_chat
- CODE EDIT (surgical code changes): replace_code_block, multi_replace_file_content, search_codebase, ast_replace_function, ast_add_import, find_references, ast_rename
- OS / SHELL: run_command, run_python, system_terminal, system_info, open_application, close_application, screenshot_desktop, clipboard_read, clipboard_write
- MEDIA: generate_image, generate_speech, generate_video
- OFFICE DOCS: read_document, create_document, edit_document, read_google_doc
- SYSTEM SELF-AWARENESS: get_my_config, list_available_models, set_my_model, get_system_status, get_my_capabilities, help, get_recent_errors, get_session_stats
- SELF-EVOLUTION: self_read_source, self_edit_persona, self_add_learning, self_view_evolution, self_reflect, self_heal, create_tool, list_dynamic_tools, delete_dynamic_tool
- SCHEDULER: create_cron_job, list_cron_jobs, delete_cron_job
- UTILITY: get_current_time, echo_message, notify_user`;

          // ── 3. Context-aware router prompt ──────────────────────────────────
          const routerPrompt = `You are a smart tool selector. Select the minimum tools needed to answer the user request.

Task Type: ${taskType.toUpperCase()}
User Request: "${cleanMessage}"
Available Tools: ${activeTools.map(t => t.name).join(', ')}
${toolCategoryHint}

CRITICAL RULES:
1. Output ONLY a JSON array of tool name strings. Example: ["web_search", "memory_save"]
2. Select up to 8 tools maximum. Prefer fewer.
3. NEVER call the tools yourself. NEVER use <think> or markdown.
4. RESPONSE MUST START WITH '[' AND END WITH ']'.
5. If the request needs REAL-TIME or CURRENT data (prices, news, weather, rates, today's info) → MUST include "web_search".
6. If the request is about PAST conversations or things previously discussed → use "memory_search" or "search_knowledge".
7. NEVER select code-edit tools (replace_code_block, ast_*) for non-code tasks.
8. If no specific tool is needed beyond essentials, return [].`;

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
              let isValidResult = false;

              // Try standard parsing
              const matches = text.match(/\[\s*".*?"\s*(?:,\s*".*?"\s*)*\]/gs) || text.match(/\[[\s\S]*?\]/gs);

              if (matches) {
                for (let jsonStr of matches) {
                   try {
                     if (jsonStr.includes("'") && !jsonStr.includes('"')) jsonStr = jsonStr.replace(/'/g, '"');
                     const parsed = JSON.parse(jsonStr);
                     if (Array.isArray(parsed)) {
                       selected = parsed.filter(s => typeof s === 'string');
                       isValidResult = true;
                       break;
                     }
                   } catch {}
                }
              }

              // Fallback: More aggressive extraction if JSON.parse failed
              if (!isValidResult) {
                 const bracketContentMatches = text.match(/\[([\s\S]*?)\]/g);
                 if (bracketContentMatches) {
                   for (const content of bracketContentMatches) {
                      const strings = content.match(/(?:"|')([^"']+)(?:"|')/g);
                      if (strings) {
                        selected = strings.map(s => s.replace(/["']/g, '').trim());
                        isValidResult = true;
                        break;
                      }
                      if (content.trim() === '[]') {
                        isValidResult = true;
                        break;
                      }
                   }
                 }
              }

              if (isValidResult) {
                // Merge LLM-selected + task-type essential, filter to only enabled tools
                const merged = Array.from(new Set([...selected, ...essential]));
                activeTools = activeTools.filter(t => t.name && merged.includes(t.name));
                console.log(`[DynamicRouter] taskType=${taskType} → ${activeTools.length} tools. LLM selected: [${selected.join(', ')}] | Essential kept: [${essential.join(', ')}]`);
              } else {
                // Parser failed — keep essential tools only as safe fallback
                activeTools = activeTools.filter(t => t.name && essential.includes(t.name));
                console.warn('[DynamicRouter] Parse failed, kept essential only. Raw snippet:', text.substring(0, 100));
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
            
            const preferredLang = getSetting('ai_preferred_language') || 'th';
            const langInstruction = preferredLang === 'en' 
              ? '\n- IMPORTANT: Respond in ENGLISH only.' 
              : '\n- IMPORTANT: ตอบเป็นภาษาไทยเท่านั้น (Respond in THAI only).';

            // Inject task-type-specific behavior hints
            let taskHint = '';
            if (taskType === TaskType.WEB_BROWSER && !preSearchSuccess) {
              // Pre-search failed — force LLM to call web_search tool itself
              taskHint = '\n\n[🌐 WEB TASK PROTOCOL]\n- ข้อมูลนี้ต้องการข้อมูล Real-Time จากอินเทอร์เน็ต\n- คุณ MUST เรียกใช้ tool "web_search" ทันทีเพื่อค้นหาคำตอบ\n- ถ้า web_search ตัวแรกไม่มีข้อมูลที่ต้องการ → ลอง web_search คำค้นอื่น หรือ read_webpage จาก URL ที่เกี่ยวข้อง\n- ห้ามตอบว่า "ไม่สามารถเข้าถึงข้อมูลได้" โดยไม่ได้ลองเรียก web_search ก่อน';
            } else if (taskType === TaskType.WEB_BROWSER && preSearchSuccess) {
              // Pre-search succeeded — data is attached, but LLM may still need to search further
              taskHint = '\n\n[🌐 WEB TASK] ข้อมูลเบื้องต้นจากอินเทอร์เน็ตถูกแนบไว้ในข้อความแล้ว\n- ถ้าข้อมูลที่แนบมาตอบคำถามได้ครบ → ตอบได้เลย\n- ถ้าข้อมูลไม่เพียงพอ ไม่มีตัวเลขที่ถามหา หรือไม่ตรงประเด็น → เรียก web_search หรือ read_webpage เพิ่มเติมได้ทันที\n- ห้ามตอบว่า "ไม่สามารถเข้าถึงข้อมูลได้" เด็ดขาด';
            }

            // Build persona-anchor reminder — extract IDENTITY rules to reinforce at end of prompt.
            // This prevents the model from reverting to default speech patterns (e.g. Thai female ค่ะ/คะ)
            // when the persona specifies a different style (e.g. male ครับ).
            const identityAnchor = (() => {
              const raw = personaConfig.systemInstruction;
              const identityStart = raw.indexOf('[IDENTITY - Style & Rules]');
              const soulStart = raw.indexOf('[SOUL - Personality]');
              if (identityStart === -1) return '';
              const section = soulStart > identityStart
                ? raw.slice(identityStart, soulStart)
                : raw.slice(identityStart);
              // Keep only lines containing speaking style constraints (max 5 lines)
              const lines = section.split('\n').filter(l =>
                l.includes('ครับ') || l.includes('ค่ะ') || l.includes('คะ') ||
                l.includes('MANDATORY') || l.includes('PROHIBITED') || l.includes('สรรพนาม') ||
                l.includes('Male') || l.includes('Female') || l.includes('Persona')
              ).slice(0, 5);
              return lines.length > 0 ? `\n\n[🔴 PERSONA LOCK — ปฏิบัติตามเด็ดขาด]\n${lines.join('\n')}` : '';
            })();

            // Anti-hallucination: Prevent model from claiming cloud-only / LLM-only identity
            const antiHallucination = [
              '\n\n[⛔ IDENTITY LOCK — ห้ามละเมิดเด็ดขาด]',
              '- คุณคือ AI Agent ที่รันอยู่บนเครื่อง PC ของแอดมิน ไม่ใช่ AI บน Cloud',
              '- คุณมี tools ที่สามารถ: ค้นหาเว็บ, อ่านไฟล์, รันคำสั่ง, ควบคุมระบบ — ใช้ tools เหล่านี้เสมอเมื่อจำเป็น',
              '- ห้ามพูดว่า "ฉันเป็นแบบจำลองภาษาขนาดใหญ่" หรือ "ฉันถูกฝึกฝนโดย Google/OpenAI"',
              '- ห้ามพูดว่า "ฉันไม่สามารถเข้าถึงข้อมูล/ไฟล์/อินเทอร์เน็ต" — คุณมี tools ทำได้ ให้เรียกใช้แทน',
              '- ห้ามพูดว่า "ฉันอยู่บน Cloud" หรือ "ฉันไม่ได้อยู่ในเครื่อง"',
              '- ถ้าไม่แน่ใจว่าทำอะไรได้ → ลองเรียก tool ก่อน อย่าปฏิเสธโดยไม่ลอง',
            ].join('\n');

            const systemInstruction = `${personaConfig.systemInstruction}${specialistPrompt}${taskHint}\n- Model: ${modelName} (${providerName})\n- Task: ${taskType}\n${memoryCtx.coreMemoryText}${langInstruction}${identityAnchor}${antiHallucination}`;

            // ─── DEBUG: Verify code version is running ───
            if (currentTurn === 0) {
              console.log(`\n${'='.repeat(60)}`);
              console.log(`[Agent:DEBUG] ✅ NEW CODE ACTIVE (v2-patched)`);
              console.log(`[Agent:DEBUG] Platform: ${ctx?.platform} | BotId: ${ctx?.botId} | TaskType: ${taskType}`);
              console.log(`[Agent:DEBUG] Model: ${modelName} (${providerName})`);
              console.log(`[Agent:DEBUG] SystemInstruction length: ${systemInstruction.length} chars`);
              console.log(`[Agent:DEBUG] SystemInstruction first 200: ${systemInstruction.substring(0, 200)}`);
              console.log(`[Agent:DEBUG] SystemInstruction last 300: ${systemInstruction.substring(systemInstruction.length - 300)}`);
              console.log(`[Agent:DEBUG] ActiveTools (${activeTools.length}): ${activeTools.map(t => t.name).join(', ')}`);
              console.log(`[Agent:DEBUG] Has web_search: ${activeTools.some(t => t.name === 'web_search')}`);
              console.log(`${'='.repeat(60)}\n`);
            }

            // Use correctly defined generateResponse from AIProvider
            const response = await provider.generateResponse(
              modelName,
              systemInstruction,
              currentContents,
              activeTools as AITool[],
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
                role: 'assistant',
                parts: (response.toolCalls as ToolCall[]).map(c => ({ functionCall: { name: c.name, args: c.args } }))
              });

              const responseParts: AIMessagePart[] = [];
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

            // ── TEXT-BASED TOOL CALL FALLBACK ──
            // Some models (especially thinking models) write tool calls as text
            // e.g. [replace_code_block]{"file_path":"..."}[/replace_code_block]
            // Parse these and execute them as real tool calls
            if (response.text && !response.toolCalls) {
              const textToolRegex = /\[(replace_code_block|multi_replace_file_content|read_file_content|find_references|ast_replace_function|ast_add_import|ast_rename|write_file_content|run_command)\]\s*```?(?:json)?\s*([\s\S]*?)```?\s*\[\/\1\]/g;
              const textToolCalls: ToolCall[] = [];
              let tm;
              while ((tm = textToolRegex.exec(response.text)) !== null) {
                try {
                  const args = JSON.parse(tm[2].trim());
                  textToolCalls.push({ name: tm[1], args });
                } catch { /* skip malformed JSON */ }
              }

              if (textToolCalls.length > 0) {
                console.log(`[Agent] Recovered ${textToolCalls.length} text-based tool call(s) from model response`);
                // Push assistant message with text content
                currentContents.push({ role: 'assistant', parts: [{ text: response.text }] });
                // Execute the parsed tool calls
                const responseParts: AIMessagePart[] = [];
                for (const call of textToolCalls) {
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
                continue; // Continue turn loop — model may want to call more tools
              }
            }

            if (response.text) {
              finalResponseText = response.text;
              currentContents.push({ role: 'assistant', parts: [{ text: finalResponseText }] });
              umAddMessage(chatId, 'assistant', finalResponseText, 'chat', memoryMetadata);
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

      finishRun(agentRun, stats, finalResponseText, undefined, currentContents);
      return finalResponseText || '✅ Done';

    } catch (error: any) {
      console.error('[Agent Error]:', error);
      finishRun(agentRun, stats, undefined, error.message, (this as any)._currentTranscript);

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
      { provider: 'gemini', model: 'gemini-2.5-flash' },
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
