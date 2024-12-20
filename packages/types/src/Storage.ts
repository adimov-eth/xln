import { z } from 'zod';

export interface IStorageMetadata {
  createdAt: number;
  updatedAt: number;
  ttl?: number;
  expiresAt?: number;
}

export interface IStorageOptions {
  prefix?: string;
  ttl?: number;
  encoding?: string;
  compression?: boolean;
  encryption?: {
    enabled: boolean;
    key: string;
    algorithm: string;
  };
}

export interface IStorageServiceConfig {
  dbPath?: string;
  logger?: any;
  options?: IStorageOptions;
}

export interface IStorageStats {
  keys: number;
  size: number;
  encryptedKeys: number;
  expiredKeys: number;
  compressionRatio: number;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export const StorageSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  value: z.unknown(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export type Storage = z.infer<typeof StorageSchema>;

export const StorageKeySchema = z.object({
  key: z.string()
});

export type StorageKey = z.infer<typeof StorageKeySchema>;
