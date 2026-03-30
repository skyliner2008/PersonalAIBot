/**
 * CLIManager — Dynamic CLI Connection Manager
 * Integrated into Settings page (not a separate page).
 *
 * Uses api.getCliTopology() which includes proper JWT auth via api.request().
 *
 * What this adds that doesn't exist elsewhere:
 * - Per-CLI login-status check (authenticated or not)
 * - Per-CLI model picker from live model list
 * - Per-CLI API Key input stored in DB
 * - Test Connection button with live result
 * - @Mention routing table with enable/disable per CLI
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Terminal, RefreshCw, CheckCircle2, XCircle, AlertCircle,
  ChevronDown, ChevronRight, Key, Cpu, Save, Play, ExternalLink,
  Eye, EyeOff, Lock, Unlock, MessageSquare, ToggleLeft, ToggleRight,
  Loader2,
} from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../components/Toast';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BackendInfo {
  id: string;
  name: string;
  available: boolean;
  path?: string;
  description: string;
  kind: 'builtin' | 'cli';
  prefix?: string;
  command?: string;
}

interface CliLoginStatus {
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

interface CliModelInfo {
  cliId: string;
  models: string[];
  selectedModel: string;
  defaultModel: string;
}

interface CliSettings {
  cliId: string;
  model?: string;
  personality?: string;
  agentMode?: string;
  extraArgs?: string;
  enabled?: boolean;
  apiKey?: string;
}

interface CliFullStatus {
  backend: BackendInfo;
  login: CliLoginStatus;
  models: CliModelInfo;
  settings: CliSettings;
  lastChecked: string;
}

interface MentionEntry {
  cliId: string;
  name: string;
  mention: string;
  enabled: boolean;
  model: string;
  available: boolean;
}

// ─── Status badge ────────────────────────────────────────────────────────────

function CliStatusDot({ available, loggedIn }: { available: boolean; loggedIn: boolean }) {
  if (!available) return <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="ไม่ได้ติดตั้ง" />;
  if (!loggedIn) return <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" title="ยังไม่ Login" />;
  return <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="พร้อมใช้งาน" />;
}

// ─── Individual CLI Row ───────────────────────────────────────────────────────

function CliRow({ item, onSaved }: { item: CliFullStatus; onSaved: () => void }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState(item.settings.apiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(item.settings.model || item.models.defaultModel || '');
  const [agentMode, setAgentMode] = useState(item.settings.agentMode || 'auto');
  const [extraArgs, setExtraArgs] = useState(item.settings.extraArgs || '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; output?: string } | null>(null);
  const [enabled, setEnabled] = useState(item.settings.enabled !== false);

  const { backend, login, models } = item;
  const cliId = backend.id;

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveCliSettings(cliId, { model, agentMode, extraArgs, enabled, apiKey: apiKey || undefined });
      addToast('success', `บันทึกการตั้งค่า ${backend.name} แล้ว`);
      onSaved();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testCliConnection(cliId);
      setTestResult({ success: res.success, message: res.message || (res.success ? 'ทำงานได้ปกติ' : 'ไม่ตอบสนอง'), output: res.output });
    } catch {
      setTestResult({ success: false, message: 'Connection error' });
    } finally {
      setTesting(false);
    }
  };

  const handleToggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await api.saveCliSettings(cliId, { model, agentMode, extraArgs, enabled: next, apiKey: apiKey || undefined });
    } catch { /* ignore */ }
  };

  return (
    <div className={`border rounded-lg overflow-hidden transition-all ${
      !backend.available
        ? 'border-gray-700/40 bg-gray-900/30 opacity-60'
        : login.loggedIn
          ? 'border-green-600/30 bg-gray-900/60'
          : 'border-yellow-600/30 bg-gray-900/60'
    }`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <CliStatusDot available={backend.available} loggedIn={login.loggedIn} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{backend.name}</span>
            {!backend.available && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/30">
                ไม่ได้ติดตั้ง
              </span>
            )}
            {backend.available && !login.loggedIn && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-300 border border-yellow-700/30 flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> ยังไม่ Login
              </span>
            )}
            {backend.available && login.loggedIn && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700/30 flex items-center gap-1">
                <Unlock className="w-2.5 h-2.5" /> พร้อมใช้
              </span>
            )}
            {login.method !== 'none' && login.method !== 'local' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                login.method === 'api_key'
                  ? 'bg-blue-900/30 text-blue-300 border-blue-700/30'
                  : 'bg-purple-900/30 text-purple-300 border-purple-700/30'
              }`}>
                {login.method === 'api_key' ? 'API Key' : 'OAuth'}
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-500 truncate mt-0.5">
            {backend.path || backend.description}
            {model && <span className="ml-2 text-gray-600">· {model}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* enable/disable toggle */}
          {backend.available && (
            <button onClick={handleToggleEnabled} className={enabled ? 'text-green-400' : 'text-gray-600'} title="เปิด/ปิดการใช้งาน">
              {enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
            </button>
          )}

          {/* login link */}
          {backend.available && !login.loggedIn && login.loginUrl && (
            <a href={login.loginUrl} target="_blank" rel="noopener noreferrer"
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded bg-yellow-700/30 text-yellow-300 border border-yellow-600/30 hover:bg-yellow-700/50 transition-colors">
              <ExternalLink className="w-3 h-3" /> เชื่อมต่อ
            </a>
          )}

          <button
            onClick={() => setOpen(!open)}
            className="p-1 text-gray-500 hover:text-gray-200 transition-colors rounded"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded settings */}
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-700/30 space-y-3">
          {/* Not installed warning */}
          {!backend.available && (
            <div className="flex items-center gap-2 p-2 rounded bg-red-900/20 border border-red-700/20">
              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-300">
                CLI ไม่ได้ติดตั้งหรือไม่พบบน PATH — ติดตั้ง {backend.command || cliId.replace('-cli', '')} แล้ว Refresh
              </p>
            </div>
          )}

          {/* Login hint */}
          {backend.available && !login.loggedIn && (
            <div className="flex items-start gap-2 p-2 rounded bg-yellow-900/20 border border-yellow-700/20">
              <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="text-yellow-300">{login.error}</p>
                {login.loginCommand && (
                  <code className="text-yellow-400/70 font-mono mt-0.5 block">{login.loginCommand}</code>
                )}
              </div>
            </div>
          )}

          {/* API Key */}
          {login.apiKeyEnvVar && (
            <div className="space-y-1">
              <label className="text-xs text-gray-400 flex items-center gap-1">
                <Key className="w-3 h-3" /> API Key
                <span className="text-gray-600 font-mono">({login.apiKeyEnvVar})</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={`ใส่ ${login.apiKeyEnvVar}...`}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 pr-8"
                  />
                  <button onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {login.loginUrl && (
                  <a href={login.loginUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-blue-900/40 border border-blue-700/30 text-xs text-blue-300 hover:bg-blue-900/60 whitespace-nowrap">
                    <ExternalLink className="w-3 h-3" /> รับ Key
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Model selector */}
          {models.models && models.models.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-gray-400 flex items-center gap-1">
                <Cpu className="w-3 h-3" /> Model
              </label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {models.models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-600">Default: {models.defaultModel}</p>
            </div>
          )}

          {/* Agent Mode */}
          <div className="space-y-1">
            <label className="text-xs text-gray-400">Agent Mode</label>
            <select
              value={agentMode}
              onChange={e => setAgentMode(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="auto">Auto</option>
              <option value="chat">Chat Only</option>
              <option value="agent">Full Agent</option>
              <option value="code">Code Specialist</option>
            </select>
          </div>

          {/* Extra Args */}
          <div className="space-y-1">
            <label className="text-xs text-gray-400 flex items-center gap-1">
              <Terminal className="w-3 h-3" /> Extra CLI Arguments
            </label>
            <input
              type="text"
              value={extraArgs}
              onChange={e => setExtraArgs(e.target.value)}
              placeholder="--verbose --no-auto-approve ..."
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700/50 hover:bg-blue-700/70 text-blue-200 text-xs font-medium border border-blue-600/40 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              {saving ? 'บันทึก...' : 'บันทึก'}
            </button>

            <button
              onClick={handleTest}
              disabled={testing || !backend.available}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700/60 hover:bg-gray-700 text-gray-200 text-xs font-medium border border-gray-600/40 transition-colors disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {testing ? 'กำลังทดสอบ...' : 'ทดสอบ Connection'}
            </button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`flex items-start gap-2 p-2 rounded text-xs border ${
              testResult.success
                ? 'bg-green-900/20 border-green-700/30 text-green-300'
                : 'bg-red-900/20 border-red-700/30 text-red-300'
            }`}>
              {testResult.success
                ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
              <div>
                <p>{testResult.message}</p>
                {testResult.output && (
                  <code className="text-[10px] text-gray-400 font-mono mt-0.5 block truncate max-w-xs">
                    {testResult.output}
                  </code>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── @Mention Routing Sub-panel ──────────────────────────────────────────────

function MentionRoutingPanel() {
  const { addToast } = useToast();
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getCliMentionMap();
      if (res?.success) setMentions(res.mentions || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (entry: MentionEntry) => {
    setUpdating(entry.cliId);
    try {
      await api.updateCliMentionConfig(entry.cliId, !entry.enabled, entry.model);
      setMentions(prev => prev.map(m => m.cliId === entry.cliId ? { ...m, enabled: !m.enabled } : m));
    } catch (e) {
      addToast('error', 'อัปเดตไม่สำเร็จ');
    } finally {
      setUpdating(null);
    }
  };

  if (loading && mentions.length === 0) {
    return <div className="flex items-center gap-2 text-gray-500 text-xs py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลด...</div>;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-gray-500 mb-2">
        พิมพ์ <code className="bg-gray-800 px-1 rounded text-cyan-300 font-mono">@ชื่อ</code> ในแชทเพื่อ Summon CLI โดยตรง (Line / Telegram / Discord)
      </p>
      {mentions.map(entry => (
        <div key={entry.cliId} className={`flex items-center justify-between p-2 rounded border transition-colors ${
          entry.enabled && entry.available ? 'bg-gray-800/50 border-gray-600/30' : 'bg-gray-800/20 border-gray-700/20 opacity-60'
        }`}>
          <div className="flex items-center gap-2.5">
            <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${
              entry.available ? 'bg-cyan-900/40 text-cyan-300' : 'bg-gray-800 text-gray-500'
            }`}>
              {entry.mention}
            </span>
            <span className="text-xs text-gray-300">{entry.name}</span>
            {!entry.available && <span className="text-[10px] text-gray-600">(ไม่ได้ติดตั้ง)</span>}
          </div>

          {entry.cliId !== 'jarvis' && entry.cliId !== 'agent' && (
            <button
              onClick={() => toggle(entry)}
              disabled={updating === entry.cliId || !entry.available}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 ${
                entry.enabled
                  ? 'bg-blue-700/40 text-blue-300 hover:bg-blue-700/60'
                  : 'bg-gray-700/40 text-gray-400 hover:bg-gray-700/60'
              }`}
            >
              {updating === entry.cliId ? '...' : entry.enabled ? 'เปิด ✓' : 'ปิด'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main CLIManager Component ────────────────────────────────────────────────

export function CLIManager() {
  const [expanded, setExpanded] = useState(false);
  const [clis, setClis] = useState<CliFullStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [lastScan, setLastScan] = useState<string>('');

  const loadTopology = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const res = await api.getCliTopology(forceRefresh);
      if (res?.success) {
        setClis(res.clis || []);
        setLastScan(new Date().toLocaleTimeString('th-TH'));
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Load when expanded for the first time
  useEffect(() => {
    if (expanded && clis.length === 0) {
      loadTopology(false);
    }
  }, [expanded, clis.length, loadTopology]);

  const installed = clis.filter(c => c.backend.available).length;
  const authenticated = clis.filter(c => c.backend.available && c.login.loggedIn).length;

  return (
    <div className="border border-cyan-500/20 rounded-lg overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-cyan-500/10 to-transparent hover:from-cyan-500/15 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <div className="text-left">
            <span className="text-xs font-semibold text-gray-200">CLI Connection Manager</span>
            <span className="text-[10px] text-gray-500 ml-2">ตรวจสอบสถานะ · ตั้งค่า Model · @Mention Routing</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {clis.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{installed}/{clis.length} ติดตั้ง</span>
              {authenticated > 0 && (
                <span className="text-[10px] text-green-300 bg-green-500/20 px-2 py-0.5 rounded-full border border-green-500/30">
                  {authenticated} พร้อม
                </span>
              )}
            </div>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-500" />
            : <ChevronRight className="w-4 h-4 text-gray-500" />
          }
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Controls */}
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-400">
              ตรวจสอบ CLI ทั้งหมดในเครื่อง — ตั้งค่า API Key, Model, และการสั่งงานผ่าน @mention
            </p>
            <div className="flex items-center gap-2">
              {lastScan && (
                <span className="text-[10px] text-gray-600">สแกนล่าสุด {lastScan}</span>
              )}
              <button
                onClick={() => loadTopology(true)}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-700/30 text-cyan-300 text-xs border border-cyan-600/30 hover:bg-cyan-700/50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'กำลังสแกน...' : 'สแกน CLI ใหม่'}
              </button>
            </div>
          </div>

          {/* Summary */}
          {clis.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'ทั้งหมด', val: clis.length, color: 'text-gray-300' },
                { label: 'ติดตั้งแล้ว', val: installed, color: 'text-blue-300' },
                { label: 'พร้อมใช้', val: authenticated, color: 'text-green-300' },
              ].map(s => (
                <div key={s.label} className="bg-gray-800/40 rounded-lg p-2 text-center border border-gray-700/30">
                  <div className={`text-lg font-bold ${s.color}`}>{s.val}</div>
                  <div className="text-[10px] text-gray-500">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* CLI list */}
          {loading && clis.length === 0 ? (
            <div className="flex items-center gap-2 text-gray-500 text-xs py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> กำลังสแกน CLI ในระบบ...
            </div>
          ) : clis.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">ไม่พบ CLI — กด "สแกน CLI ใหม่"</p>
          ) : (
            <div className="space-y-2">
              {clis.map(item => (
                <CliRow key={item.backend.id} item={item} onSaved={() => loadTopology(false)} />
              ))}
            </div>
          )}

          {/* @Mention routing section */}
          {clis.length > 0 && (
            <div className="border border-gray-700/40 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowMentions(!showMentions)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-800/40 hover:bg-gray-800/60 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-medium text-gray-200">@Mention Routing</span>
                  <span className="text-[10px] text-gray-500">Line / Telegram / Discord</span>
                </div>
                {showMentions
                  ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                  : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
              </button>
              {showMentions && (
                <div className="p-3">
                  <MentionRoutingPanel />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
