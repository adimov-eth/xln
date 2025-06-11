import type { Result } from './types/result.ts';
import type { Message } from './types/server.ts';

export interface Storage {
  saveState(key: string, state: any): Promise<Result<void, Error>>;
  loadState(key: string): Promise<Result<any, Error>>;
  saveBlock(height: number, data: readonly Message[]): Promise<Result<void, Error>>;
  loadBlocks(from: number, to: number): Promise<Result<readonly Message[], Error>>;
  appendWAL(height: number, msgs: readonly Message[]): Promise<Result<void, Error>>;
  pruneWAL(uptoHeight: number): Promise<Result<void, Error>>;
  init(): Promise<Result<void, Error>>;
  close(): Promise<Result<void, Error>>;
}

// Memory storage for testing
export class MemoryStorage implements Storage {
  private states = new Map<string, any>();
  private blocks = new Map<number, readonly Message[]>();
  private wal = new Map<string, Message>();

  async init(): Promise<Result<void, Error>> {
    return { ok: true, value: undefined };
  }

  async close(): Promise<Result<void, Error>> {
    return { ok: true, value: undefined };
  }

  async saveState(key: string, state: any): Promise<Result<void, Error>> {
    this.states.set(key, structuredClone(state));
    return { ok: true, value: undefined };
  }

  async loadState(key: string): Promise<Result<any, Error>> {
    const state = this.states.get(key);
    return state ? { ok: true, value: structuredClone(state) } : { ok: false, error: new Error('Not found') };
  }

  async saveBlock(height: number, data: readonly Message[]): Promise<Result<void, Error>> {
    this.blocks.set(height, [...data]);
    return { ok: true, value: undefined };
  }

  async loadBlocks(from: number, to: number): Promise<Result<readonly Message[], Error>> {
    const result: Message[] = [];
    for (let h = from; h <= to; h++) {
      const block = this.blocks.get(h);
      if (block) result.push(...block);
    }
    return { ok: true, value: result };
  }

  async appendWAL(height: number, msgs: readonly Message[]): Promise<Result<void, Error>> {
    msgs.forEach((msg, i) => {
      this.wal.set(`${height}:${i}`, msg);
    });
    return { ok: true, value: undefined };
  }

  async pruneWAL(uptoHeight: number): Promise<Result<void, Error>> {
    for (const [key] of this.wal) {
      const [hStr] = key.split(':');
      if (!hStr) continue;
      if (parseInt(hStr, 10) < uptoHeight) {
        this.wal.delete(key);
      }
    }
    return { ok: true, value: undefined };
  }
} 