import { getSetting, isDbInitialized } from '../database/db.js';

const DEFAULT_ROOT_ADMIN_BOT_ID = process.env.JARVIS_ROOT_BOT_ID || 'jarvis-root-admin';
const DEFAULT_ROOT_ADMIN_BOT_NAME = process.env.JARVIS_ROOT_BOT_NAME || 'Jarvis Root Admin';
const DEFAULT_ROOT_ADMIN_PERSONA_PLATFORM = process.env.JARVIS_ROOT_PERSONA_PLATFORM || 'system';
const DEFAULT_ROOT_ADMIN_SPECIALIST = process.env.JARVIS_ROOT_SPECIALIST || 'jarvis-root-admin';

const DEFAULT_SUPERVISOR_BOT_IDS = Array.from(
  new Set([
    DEFAULT_ROOT_ADMIN_BOT_ID,
    'jarvis-admin',
    'specialist_jarvis-root-admin',
  ]),
);

function readSettingSafe(key: string): string | null {
  if (!isDbInitialized()) return null;
  try {
    return getSetting(key) ?? null;
  } catch {
    return null;
  }
}

function normalizeId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeName(value: string): string {
  return String(value || '').trim();
}

function parseSupervisorIds(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((item) => normalizeId(item))
    .filter(Boolean);
}

export function getRootAdminBotId(): string {
  return normalizeId(readSettingSafe('jarvis_root_bot_id') ?? DEFAULT_ROOT_ADMIN_BOT_ID);
}

export function getRootAdminBotName(): string {
  return normalizeName(readSettingSafe('jarvis_root_bot_name') ?? DEFAULT_ROOT_ADMIN_BOT_NAME);
}

export function getRootAdminPersonaPlatform(): string {
  return normalizeName(readSettingSafe('jarvis_root_persona_platform') ?? DEFAULT_ROOT_ADMIN_PERSONA_PLATFORM);
}

export function getRootAdminSpecialistName(): string {
  return normalizeId(readSettingSafe('jarvis_root_specialist_name') ?? DEFAULT_ROOT_ADMIN_SPECIALIST);
}

let cachedSupervisorBotIds: string[] | null = null;

export function getRootAdminSupervisorBotIds(): string[] {
  if (cachedSupervisorBotIds) {
    return cachedSupervisorBotIds;
  }
  const configuredRaw = readSettingSafe('jarvis_supervisor_bot_ids');
  const configured = configuredRaw ? parseSupervisorIds(configuredRaw) : [];
  const merged = Array.from(
    new Set([
      getRootAdminBotId(),
      ...configured,
      ...DEFAULT_SUPERVISOR_BOT_IDS,
    ]),
  );
  cachedSupervisorBotIds = merged.filter(Boolean);
  return cachedSupervisorBotIds;
}

export function isRootAdminBotId(botId?: string): boolean {
  if (!botId) return false;
  const normalized = normalizeId(botId);
  return getRootAdminSupervisorBotIds().includes(normalized);
}

export function getRootAdminIdentity() {
  return {
    botId: getRootAdminBotId(),
    botName: getRootAdminBotName(),
    personaPlatform: getRootAdminPersonaPlatform(),
    specialistName: getRootAdminSpecialistName(),
    supervisorBotIds: getRootAdminSupervisorBotIds(),
  };
}
