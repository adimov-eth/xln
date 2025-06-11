import { LevelDBStorage } from './leveldbStorage.ts';
import type { Storage } from './storageInterface.ts';
import type { Result } from './types/result.ts';
import type { Message } from './types/server.ts';

export class DatabaseManager {
  constructor(private storage: Storage = new LevelDBStorage()) {}

  async init(): Promise<void> {
    const res = await this.storage.init();
    if (!res.ok) throw res.error;
  }

  async close(): Promise<void> {
    const res = await this.storage.close();
    if (!res.ok) throw res.error;
  }

  async appendWALBatch(height: number, txs: readonly Message[]): Promise<Result<void, Error>> {
    return this.storage.appendWAL(height, txs);
  }

  async pruneWAL(uptoHeight: number): Promise<Result<void, Error>> {
    return this.storage.pruneWAL(uptoHeight);
  }

  async storeBlock(height: number, msgs: readonly Message[]): Promise<Result<void, Error>> {
    return this.storage.saveBlock(height, msgs);
  }
} 