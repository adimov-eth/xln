# Types

## Primitives

```typescript
// types/primitives.ts - Branded types and primitives
export type EntityId = string & { readonly _brand: 'EntityId' };
export type SignerIdx = number & { readonly _brand: 'SignerIdx' };
export type BlockHeight = number & { readonly _brand: 'BlockHeight' };
export type BlockHash = string & { readonly _brand: 'BlockHash' };
export type TxHash = string & { readonly _brand: 'TxHash' };

// Type guards and constructors
export const toEntityId = (s: string): EntityId => s as EntityId;
export const toSignerIdx = (n: number): SignerIdx => n as SignerIdx;
export const toBlockHeight = (n: number): BlockHeight => n as BlockHeight;
export const toBlockHash = (s: string): BlockHash => s as BlockHash;
export const toTxHash = (s: string): TxHash => s as TxHash;

// Result type for error handling
export type Result<T, E = Error> = 
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// Common status types
export type EntityStatus = 'idle' | 'proposed';
export type BlockStatus = 'pending' | 'committed';

// types/entity.ts - Entity-related types
import type { EntityId, SignerIdx, BlockHash, TxHash } from './primitives';

// Entity transaction - the actual business logic operations
export type EntityTx = {
  readonly op: string;      // Operation type: 'mint', 'transfer', etc.
  readonly data: unknown;   // Operation-specific payload
  readonly nonce?: number;  // Optional for ordering
};

// Commands that can be sent to an entity
export type EntityInput = 
  | { readonly type: 'add_tx'; readonly tx: EntityTx }
  | { readonly type: 'propose_block' }
  | { readonly type: 'commit_block'; readonly blockHash: BlockHash };

// Proposed block structure
export type ProposedBlock = {
  readonly txs: readonly EntityTx[];
  readonly hash: BlockHash;
  readonly status: BlockStatus;
  readonly proposedAt?: number;     // Timestamp for timeout
  readonly signatures?: readonly SignerIdx[];  // Collected signatures
};

// Complete entity state
export type EntityState = {
  readonly height: BlockHeight;
  readonly state: unknown;           // Application-specific state
  readonly mempool: readonly EntityTx[];
  readonly proposed?: ProposedBlock;
  readonly quorum: readonly SignerIdx[];  // Participating signers
  readonly status: EntityStatus;
  readonly lastBlockHash?: BlockHash;     // For chain verification
};

// Entity configuration
export type EntityConfig = {
  readonly id: EntityId;
  readonly quorum: readonly SignerIdx[];
  readonly threshold?: number;       // Percentage, defaults to 67
  readonly timeout?: number;         // Block timeout in ms
};

// types/server.ts - Server-level types
import type { EntityId, SignerIdx, BlockHeight } from './primitives';
import type { EntityInput, EntityState } from './entity';

// Server-level transaction
export type ServerTx = {
  readonly signer: SignerIdx;     // Who is sending
  readonly entityId: EntityId;    // Where to send
  readonly input: EntityInput;    // What to do
  readonly timestamp?: number;    // When received
};

// Server state
export type ServerState = {
  readonly height: BlockHeight;
  readonly signers: ReadonlyMap<SignerIdx, ReadonlyMap<EntityId, EntityState>>;
  readonly mempool: readonly ServerTx[];
  readonly startTime?: number;    // Server start timestamp
  readonly lastBlockTime?: number;
};

// Server configuration
export type ServerConfig = {
  readonly signerCount: number;
  readonly tickMs: number;        // Block interval, default 100ms
  readonly snapshotInterval: number;  // Blocks between snapshots
};

// types/messages.ts - Inter-entity messaging
import type { EntityId, SignerIdx } from './primitives';
import type { EntityInput } from './entity';

// Message between entities
export type OutboxMsg = {
  readonly from: EntityId;        // Source entity
  readonly toEntity: EntityId;    // Destination entity
  readonly toSigner: SignerIdx;   // Target signer (usually proposer)
  readonly input: EntityInput;    // Command to send
  readonly timestamp?: number;    // When created
};

// Message routing info
export type RouteInfo = {
  readonly source: EntityId;
  readonly destination: EntityId;
  readonly hops?: readonly EntityId[];  // For multi-hop routing
};

// types/storage.ts - Storage-related types
import type { EntityId, SignerIdx, BlockHeight, BlockHash } from './primitives';
import type { ServerState, ServerTx } from './server';
import type { EntityState } from './entity';

// WAL entry
export type WalEntry = {
  readonly height: BlockHeight;
  readonly signer: SignerIdx;
  readonly entityId: EntityId;
  readonly tx: ServerTx;
};

// Snapshot metadata
export type SnapshotMeta = {
  readonly height: BlockHeight;
  readonly hash: string;          // Root hash
  readonly timestamp: number;
  readonly entityCount: number;
};

// Storage keys
export type StateKey = `${SignerIdx}:${EntityId}`;
export type WalKey = `${BlockHeight}:${SignerIdx}:${EntityId}`;
export type BlockKey = `${BlockHeight}`;

// Storage operations result
export type StorageResult<T> = Result<T, StorageError>;

export type StorageError = 
  | { readonly type: 'not_found'; readonly key: string }
  | { readonly type: 'corruption'; readonly details: string }
  | { readonly type: 'io_error'; readonly error: Error };

// types/protocols.ts - Protocol definitions for extensibility
import type { EntityTx } from './entity';

// Protocol handler for entity operations
export type Protocol<TState, TData> = {
  readonly name: string;
  readonly validate: (tx: EntityTx) => tx is EntityTx & { data: TData };
  readonly apply: (state: TState, data: TData) => TState;
  readonly gasRequired?: number;
};

// Example protocol data types
export type MintData = {
  readonly amount: bigint;
  readonly memo?: string;
};

export type TransferData = {
  readonly to: EntityId;
  readonly amount: bigint;
  readonly asset?: string;
};

// types/consensus.ts - Consensus-related types
import type { EntityId, SignerIdx, BlockHash } from './primitives';

// Quorum structure
export type QuorumMember = {
  readonly signer: SignerIdx;
  readonly weight: number;        // Voting weight
};

export type Quorum = {
  readonly members: readonly QuorumMember[];
  readonly threshold: number;     // Percentage required
};

// Vote on a block
export type Vote = {
  readonly signer: SignerIdx;
  readonly blockHash: BlockHash;
  readonly signature?: string;    // Future: cryptographic signature
};

// Consensus state
export type ConsensusState = {
  readonly round: number;
  readonly votes: readonly Vote[];
  readonly decided: boolean;
};

// types/network.ts - Future networking types
import type { EntityId, SignerIdx } from './primitives';

// Peer information
export type PeerInfo = {
  readonly id: string;            // libp2p peer ID
  readonly signers: readonly SignerIdx[];
  readonly entities: readonly EntityId[];
  readonly lastSeen: number;
};

// Network message types
export type NetworkMsg = 
  | { readonly type: 'entity_sync'; readonly entities: readonly EntityId[] }
  | { readonly type: 'block_announce'; readonly height: BlockHeight }
  | { readonly type: 'request_state'; readonly entityId: EntityId };

// types/index.ts - Main export file
export * from './primitives';
export * from './entity';
export * from './server';
export * from './messages';
export * from './storage';
export * from './protocols';
export * from './consensus';
export * from './network';

// Convenience type for complete system state
export type XLNSystem = {
  readonly server: ServerState;
  readonly config: ServerConfig;
  readonly protocols: ReadonlyMap<string, Protocol<any, any>>;
};

// Type for deterministic testing
export type TestSnapshot = {
  readonly seed: number;
  readonly height: BlockHeight;
  readonly hash: string;
  readonly state: ServerState;
};

```