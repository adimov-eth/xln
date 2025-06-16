import type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives';
import type { EntityStage } from '../core/quorum';

// Entity transaction type
export type EntityTx = { 
  readonly op: string; 
  readonly data: any;
};

// Entity input discriminated union
export type ProposedBlock = {
  readonly txs: EntityTx[];
  readonly hash: BlockHash;
  readonly approves: Set<SignerIdx>;
  readonly timestamp: number;        // Add for timeout tracking
  readonly proposer: SignerIdx;      // Track who proposed
};

// Equipment of typestate via Base<TStage>
type Base<S extends EntityStage, T> = {
  readonly tag: S;
  readonly height: BlockHeight;
  readonly state: T;
  readonly mempool: EntityTx[];
  readonly lastBlockHash?: BlockHash;
  readonly lastProcessedHeight?: BlockHeight;
};

export type Idle<T>       = Base<'Idle', T>;
export type Proposed<T>   = Base<'Proposed', T> & { readonly proposal: ProposedBlock };
export type Committing<T> = Base<'Committing', T> & { readonly proposal: ProposedBlock };
export type Faulted       = { readonly tag: 'Faulted'; readonly reason: string; readonly height: BlockHeight; readonly lastProcessedHeight?: BlockHeight };

export type EntityState<T = any> = Idle<T> | Proposed<T> | Committing<T> | Faulted;

export type EntityMeta = {
  readonly id: EntityId;
  readonly quorum: SignerIdx[];
  readonly timeoutMs?: number;      // Configurable timeout
};

// Update EntityInput to not require hash for propose_block
export type EntityInput =
  | { readonly type: 'add_tx'; readonly tx: EntityTx }
  | { readonly type: 'propose_block'; readonly txs: EntityTx[] }
  | { readonly type: 'approve_block'; readonly hash: BlockHash; readonly from?: SignerIdx }
  | { readonly type: 'commit_block'; readonly hash: BlockHash };

// Registry type
export type Registry = Map<EntityId, EntityMeta>;

// Server transaction type
export type ServerTx = {
  readonly signer: SignerIdx;
  readonly entityId: EntityId;
  readonly input: EntityInput;
};

// Outbox message type
export type OutboxMsg = {
  readonly from: EntityId;
  readonly toEntity: EntityId;
  readonly toSigner?: SignerIdx;
  readonly input: EntityInput;
};

// Server state type
export type ServerState = {
  readonly height: BlockHeight;
  readonly registry: Registry;
  readonly signers: Map<SignerIdx, Map<EntityId, EntityState>>;
  readonly mempool: ServerTx[];
  readonly lastBlockHash?: BlockHash;
};