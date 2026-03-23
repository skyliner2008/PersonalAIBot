/**
 * Unified API Key Manager
 * Uses better-sqlite3 via db.ts helpers + AES-256-GCM encryption
 */

import { createLogger } from '../utils/logger.js';
import { getProvider, getRegistry, ProviderDefinition } from './registry.js';
import { dbAll, dbGet, dbRun, setCredential, getCredential } from '../database/db.js';

const log = createLogger('KeyManager');

/**
 * Helper to consistently format errors for logging
 */
const serializeError = (error: any): string =>
  error instanceof Error ? error.message : String(error);

export class KeyManager {
  private static envKeyCache: Map<string, string> = new Map();

  /**
   * Import API keys from .env into database (idempotent)
   */
  static async importEnvKeys(): Promise<void> {
    try {
      // Ensure unique constraint exists to prevent race conditions during concurrent imports
      await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_provider_type ON api_keys (provider_id, key_type)');

      const registry = getRegistry();
      let imported = 0;

      for (const provider of Object.values(registry.providers)) {
        if (!provider.apiKeyEnvVar) continue;
        const envValue = process.env[provider.apiKeyEnvVar];
        if (!envValue) continue;

        // 1. Fast path: skip if key already exists and is valid
        if (this.getKeyFromDb(provider.id)) continue;

        // 2. Atomic lock: Use INSERT OR IGNORE to handle race conditions.
        // Only one instance will successfully insert the placeholder row.
        const result = dbRun(
          `INSERT OR IGNORE INTO api_keys (provider_id, key_type, encrypted_value, source, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [provider.id, 'api_key', `ref:provider_key_${provider.id}`, 'env']
        ) as any;

        // 3. If we inserted the row, proceed to set the actual credential
        if (result && result.changes > 0) {
          await this.setKeyInDb(provider.id, envValue, 'env');
          imported++;
        }
      }

      if (imported > 0) {
        log.info('✓ Imported env keys to DB', { count: imported });
      }
    } catch (error) {
      log.error('Failed to import env keys', { error: serializeError(error) });
    }
  }

  /**
   * Get API key for a provider (DB → .env fallback)
   */
  static async getKey(providerId: string): Promise<string | null> {
    try {
      const provider = getProvider(providerId);
      if (!provider) return null;

      // 1. Try encrypted DB first
      const dbKey = this.getKeyFromDb(providerId);
      if (dbKey) return dbKey;

      // No .env fallback - force Database ONLY as single source of truth
      return null;
    } catch (error) {
      log.error('Failed to get key', { providerId, error: serializeError(error) });
      return null;
    }
  }

  /**
   * Set/update API key (encrypted via AES-256-GCM)
   */
  static async setKey(
    providerId: string,
    value: string,
    source: 'dashboard' | 'env' = 'dashboard'
  ): Promise<boolean> {
    try {
      if (!value || value.trim().length === 0) return false;
      const provider = getProvider(providerId);
      if (!provider) return false;

      await this.setKeyInDb(providerId, value, source);
      log.info('✓ Key saved (encrypted)', { providerId, source });
      return true;
    } catch (error) {
      log.error('Failed to set key', { providerId, error: serializeError(error) });
      return false;
    }
  }

  /**
   * Delete API key from database
   */
  static async deleteKey(providerId: string): Promise<boolean> {
    try {
      await dbRun('DELETE FROM api_keys WHERE provider_id = ?', [providerId]);
      // Also remove from credential store - use SQL concatenation to prevent injection
      dbRun("DELETE FROM settings WHERE key = 'provider_key_' || ?", [providerId]);
      log.info('✓ Key deleted', { providerId });
      return true;
    } catch (error) {
      log.error('Failed to delete key', { providerId, error: serializeError(error) });
      return false;
    }
  }

  /**
   * List configured providers (those with keys in DB or .env)
   */
  static async listConfigured(): Promise<string[]> {
    try {
      // Query optimized to filter directly for providers with corresponding entries in settings table
      const rows = await dbAll<{ provider_id: string }>(
        "SELECT DISTINCT provider_id FROM api_keys WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'provider_key_' || provider_id)"
      );
      return rows.map(r => r.provider_id);
    } catch (error) {
      log.error('Failed to list', { error: serializeError(error) });
      return [];
    }
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private static getKeyFromDb(providerId: string): string | null {
    const credKey = `provider_key_${providerId}`;
    try {
      return getCredential(credKey) || null;
    } catch (error) {
      // Log decryption or database errors specifically
      log.error('Error retrieving key from DB', { 
        providerId, 
        error: serializeError(error)
      });
      return null;
    }
  }

  private static async setKeyInDb(providerId: string, value: string, source: string): Promise<void> {
    const credKey = `provider_key_${providerId}`;

    try {
      await dbRun('BEGIN TRANSACTION');

      // 1. Store encrypted via AES-256-GCM credential store
      await setCredential(credKey, value);

      // 2. Also store reference in api_keys table (encrypted value stored separately)
      await dbRun(
        `INSERT OR REPLACE INTO api_keys (provider_id, key_type, encrypted_value, source, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [providerId, 'api_key', `ref:${credKey}`, source]
      );

      await dbRun('COMMIT');
    } catch (error) {
      await dbRun('ROLLBACK');
      throw error;
    }
  }
}

export default KeyManager;
