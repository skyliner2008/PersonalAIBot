/**
 * CLI Manager Routes — Dynamic CLI Discovery, Status, Settings & OAuth
 *
 * Provides REST API endpoints for the Unified Topology dashboard page.
 * Handles: discovery, login-check, model listing, settings, and @mention routing.
 */

import { Router, Request, Response } from 'express';
import { execSync, spawn, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../utils/logger.js';
import { requireReadWriteAuth } from '../utils/auth.js';
import { getAvailableBackends, refreshAvailableBackends, type BackendInfo } from '../terminal/commandRouter.js';
import { scanOAuthCredentials } from '../providers/oauthDetector.js';
import { getSetting, setSetting } from '../database/db.js';

const log = createLogger('CliManagerRoutes');
const router = Router();
router.use(requireReadWriteAuth('viewer'));

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CliLoginStatus {
  cliId: string;
  loggedIn: boolean;
  method: 'api_key' | 'oauth_web' | 'oauth_cli' | 'none' | 'local';
  account?: string;
  error?: string;
  loginUrl?: string;
  loginCommand?: string;
  apiKeyEnvVar?: string;
  apiKeyConfigured: boolean;
}

export interface CliModelInfo {
  cliId: string;
  models: string[];
  selectedModel: string;
  defaultModel: string;
  error?: string;
}

export interface CliSettings {
  cliId: string;
  model?: string;
  personality?: string;
  agentMode?: string;
  permissions?: string[];
  extraArgs?: string;
  enabled?: boolean;
  apiKey?: string;
  loginMethod?: 'api_key' | 'oauth_web' | 'oauth_cli' | 'none' | 'local';
}

export interface CliFullStatus {
  backend: BackendInfo;
  login: CliLoginStatus;
  models: CliModelInfo;
  settings: CliSettings;
  lastChecked: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function execSafe(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, {
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    }).trim();
  } catch {
    return null;
  }
}

function getSettingKey(cliId: string, key: string): string {
  return `cli_settings_${cliId}_${key}`;
}

function loadCliSettingsFromDb(cliId: string): Partial<CliSettings> {
  try {
    const raw = getSetting(getSettingKey(cliId, 'all'));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveCliSettingsToDb(cliId: string, settings: Partial<CliSettings>): void {
  const existing = loadCliSettingsFromDb(cliId);
  const merged = { ...existing, ...settings, cliId };
  setSetting(getSettingKey(cliId, 'all'), JSON.stringify(merged));
}

// ─── CLI-specific login detectors ────────────────────────────────────────────

const CLI_KNOWN_CONFIGS: Record<string, {
  apiKeyEnvVar?: string;
  loginCommand?: string;
  loginUrl?: string;
  method: 'api_key' | 'oauth_web' | 'oauth_cli' | 'none' | 'local';
  defaultModels: string[];
  defaultModel: string;
  checkLogin?: (apiKey?: string) => CliLoginStatus['loggedIn'];
  listModelsCmd?: string;
}> = {
  'gemini-cli': {
    apiKeyEnvVar: 'GEMINI_API_KEY',
    loginCommand: 'gemini auth login',
    loginUrl: 'https://aistudio.google.com/apikey',
    method: 'oauth_web',
    defaultModels: [
      'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash',
      'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash',
      'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview',
    ],
    defaultModel: 'gemini-2.0-flash',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.GEMINI_API_KEY;
      if (key && key.length > 20) return true;
      // Check gemini settings file
      const settingsPath = path.join(os.homedir(), '.gemini', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          if (data.apiKey || data.api_key) return true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },
  'claude-cli': {
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    loginCommand: 'claude login',
    loginUrl: 'https://console.anthropic.com/settings/keys',
    method: 'oauth_web',
    defaultModels: [
      'claude-opus-4-20250514', 'claude-sonnet-4-20250514',
      'claude-haiku-4-20250414', 'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022', 'claude-3-opus-20240229',
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.ANTHROPIC_API_KEY;
      if (key && key.length > 20) return true;
      // Check Claude CLI credentials file
      const credPaths = [
        path.join(os.homedir(), '.claude', '.credentials.json'),
        path.join(os.homedir(), '.anthropic', 'credentials.json'),
      ];
      for (const p of credPaths) {
        if (fs.existsSync(p)) return true;
      }
      return false;
    },
  },
  'codex-cli': {
    apiKeyEnvVar: 'OPENAI_API_KEY',
    loginCommand: 'codex login',
    loginUrl: 'https://platform.openai.com/api-keys',
    method: 'api_key',
    defaultModels: [
      'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini',
      'o4-mini', 'o3-mini', 'gpt-5.3-codex',
    ],
    defaultModel: 'gpt-4.1',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.OPENAI_API_KEY;
      return !!(key && key.startsWith('sk-') && key.length > 20);
    },
  },
  'openai-cli': {
    apiKeyEnvVar: 'OPENAI_API_KEY',
    loginUrl: 'https://platform.openai.com/api-keys',
    method: 'api_key',
    defaultModels: [
      'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo',
      'o3', 'o3-mini', 'o1', 'o1-mini',
    ],
    defaultModel: 'gpt-4o',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.OPENAI_API_KEY;
      return !!(key && key.startsWith('sk-') && key.length > 20);
    },
  },
  'kilo-cli': {
    apiKeyEnvVar: 'KILO_API_KEY',
    loginCommand: 'kilo login',
    loginUrl: 'https://kilocode.ai/settings',
    method: 'oauth_web',
    defaultModels: [
      'kilo/kilo-auto/free', 'kilo/kilo-auto/small',
      'kilo/kilo-auto/balanced', 'kilo/kilo-auto/frontier',
      'kilo/anthropic/claude-sonnet-4', 'kilo/openai/gpt-4o',
      'kilo/google/gemini-2.0-flash', 'kilo/deepseek/deepseek-r1',
    ],
    defaultModel: 'kilo/kilo-auto/free',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.KILO_API_KEY;
      if (key && key.length > 20) return true;
      // Check kilo config
      const configPath = path.join(os.homedir(), '.kilo', 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (data.apiKey || data.token) return true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },
  'opencode-cli': {
    apiKeyEnvVar: 'OPENCODE_API_KEY',
    loginCommand: 'opencode login',
    loginUrl: 'https://opencode.ai',
    method: 'oauth_web',
    defaultModels: [
      'kimi-k2.5', 'kimi-k2', 'deepseek-r1', 'deepseek-v3',
      'moonshot-v1-8k', 'moonshot-v1-32k',
    ],
    defaultModel: 'kimi-k2.5',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.OPENCODE_API_KEY;
      if (key && key.length > 20) return true;
      // Check ~/.opencode config
      const configPath = path.join(os.homedir(), '.opencode', 'config.json');
      if (fs.existsSync(configPath)) return true;
      return false;
    },
  },
  'aider-cli': {
    apiKeyEnvVar: 'OPENAI_API_KEY',
    loginUrl: 'https://platform.openai.com/api-keys',
    method: 'api_key',
    defaultModels: [
      'gpt-4o', 'gpt-4-turbo', 'claude-sonnet-4-20250514',
      'gemini-2.0-flash', 'deepseek/deepseek-coder',
    ],
    defaultModel: 'gpt-4o',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.OPENAI_API_KEY;
      return !!(key && key.startsWith('sk-') && key.length > 20);
    },
  },
  'ollama-cli': {
    method: 'local',
    defaultModels: ['llama3.1', 'llama3.2', 'mistral', 'codellama', 'qwen2.5-coder', 'phi3'],
    defaultModel: 'llama3.1',
    listModelsCmd: 'ollama list',
    checkLogin: () => {
      // Ollama is local, just check if service is running
      const result = execSafe('ollama list');
      return !!result && !result.includes('Error') && !result.includes('connection refused');
    },
  },
  'llm-cli': {
    apiKeyEnvVar: 'OPENAI_API_KEY',
    loginUrl: 'https://platform.openai.com/api-keys',
    method: 'api_key',
    defaultModels: ['gpt-4o', 'gpt-3.5-turbo', 'claude-3-opus-20240229'],
    defaultModel: 'gpt-4o',
    listModelsCmd: 'llm models',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.OPENAI_API_KEY;
      return !!(key && key.startsWith('sk-') && key.length > 20);
    },
  },
  'qwen-cli': {
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    loginUrl: 'https://dashscope.aliyun.com/',
    method: 'api_key',
    defaultModels: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    defaultModel: 'qwen-max',
    checkLogin: (apiKey) => {
      if (apiKey) return true;
      const key = process.env.DASHSCOPE_API_KEY;
      return !!(key && key.length > 20);
    },
  },
};

// ─── Login check per CLI ──────────────────────────────────────────────────────

function checkLoginStatus(backend: BackendInfo): CliLoginStatus {
  const cliId = String(backend.id);
  const config = CLI_KNOWN_CONFIGS[cliId];
  const settings = loadCliSettingsFromDb(cliId);

  if (!backend.available) {
    return {
      cliId,
      loggedIn: false,
      method: 'none',
      apiKeyConfigured: false,
      error: 'CLI not installed or not found on PATH',
    };
  }

  if (!config) {
    // Unknown CLI — assume local/no-auth
    return {
      cliId,
      loggedIn: true,
      method: 'none',
      apiKeyConfigured: true,
    };
  }

  // Resolve API key: DB saved > env var
  const savedApiKey = settings.apiKey;
  const envApiKey = config.apiKeyEnvVar ? process.env[config.apiKeyEnvVar] : undefined;
  const effectiveApiKey = savedApiKey || envApiKey;

  const apiKeyConfigured = !!(effectiveApiKey && effectiveApiKey.length > 5);
  const loggedIn = config.checkLogin ? config.checkLogin(effectiveApiKey) : apiKeyConfigured;

  return {
    cliId,
    loggedIn,
    method: config.method,
    account: effectiveApiKey ? `${config.apiKeyEnvVar || 'API Key'} configured` : undefined,
    apiKeyConfigured,
    loginUrl: config.loginUrl,
    loginCommand: config.loginCommand,
    apiKeyEnvVar: config.apiKeyEnvVar,
    error: !loggedIn ? `Not authenticated. ${config.loginCommand ? `Run: ${config.loginCommand}` : 'Set API key in settings.'}` : undefined,
  };
}

// ─── Model listing per CLI ────────────────────────────────────────────────────

function getModelsForCli(cliId: string, backend: BackendInfo): CliModelInfo {
  const config = CLI_KNOWN_CONFIGS[cliId];
  const settings = loadCliSettingsFromDb(cliId);

  const defaultModels = config?.defaultModels || [];
  const defaultModel = config?.defaultModel || '';
  const selectedModel = settings.model || defaultModel;

  // For ollama and llm, try to get live model list
  if (config?.listModelsCmd && backend.available) {
    try {
      const rawList = execSafe(config.listModelsCmd, 8000);
      if (rawList && !rawList.toLowerCase().includes('error')) {
        const liveModels = rawList
          .split('\n')
          .slice(1) // skip header
          .map(line => line.trim().split(/\s+/)[0])
          .filter(m => m && m.length > 1 && !m.includes(':'));

        if (liveModels.length > 0) {
          const mergedModels = Array.from(new Set([...liveModels, ...defaultModels]));
          return { cliId, models: mergedModels, selectedModel, defaultModel };
        }
      }
    } catch { /* fall through to defaults */ }
  }

  return { cliId, models: defaultModels, selectedModel, defaultModel };
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/** GET /api/cli-manager/discover — scan all installed CLIs */
router.get('/discover', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    const backends = forceRefresh ? refreshAvailableBackends() : getAvailableBackends();
    const cliBackends = backends.filter(b => b.kind === 'cli');

    const results: CliFullStatus[] = cliBackends.map(backend => {
      const cliId = String(backend.id);
      const loginStatus = checkLoginStatus(backend);
      const modelInfo = getModelsForCli(cliId, backend);
      const settings = loadCliSettingsFromDb(cliId);

      return {
        backend,
        login: loginStatus,
        models: modelInfo,
        settings: {
          cliId,
          model: settings.model || modelInfo.defaultModel,
          personality: settings.personality || '',
          agentMode: settings.agentMode || 'auto',
          permissions: settings.permissions || [],
          extraArgs: settings.extraArgs || '',
          enabled: settings.enabled !== false,
          loginMethod: settings.loginMethod || CLI_KNOWN_CONFIGS[cliId]?.method || 'none',
        },
        lastChecked: new Date().toISOString(),
      };
    });

    // Sort: available + logged-in first
    results.sort((a, b) => {
      const scoreA = (a.backend.available ? 2 : 0) + (a.login.loggedIn ? 1 : 0);
      const scoreB = (b.backend.available ? 2 : 0) + (b.login.loggedIn ? 1 : 0);
      return scoreB - scoreA;
    });

    res.json({ success: true, clis: results, total: results.length });
  } catch (err) {
    log.error('CLI discovery error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** GET /api/cli-manager/status/:cliId — check single CLI status */
router.get('/status/:cliId', async (req: Request, res: Response) => {
  try {
    const cliId = String(req.params['cliId'] || '');
    const backends = refreshAvailableBackends();
    const backend = backends.find(b => b.id === cliId);

    if (!backend) {
      return res.status(404).json({ success: false, error: `CLI '${cliId}' not found` });
    }

    const loginStatus = checkLoginStatus(backend);
    const modelInfo = getModelsForCli(cliId, backend);
    const settings = loadCliSettingsFromDb(cliId);

    res.json({
      success: true,
      status: {
        backend,
        login: loginStatus,
        models: modelInfo,
        settings,
        lastChecked: new Date().toISOString(),
      },
    });
  } catch (err) {
    log.error('CLI status check error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** GET /api/cli-manager/models/:cliId — list available models for a CLI */
router.get('/models/:cliId', async (req: Request, res: Response) => {
  try {
    const cliId = String(req.params['cliId'] || '');
    const backends = getAvailableBackends();
    const backend = backends.find(b => b.id === cliId);

    if (!backend || !backend.available) {
      return res.status(404).json({ success: false, error: `CLI '${cliId}' not available` });
    }

    const modelInfo = getModelsForCli(cliId, backend);
    res.json({ success: true, ...modelInfo });
  } catch (err) {
    log.error('Model list error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** POST /api/cli-manager/settings/:cliId — save settings for a CLI */
router.post('/settings/:cliId', async (req: Request, res: Response) => {
  try {
    const cliId = String(req.params['cliId'] || '');
    const {
      model, personality, agentMode, permissions, extraArgs, enabled,
      apiKey, loginMethod,
    } = req.body as CliSettings;

    saveCliSettingsToDb(cliId, {
      model,
      personality,
      agentMode,
      permissions,
      extraArgs,
      enabled,
      apiKey,
      loginMethod,
    });

    log.info(`Saved settings for CLI: ${cliId}`, { model, enabled });
    res.json({ success: true, message: `Settings saved for ${cliId}` });
  } catch (err) {
    log.error('Save settings error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** POST /api/cli-manager/test/:cliId — quick connectivity test */
router.post('/test/:cliId', async (req: Request, res: Response) => {
  try {
    const cliId = String(req.params['cliId'] || '');
    const backends = getAvailableBackends();
    const backend = backends.find(b => b.id === cliId);

    if (!backend || !backend.available) {
      return res.json({
        success: false,
        available: false,
        message: `CLI '${cliId}' is not installed or not found on PATH`,
      });
    }

    // Simple version/help command test
    const testCommands: { [key: string]: string } = {
      'gemini-cli': 'gemini --version',
      'claude-cli': 'claude --version',
      'codex-cli': 'codex --version',
      'openai-cli': 'openai --version',
      'kilo-cli': 'kilo --version',
      'ollama-cli': 'ollama --version',
      'opencode-cli': 'opencode --version',
      'aider-cli': 'aider --version',
      'llm-cli': 'llm --version',
      'qwen-cli': 'qwen --version',
    };

    const cmd = testCommands[cliId] || `${backend.command || cliId.replace('-cli', '')} --version`;
    const result = execSafe(cmd, 8000);

    if (result) {
      res.json({
        success: true,
        available: true,
        output: result.substring(0, 200),
        message: `${backend.name} is responding`,
      });
    } else {
      // Try --help as fallback
      const helpCmd = cmd.replace('--version', '--help');
      const helpResult = execSafe(helpCmd, 6000);
      res.json({
        success: !!helpResult,
        available: !!helpResult,
        output: helpResult ? helpResult.substring(0, 200) : '',
        message: helpResult ? `${backend.name} is responding (via --help)` : `${backend.name} did not respond`,
      });
    }
  } catch (err) {
    log.error('CLI test error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** GET /api/cli-manager/oauth — scan all OAuth credentials */
router.get('/oauth', async (req: Request, res: Response) => {
  try {
    const result = await scanOAuthCredentials();
    res.json({ success: true, ...result });
  } catch (err) {
    log.error('OAuth scan error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** GET /api/cli-manager/mention-map — get @mention routing table */
router.get('/mention-map', async (req: Request, res: Response) => {
  try {
    const backends = getAvailableBackends();
    const cliBackends = backends.filter(b => b.kind === 'cli' && b.available);

    // Build @mention map with current settings
    const mentionMap = cliBackends.map(b => {
      const cliId = String(b.id);
      const settings = loadCliSettingsFromDb(cliId);
      const command = b.command || cliId.replace('-cli', '');
      return {
        cliId,
        name: b.name,
        mention: `@${command}`,
        enabled: settings.enabled !== false,
        model: settings.model || CLI_KNOWN_CONFIGS[cliId]?.defaultModel || '',
        available: b.available,
      };
    });

    // Add built-in mentions
    const builtins = [
      { cliId: 'jarvis', name: 'Jarvis (Root Admin)', mention: '@jarvis', enabled: true, model: '', available: true },
      { cliId: 'agent', name: 'Jarvis Agent', mention: '@agent', enabled: true, model: '', available: true },
    ];

    res.json({ success: true, mentions: [...builtins, ...mentionMap] });
  } catch (err) {
    log.error('Mention map error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** POST /api/cli-manager/mention-config — update @mention routing settings */
router.post('/mention-config', async (req: Request, res: Response) => {
  try {
    const { cliId, enabled, model } = req.body as { cliId: string; enabled: boolean; model?: string };
    if (!cliId) return res.status(400).json({ success: false, error: 'cliId required' });

    saveCliSettingsToDb(cliId, { enabled, model });
    log.info(`Updated mention config for @${cliId}`, { enabled, model });
    res.json({ success: true, message: 'Mention config updated' });
  } catch (err) {
    log.error('Mention config update error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
