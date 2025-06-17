import { Level } from 'level';
import type { BatchOperation } from 'level';
import type { BlockHeight, ServerState, ServerTx, BlockData } from '../types/state.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import { decode, encode } from '../utils/encoding.js';
import { Mutex } from '../utils/mutex.js';
import type { Storage } from './interface.js';
import { RLP } from '@ethereumjs/rlp';
import type { Decoded } from '@ethereumjs/rlp';

export class LevelDBStorage implements Storage {
  private db: Level<string, Buffer>;
  private walDb: Level<string, Buffer>;
  private blockDb: Level<string, Buffer>;
  private snapshotDb: Level<string, Buffer>;
  private mutex = new Mutex();

  constructor(basePath: string) {
    const options = { valueEncoding: 'buffer', keyEncoding: 'utf8' };
    this.db = new Level(`${basePath}/main`, options);
    this.walDb = new Level(`${basePath}/wal`, options);
    this.blockDb = new Level(`${basePath}/blocks`, options);
    this.snapshotDb = new Level(`${basePath}/snapshots`, options);
  }

  private formatHeight = (h: BlockHeight) => Number(h).toString().padStart(10, '0');

  readonly wal = {
    append: async (h: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const key = `wal:${this.formatHeight(h)}`;
        const value = RLP.encode(txs.map(encode.serverTx));
        await this.walDb.put(key, Buffer.from(value));
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
        for await (const value of this.walDb.values({ gte: startKey })) {
          const decodedTxs = RLP.decode(value) as unknown as Decoded[];
          result.push(...decodedTxs.map(tx => decode.serverTx(tx as unknown as Decoded[])));
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
        let latestKey: string | null = null;
        let latestValue: Buffer | null = null;
        
        for await (const [key, value] of this.snapshotDb.iterator({ reverse: true, limit: 1 })) {
          latestKey = key;
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