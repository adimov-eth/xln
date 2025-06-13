import { ServerTx, BlockHeight, ServerState } from '../core/types/primitives';
import { KV } from './kvMemory';

// Storage interfaces using the KV abstraction

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

export interface Storage {
  state: StateStorage;
  wal: WalStorage;
  blocks: BlockStorage;
  archive: ArchiveStorage;
  refs: KV; // Direct KV for references
}

// Key helpers
const pad = (n: number | BlockHeight) => n.toString().padStart(10, '0');

export const keys = {
  state: (signer: number, entityId: string) => `state:${signer}:${entityId}`,
  registry: () => 'state:registry',
  meta: () => 'state:meta',
  wal: (height: BlockHeight, signer: number, entityId: string) => 
    `wal:${pad(height)}:${signer}:${entityId}`,
  walRegistry: (height: BlockHeight, id: string) => 
    `wal:reg:${pad(height)}:${id}`,
  block: (height: BlockHeight) => `block:${pad(height)}`,
  archive: (hash: string) => `archive:${hash}`,
};