import { Level } from 'level';
import { Logger } from '../utils';
import {
  IStorageServiceConfig,
  StorageError,
  IStorageStats,
  IStorageOptions,
  IStorageMetadata,
} from '@xln/types';

export class StorageService {
  private db: Level;
  private logger: Logger;
  private readonly options: IStorageOptions;

  constructor(config?: IStorageServiceConfig) {
    this.logger = config?.logger || new Logger({ name: 'StorageService' });
    this.db = new Level(config?.dbPath || '');
    this.options = {
      prefix: '',
      ...config?.options,
    };
  }

  async open(): Promise<void> {
    await this.db.open();
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async put<T>(key: string, value: T, ttl?: number): Promise<void> {
    const storageValue = {
      data: value,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ttl,
        expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
      },
    };
    await this.db.put(key, JSON.stringify(storageValue));
  }

  async get<T>(key: string): Promise<{ data: T; metadata: IStorageMetadata } | null> {
    try {
      const value = await this.db.get(key);
      return JSON.parse(value);
    } catch (error) {
      if ((error as any).type === 'NotFoundError') {
        return null;
      }
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    await this.db.del(key);
  }

  async keys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const key of this.db.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }

  async batch<T>(operations: Array<{ type: 'put' | 'del'; key: string; value?: T }>): Promise<void> {
    const batch = this.db.batch();
    for (const op of operations) {
      if (op.type === 'put' && op.value !== undefined) {
        batch.put(op.key, JSON.stringify(op.value));
      } else if (op.type === 'del') {
        batch.del(op.key);
      }
    }
    await batch.write();
  }

  async stats(): Promise<IStorageStats> {
    const keys = await this.keys('');
    return {
      keys: keys.length,
      size: 0, // TODO: Implement actual size calculation
      encryptedKeys: 0,
      expiredKeys: 0,
      compressionRatio: 0,
    };
  }

  /**
   * Gets a prefixed key
   */
  public getPrefixedKey(key: string): string {
    return this.options.prefix ? `${this.options.prefix}:${key}` : key;
  }

  /**
   * Updates TTL for a key
   */
  async touch(key: string, ttl: number): Promise<void> {
    const value = await this.get(key);
    if (value) {
      await this.put(key, value, ttl);
    }
  }

  /**
   * Removes expired entries
   */
  async cleanup(): Promise<void> {
    const keys = await this.keys('');
    for (const key of keys) {
      const value = await this.get(key);
      if (value?.metadata?.expiresAt && value.metadata.expiresAt < Date.now()) {
        await this.del(key);
      }
    }
  }
}
