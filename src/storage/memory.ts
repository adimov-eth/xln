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
  private mutex = new Mutex(); // Prevent concurrent access
  
  readonly wal = {
    append: async (h: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const key = `wal:${Number(h).toString().padStart(10, '0')}`;
        // Append to existing array instead of overwriting
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
        const prefix = 'wal:';
        const startKey = `${prefix}${Number(h).toString().padStart(10, '0')}`;
        
        // Sort keys to ensure deterministic ordering
        const sortedKeys = Array.from(this.walEntries.keys()).sort();
        
        for (const key of sortedKeys) {
          if (key >= startKey) {
            const txs = this.walEntries.get(key);
            if (txs) {
              result.push(...txs);
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
        const prefix = 'wal:';
        const endKey = `${prefix}${Number(h).toString().padStart(10, '0')}`;
        
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
      try {
        this.blockStore.set(h, block);
        return Ok(undefined);
      } catch (e) {
        return Err(`Block save failed: ${e}`);
      }
    },
    
    get: async (h: BlockHeight): Promise<Result<BlockData | null>> => {
      try {
        return Ok(this.blockStore.get(h) || null);
      } catch (e) {
        return Err(`Block get failed: ${e}`);
      }
    }
  };
  
  readonly snapshots = {
    save: async (state: ServerState): Promise<Result<void>> => {
      try {
        // Serialize to JSON string with BigInt support
        const serialized = serializeWithBigInt({
          height: state.height,
          entities: Array.from(state.entities.entries()).map(([k, v]) => [
            k, 
            {
              ...v,
              mempool: [...v.mempool],
              proposal: v.proposal ? {
                ...v.proposal,
                txs: [...v.proposal.txs],
                approvals: Array.from(v.proposal.approvals)
              } : undefined
            }
          ]),
          registry: Array.from(state.registry.entries()).map(([k, v]) => [
            k, 
            { ...v, quorum: [...v.quorum] }
          ]),
          mempool: [...state.mempool]
        });
        
        // Store as string (simulating database storage)
        this.latestSnapshot = deserializeWithBigInt(serialized);
        return Ok(undefined);
      } catch (e) {
        return Err(`Snapshot save failed: ${e}`);
      }
    },
    
    loadLatest: async (): Promise<Result<ServerState | null>> => {
      try {
        if (!this.latestSnapshot) return Ok(null);
        
        // Reconstruct proper types from deserialized data
        const state: ServerState = {
          height: this.latestSnapshot.height,
          entities: new Map(
            this.latestSnapshot.entities.map(([k, v]: [string, any]) => [
              k,
              {
                ...v,
                mempool: [...v.mempool],
                proposal: v.proposal ? {
                  ...v.proposal,
                  txs: [...v.proposal.txs],
                  approvals: new Set(v.proposal.approvals)
                } : undefined
              }
            ])
          ),
          registry: new Map(
            this.latestSnapshot.registry.map(([k, v]: [string, any]) => [
              k,
              { ...v, quorum: [...v.quorum] }
            ])
          ),
          mempool: [...this.latestSnapshot.mempool]
        };
        
        return Ok(state);
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
  
  // Debug helpers
  getWalSize(): number {
    return this.walEntries.size;
  }
  
  getBlockCount(): number {
    return this.blockStore.size;
  }
} 