// ============================================================================
// storage/memory.ts - In-memory storage implementation
// ============================================================================

import type { Decoded } from '@ethereumjs/rlp';
import { RLP } from '@ethereumjs/rlp';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';
import { decode, encode } from '../utils/encoding.js';
import { Mutex } from '../utils/mutex.js';
import type { Storage } from './interface.js';

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
  
  get blocks() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      save: async (h: BlockHeight, block: BlockData): Promise<Result<void>> => {
        const bufferToSave = block.encodedData ?? encode.blockData(block);
        self.blockStore.set(h, bufferToSave);
        return Ok(undefined);
      },
      get: async (h: BlockHeight): Promise<Result<BlockData | null>> => {
        const buffer = self.blockStore.get(h);
        return Ok(buffer ? decode.blockData(buffer) : null);
      },
      iterator: async function* (
        options?: { reverse?: boolean; limit?: number }
      ): AsyncIterableIterator<[string, any]> {
        const entries = Array.from(self.blockStore.entries())
          .map(([h, buffer]) => [`block:${self.formatHeight(h)}`, buffer] as [string, any])
          .sort((a, b) => (options?.reverse ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])));

        const limit = options?.limit ?? entries.length;
        for (let i = 0; i < Math.min(limit, entries.length); i++) {
          const entry = entries[i];
          if (entry) {
            yield entry;
          }
        }
      },
    };
  }
  
  get snapshots() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      save: async (state: ServerState): Promise<Result<void>> => {
        try {
          const encoded = encode.serverState(state);
          self.snapshotStore.set(state.height, encoded);
          return Ok(undefined);
        } catch (e) {
          return Err(`Snapshot save failed: ${e}`);
        }
      },
      
      loadLatest: async (): Promise<Result<ServerState | null>> => {
        try {
          if (self.snapshotStore.size === 0) return Ok(null);
          const latestHeight = Math.max(...Array.from(self.snapshotStore.keys()).map(Number));
          const encoded = self.snapshotStore.get(latestHeight as BlockHeight);
          return Ok(encoded ? decode.serverState(encoded) : null);
        } catch (e) {
          return Err(`Snapshot load failed: ${e}`);
        }
      }
    };
  }
  
  clear(): void {
    this.walEntries.clear();
    this.blockStore.clear();
    this.snapshotStore.clear();
  }
}