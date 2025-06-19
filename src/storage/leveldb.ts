import type { Decoded } from '@ethereumjs/rlp';
import { RLP } from '@ethereumjs/rlp';
import type { BatchOperation } from 'level';
import { Level } from 'level';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';
import { decode, encode } from '../utils/encoding.js';
import { Mutex } from '../utils/mutex.js';
import type { Storage } from './interface.js';

export type LevelDBStorageOptions = {
  readonly validateWAL?: boolean; // Enable WAL validation (default: false in production, true in test)
};

export class LevelDBStorage implements Storage {
  private db: Level<string, Buffer>;
  private walDb: Level<string, Buffer>;
  private blockDb: Level<string, Buffer>;
  private snapshotDb: Level<string, Buffer>;
  private mutex = new Mutex();
  private validateWAL: boolean;

  constructor(basePath: string, options?: LevelDBStorageOptions) {
    const levelOptions = { valueEncoding: 'buffer', keyEncoding: 'utf8' };
    this.db = new Level(`${basePath}/main`, levelOptions);
    this.walDb = new Level(`${basePath}/wal`, levelOptions);
    this.blockDb = new Level(`${basePath}/blocks`, levelOptions);
    this.snapshotDb = new Level(`${basePath}/snapshots`, levelOptions);
    
    // Default to validation in test environment, off in production
    this.validateWAL = options?.validateWAL ?? (process.env.NODE_ENV === 'test');
  }
  
  async open(): Promise<void> {
    // Level auto-opens, but we can ensure they're ready
    await Promise.all([
      this.db.open(),
      this.walDb.open(),
      this.blockDb.open(),
      this.snapshotDb.open(),
    ].map(p => p.catch(() => {}))); // Ignore "already open" errors
  }

  private formatHeight = (h: BlockHeight) => Number(h).toString().padStart(10, '0');

  readonly wal = {
    append: async (h: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const key = `wal:${this.formatHeight(h)}`;
        const value = RLP.encode(txs.map(encode.serverTx));
        
        // Conditionally validate encoding based on configuration
        if (this.validateWAL) {
          try {
            const decoded = RLP.decode(value);
            if (!Array.isArray(decoded)) {
              return Err('WAL append failed: Invalid encoding - not an array');
            }
          } catch (e) {
            return Err(`WAL append failed: Invalid encoding - ${e}`);
          }
        }
        
        // make sure the handle is ready *before* the first put
        if (this.walDb.status !== 'open') {
          await this.walDb.open();
        }
        
        try {
          await this.walDb.put(key, Buffer.from(value));
        } catch (e: any) {
          // extremely defensive – one more attempt
          if (String(e).includes('Database is not open')) {
            await this.walDb.open();
            await this.walDb.put(key, Buffer.from(value));
          } else {
            throw e;
          }
        }
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
        let corruptedEntries = 0;
        
        for await (const [key, value] of this.walDb.iterator({ gte: startKey })) {
          try {
            const decodedTxs = RLP.decode(value) as unknown as Decoded[];
            result.push(...decodedTxs.map(tx => decode.serverTx(tx as unknown as Decoded[])));
          } catch (e) {
            // Log corrupted entry but continue processing
            corruptedEntries++;
            console.warn(`Skipping corrupted WAL entry ${key}: ${e}`);
          }
        }
        
        if (corruptedEntries > 0) {
          console.warn(`Recovered from WAL with ${corruptedEntries} corrupted entries skipped`);
        }
        
        return Ok(result);
      } catch (e) {
        return Err(`WAL read failed: ${e}`);
      }
    },

    truncateBefore: async (h: BlockHeight): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const endKey = `wal:${this.formatHeight(h)}`;
        const ops: BatchOperation<Level<string, Buffer>, string, Buffer>[] = [];
        for await (const key of this.walDb.keys({ lt: endKey })) {
          ops.push({ type: 'del', key });
        }
        if (ops.length > 0) {
          await this.walDb.batch(ops);
        }
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL truncate failed: ${e}`);
      } finally {
        release();
      }
    },
  };

  readonly blocks = {
    save: async (h: BlockHeight, block: BlockData): Promise<Result<void>> => {
      try {
        const key = `block:${this.formatHeight(h)}`;
        const bufferToSave = block.encodedData ?? encode.blockData(block);
        await this.blockDb.put(key, bufferToSave);
        return Ok(undefined);
      } catch (e) {
        return Err(`Block save failed: ${e}`);
      }
    },
    get: async (h: BlockHeight): Promise<Result<BlockData | null>> => {
      try {
        const key = `block:${this.formatHeight(h)}`;
        const value = await this.blockDb.get(key);
        return Ok(decode.blockData(value));
      } catch (e: any) {
        if (e.code === 'LEVEL_NOT_FOUND') return Ok(null);
        return Err(`Block get failed: ${e}`);
      }
    },
    iterator: async function* (this: LevelDBStorage, options?: { reverse?: boolean; limit?: number }): AsyncIterableIterator<[string, any]> {
      const levelIterator = this.blockDb.iterator(options || {});
      try {
        for await (const [key, value] of levelIterator) {
          yield [key, value] as [string, any];
        }
      } finally {
        await levelIterator.close();
      }
    }.bind(this),
  };

  readonly snapshots = {
    save: async (state: ServerState): Promise<Result<void>> => {
      try {
        const key = `snapshot:${this.formatHeight(state.height)}`;
        const value = encode.serverState(state);
        await this.snapshotDb.put(key, value);
        return Ok(undefined);
      } catch (e) {
        return Err(`Snapshot save failed: ${e}`);
      }
    },

    loadLatest: async (): Promise<Result<ServerState | null>> => {
      try {
        let latestValue: Buffer | null = null;
        
        for await (const [_key, value] of this.snapshotDb.iterator({ reverse: true, limit: 1 })) {
          latestValue = value;
          break;
        }
        
        if (!latestValue) return Ok(null);
        
        return Ok(decode.serverState(latestValue));
      } catch (e) {
        return Err(`Snapshot load failed: ${e}`);
      }
    },
  };

  async close(): Promise<void> {
    await Promise.all([
      this.db.close(),
      this.walDb.close(),
      this.blockDb.close(),
      this.snapshotDb.close(),
    ]);
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.db.clear(),
      this.walDb.clear(),
      this.blockDb.clear(),
      this.snapshotDb.clear(),
    ]);
  }
}