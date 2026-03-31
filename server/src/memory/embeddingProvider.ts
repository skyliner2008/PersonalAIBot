// ============================================================
// Embedding Provider - centralized embedding generation with caching and batching
// ============================================================
// Supports multiple backends (Gemini, OpenAI, OpenRouter, Local) with automatic failover,
// caching, batching, retry, and graceful degradation.

import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { createLogger } from '../utils/logger.js';
import OpenAI from 'openai';
import { pipeline } from '@huggingface/transformers';

const log = createLogger('EmbeddingProvider');

// ============================================================
// Constants & Types
// ============================================================

export interface EmbeddingProviderStats {
  providerType: string;
  cacheSize: number;
  maxCacheSize: number;
  queuedRequests: number;
  activeModel: string;
  dimensions: number;
}

export interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<(number[] | null)[]>;
  getStats(): EmbeddingProviderStats;
  clearCache(): void;
  getDimensions(): number;
  getProviderType(): string;
}

const CACHE_MAX_ENTRIES = 500;
const BATCH_SIZE = 10;
const BATCH_TIMEOUT_MS = 500;
const EMBED_RETRY_COUNT = 1;
const EMBED_RETRY_DELAY_MS = 1000;

// ============================================================
// LRU Cache Implementation
// ============================================================

class LRUCache {
  private cache: Map<string, { embedding: number[] }> = new Map();
  private maxSize: number;

  constructor(maxSize: number = CACHE_MAX_ENTRIES) {
    this.maxSize = maxSize;
  }

  get(key: string): number[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.embedding;
  }

  set(key: string, embedding: number[]): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, { embedding });
    if (this.cache.size > this.maxSize) {
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) this.cache.delete(lruKey);
    }
  }

  clear(): void { this.cache.clear(); }
  get size(): number { return this.cache.size; }
  get max(): number { return this.maxSize; }
}

// ============================================================
// Base Provider with Caching, Batching, and Retry
// ============================================================

abstract class BaseEmbeddingProvider implements IEmbeddingProvider {
  protected cache = new LRUCache();
  protected batchQueue: { text: string; resolve: (v: number[]) => void; reject: (e: Error) => void }[] = [];
  protected batchTimeout: NodeJS.Timeout | null = null;
  protected processing = false;
  protected detectedDimensions: number = 0; // Auto-detected from first successful embed

  async embed(text: string): Promise<number[]> {
    if (!text || !text.trim()) return [];
    const hash = crypto.createHash('md5').update(text).digest('hex');
    const cached = this.cache.get(hash);
    if (cached) return cached;

    return new Promise((resolve, reject) => {
      this.batchQueue.push({ text, resolve, reject });
      if (this.batchQueue.length >= BATCH_SIZE) this.processBatch();
      else if (!this.batchTimeout) this.batchTimeout = setTimeout(() => this.processBatch(), BATCH_TIMEOUT_MS);
    });
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    return Promise.all(texts.map(t => this.embed(t).catch(() => null)));
  }

  protected abstract processBatchInternal(texts: string[]): Promise<number[][]>;
  public abstract getStats(): EmbeddingProviderStats;
  public abstract getProviderType(): string;
  protected abstract getExpectedDimensions(): number;

  public getDimensions(): number {
    // Prefer auto-detected dimensions from actual API responses
    return this.detectedDimensions || this.getExpectedDimensions();
  }

  protected async processBatch(): Promise<void> {
    if (this.processing || this.batchQueue.length === 0) return;
    this.processing = true;
    if (this.batchTimeout) { clearTimeout(this.batchTimeout); this.batchTimeout = null; }

    const batch = this.batchQueue.splice(0, BATCH_SIZE);
    try {
      const texts = batch.map(b => b.text);
      const vectors = await this.processBatchWithRetry(texts);
      batch.forEach((req, i) => {
        const v = vectors[i] || [];
        // Auto-detect dimensions from first successful embed
        if (v.length > 0 && this.detectedDimensions === 0) {
          this.detectedDimensions = v.length;
          log.info(`Auto-detected embedding dimensions: ${this.detectedDimensions} (provider: ${this.getProviderType()})`);
        }
        const hash = crypto.createHash('md5').update(req.text).digest('hex');
        this.cache.set(hash, v);
        req.resolve(v);
      });
    } catch (err) {
      batch.forEach(req => req.reject(err as Error));
    } finally {
      this.processing = false;
      if (this.batchQueue.length > 0) setImmediate(() => this.processBatch());
    }
  }

  /**
   * Retry wrapper for batch processing
   */
  private async processBatchWithRetry(texts: string[]): Promise<number[][]> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= EMBED_RETRY_COUNT; attempt++) {
      try {
        return await this.processBatchInternal(texts);
      } catch (err) {
        lastError = err as Error;
        if (attempt < EMBED_RETRY_COUNT) {
          log.warn(`Embedding batch failed (attempt ${attempt + 1}/${EMBED_RETRY_COUNT + 1}), retrying in ${EMBED_RETRY_DELAY_MS}ms...`, {
            error: (err as Error).message,
            provider: this.getProviderType(),
          });
          await new Promise(r => setTimeout(r, EMBED_RETRY_DELAY_MS));
        }
      }
    }
    throw lastError;
  }

  clearCache(): void { this.cache.clear(); }
}

// ============================================================
// Gemini Provider Implementation
// ============================================================

export class GeminiEmbeddingProvider extends BaseEmbeddingProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-embedding-001') {
    super();
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    log.info(`Gemini Embedding Provider initialized with model: ${model}`);
  }

  protected async processBatchInternal(texts: string[]): Promise<number[][]> {
    const result = await this.ai.models.embedContent({
      model: this.model,
      contents: texts.map(text => ({ role: 'user', parts: [{ text }] })),
    });
    return result.embeddings?.map(e => e.values || []) || [];
  }

  getStats(): EmbeddingProviderStats {
    return {
      providerType: 'gemini',
      cacheSize: this.cache.size,
      maxCacheSize: this.cache.max,
      queuedRequests: this.batchQueue.length,
      activeModel: this.model,
      dimensions: this.getDimensions(),
    };
  }

  getProviderType(): string { return 'gemini'; }

  /**
   * Gemini embedding dimensions vary by model:
   * - gemini-embedding-001: 3072
   * - text-embedding-004: 768
   * Auto-detection overrides this when first vector is received.
   */
  protected getExpectedDimensions(): number {
    if (this.model.includes('embedding-001')) return 3072;
    if (this.model.includes('text-embedding-004')) return 768;
    return 3072; // Default for newer models
  }
}

// ============================================================
// OpenAI Provider Implementation (supports OpenAI and OpenRouter)
// ============================================================

export class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
  private openaiClient: OpenAI;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string = 'text-embedding-3-small', baseUrl: string = 'https://api.openai.com/v1') {
    super();
    this.openaiClient = new OpenAI({ apiKey, baseURL: baseUrl });
    this.model = model;
    this.baseUrl = baseUrl;
    const providerName = baseUrl.includes('openrouter') ? 'OpenRouter' : 'OpenAI';
    log.info(`${providerName} Embedding Provider initialized with model: ${model} at ${baseUrl}`);
  }

  protected async processBatchInternal(texts: string[]): Promise<number[][]> {
    const response = await this.openaiClient.embeddings.create({
      model: this.model,
      input: texts,
    });

    return response.data.map((d: any) => d.embedding);
  }

  getStats(): EmbeddingProviderStats {
    const providerName = this.baseUrl.includes('openrouter') ? 'openrouter' : 'openai';
    return {
      providerType: providerName,
      cacheSize: this.cache.size,
      maxCacheSize: this.cache.max,
      queuedRequests: this.batchQueue.length,
      activeModel: this.model,
      dimensions: this.getDimensions(),
    };
  }

  getProviderType(): string { return this.baseUrl.includes('openrouter') ? 'openrouter' : 'openai'; }

  /**
   * OpenAI embedding dimensions:
   * - text-embedding-3-small: 1536
   * - text-embedding-3-large: 3072
   * - text-embedding-ada-002: 1536
   * Auto-detection overrides this when first vector is received.
   */
  protected getExpectedDimensions(): number {
    if (this.model.includes('3-small') || this.model.includes('ada-002')) return 1536;
    if (this.model.includes('3-large')) return 3072;
    return 1536;
  }
}

// ============================================================
// Local Provider Implementation (Transformers.js ONNX)
// ============================================================

export class LocalEmbeddingProvider extends BaseEmbeddingProvider {
  private model: string;
  private extractorPromise: Promise<any>;

  constructor(model: string = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2') {
    super();
    this.model = model;
    
    log.info(`Local Embedding Provider initializing with model: ${model} (downloads ~118MB on first run)`);
    // Lazy load the model on first use, but start the promise here
    this.extractorPromise = pipeline('feature-extraction', this.model).catch(err => {
      log.error('Failed to load local embedding model', { error: String(err) });
      throw err;
    });
  }

  protected async processBatchInternal(texts: string[]): Promise<number[][]> {
    try {
      const extractor = await this.extractorPromise;
      
      // We'll feed it directly as our memory layer already prepares the text reasonably.
      const formattedTexts = texts.map(t => typeof t === 'string' ? t.trim() : '');
      
      // Process batch (transformers.js handles array inputs efficiently)
      const output = await extractor(formattedTexts, { pooling: 'mean', normalize: true });
      
      // output.data is a flat Float32Array. We need to chunk it.
      const embeddings: number[][] = [];
      const dims = this.getExpectedDimensions();
      const flatData = Array.from(output.data);
      
      for (let i = 0; i < texts.length; i++) {
        const start = i * dims;
        const end = start + dims;
        embeddings.push(flatData.slice(start, end) as number[]);
      }
      
      return embeddings;
    } catch (err) {
      log.error('Local bulk embedding failed', { error: String(err) });
      throw err;
    }
  }

  getStats(): EmbeddingProviderStats {
    return {
      providerType: 'local',
      cacheSize: this.cache.size,
      maxCacheSize: this.cache.max,
      queuedRequests: this.batchQueue.length,
      activeModel: this.model,
      dimensions: this.getDimensions(),
    };
  }

  getProviderType(): string { return 'local'; }

  /**
   * Xenova/paraphrase-multilingual-MiniLM-L12-v2 and bge-small both have 384 dimensions.
   */
  protected getExpectedDimensions(): number {
    return 384;
  }
}

// ============================================================
// Singleton & Lifecycle Management with Failover
// ============================================================

let defaultProvider: IEmbeddingProvider | null = null;
let fallbackProviders: IEmbeddingProvider[] = [];

/**
 * Initialize the embedding provider with a specific API key and type.
 * Can be called multiple times — later calls add fallback providers.
 */
export function initEmbeddingProvider(apiKey: string | undefined, type: 'gemini' | 'openai' | 'local' = 'gemini', model?: string, baseUrl?: string): void {
  if (type !== 'local' && !apiKey) {
    const effectiveKey = type === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
    if (!effectiveKey) {
      log.warn(`No API key provided or found in ENV for ${type} EmbeddingProvider initialization`);
      return;
    }
    apiKey = effectiveKey;
  }

  let provider: IEmbeddingProvider;
  if (type === 'gemini') {
    provider = new GeminiEmbeddingProvider(apiKey as string, model);
  } else if (type === 'openai') {
    provider = new OpenAIEmbeddingProvider(apiKey as string, model || 'text-embedding-3-small', baseUrl);
  } else {
    provider = new LocalEmbeddingProvider(model || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  }

  if (!defaultProvider) {
    defaultProvider = provider;
  } else {
    // Add as fallback provider
    // Prevent duplicate local providers
    if (type === 'local' && fallbackProviders.some(p => p.getProviderType() === 'local')) {
      return;
    }
    fallbackProviders.push(provider);
    log.info(`Added fallback embedding provider: ${type}`);
  }
}

export function isEmbeddingReady(): boolean { return defaultProvider !== null; }

/**
 * Embed a single text — with automatic failover to fallback providers.
 * Returns empty array if ALL providers fail (graceful degradation).
 */
export async function embedText(text: string): Promise<number[]> {
  if (!defaultProvider) return [];

  // Try default provider first
  try {
    const result = await defaultProvider.embed(text);
    if (result && result.length > 0) return result;
  } catch (e) {
    log.warn(`Primary embedding provider failed, trying fallbacks...`, { error: String(e), provider: defaultProvider.getProviderType() });
  }

  // Try fallback providers
  for (const fb of fallbackProviders) {
    try {
      const result = await fb.embed(text);
      if (result && result.length > 0) {
        log.info(`Fallback embedding provider succeeded: ${fb.getProviderType()}`);
        return result;
      }
    } catch (e) {
      log.warn(`Fallback embedding provider also failed`, { error: String(e), provider: fb.getProviderType() });
    }
  }

  // All providers failed — graceful degradation
  log.error('All embedding providers failed. Returning empty vector (semantic search will be degraded).');
  return [];
}

/**
 * Embed multiple texts — with automatic failover.
 */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  if (!defaultProvider) return texts.map(() => null);

  // Try default provider first
  try {
    const results = await defaultProvider.embedBatch(texts);
    const allNull = results.every(r => r === null || r?.length === 0);
    if (!allNull) return results;
  } catch (e) {
    log.warn('Primary batch embedding failed, trying fallbacks...', { error: String(e) });
  }

  // Try fallback providers
  for (const fb of fallbackProviders) {
    try {
      const results = await fb.embedBatch(texts);
      const allNull = results.every(r => r === null || r?.length === 0);
      if (!allNull) {
        log.info(`Fallback batch embedding succeeded: ${fb.getProviderType()}`);
        return results;
      }
    } catch (e) {
      log.warn(`Fallback batch embedding also failed`, { error: String(e), provider: fb.getProviderType() });
    }
  }

  log.error('All batch embedding providers failed. Returning nulls.');
  return texts.map(() => null);
}

export function getEmbeddingStats(): EmbeddingProviderStats {
  if (!defaultProvider) return { providerType: 'none', cacheSize: 0, maxCacheSize: 0, queuedRequests: 0, activeModel: 'none', dimensions: 0 };
  return defaultProvider.getStats();
}

/**
 * Get currently active embedding dimensions (auto-detected or expected).
 */
export function getEmbeddingDimensions(): number {
  if (!defaultProvider) return 0;
  return defaultProvider.getDimensions();
}

/**
 * Get provider info summary for diagnostics.
 */
export function getEmbeddingProviderInfo(): { primary: string; fallbacks: string[]; dimensions: number } {
  return {
    primary: defaultProvider?.getProviderType() || 'none',
    fallbacks: fallbackProviders.map(fb => fb.getProviderType()),
    dimensions: defaultProvider?.getDimensions() || 0,
  };
}
