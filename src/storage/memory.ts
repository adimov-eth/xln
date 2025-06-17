// ============================================================================
// storage/memory.ts - In-memory storage implementation
// ============================================================================

import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';
import { Mutex } from '../utils/mutex.js';
import { decode, encode } from '../utils/encoding.js';
import type { Storage } from './interface.js';
import { RLP } from '@ethereumjs/rlp';
import type { Decoded } from '@ethereumjs/rlp';

export class MemoryStorage implements Storage {
  private walEntries = new Map<string, Buffer>();
  private blockStore = new Map<BlockHeight, Buffer>();
  private snapshotStore = new Map<BlockHeight, Buffer>();
  private mutex = new Mutex();
  
  private formatHeight = (h: BlockHeight) => Number(h).toString().padStart(10, '0');

  readonly wal = {
    append: async (h: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const key = `wal:${this.formatHeight(h)}`;
        const value = Buffer.from(RLP.encode(txs.map(encode.serverTx)));
        this.walEntries.set(key, value);
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
        const startKey = `wal:${this.formatHeight(h)}`;
        const sortedKeys = Array.from(this.walEntries.keys()).sort();
        
        for (const key of sortedKeys) {
          if (key >= startKey) {
            const value = this.walEntries.get(key);
            if (value) {
              const decodedTxs = RLP.decode(value) as unknown as Decoded[];
              result.push(...decodedTxs.map(tx => decode.serverTx(tx as unknown as Decoded[])));
            }
          }
        }
        return Ok(result);
      } catch (e) {
        return Err(`WAL read failed: ${e}`);
      }
    },
    
    truncateBefore: async (h: BlockHeight): Promise<Result<void>> => {
      try {
        const endKey = `wal:${this.formatHeight(h)}`;
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
      const bufferToSave = block.encodedData ?? encode.blockData(block);
      this.blockStore.set(h, bufferToSave);
      return Ok(undefined);
    },
    get: async (h: BlockHeight): Promise<Result<BlockData | null>> => {
      const buffer = this.blockStore.get(h);
      return Ok(buffer ? decode.blockData(buffer) : null);
    }
  };
  
  readonly snapshots = {
    save: async (state: ServerState): Promise<Result<void>> => {
      try {
        const encoded = encode.serverState(state);
        this.snapshotStore.set(state.height, encoded);
        return Ok(undefined);
      } catch (e) {
        return Err(`Snapshot save failed: ${e}`);
      }
    },
    
    loadLatest: async (): Promise<Result<ServerState | null>> => {
      try {
        if (this.snapshotStore.size === 0) return Ok(null);
        const latestHeight = Math.max(...Array.from(this.snapshotStore.keys()).map(Number));
        const encoded = this.snapshotStore.get(latestHeight as BlockHeight);
        return Ok(encoded ? decode.serverState(encoded) : null);
      } catch (e) {
        return Err(`Snapshot load failed: ${e}`);
      }
    }
  };
  
  clear(): void {
    this.walEntries.clear();
    this.blockStore.clear();
    this.snapshotStore.clear();
  }
}