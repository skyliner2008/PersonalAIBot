import { getSetting } from '../database/db.js';
import { getAgentAllowOpenaiAutoFallback } from '../config/runtimeSettings.js';
import { getFallbackOrder, getProvider as getRegistryProvider } from '../providers/registry.js';
import { createAgentRuntimeProvider, getAgentCompatibleProvider, getAgentCompatibleProviders, } from '../providers/agentRuntime.js';
import { getProviderApiKey } from '../config/settingsSecurity.js';
import { trackUsage } from '../utils/usageTracker.js';
const providerCache = new Map();
function dedupeStrings(values) {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function toRuntimeContents(messages) {
    const systemInstruction = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content.trim())
        .filter(Boolean)
        .join('\n\n');
    const contents = messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
    }));
    return { systemInstruction, contents };
}
class ProviderNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProviderNotFoundError';
    }
}
class ProviderConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProviderConfigurationError';
    }
}
class RegistryAIProviderAdapter {
    providerId;
    id;
    type;
    name;
    providerDef;
    constructor(providerId) {
        this.providerId = providerId;
        const provider = getAgentCompatibleProvider(providerId);
        const supportedTypes = ['openai', 'azure', 'anthropic', 'google', 'gemini', 'minimax', 'openrouter'];
        const resolvedType = (supportedTypes.includes(providerId)
            ? providerId
            : 'openai');
        this.id = resolvedType;
        this.type = resolvedType;
        this.name = provider?.name || providerId;
        this.providerDef = provider;
    }
    async openaiSpecificMethod() {
        if (this.type !== 'openai')
            throw new Error('Method only available for OpenAI');
        console.log('OpenAI specific logic');
    }
    getProviderDef() {
        if (!this.providerDef) {
            throw new ProviderNotFoundError(`Provider "${this.providerId}" is not supported for AI chat routing`);
        }
        return this.providerDef;
    }
    getRuntimeProvider() {
        const runtimeProvider = createAgentRuntimeProvider(this.providerId);
        if (!runtimeProvider) {
            throw new ProviderConfigurationError(`Provider "${this.providerId}" is not configured or unavailable`);
        }
        return runtimeProvider;
    }
    getDefaultModel() {
        const provider = this.getProviderDef();
        return getSetting(`ai_${this.providerId}_model`)
            || provider.defaultModel
            || (provider.models?.length ? provider.models[0] : '') // Use the first model if available
            || '';
    }
    async chat(messages, options) {
        const runtimeProvider = this.getRuntimeProvider();
        const { systemInstruction, contents } = toRuntimeContents(messages);
        const modelName = options?.model || this.getDefaultModel();
        if (!modelName) {
            throw new Error(`No model configured for provider "${this.providerId}". Please configure a default model in the settings.`);
        }
        const response = await runtimeProvider.generateResponse(modelName, options?.systemPrompt || systemInstruction, contents);
        return {
            text: response.text,
            usage: response.usage ? {
                promptTokens: response.usage.promptTokens ?? 0,
                completionTokens: response.usage.completionTokens ?? 0,
                totalTokens: response.usage.totalTokens ?? 0,
            } : undefined,
        };
    }
    async testConnection() {
        try {
            const runtimeProvider = this.getRuntimeProvider();
            const modelName = this.getDefaultModel();
            if (!modelName)
                return false;
            await runtimeProvider.generateResponse(modelName, 'You are a connectivity test assistant. Reply with OK.', [{ role: 'user', parts: [{ text: 'OK' }] }]);
            return true;
        }
        catch (error) {
            console.error(`[AIRouter] Connection test failed for provider ${this.providerId}:`, error);
            return false;
        }
    }
    async listModels() {
        const provider = this.getProviderDef();
        const fallbackModels = dedupeStrings([
            ...(provider.models || []),
            provider.defaultModel,
            this.getDefaultModel(),
        ]);
        try {
            const runtimeProvider = this.getRuntimeProvider();
            const liveModels = await runtimeProvider.listModels();
            return dedupeStrings([...liveModels, ...fallbackModels]);
        }
        catch (err) {
            console.error(`[AIRouter] Failed to list models for provider ${this.providerId}: ${err}`);
            return fallbackModels;
        }
    }
}
function isCompatibleProviderId(value) {
    return !!value && !!getAgentCompatibleProvider(value);
}
const availabilityCache = new Map();
const AVAILABILITY_CACHE_TTL = 10000; // 10 seconds
function getAvailability(providerId) {
    const now = Date.now();
    const cached = availabilityCache.get(providerId);
    if (cached && now - cached.timestamp < AVAILABILITY_CACHE_TTL) {
        return cached;
    }
    const enabled = getRegistryProvider(providerId)?.enabled !== false;
    const hasCredentials = !!getProviderApiKey(providerId);
    const result = { enabled, hasCredentials, timestamp: now };
    availabilityCache.set(providerId, result);
    return result;
}
function isProviderEnabled(providerId) {
    return getAvailability(providerId).enabled;
}
function hasProviderCredentials(providerId) {
    return getAvailability(providerId).hasCredentials;
}
function getProviderAdapter(providerId) {
    const cached = providerCache.get(providerId);
    if (cached) {
        return cached;
    }
    const adapter = new RegistryAIProviderAdapter(providerId);
    const provider = adapter;
    providerCache.set(providerId, provider);
    return provider;
}
let cachedEnabledProviders = null;
let cachedAllProviders = null;
let cachedEnabledProviderIds = null;
function getCachedCompatibleProviders(enabledOnly = false) {
    if (enabledOnly) {
        if (!cachedEnabledProviders) {
            cachedEnabledProviders = getAgentCompatibleProviders({ enabledOnly: true });
        }
        return cachedEnabledProviders;
    }
    if (!cachedAllProviders) {
        cachedAllProviders = getAgentCompatibleProviders({ enabledOnly: false });
    }
    return cachedAllProviders;
}
function getCompatibleEnabledProviderIds() {
    if (!cachedEnabledProviderIds) {
        cachedEnabledProviderIds = getCachedCompatibleProviders(true).map((provider) => provider.id);
    }
    return cachedEnabledProviderIds;
}
export function clearCompatibleEnabledProviderIdsCache() {
    cachedEnabledProviders = null;
    cachedAllProviders = null;
    cachedEnabledProviderIds = null;
}
function sanitizeTaskName(task) {
    return String(task).replace(/[^a-zA-Z0-9_]/g, '_');
}
function getConfiguredProviderId(task) {
    const providerKey = getSetting(`ai_task_${task}_provider`);
    if (!providerKey)
        return null;
    if (!isCompatibleProviderId(providerKey)) {
        console.warn(`[AIRouter] Task "${sanitizeTaskName(task)}" selected unsupported provider "${providerKey}", falling back to compatible providers`);
        return null;
    }
    if (!isProviderEnabled(providerKey)) {
        console.warn(`[AIRouter] Task "${sanitizeTaskName(task)}" selected disabled provider "${providerKey}", falling back`);
        return null;
    }
    return providerKey;
}
const providerOrderCache = new Map();
const ORDER_CACHE_TTL = 10000; // 10 seconds
function getProviderOrder(preferredProviderId) {
    const cacheKey = String(preferredProviderId);
    const now = Date.now();
    const cached = providerOrderCache.get(cacheKey);
    if (cached && now - cached.timestamp < ORDER_CACHE_TTL) {
        return cached.order;
    }
    const allowOpenaiAutoFallback = getAgentAllowOpenaiAutoFallback();
    const registryFallback = getFallbackOrder('llm').filter(isCompatibleProviderId);
    const enabledProviders = getCompatibleEnabledProviderIds();
    const isProviderAllowed = (providerId) => {
        if (!isProviderEnabled(providerId))
            return false;
        if (providerId !== 'openai')
            return true;
        if (preferredProviderId === 'openai')
            return true;
        return allowOpenaiAutoFallback;
    };
    const order = dedupeStrings([
        preferredProviderId,
        ...registryFallback,
        ...enabledProviders,
    ]).filter(isProviderAllowed);
    providerOrderCache.set(cacheKey, { order, timestamp: now });
    return order;
}
function findDefaultProviderId(enabledOnly = true) {
    return getCompatibleEnabledProviderIds()[0] || getAgentCompatibleProviders({ enabledOnly })[0]?.id;
}
export function getProviderForTask(task) {
    const providerId = getProviderOrder(getConfiguredProviderId(task))[0]
        || findDefaultProviderId();
    if (!providerId) {
        throw new Error('No compatible AI providers are registered');
    }
    return getProvider(providerId);
}
export function getProvider(id) {
    const providerId = isCompatibleProviderId(id) ? id : findDefaultProviderId();
    if (!providerId) {
        throw new Error('No compatible AI providers are registered');
    }
    return getProviderAdapter(providerId);
}
export async function aiChat(task, messages, options) {
    const preferredProviderId = getConfiguredProviderId(task);
    const modelSetting = getSetting(`ai_task_${task}_model`);
    const providerOrder = getProviderOrder(preferredProviderId);
    if (!providerOrder || providerOrder.length === 0) {
        return { text: 'The AI provider is temporarily unavailable right now. Please try again shortly.', usage: undefined };
    }
    for (const providerId of providerOrder) {
        if (!hasProviderCredentials(providerId)) {
            if (providerId === preferredProviderId) {
                console.warn(`[AIRouter] Preferred provider "${providerId}" has no configured key, trying fallback`);
            }
            continue;
        }
        const provider = getProvider(providerId);
        const chatOptions = {
            ...options,
            model: providerId === preferredProviderId ? options?.model || modelSetting || undefined : undefined,
        };
        const startMs = Date.now();
        try {
            if (providerId !== preferredProviderId && preferredProviderId) {
                console.warn(`[AIRouter] Failover: trying ${providerId} for task "${task}"`);
            }
            const result = await provider.chat(messages, chatOptions);
            const chatResult = result;
            trackUsage({
                provider: provider.id,
                model: chatOptions.model || (providerId === preferredProviderId ? 'default' : 'fallback'),
                task,
                platform: 'api',
                promptTokens: chatResult.usage?.promptTokens || 0,
                completionTokens: chatResult.usage?.completionTokens || 0,
                totalTokens: chatResult.usage?.totalTokens || 0,
                durationMs: Date.now() - startMs,
                success: true,
            });
            return chatResult;
        }
        catch (err) {
            const errorMessage = escapeHtml(String(err.message || 'Unknown error'));
            trackUsage({
                provider: provider.id,
                model: chatOptions.model || (providerId === preferredProviderId ? 'default' : 'fallback'),
                task,
                platform: 'api',
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                durationMs: Date.now() - startMs,
                success: false,
                errorMessage: errorMessage,
            });
            console.error(`[AIRouter] Provider ${providerId} failed for task "${task}": ${errorMessage}`);
        }
    }
    return { text: 'The AI provider is temporarily unavailable right now. Please try again shortly.', usage: undefined };
}
function trackChatUsage(provider, chatOptions, task, startMs, success, result, errorMessage) {
    trackUsage({
        provider: provider.id,
        model: chatOptions.model || (provider.id === getConfiguredProviderId(task) ? 'default' : 'fallback'),
        task,
        platform: 'api',
        promptTokens: result?.usage?.promptTokens || 0,
        completionTokens: result?.usage?.completionTokens || 0,
        totalTokens: result?.usage?.totalTokens || 0,
        durationMs: Date.now() - startMs,
        success: success,
        errorMessage: errorMessage,
    });
}
const providerTestResultsCache = new Map();
const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
export async function testAllProviders() {
    const results = {};
    for (const providerDef of getAgentCompatibleProviders()) {
        const cachedResult = providerTestResultsCache.get(providerDef.id);
        if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_EXPIRY_MS) {
            results[providerDef.id] = cachedResult.result;
            continue;
        }
        if (!isProviderEnabled(providerDef.id) || !hasProviderCredentials(providerDef.id)) {
            results[providerDef.id] = false;
            providerTestResultsCache.set(providerDef.id, { result: false, timestamp: Date.now() });
            continue;
        }
        let result = false;
        try {
            const provider = getProviderAdapter(providerDef.id);
            result = await provider.testConnection();
        }
        catch {
            result = false;
        }
        results[providerDef.id] = result;
        providerTestResultsCache.set(providerDef.id, { result, timestamp: Date.now() });
    }
    return results;
}
export const providers = new Proxy(Object.create(null), {
    get(_target, prop) {
        if (typeof prop !== 'string' || prop in Object.prototype) {
            return undefined;
        }
        if (!getAgentCompatibleProvider(prop)) {
            return undefined;
        }
        return getProvider(prop);
    },
    ownKeys() {
        return getAgentCompatibleProviders().filter(p => isProviderEnabled(p.id)).map(p => p.id);
    },
    getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === 'string' && !(prop in Object.prototype) && getAgentCompatibleProvider(prop)) {
            return { enumerable: true, configurable: true };
        }
        return undefined;
    },
});
//# sourceMappingURL=aiRouter.js.map