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

// Server types
export interface ServerState {
  height: number;
  signers: Map<number, Map<string, EntityState>>;
  entityIndex: Map<number, Set<string>>; // signerIndex -> entity IDs
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
  // Consensus configuration (replaces EntityRegistry)
  quorum: Array<[number, number]>;  // [signerIndex, weight]
  threshold: number;  // e.g., 0.67 for 67%
  proposer: number;  // Current proposer signer index
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
    }
  | { type: 'vote'; blockHeight: number; blockHash: string }
  | { type: 'inbox'; from: string; message: EntityMessage };

// Typed inter-entity messages
export type EntityMessage =
  | { type: 'credit_line_update'; recipient: string; newLimit: number; utilizationRate: number }
  | { type: 'invoice'; recipient: string; items: InvoiceItem[]; total: number; dueDate: string }
  | { type: 'payment'; from: string; to: string; amount: number; reference?: string }
  | { type: 'transfer_notification'; from: string; to: string; amount: number; memo?: string }
  | { type: 'channel_proposal'; proposer: string; terms: any } // For future channel layer
  | { type: 'channel_update'; channelId: string; update: any };

export interface InvoiceItem {
  name: string;
  quantity: number;
  price: number;
}

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
    const idBuf = Buffer.from(entityId, 'utf8');
    const key = Buffer.allocUnsafe(5 + idBuf.length);
    key[0] = 0x02;
    key.writeUInt32BE(signerIndex, 1);
    idBuf.copy(key, 5);
    return key;
  },
  entityBlock: (entityId: string, height: number) => {
    const idBuf = Buffer.from(entityId, 'utf8');
    const key = Buffer.allocUnsafe(1 + idBuf.length + 4);
    key[0] = 0x03;
    idBuf.copy(key, 1);
    key.writeUInt32BE(height, 1 + idBuf.length);
    return key;
  },
  entityIndex: (signerIndex: number) => {
    const key = Buffer.allocUnsafe(5);
    key[0] = 0x04;
    key.writeUInt32BE(signerIndex, 1);
    return key;
  }
};