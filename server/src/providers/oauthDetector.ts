/**
 * CLI OAuth Detector
 * Scans local machine for CLI-based OAuth credentials that the agent can use.
 * Focuses on CLI OAuth tokens (gcloud, gh, az, aws, etc.) to comply with provider ToS.
 *
 * These are legitimate OAuth flows initiated by the user via CLI tools,
 * NOT browser-based token scraping.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OAuthDetector');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OAuthCredential {
  /** Provider ID (matches registry or new) */
  providerId: string;
  /** Display name */
  name: string;
  /** CLI tool that owns the credential */
  cliTool: string;
  /** OAuth source description */
  source: string;
  /** Whether the credential is currently valid */
  valid: boolean;
  /** Access token (short-lived, refreshable) */
  accessToken?: string;
  /** Expiry timestamp (ms) if known */
  expiresAt?: number;
  /** Project/account identifier */
  account?: string;
  /** Base URL for API calls */
  baseUrl?: string;
  /** Default model if applicable */
  defaultModel?: string;
  /** Available models */
  models?: string[];
  /** Provider type for registry */
  providerType: 'gemini' | 'openai-compatible' | 'anthropic' | 'rest-api';
  /** Provider category */
  category: 'llm' | 'embedding' | 'tts' | 'image' | 'search' | 'platform';
  /** Error message if detection failed */
  error?: string;
}

export interface OAuthScanResult {
  timestamp: string;
  scannedTools: string[];
  detected: OAuthCredential[];
  errors: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function execSafe(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, {
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    }).trim();
  } catch {
    return null;
  }
}

function fileExists(filePath: string): boolean {
  try { return fs.existsSync(filePath); } catch { return false; }
}

function readJsonSafe(filePath: string): any {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

// ─── Detector Functions ──────────────────────────────────────────────────────

/** Google Cloud CLI (gcloud) → Vertex AI / Gemini API */
function detectGcloud(): OAuthCredential | null {
  // Check if gcloud is installed
  const gcloudPath = execSafe('which gcloud') || execSafe('where gcloud');
  if (!gcloudPath) return null;

  // Check active account
  const account = execSafe('gcloud config get-value account 2>/dev/null');
  if (!account || account === '(unset)') {
    return {
      providerId: 'vertex-ai',
      name: 'Google Vertex AI (gcloud)',
      cliTool: 'gcloud',
      source: 'gcloud CLI OAuth',
      valid: false,
      providerType: 'gemini',
      category: 'llm',
      error: 'No active gcloud account. Run: gcloud auth login',
    };
  }

  // Get access token
  const accessToken = execSafe('gcloud auth print-access-token 2>/dev/null');
  if (!accessToken) {
    return {
      providerId: 'vertex-ai',
      name: 'Google Vertex AI (gcloud)',
      cliTool: 'gcloud',
      source: 'gcloud CLI OAuth',
      valid: false,
      account,
      providerType: 'gemini',
      category: 'llm',
      error: 'Token expired. Run: gcloud auth login',
    };
  }

  // Get project
  const project = execSafe('gcloud config get-value project 2>/dev/null') || '';
  const region = execSafe('gcloud config get-value compute/region 2>/dev/null') || 'us-central1';

  return {
    providerId: 'vertex-ai',
    name: 'Google Vertex AI (gcloud)',
    cliTool: 'gcloud',
    source: `gcloud CLI OAuth — ${account}`,
    valid: true,
    accessToken,
    account,
    baseUrl: `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}`,
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash'],
    providerType: 'gemini',
    category: 'llm',
  };
}

/** Google Application Default Credentials (ADC) */
function detectGoogleADC(): OAuthCredential | null {
  const adcPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'),
  ].filter(Boolean) as string[];

  for (const adcPath of adcPaths) {
    if (!fileExists(adcPath)) continue;
    const adc = readJsonSafe(adcPath);
    if (!adc) continue;

    // Service account key file
    if (adc.type === 'service_account' && adc.private_key) {
      return {
        providerId: 'vertex-ai-sa',
        name: 'Google Vertex AI (Service Account)',
        cliTool: 'gcloud',
        source: `Service Account: ${adc.client_email || 'unknown'}`,
        valid: true,
        account: adc.client_email,
        baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
        defaultModel: 'gemini-1.5-flash',
        models: ['gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash'],
        providerType: 'gemini',
        category: 'llm',
      };
    }

    // Authorized user (ADC from gcloud auth application-default login)
    if (adc.type === 'authorized_user' && adc.refresh_token) {
      return {
        providerId: 'vertex-ai-adc',
        name: 'Google Vertex AI (ADC)',
        cliTool: 'gcloud',
        source: `ADC: ${adc.client_id?.slice(0, 20)}...`,
        valid: true,
        baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
        defaultModel: 'gemini-1.5-flash',
        models: ['gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash'],
        providerType: 'gemini',
        category: 'llm',
      };
    }
  }
  return null;
}

/** GitHub CLI (gh) → GitHub Models API */
function detectGitHubCLI(): OAuthCredential | null {
  const ghPath = execSafe('which gh') || execSafe('where gh');
  if (!ghPath) return null;

  // Check auth status
  const authStatus = execSafe('gh auth status 2>&1');
  if (!authStatus || authStatus.includes('not logged in')) {
    return {
      providerId: 'github-models',
      name: 'GitHub Models (gh CLI)',
      cliTool: 'gh',
      source: 'GitHub CLI OAuth',
      valid: false,
      providerType: 'openai-compatible',
      category: 'llm',
      error: 'Not logged in. Run: gh auth login',
    };
  }

  // Get token
  const token = execSafe('gh auth token 2>/dev/null');
  if (!token) {
    return {
      providerId: 'github-models',
      name: 'GitHub Models (gh CLI)',
      cliTool: 'gh',
      source: 'GitHub CLI OAuth',
      valid: false,
      providerType: 'openai-compatible',
      category: 'llm',
      error: 'Cannot retrieve token. Run: gh auth refresh',
    };
  }

  // Extract username from auth status
  const userMatch = authStatus.match(/Logged in to github\.com account (\S+)/i)
    || authStatus.match(/account\s+(\S+)/i);
  const account = userMatch?.[1] || 'authenticated';

  return {
    providerId: 'github-models',
    name: 'GitHub Models (gh CLI)',
    cliTool: 'gh',
    source: `GitHub CLI OAuth — ${account}`,
    valid: true,
    accessToken: token,
    account,
    baseUrl: 'https://models.inference.ai.azure.com',
    defaultModel: 'gpt-4o',
    models: [
      'gpt-4o', 'gpt-4o-mini',
      'Meta-Llama-3.1-405B-Instruct', 'Meta-Llama-3.1-70B-Instruct',
      'Mistral-Large-2', 'Mistral-Nemo',
      'Cohere-command-r-plus',
    ],
    providerType: 'openai-compatible',
    category: 'llm',
  };
}

/** Azure CLI (az) → Azure OpenAI */
function detectAzureCLI(): OAuthCredential | null {
  const azPath = execSafe('which az') || execSafe('where az');
  if (!azPath) return null;

  const account = execSafe('az account show --query "user.name" -o tsv 2>/dev/null');
  if (!account) {
    return {
      providerId: 'azure-openai',
      name: 'Azure OpenAI (az CLI)',
      cliTool: 'az',
      source: 'Azure CLI OAuth',
      valid: false,
      providerType: 'openai-compatible',
      category: 'llm',
      error: 'Not logged in. Run: az login',
    };
  }

  const token = execSafe('az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv 2>/dev/null');
  const subscription = execSafe('az account show --query "name" -o tsv 2>/dev/null') || '';

  return {
    providerId: 'azure-openai',
    name: 'Azure OpenAI (az CLI)',
    cliTool: 'az',
    source: `Azure CLI OAuth — ${account} (${subscription})`,
    valid: !!token,
    accessToken: token || undefined,
    account,
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-35-turbo'],
    providerType: 'openai-compatible',
    category: 'llm',
    error: token ? undefined : 'Cannot get cognitive services token. Check RBAC permissions.',
  };
}

/** AWS CLI → Amazon Bedrock */
function detectAWSCLI(): OAuthCredential | null {
  const awsPath = execSafe('which aws') || execSafe('where aws');
  if (!awsPath) return null;

  // Check if configured
  const identity = execSafe('aws sts get-caller-identity --query "Arn" --output text 2>/dev/null');
  if (!identity) {
    // Check if credentials file exists
    const credPath = path.join(os.homedir(), '.aws', 'credentials');
    if (fileExists(credPath)) {
      return {
        providerId: 'aws-bedrock',
        name: 'Amazon Bedrock (AWS CLI)',
        cliTool: 'aws',
        source: 'AWS CLI credentials file',
        valid: false,
        providerType: 'openai-compatible',
        category: 'llm',
        error: 'Credentials found but STS call failed. Check: aws configure',
      };
    }
    return null;
  }

  const region = execSafe('aws configure get region 2>/dev/null') || 'us-east-1';

  return {
    providerId: 'aws-bedrock',
    name: 'Amazon Bedrock (AWS CLI)',
    cliTool: 'aws',
    source: `AWS CLI — ${identity}`,
    valid: true,
    account: identity,
    baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
    defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    models: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'meta.llama3-1-70b-instruct-v1:0',
      'amazon.nova-pro-v1:0',
    ],
    providerType: 'openai-compatible',
    category: 'llm',
  };
}

/** Hugging Face CLI → HF Inference API */
function detectHuggingFace(): OAuthCredential | null {
  // Check token file
  const tokenPath = path.join(os.homedir(), '.cache', 'huggingface', 'token');
  const tokenPathAlt = path.join(os.homedir(), '.huggingface', 'token');

  let token: string | null = null;
  for (const p of [tokenPath, tokenPathAlt]) {
    if (fileExists(p)) {
      try {
        token = fs.readFileSync(p, 'utf-8').trim();
        if (token) break;
      } catch { /* ignore */ }
    }
  }

  // Also check env
  if (!token) {
    token = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || null;
  }

  if (!token) return null;

  return {
    providerId: 'huggingface',
    name: 'Hugging Face Inference',
    cliTool: 'huggingface-cli',
    source: `HF Token: ${token.slice(0, 8)}...`,
    valid: true,
    accessToken: token,
    baseUrl: 'https://api-inference.huggingface.co/v1',
    defaultModel: 'meta-llama/Llama-3.1-70B-Instruct',
    models: [
      'meta-llama/Llama-3.1-70B-Instruct',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'Qwen/Qwen2.5-72B-Instruct',
    ],
    providerType: 'openai-compatible',
    category: 'llm',
  };
}

/** Ollama (local/cloud) — not OAuth but useful */
function detectOllama(): OAuthCredential | null {
  const ollamaPath = execSafe('where ollama 2>nul') || execSafe('which ollama 2>/dev/null');
  if (!ollamaPath) return null;

  // Determine Ollama host (supports remote/cloud Ollama instances)
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const baseApiUrl = ollamaHost.replace(/\/$/, '');

  // Try to get model list via 'ollama list' command first (most reliable on Windows)
  let models: string[] = [];
  let serverRunning = false;

  const ollamaListResult = execSafe('ollama list 2>&1', 5000);
  if (ollamaListResult && !ollamaListResult.includes('Error') && !ollamaListResult.includes('connection refused') && !ollamaListResult.includes('could not connect')) {
    serverRunning = true;
    // Parse 'ollama list' output: first column is model name, skip header
    const lines = ollamaListResult.split('\n').slice(1);
    models = lines
      .map(line => line.trim().split(/\s+/)[0])
      .filter(m => m && m.length > 1 && m.includes(':'));
    // Also include names without the :tag suffix for flexibility
    if (models.length === 0) {
      models = lines
        .map(line => line.trim().split(/\s+/)[0])
        .filter(m => m && m.length > 1);
    }
  }

  // Fallback: try HTTP API if 'ollama list' didn't work
  if (!serverRunning) {
    try {
      const curlCmd = process.platform === 'win32'
        ? `curl -s -o nul -w "%%{http_code}" ${baseApiUrl}/api/tags`
        : `curl -s -o /dev/null -w "%{http_code}" ${baseApiUrl}/api/tags`;
      const res = execSafe(curlCmd, 3000);
      if (res && (res.includes('200') || res === '200')) {
        serverRunning = true;
      }
    } catch { /* ignore */ }
  }

  // Try HTTP API for models if 'ollama list' didn't get them
  if (serverRunning && models.length === 0) {
    try {
      const modelsJson = execSafe(`curl -s ${baseApiUrl}/api/tags`, 5000);
      if (modelsJson) {
        const parsed = JSON.parse(modelsJson);
        models = (parsed.models || []).map((m: any) => m.name).filter(Boolean);
      }
    } catch { /* ignore */ }
  }

  if (!serverRunning) {
    return {
      providerId: 'ollama',
      name: 'Ollama (Local)',
      cliTool: 'ollama',
      source: `Ollama — ${ollamaPath.split('\n')[0].trim()}`,
      valid: true, // CLI is installed — just not running right now
      providerType: 'openai-compatible',
      category: 'llm',
      baseUrl: `${baseApiUrl}/v1`,
      defaultModel: 'llama3.1',
      models: [],
      error: 'Ollama not running. Start with: ollama serve',
    };
  }

  return {
    providerId: 'ollama',
    name: 'Ollama (Local)',
    cliTool: 'ollama',
    source: `Ollama — ${models.length} models available`,
    valid: true,
    baseUrl: `${baseApiUrl}/v1`,
    defaultModel: models[0] || 'llama3.1',
    models,
    providerType: 'openai-compatible',
    category: 'llm',
  };
}

/** LM Studio (local) */
function detectLMStudio(): OAuthCredential | null {
  try {
    const res = execSafe('curl -s -o /dev/null -w "%{http_code}" http://localhost:1234/v1/models', 2000);
    if (res !== '200') return null;
  } catch {
    return null;
  }

  let models: string[] = [];
  try {
    const modelsJson = execSafe('curl -s http://localhost:1234/v1/models', 3000);
    if (modelsJson) {
      const parsed = JSON.parse(modelsJson);
      models = (parsed.data || []).map((m: any) => m.id).filter(Boolean);
    }
  } catch { /* ignore */ }

  return {
    providerId: 'lmstudio',
    name: 'LM Studio (Local)',
    cliTool: 'lmstudio',
    source: `LM Studio local — ${models.length} models loaded`,
    valid: true,
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: models[0] || '',
    models,
    providerType: 'openai-compatible',
    category: 'llm',
  };
}

/** Cloudflare Wrangler → Workers AI */
function detectCloudflareWrangler(): OAuthCredential | null {
  const wranglerPath = execSafe('which wrangler') || execSafe('where wrangler');
  if (!wranglerPath) return null;

  // Check wrangler config for oauth token
  const configDir = path.join(os.homedir(), '.wrangler', 'config');
  const tokenPath = path.join(os.homedir(), '.wrangler', 'config', 'default.toml');

  // Wrangler stores tokens in ~/.wrangler/config/default.toml or via env
  const cfToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  if (!cfToken) {
    // Check if logged in via wrangler
    const whoami = execSafe('npx wrangler whoami 2>/dev/null', 8000);
    if (!whoami || whoami.includes('not authenticated')) {
      return null; // Not installed as CLI or not logged in
    }
  }

  return {
    providerId: 'cloudflare-ai',
    name: 'Cloudflare Workers AI',
    cliTool: 'wrangler',
    source: 'Cloudflare CLI OAuth',
    valid: !!cfToken,
    accessToken: cfToken || undefined,
    baseUrl: 'https://api.cloudflare.com/client/v4',
    defaultModel: '@cf/meta/llama-3.1-70b-instruct',
    models: [
      '@cf/meta/llama-3.1-70b-instruct',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/mistral/mistral-7b-instruct-v0.2',
      '@hf/thebloke/deepseek-coder-6.7b-instruct-awq',
    ],
    providerType: 'openai-compatible',
    category: 'llm',
    error: cfToken ? undefined : 'No API token found. Run: wrangler login',
  };
}

// ─── AI CLI Tool Detectors ──────────────────────────────────────────────────

/** Gemini CLI (gemini) — Google's interactive AI CLI */
function detectGeminiCLI(): OAuthCredential | null {
  const geminiPath = execSafe('where gemini') || execSafe('which gemini');
  if (!geminiPath) return null;

  // Check if gemini CLI is functional (--version or --help)
  const version = execSafe('gemini --version 2>&1') || execSafe('gemini --help 2>&1');
  const valid = !!version && !version.includes('not found');

  // Gemini CLI may use GEMINI_API_KEY or Google OAuth
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

  // Try to get live models if API key is available
  let models = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
  if (apiKey) {
    const liveModels = fetchGeminiModels(apiKey);
    if (liveModels.length > 0) {
      models = liveModels;
    }
  }

  return {
    providerId: 'gemini-cli',
    name: 'Gemini CLI',
    cliTool: 'gemini',
    source: `Gemini CLI — ${geminiPath.split('\n')[0].trim()}`,
    valid,
    accessToken: apiKey || undefined,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    models,
    providerType: 'gemini',
    category: 'llm',
    error: valid ? undefined : 'Gemini CLI found but may not be functional',
  };
}

/** Claude CLI (claude) — Anthropic's Claude Code CLI */
function detectClaudeCLI(): OAuthCredential | null {
  // Try multiple detection methods on Windows
  let claudePath = execSafe('where claude 2>nul') || execSafe('which claude 2>/dev/null');

  // Windows: also check common npm global paths
  if (!claudePath) {
    const appDataNpm = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm', 'claude.cmd')
      : '';
    if (appDataNpm && fs.existsSync(appDataNpm)) {
      claudePath = appDataNpm;
    }
  }

  // Check npm global list
  if (!claudePath) {
    const npmList = execSafe('npm list -g @anthropic-ai/claude-code --depth=0 2>&1');
    if (npmList && !npmList.includes('(empty)') && !npmList.includes('ERR!')) {
      claudePath = 'npx @anthropic-ai/claude-code';
    }
  }

  if (!claudePath) return null;

  // Try --version, --help, or just -v for validation
  const version = execSafe('claude --version 2>&1')
    || execSafe('claude -v 2>&1')
    || execSafe('claude --help 2>&1');

  if (!version) {
    return {
      providerId: 'claude-cli',
      name: 'Claude Code CLI',
      cliTool: 'claude',
      source: `Claude CLI — ${claudePath.split('\n')[0].trim()}`,
      valid: false,
      providerType: 'anthropic',
      category: 'llm',
      error: 'Claude CLI found but could not verify functionality.',
    };
  }

  // Valid if we get any output that isn't an OS "not found" error
  const valid = !version.toLowerCase().includes('is not recognized')
    && !version.toLowerCase().includes('not found')
    && !version.toLowerCase().includes('no such file');

  // Claude CLI uses ANTHROPIC_API_KEY or internal OAuth
  const apiKey = process.env.ANTHROPIC_API_KEY || '';

  // Try to get live models
  let models = ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250414'];
  if (apiKey) {
    const liveModels = fetchAnthropicModels(apiKey);
    if (liveModels.length > 0) {
      models = liveModels;
    }
  }

  return {
    providerId: 'claude-cli',
    name: 'Claude Code CLI',
    cliTool: 'claude',
    source: `Claude CLI — ${claudePath.split('\n')[0].trim()}`,
    valid,
    accessToken: apiKey || undefined,
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    models,
    providerType: 'anthropic',
    category: 'llm',
    error: valid ? undefined : 'Claude CLI found but may not be functional',
  };
}

/** OpenAI CLI (openai) — OpenAI SDK CLI tool */
function detectOpenAICLI(): OAuthCredential | null {
  const openaiPath = execSafe('where openai 2>nul') || execSafe('which openai 2>/dev/null');
  if (!openaiPath) return null;

  const version = execSafe('openai --version 2>&1') || execSafe('openai --help 2>&1');
  if (!version) {
    return {
      providerId: 'openai-cli',
      name: 'OpenAI CLI',
      cliTool: 'openai',
      source: `OpenAI CLI — ${openaiPath.split('\n')[0].trim()}`,
      valid: false,
      providerType: 'openai-compatible',
      category: 'llm',
      error: 'OpenAI CLI found but could not verify functionality.',
    };
  }
  const apiKey = process.env.OPENAI_API_KEY || '';

  // Valid if: openai binary exists AND version check passes
  const valid = !version.includes('not found') && !version.includes('is not recognized');

  // Try live model listing
  let models = ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4-turbo'];
  if (apiKey) {
    const liveModels = fetchOpenAIModels(apiKey);
    if (liveModels.length > 0) {
      // Filter to chat models
      const chatModels = liveModels.filter(m =>
        m.includes('gpt-4') || m.includes('gpt-3.5') || m.includes('o3') || m.includes('o4') || m.includes('o1')
      );
      if (chatModels.length > 0) models = chatModels;
    }
  }

  return {
    providerId: 'openai-cli',
    name: 'OpenAI CLI',
    cliTool: 'openai',
    source: `OpenAI CLI — ${openaiPath.split('\n')[0].trim()}`,
    valid,
    accessToken: apiKey || undefined,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models,
    providerType: 'openai-compatible',
    category: 'llm',
    error: valid ? undefined : 'OpenAI CLI found but needs OPENAI_API_KEY to function',
  };
}

/** Codex CLI (codex) — OpenAI Codex CLI */
function detectCodexCLI(): OAuthCredential | null {
  const codexPath = execSafe('where codex') || execSafe('which codex');
  // Also check npx
  if (!codexPath) {
    const npxPath = execSafe('where npx') || execSafe('which npx');
    if (!npxPath) return null;
    const npmList = execSafe('npm list -g @openai/codex --depth=0 2>&1');
    if (!npmList || npmList.includes('(empty)') || npmList.includes('ERR!')) return null;
  }

  const version = execSafe('codex --version 2>&1');
  const valid = !!version && !version.includes('not found');

  // Codex uses OPENAI_API_KEY
  const apiKey = process.env.OPENAI_API_KEY || '';

  // Try live model listing
  let models = ['gpt-5.3-codex', 'o4-mini', 'gpt-4.1', 'gpt-4o'];
  if (apiKey) {
    const liveModels = fetchOpenAIModels(apiKey);
    if (liveModels.length > 0) {
      // Filter to coding-relevant models
      const codingModels = liveModels.filter(m =>
        m.includes('gpt-4') || m.includes('gpt-5') || m.includes('o3') || m.includes('o4') || m.includes('o1') || m.includes('codex')
      );
      if (codingModels.length > 0) models = codingModels;
    }
  }

  return {
    providerId: 'codex-cli',
    name: 'OpenAI Codex CLI',
    cliTool: 'codex',
    source: `Codex CLI — ${(codexPath || 'npx').split('\n')[0].trim()}`,
    valid,
    accessToken: apiKey || undefined,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.3-codex',
    models,
    providerType: 'openai-compatible',
    category: 'llm',
    error: valid ? undefined : 'Codex CLI found but may not be functional',
  };
}

/** Kilo Code CLI */
function detectKiloCLI(): OAuthCredential | null {
  const kiloPath = execSafe('where kilo 2>nul') || execSafe('which kilo 2>/dev/null');
  if (!kiloPath) return null;

  const version = execSafe('kilo --version 2>&1') || execSafe('kilo --help 2>&1');
  if (!version) {
    return {
      providerId: 'kilo-cli',
      name: 'Kilo Code CLI',
      cliTool: 'kilo',
      source: `Kilo CLI — ${kiloPath.split('\n')[0].trim()}`,
      valid: false,
      baseUrl: '',
      defaultModel: 'kilo/kilo-auto/free',
      models: [
        'kilo/kilo-auto/free',
        'kilo/kilo-auto/small',
        'kilo/kilo-auto/balanced',
        'kilo/kilo-auto/frontier',
        'kilo/anthropic/claude-sonnet-4',
        'kilo/openai/gpt-4o',
        'kilo/google/gemini-2.0-flash',
      ],
      providerType: 'openai-compatible',
      category: 'llm',
      error: 'Kilo CLI found but could not verify functionality.',
    };
  }
  const valid = !!version && !version.includes('not found') && !version.includes('is not recognized');

  return {
    providerId: 'kilo-cli',
    name: 'Kilo Code CLI',
    cliTool: 'kilo',
    source: `Kilo CLI — ${kiloPath.split('\n')[0].trim()}`,
    valid,
    baseUrl: '',
    defaultModel: 'kilo/kilo-auto/free',
    models: [
      'kilo/kilo-auto/free',
      'kilo/kilo-auto/small',
      'kilo/kilo-auto/balanced',
      'kilo/kilo-auto/frontier',
      'kilo/anthropic/claude-sonnet-4',
      'kilo/openai/gpt-4o',
      'kilo/google/gemini-2.0-flash',
    ],
    providerType: 'openai-compatible',
    category: 'llm',
    error: valid
      ? undefined
      : 'Kilo CLI found but may not be functional',
  };
}

/** Aider CLI — AI pair programming */
function detectAiderCLI(): OAuthCredential | null {
  const aiderPath = execSafe('where aider 2>nul') || execSafe('which aider 2>/dev/null');
  if (!aiderPath) return null;

  const version = execSafe('aider --version 2>&1');
  const valid = !!version && !version.includes('not found') && !version.includes('is not recognized');

  if (!valid) {
    return {
      providerId: 'aider-cli',
      name: 'Aider CLI',
      cliTool: 'aider',
      source: `Aider CLI — ${aiderPath.split('\n')[0].trim()}`,
      valid: false,
      providerType: 'openai-compatible',
      category: 'llm',
      error: 'Aider CLI found but could not verify functionality.',
    };
  }

  // Aider uses OPENAI_API_KEY or ANTHROPIC_API_KEY, or its own .aider.conf.yml
  const hasOpenAI = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 20);
  const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 20);
  // Check aider's own config files
  const aiderConfPaths = [
    path.join(os.homedir(), '.aider.conf.yml'),
    path.join(os.homedir(), '.aider', 'config.yml'),
  ];
  const hasAiderConf = aiderConfPaths.some(p => fileExists(p));
  const hasAuth = hasOpenAI || hasAnthropic || hasAiderConf;

  return {
    providerId: 'aider-cli',
    name: 'Aider CLI',
    cliTool: 'aider',
    source: `Aider CLI — ${aiderPath.split('\n')[0].trim()}`,
    valid: true, // CLI is functional — auth is separate
    baseUrl: hasAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    defaultModel: hasAnthropic ? 'claude-sonnet-4-20250514' : 'gpt-4o',
    models: [
      'gpt-4o', 'gpt-4-turbo', 'claude-sonnet-4-20250514',
      'claude-haiku-4-20250414', 'gemini-2.0-flash',
      'deepseek/deepseek-coder',
    ],
    providerType: hasAnthropic ? 'anthropic' : 'openai-compatible',
    category: 'llm',
    error: hasAuth ? undefined : 'Aider needs OPENAI_API_KEY or ANTHROPIC_API_KEY',
  };
}

/** Qwen CLI (qwen) — Alibaba Qwen AI CLI */
function detectQwenCLI(): OAuthCredential | null {
  const qwenPath = execSafe('where qwen 2>nul') || execSafe('which qwen 2>/dev/null');
  if (!qwenPath) return null;

  const version = execSafe('qwen --version 2>&1') || execSafe('qwen --help 2>&1');
  const valid = !!version && !version.includes('not found') && !version.includes('is not recognized');

  if (!valid) {
    return {
      providerId: 'qwen-cli',
      name: 'Qwen CLI',
      cliTool: 'qwen',
      source: `Qwen CLI — ${qwenPath.split('\n')[0].trim()}`,
      valid: false,
      providerType: 'openai-compatible',
      category: 'llm',
      error: 'Qwen CLI found but could not verify functionality.',
    };
  }

  // Qwen CLI can use env var OR its own internal auth (login via browser OAuth)
  const apiKey = process.env.DASHSCOPE_API_KEY || '';
  // Check various config locations Qwen CLI might use
  const qwenConfigPaths = [
    path.join(os.homedir(), '.qwen', 'config.json'),
    path.join(os.homedir(), '.qwen', 'credentials'),
    path.join(os.homedir(), '.config', 'qwen', 'config.json'),
    path.join(os.homedir(), '.dashscope', 'credentials'),
  ];
  const hasConfig = qwenConfigPaths.some(p => fileExists(p));
  // If CLI responds to --version, it's installed and likely already authenticated via its own login
  const hasAuth = apiKey.length > 10 || hasConfig;

  return {
    providerId: 'qwen-cli',
    name: 'Qwen CLI',
    cliTool: 'qwen',
    source: `Qwen CLI — ${qwenPath.split('\n')[0].trim()}`,
    valid: true, // CLI is functional — user confirmed it works
    accessToken: apiKey || undefined,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen-vl-max'],
    providerType: 'openai-compatible',
    category: 'llm',
    error: hasAuth ? undefined : undefined, // CLI handles its own auth internally
  };
}

/** OpenCode CLI (opencode) — Multi-model coding CLI */
function detectOpenCodeCLI(): OAuthCredential | null {
  const opencodePath = execSafe('where opencode 2>nul') || execSafe('which opencode 2>/dev/null');
  if (!opencodePath) return null;

  const version = execSafe('opencode --version 2>&1') || execSafe('opencode --help 2>&1');
  const valid = !!version && !version.includes('not found') && !version.includes('is not recognized');

  if (!valid) {
    return {
      providerId: 'opencode-cli',
      name: 'OpenCode CLI',
      cliTool: 'opencode',
      source: `OpenCode CLI — ${opencodePath.split('\n')[0].trim()}`,
      valid: false,
      providerType: 'openai-compatible',
      category: 'llm',
      error: 'OpenCode CLI found but could not verify functionality.',
    };
  }

  // OpenCode stores auth in its own config directory
  const hasKey = !!(process.env.OPENCODE_API_KEY && process.env.OPENCODE_API_KEY.length > 10);
  const opencodeConfigPaths = [
    path.join(os.homedir(), '.opencode', 'config.json'),
    path.join(os.homedir(), '.opencode', 'credentials'),
    path.join(os.homedir(), '.config', 'opencode', 'config.json'),
    path.join(os.homedir(), '.opencode.json'),
  ];
  const hasConfig = opencodeConfigPaths.some(p => fileExists(p));

  return {
    providerId: 'opencode-cli',
    name: 'OpenCode CLI',
    cliTool: 'opencode',
    source: `OpenCode CLI — ${opencodePath.split('\n')[0].trim()}`,
    valid: true, // CLI is functional — user confirmed it works
    baseUrl: '',
    defaultModel: 'kimi-k2.5',
    models: ['kimi-k2.5', 'kimi-k2', 'deepseek-r1', 'deepseek-v3', 'moonshot-v1-8k'],
    providerType: 'openai-compatible',
    category: 'llm',
    error: (hasKey || hasConfig) ? undefined : undefined, // CLI handles its own auth
  };
}

// ─── Live Model Fetching Helpers ────────────────────────────────────────────

/** Try to get real models from Gemini API using the existing API key */
function fetchGeminiModels(apiKey: string): string[] {
  try {
    const raw = execSafe(
      `curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}"`,
      8000
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed.models) return [];
    return (parsed.models as any[])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => (m.name as string).replace('models/', ''))
      .filter(name => name.startsWith('gemini'));
  } catch { return []; }
}

/** Try to get real models from OpenAI-compatible API */
function fetchOpenAIModels(apiKey: string, baseUrl = 'https://api.openai.com/v1'): string[] {
  try {
    const raw = execSafe(
      `curl -s -H "Authorization: Bearer ${apiKey}" "${baseUrl}/models"`,
      8000
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed.data) return [];
    return (parsed.data as any[])
      .map(m => m.id as string)
      .filter(id => id && !id.includes('embedding') && !id.includes('whisper') && !id.includes('dall-e') && !id.includes('tts'));
  } catch { return []; }
}

/** Try to get real models from Anthropic API */
function fetchAnthropicModels(apiKey: string): string[] {
  try {
    const raw = execSafe(
      `curl -s -H "x-api-key: ${apiKey}" -H "anthropic-version: 2023-06-01" "https://api.anthropic.com/v1/models"`,
      8000
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed.data) return [];
    return (parsed.data as any[]).map(m => m.id as string).filter(Boolean);
  } catch { return []; }
}

// ─── Main Scanner ────────────────────────────────────────────────────────────

const DETECTORS: Array<{ name: string; detect: () => OAuthCredential | null }> = [
  // Cloud OAuth providers
  { name: 'Google Cloud (gcloud)', detect: detectGcloud },
  { name: 'Google ADC', detect: detectGoogleADC },
  { name: 'GitHub CLI (gh)', detect: detectGitHubCLI },
  { name: 'Azure CLI (az)', detect: detectAzureCLI },
  { name: 'AWS CLI', detect: detectAWSCLI },
  { name: 'Hugging Face', detect: detectHuggingFace },
  // AI CLI tools
  { name: 'Gemini CLI', detect: detectGeminiCLI },
  { name: 'Claude CLI', detect: detectClaudeCLI },
  { name: 'OpenAI CLI', detect: detectOpenAICLI },
  { name: 'Codex CLI', detect: detectCodexCLI },
  { name: 'Kilo Code CLI', detect: detectKiloCLI },
  { name: 'Aider CLI', detect: detectAiderCLI },
  { name: 'Qwen CLI', detect: detectQwenCLI },
  { name: 'OpenCode CLI', detect: detectOpenCodeCLI },
  // Local providers
  { name: 'Ollama (local)', detect: detectOllama },
  { name: 'LM Studio (local)', detect: detectLMStudio },
  { name: 'Cloudflare Workers AI', detect: detectCloudflareWrangler },
];

/** Scan all CLI OAuth sources and return detected credentials */
export async function scanOAuthCredentials(): Promise<OAuthScanResult> {
  const result: OAuthScanResult = {
    timestamp: new Date().toISOString(),
    scannedTools: [],
    detected: [],
    errors: [],
  };

  for (const { name, detect } of DETECTORS) {
    result.scannedTools.push(name);
    try {
      const credential = detect();
      if (credential) {
        result.detected.push(credential);
        log.info(`OAuth detected: ${credential.name}`, {
          provider: credential.providerId,
          valid: credential.valid,
          source: credential.source,
        });
      }
    } catch (err) {
      const msg = `Failed to scan ${name}: ${String(err)}`;
      result.errors.push(msg);
      log.warn(msg);
    }
  }

  log.info(`OAuth scan complete: ${result.detected.length} providers found from ${result.scannedTools.length} sources`);
  return result;
}

/** Refresh a specific OAuth token (e.g. gcloud access token expires every hour) */
export function refreshOAuthToken(providerId: string): OAuthCredential | null {
  const detector = DETECTORS.find(d => {
    const cred = d.detect();
    return cred?.providerId === providerId;
  });
  if (!detector) return null;
  return detector.detect();
}

/**
 * Fetch live models for a provider using API key + provider type.
 * Used as a fallback when ProviderFactory.listModels() fails for CLI-based providers.
 */
export function fetchLiveModelsForProvider(
  providerId: string,
  apiKey: string,
  providerType?: string,
  baseUrl?: string
): string[] {
  try {
    // Determine provider type from ID
    const type = providerType ||
      (providerId.includes('gemini') ? 'gemini' :
       providerId.includes('claude') || providerId.includes('anthropic') ? 'anthropic' :
       'openai-compatible');

    switch (type) {
      case 'gemini':
        return fetchGeminiModels(apiKey);
      case 'anthropic':
        return fetchAnthropicModels(apiKey);
      case 'openai-compatible':
        return fetchOpenAIModels(apiKey, baseUrl || 'https://api.openai.com/v1');
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/** Get just the list of detected provider IDs (fast check) */
export function getDetectedOAuthProviderIds(): string[] {
  const ids: string[] = [];
  for (const { detect } of DETECTORS) {
    try {
      const cred = detect();
      if (cred?.valid) ids.push(cred.providerId);
    } catch { /* skip */ }
  }
  return ids;
}
