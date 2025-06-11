import { Level } from 'level';
import * as RLP from 'rlp';
import type { Storage } from './storageInterface.ts';
import type { Result } from './types/result.ts';
import { err, ok } from './types/result.ts';
import type { Message } from './types/server.ts';
import { isDirectMsg } from './types/server.ts';
import { bigJsonEncoding, jsonReplacer } from './utils.ts';

export class LevelDBStorage implements Storage {
  private stateDB = new Level<string, any>('./state', { valueEncoding: bigJsonEncoding });
  private walDB = new Level<string, any>('./wal', { valueEncoding: bigJsonEncoding });
  private blockDB = new Level<string, Uint8Array>('./blocks', { valueEncoding: 'binary' });

  async init(): Promise<Result<void, Error>> {
    try {
      await Promise.all([this.stateDB.open(), this.walDB.open(), this.blockDB.open()]);
      return ok(undefined);
    } catch (e) {
      return err(e as Error);
    }
  }

  async close(): Promise<Result<void, Error>> {
    try {
      await Promise.all([this.stateDB.close(), this.walDB.close(), this.blockDB.close()]);
      return ok(undefined);
    } catch (e) {
      return err(e as Error);
    }
  }

  async saveState(key: string, state: any): Promise<Result<void, Error>> {
    try {
      await this.stateDB.put(key, state);
      return ok(undefined);
    } catch (e) {
      return err(e as Error);
    }
  }

  async loadState(key: string): Promise<Result<any, Error>> {
    try {
      const state = await this.stateDB.get(key);
      return ok(state);
    } catch (e) {
      return err(e as Error);
    }
  }

  async saveBlock(height: number, data: readonly Message[]): Promise<Result<void, Error>> {
    try {
      const encoded = RLP.encode([
        height,
        Date.now(),
        data.filter(isDirectMsg).map((m) => [m.signer, m.entityId, JSON.stringify(m.input, jsonReplacer)]),
      ]);
      await this.blockDB.put(height.toString(), encoded);
      return ok(undefined);
    } catch (e) {
      return err(e as Error);
    }
  }

  async loadBlocks(from: number, to: number): Promise<Result<readonly Message[], Error>> {
    try {
      const messages: Message[] = [];
      for (let h = from; h <= to; h++) {
        try {
          const data = await this.blockDB.get(h.toString());
          const decoded = RLP.decode(data) as unknown as [number, number, [number, string, string][]];
          const [, , txs] = decoded;
          
          for (const [signer, entityId, inputJson] of txs) {
            messages.push({
              scope: 'direct',
              signer,
              entityId,
              input: JSON.parse(inputJson),
            });
          }
        } catch {
          // Block not found, continue
        }
      }
      return ok(messages);
    } catch (e) {
      return err(e as Error);
    }
  }

  async appendWAL(height: number, msgs: readonly Message[]): Promise<Result<void, Error>> {
    try {
      const batch = this.walDB.batch();
      msgs.filter(isDirectMsg).forEach((msg, i) => {
        const key = `${height}:${msg.signer}:${msg.entityId}`;
        batch.put(key, msg);
      });
      await batch.write();
      return ok(undefined);
    } catch (e) {
      return err(e as Error);
    }
  }

  async pruneWAL(uptoHeight: number): Promise<Result<void, Error>> {
    try {
      const batch = this.walDB.batch();
      for await (const [rawKey] of this.walDB.iterator()) {
        if (typeof rawKey !== 'string') continue;
        const [hStr] = rawKey.split(':');
        if (!hStr) continue;
        const h = parseInt(hStr, 10);
        if (h < uptoHeight) batch.del(rawKey);
      }
      await batch.write();
      return ok(undefined);
    } catch (e) {
      return err(e as Error);
    }
  }
} 