// types.ts
import { Buffer } from 'buffer';

// Result types for error handling
export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// Basic types
export type Hash = Buffer;
export type Address = Buffer;
export type Timestamp = number;

// Mempool configuration
export interface MempoolConfig {
  maxSize: number;
  maxAge: number; // milliseconds
  maxTxsPerEntity: number;
  evictionBatchSize: number;
}

export interface MempoolEntry {
  tx: ServerTx;
  timestamp: number;
  entityId: string;
  signerIndex: number;
}

// Server types
export interface ServerState {
  height: number;
  signers: Map<number, Map<string, EntityState>>;
  mempool: Map<Hash, MempoolEntry>; // txHash -> entry
  config: MempoolConfig;
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
  status: 'idle' | 'pending' | 'awaiting_signatures';
  proposedBlock?: EntityBlock;
  consensusBlock?: EntityBlock;  // Last signed block
}

export type EntityInput =
  | { type: 'import'; state: EntityState; height: number }
  | { type: 'add_tx'; tx: EntityTx }
  | { type: 'propose_block'; quorum?: Array<[number, number]> }
  | { type: 'commit_block'; height: number }
  | { type: 'validate_block'; block: EntityBlock }
  | { 
      type: 'block_signature'; 
      height: number; 
      signature: Buffer; 
      signerIndex: number;
      quorum: Array<[number, number]>; 
    };

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
  proposer: number;
  signatures: Map<number, Buffer>;  // signerIndex -> signature
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
  },
  entityBlock: (entityId: string, height: number) => {
    const key = Buffer.allocUnsafe(37);
    key[0] = 0x03;
    Buffer.from(entityId, 'hex').copy(key, 1);
    key.writeUInt32BE(height, 33);
    return key;
  }
};