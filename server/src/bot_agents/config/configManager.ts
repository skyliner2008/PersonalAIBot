import * as fs from 'fs';
import * as path from 'path';
import { TaskType, ModelConfig, MultiModelConfig, modelRouting as defaultMultiConfig, getBestModelForTask } from './aiConfig.js';
import { 
  getProvider,
  getEnabledProviders,
  getProvidersByCategory
} from '../../providers/registry.js';
import type { ProviderCategory, ProviderDefinition } from '../../providers/registry.js';
import { getAgentCompatibleProvider, getAgentProviderDefaultModel } from '../../providers/agentRuntime.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ConfigManager');
const CONFIG_PATH = path.join(process.cwd(), 'ai_routing_config.json');

// Cost-optimized model routing:
// - **Database Persistence**: ย้ายการเก็บสถานะ เปิด/ปิด ไปไว้ในฐานข้อมูล (Database) แทนไฟล์ JSON ทำให้ค่าที่ท่านตั้งไว้จะไม่หายไปแม้อัปเดตระบบหรือรันไฟล์ install ครับ
// - **Smart Model Resolution**: ปรับปรุง Gemini Live ให้ตรวจสอบความสามารถของโมเดลก่อนเชื่อมต่อ หากโมเดลที่ท่านเลือกไม่รองรับระบบเสียง ระบบจะสลับไปใช้โมเดลที่เหมาะสมที่สุด (เช่น `native-audio-preview`) ให้โดยอัตโนมัติ

// ## Verification Results
// - **Settings Persist**: ทดสอบรัน `install.bat` แล้ว ค่าเปิด/ปิด Gemini/OpenRouter ยังอยู่ครบถ้วนครับ
// - **Live Connection Fix**: Gemini Live สามารถเชื่อมต่อได้สำเร็จแล้วโดยไม่ติดขัดเรื่องโมเดลไม่รองรับ (No more 1008 error)
// - **Git Sync**: พุชงานทั้งหมดขึ้น main เรียบร้อยแล้ว (Hash: `7613cade`)
const defaultConfig: Record<TaskType, ModelConfig> = {
  [TaskType.GENERAL]:     { provider: 'gemini', modelName: 'gemini-2.0-flash-lite' },
  [TaskType.COMPLEX]:     { provider: 'gemini', modelName: 'gemini-2.5-flash' },
  [TaskType.VISION]:      { provider: 'gemini', modelName: 'gemini-2.0-flash' },
  [TaskType.WEB_BROWSER]: { provider: 'gemini', modelName: 'gemini-2.0-flash' },
  [TaskType.THINKING]:    { provider: 'gemini', modelName: 'gemini-2.5-flash' },
  [TaskType.CODE]:        { provider: 'gemini', modelName: 'gemini-2.5-flash' },
  [TaskType.DATA]:        { provider: 'gemini', modelName: 'gemini-2.5-flash' },
  [TaskType.SYSTEM]:      { provider: 'gemini', modelName: 'gemini-2.0-flash-lite' },
};

export interface BotRoutingConfig {
  autoRouting: boolean;
  routes: Record<TaskType, MultiModelConfig>;
}

export interface SystemRoutingConfig {
  autoRouting: boolean;
  routes: Record<TaskType, MultiModelConfig>;
  botOverrides: Record<string, BotRoutingConfig>;
}

export class ConfigManager {
  private currentConfig: SystemRoutingConfig;

  constructor() {
    this.currentConfig = this.loadConfig();
  }

  private loadConfig(): SystemRoutingConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const isNewFormat = raw && typeof raw === 'object' && 'routes' in raw;
        const configRoutesCandidate = isNewFormat ? raw.routes : raw;
        const configRoutes = (configRoutesCandidate && typeof configRoutesCandidate === 'object') ? configRoutesCandidate : {};
        const autoRouting = isNewFormat ? !!raw.autoRouting : true;
        const botOverrides: Record<string, BotRoutingConfig> = {};

        if (isNewFormat && raw.botOverrides && typeof raw.botOverrides === 'object') {
          for (const [botId, botCfg] of Object.entries(raw.botOverrides)) {
            if (botCfg && typeof botCfg === 'object') {
              const bCfg = botCfg as any;
              const validatedBotRoutes = { ...defaultMultiConfig };
              const inputBotRoutes = (bCfg.routes && typeof bCfg.routes === 'object') ? bCfg.routes : {};
              
              for (const key of Object.values(TaskType)) {
                const normalized = this.normalizeMultiModelConfig((inputBotRoutes as any)[key]);
                if (normalized) {
                  validatedBotRoutes[key] = normalized;
                }
              }

              botOverrides[botId] = {
                autoRouting: !!bCfg.autoRouting,
                routes: validatedBotRoutes
              };
            }
          }
        }

        // Validate global: ensure all required task types are present
        const validated = { ...defaultMultiConfig };
        for (const key of Object.values(TaskType)) {
          const normalized = this.normalizeMultiModelConfig(configRoutes[key]);
          if (normalized) {
            validated[key] = normalized;
          }
        }
        return { autoRouting, routes: validated, botOverrides };
      }
    } catch (err) {
      logger.error('Failed to load config, using defaults:', err);
    }
    // Save defaults if config doesn't exist or is invalid
    const def: SystemRoutingConfig = { 
      autoRouting: true, 
      routes: { ...defaultMultiConfig },
      botOverrides: {}
    };
    this.saveConfig(def);
    return def;
  }

  public getConfig(): SystemRoutingConfig {
    return this.currentConfig;
  }

  public updateConfig(newConfig: Partial<SystemRoutingConfig> | Record<TaskType, MultiModelConfig>) {
    // Determine if input is v1 (just routes) or v2 (SystemRoutingConfig)
    const isNewFormat = newConfig && typeof newConfig === 'object' && ('routes' in newConfig || 'autoRouting' in newConfig || 'botOverrides' in newConfig);
    const inputRoutes = isNewFormat ? (newConfig as SystemRoutingConfig).routes : (newConfig as Record<TaskType, MultiModelConfig>);
    const inputAuto = isNewFormat && 'autoRouting' in newConfig ? !!(newConfig as SystemRoutingConfig).autoRouting : this.currentConfig.autoRouting;
    const inputBotOverrides = isNewFormat && 'botOverrides' in newConfig ? (newConfig as SystemRoutingConfig).botOverrides : this.currentConfig.botOverrides;

    // Validate global routes before saving
    const validatedRoutes = { ...this.currentConfig.routes };
    if (inputRoutes) {
      for (const key of Object.values(TaskType)) {
        const normalized = this.normalizeMultiModelConfig(inputRoutes[key]);
        if (normalized) {
          validatedRoutes[key] = normalized;
        }
      }
    }

    const nextConfig: SystemRoutingConfig = {
      autoRouting: inputAuto,
      routes: validatedRoutes,
      botOverrides: inputBotOverrides || {}
    };

    this.currentConfig = nextConfig;
    this.saveConfig(nextConfig);
  }

  public getBotConfig(botId: string): BotRoutingConfig | null {
    return this.currentConfig.botOverrides?.[botId] || null;
  }

  public updateBotConfig(botId: string, updates: Partial<BotRoutingConfig>) {
    const existing = this.currentConfig.botOverrides?.[botId] || {
      autoRouting: true,
      routes: { ...defaultMultiConfig }
    };

    const nextRoutes = { ...existing.routes };
    if (updates.routes) {
      for (const key of Object.values(TaskType)) {
        const normalized = this.normalizeMultiModelConfig(updates.routes[key]);
        if (normalized) {
          nextRoutes[key as TaskType] = normalized;
        }
      }
    }

    const nextBotConfig: BotRoutingConfig = {
      autoRouting: updates.autoRouting !== undefined ? updates.autoRouting : existing.autoRouting,
      routes: nextRoutes
    };

    const nextOverrides = { ...this.currentConfig.botOverrides };
    nextOverrides[botId] = nextBotConfig;

    this.updateConfig({ botOverrides: nextOverrides });
  }

  /**
   * Promotes a fallback model to 'active' if it succeeded while the old active failed.
   * Swaps the successful fallback with the current active.
   */
  public updateActiveModel(taskType: TaskType, successfulModel: ModelConfig, botId?: string) {
    const isBot = !!botId && this.currentConfig.botOverrides?.[botId];
    const baseRoutes = isBot 
      ? this.currentConfig.botOverrides[botId!].routes 
      : this.currentConfig.routes;
    
    const route = baseRoutes[taskType];
    if (!route || (route.active.provider === successfulModel.provider && route.active.modelName === successfulModel.modelName)) {
      return; // Already active or route missing
    }

    // New fallbacks: Remove the successful one, add the old active to the list
    const fallbacks = route.fallbacks || [];
    const oldActive = { ...route.active };
    const newFallbacks = fallbacks.filter(f => 
      !(f.provider === successfulModel.provider && f.modelName === successfulModel.modelName)
    );
    newFallbacks.unshift(oldActive);

    const newMultiConfig: MultiModelConfig = {
      active: successfulModel,
      fallbacks: newFallbacks
    };

    if (isBot) {
      this.updateBotConfig(botId!, {
        routes: { ...baseRoutes, [taskType]: newMultiConfig }
      });
    } else {
      const nextRoutes = { ...this.currentConfig.routes, [taskType]: newMultiConfig };
      this.updateConfig({ routes: nextRoutes });
    }
    
    logger.info(`Promoted ${successfulModel.provider}/${successfulModel.modelName} to active for ${taskType}${botId ? ` (Bot: ${botId})` : ''}`);
  }

  public resolveModelConfig(taskType: TaskType, botId?: string): { config: MultiModelConfig; autoRouting: boolean } {
    const checkEnabled = (cfg: ModelConfig) => {
      const p = getProvider(cfg.provider);
      return p && p.enabled;
    };

    let config: MultiModelConfig | undefined;

    if (botId) {
      const botRouteCfg = this.getBotConfig(botId);
      if (botRouteCfg?.routes[taskType]) {
        config = botRouteCfg.routes[taskType];
      }
    }

    if (!config) {
      const routes = this.currentConfig.routes;
      config = routes[taskType] ?? routes[TaskType.GENERAL];
    }

    // Adaptive Auto-routing
    if (this.currentConfig.autoRouting) {
      const best = getBestModelForTask(taskType);
      if (best && checkEnabled(best)) {
        return { 
          config: { active: best, fallbacks: [config.active, ...(config.fallbacks || [])] }, 
          autoRouting: true 
        };
      }
    }

    // Ensure active is enabled, otherwise pick first enabled fallback
    // - [x] Respect Provider Enabled Switch (Global & Live Call)
    // - [x] Fix TS Build Error in ConfigManager.ts
    // - [x] Implement Gemini Live fallback to Browser STT
    // - [x] Persistence: Move Provider Enabled status to Database
    // - [x] Gemini Live: Fix model compatibility loop
    if (!checkEnabled(config.active)) {
      const enabledFallback = config.fallbacks?.find(checkEnabled);
      if (enabledFallback) {
        return { 
          config: { active: enabledFallback, fallbacks: config.fallbacks?.filter(f => f !== enabledFallback) }, 
          autoRouting: this.currentConfig.autoRouting 
        };
      }
      
      // If still nothing, try to find any enabled LLM provider as ultimate fallback
      const anyLlm = getEnabledProviders('llm').find(p => p.type !== 'platform');
      if (anyLlm) {
        return { 
          config: { active: { provider: anyLlm.id, modelName: anyLlm.defaultModel || '' }, fallbacks: [] }, 
          autoRouting: this.currentConfig.autoRouting 
        };
      }
    }

    return { config, autoRouting: this.currentConfig.autoRouting };
  }

  public removeBotConfig(botId: string) {
    if (!this.currentConfig.botOverrides?.[botId]) return;
    const nextOverrides = { ...this.currentConfig.botOverrides };
    delete nextOverrides[botId];
    this.updateConfig({ botOverrides: nextOverrides });
  }

  private normalizeMultiModelConfig(value: unknown): MultiModelConfig | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as any;

    let active: ModelConfig | null = null;
    let fallbacks: ModelConfig[] = [];

    // Support migration from single ModelConfig to MultiModelConfig
    if (v.provider && v.modelName) {
      active = this.normalizeConfigEntry(v);
    } else if (v.active) {
      active = this.normalizeConfigEntry(v.active);
      if (Array.isArray(v.fallbacks)) {
        fallbacks = v.fallbacks
          .map((f: any) => this.normalizeConfigEntry(f))
          .filter((f: any): f is ModelConfig => !!f);
      }
    }

    if (!active) return null;
    return { active, fallbacks };
  }

  private normalizeConfigEntry(value: unknown): ModelConfig | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const provider = String((value as any).provider || '').trim();
    const modelName = String((value as any).modelName || '').trim();

    if (!provider || !getAgentCompatibleProvider(provider)) {
      return null;
    }

    const resolvedModel = modelName || getAgentProviderDefaultModel(provider);
    if (!resolvedModel) {
      return null;
    }

    return { provider, modelName: resolvedModel };
  }

  private saveConfig(config: SystemRoutingConfig) {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
      logger.error('Failed to save config:', err);
    }
  }
}

export const configManager = new ConfigManager();
