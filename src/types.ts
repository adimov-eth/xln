// types.ts
import { Buffer } from 'buffer';

// Basic types
export type Hash = Buffer;
export type Address = Buffer;
export type Timestamp = number;

// Server types
export interface ServerState {
  height: number;
  signers: Map<number, Map<string, EntityState>>;
  mempool: ServerTx[];
}

export interface ServerTx {
  signerIndex: number;
  entityId: string;
  input: EntityInput;
}

export interface ServerBlock {
  height: number;
  timestamp: Timestamp;
  inputs: ServerTx[];
  stateRoot: Hash;
}

// Entity types
export interface EntityState {
  height: number;
  nonce: number;
  data: any;  // Business-specific state
  mempool: EntityTx[];
  status: 'idle' | 'pending';
}

export type EntityInput =
  | { kind: 'import'; state: EntityState; height: number }
  | { kind: 'add_tx'; tx: EntityTx }
  | { kind: 'propose_block' }
  | { kind: 'commit_block'; height: number };

export interface EntityTx {
  nonce: number;
  op: string;
  data: any;
}

export interface EntityBlock {
  height: number;
  txs: EntityTx[];
  prevHash: Hash;
  stateRoot: Hash;
}

// Outbox for cross-entity communication
export interface OutboxMessage {
  fromEntity: string;
  toEntity: string;
  toSigner: number;
  payload: EntityInput;
}

// Storage keys
export const KEYS = {
  serverRoot: Buffer.from([0x00]),
  serverBlock: (height: number) => {
    const key = Buffer.allocUnsafe(5);
    key[0] = 0x01;
    key.writeUInt32BE(height, 1);
    return key;
  },
  entityState: (signerIndex: number, entityId: string) => {
    const key = Buffer.allocUnsafe(33);
    key[0] = 0x02;
    key.writeUInt32BE(signerIndex, 1);
    Buffer.from(entityId, 'hex').copy(key, 5);
    return key;
  }
};