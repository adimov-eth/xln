import type { ServerState, ServerTx } from './core';
import type { BlockHeight } from './primitives';

// Storage interfaces
export interface StateStorage {
    save(state: ServerState): Promise<void>;
    load(): Promise<ServerState | null>;
  }
  
  export interface WalStorage {
    append(height: BlockHeight, txs: ServerTx[]): Promise<void>;
    getFromHeight(height: BlockHeight): Promise<ServerTx[]>;
    truncateBefore(height: BlockHeight): Promise<void>;
  }
  
  export interface BlockStorage {
    save(height: BlockHeight, data: any): Promise<void>;
    get(height: BlockHeight): Promise<any>;
  }
  
  export interface ArchiveStorage {
    save(hash: string, snapshot: any): Promise<void>;
    get(hash: string): Promise<any>;
  }
  

export interface KV {
  get(key: string): Promise<string | undefined>;
  put(key: string, val: string): Promise<void>;
  del(key: string): Promise<void>;
  batch(ops: { type: 'put' | 'del'; key: string; value?: string }[]): Promise<void>;
  iterator(options?: { gte?: string; lt?: string }): AsyncIterable<[string, string]>;
}

export interface Storage {
  state: StateStorage;
  wal: WalStorage;
  blocks: BlockStorage;
  archive: ArchiveStorage;
  refs: KV;
}