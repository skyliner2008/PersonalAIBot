// ============================================================
// Embedding Provider - centralized embedding generation with caching and batching
// ============================================================
// Supports multiple backends (Gemini, OpenAI, etc.) with automatic failover and caching.

import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { createLogger } from '../utils/logger.js';
import OpenAI from 'openai';

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
}

export interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<(number[] | null)[]>;
  getStats(): EmbeddingProviderStats;
  clearCache(): void;
  getDimensions(): number;
}

const CACHE_MAX_ENTRIES = 500;
const BATCH_SIZE = 10;
const BATCH_TIMEOUT_MS = 500;

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
// Base Provider with Caching and Batching
// ============================================================

abstract class BaseEmbeddingProvider implements IEmbeddingProvider {
  protected cache = new LRUCache();
  protected batchQueue: { text: string; resolve: (v: number[]) => void; reject: (e: Error) => void }[] = [];
  protected batchTimeout: NodeJS.Timeout | null = null;
  protected processing = false;

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
  public abstract getDimensions(): number;

  protected async processBatch(): Promise<void> {
    if (this.processing || this.batchQueue.length === 0) return;
    this.processing = true;
    if (this.batchTimeout) { clearTimeout(this.batchTimeout); this.batchTimeout = null; }

    const batch = this.batchQueue.splice(0, BATCH_SIZE);
    try {
      const texts = batch.map(b => b.text);
      const vectors = await this.processBatchInternal(texts);
      batch.forEach((req, i) => {
        const v = vectors[i] || [];
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
    };
  }

  getDimensions(): number { return 768; }
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
    log.info(`OpenAI Embedding Provider initialized with model: ${model} at ${baseUrl}`);
  }

  protected async processBatchInternal(texts: string[]): Promise<number[][]> {
    const response = await this.openaiClient.embeddings.create({
      model: this.model,
      input: texts,
    });

    return response.data.map((d: any) => d.embedding);
  }

  getStats(): EmbeddingProviderStats {
    return {
      providerType: 'openai',
      cacheSize: this.cache.size,
      maxCacheSize: this.cache.max,
      queuedRequests: this.batchQueue.length,
      activeModel: this.model,
    };
  }

  getDimensions(): number {
    return this.model.includes('3-small') ? 1536 : (this.model.includes('3-large') ? 3072 : 1536);
  }
}

// ============================================================
// Singleton & Lifecycle Management
// ============================================================

let defaultProvider: IEmbeddingProvider | null = null;

export function initEmbeddingProvider(apiKey: string | undefined, type: 'gemini' | 'openai' = 'gemini', model?: string, baseUrl?: string): void {
  // Use provided apiKey OR fall back to env variables
  const effectiveKey = apiKey || (type === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);

  if (!effectiveKey) {
    log.warn(`No API key provided or found in ENV for ${type} EmbeddingProvider initialization`);
    return;
  }

  if (type === 'gemini') {
    defaultProvider = new GeminiEmbeddingProvider(effectiveKey, model);
  } else {
    defaultProvider = new OpenAIEmbeddingProvider(effectiveKey, model || 'text-embedding-3-small', baseUrl);
  }
}

export function isEmbeddingReady(): boolean { return defaultProvider !== null; }

export async function embedText(text: string): Promise<number[]> {
  if (!defaultProvider) return [];
  try { return await defaultProvider.embed(text); }
  catch (e) { log.error('Embedding failed:', String(e)); return []; }
}

export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  if (!defaultProvider) return texts.map(() => null);
  try { return await defaultProvider.embedBatch(texts); }
  catch (e) { log.error('Batch embedding failed:', String(e)); return texts.map(() => null); }
}

export function getEmbeddingStats(): EmbeddingProviderStats {
  if (!defaultProvider) return { providerType: 'none', cacheSize: 0, maxCacheSize: 0, queuedRequests: 0, activeModel: 'none' };
  return defaultProvider.getStats();
}
