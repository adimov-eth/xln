// ============================================================================
// storage/memory.ts - In-memory storage implementation
// ============================================================================

import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';
import { Mutex } from '../utils/mutex.js';
import { deserializeWithBigInt, serializeWithBigInt } from '../utils/serialization.js';
import type { Storage } from './interface.js';

export class MemoryStorage implements Storage {
  private walEntries = new Map<string, ServerTx[]>();
  private blockStore = new Map<BlockHeight, BlockData>();
  private latestSnapshot: any = null;
  private mutex = new Mutex();
  
  readonly wal = {
    append: async (h: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const key = `wal:${Number(h).toString().padStart(10, '0')}`;
        const existing = this.walEntries.get(key) || [];
        this.walEntries.set(key, [...existing, ...txs]);
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL append failed: ${e}`);
      } finally {
        release();
      }
    },
    
    readFromHeight: async (h: BlockHeight): Promise<Result<readonly ServerTx[]>> => {
      try {
        const result: ServerTx[] = [];
        const startKey = `wal:${Number(h).toString().padStart(10, '0')}`;
        const sortedKeys = Array.from(this.walEntries.keys()).sort();
        
        for (const key of sortedKeys) {
          if (key >= startKey) {
            result.push(...(this.walEntries.get(key) ?? []));
          }
        }
        return Ok(result);
      } catch (e) {
        return Err(`WAL read failed: ${e}`);
      }
    },
    
    truncateBefore: async (h: BlockHeight): Promise<Result<void>> => {
      try {
        const endKey = `wal:${Number(h).toString().padStart(10, '0')}`;
        for (const key of this.walEntries.keys()) {
          if (key < endKey) {
            this.walEntries.delete(key);
          }
        }
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL truncate failed: ${e}`);
      }
    }
  };
  
  readonly blocks = {
    save: async (h: BlockHeight, block: BlockData): Promise<Result<void>> => {
      this.blockStore.set(h, block);
      return Ok(undefined);
    },
    get: async (h: BlockHeight): Promise<Result<BlockData | null>> => Ok(this.blockStore.get(h) || null)
  };
  
  readonly snapshots = {
    save: async (state: ServerState): Promise<Result<void>> => {
      try {
        const serialized = serializeWithBigInt(state);
        this.latestSnapshot = deserializeWithBigInt(serialized); // Simulate DB roundtrip
        return Ok(undefined);
      } catch (e) {
        return Err(`Snapshot save failed: ${e}`);
      }
    },
    
    loadLatest: async (): Promise<Result<ServerState | null>> => {
      try {
        if (!this.latestSnapshot) return Ok(null);
        return Ok(deserializeWithBigInt(serializeWithBigInt(this.latestSnapshot)));
      } catch (e) {
        return Err(`Snapshot load failed: ${e}`);
      }
    }
  };
  
  clear(): void {
    this.walEntries.clear();
    this.blockStore.clear();
    this.latestSnapshot = null;
  }
}