// ============================================================================
// types/state.ts - Core state types
// ============================================================================

import type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives.js';

export type EntityStage = 'idle' | 'proposed' | 'committing' | 'faulted';

// Each signer maintains its own entity replicas
export type SignerEntities = ReadonlyMap<EntityId, EntityState>;

export type EntityTx = {
  readonly op: string;
  readonly data: any;
  readonly nonce?: number;
};

export type ProposedBlock = {
  readonly txs: readonly EntityTx[];
  readonly hash: BlockHash;
  readonly height: BlockHeight;
  readonly proposer: SignerIdx;
  readonly approvals: Set<SignerIdx>;
  readonly timestamp: number;
};

export type EntityState<T = any> = {
  readonly id: EntityId;
  readonly height: BlockHeight;
  readonly stage: EntityStage;
  readonly data: T;
  readonly mempool: readonly EntityTx[];
  readonly proposal?: ProposedBlock;
  readonly lastBlockHash?: BlockHash;
  readonly faultReason?: string;
};

export type EntityMeta = {
  readonly id: EntityId;
  readonly quorum: readonly SignerIdx[];
  readonly timeoutMs: number;
  readonly protocol: string;
};

export type EntityCommand = 
  | { readonly type: 'addTx'; readonly tx: EntityTx }
  | { readonly type: 'proposeBlock' }
  | { readonly type: 'shareProposal'; readonly proposal: ProposedBlock }
  | { readonly type: 'approveBlock'; readonly hash: BlockHash; readonly from?: SignerIdx }
  | { readonly type: 'commitBlock'; readonly hash: BlockHash };

export type ServerTx = {
  readonly signer: SignerIdx;
  readonly entityId: EntityId;
  readonly command: EntityCommand;
};

export type OutboxMsg = {
  readonly from: EntityId;
  readonly to: EntityId;
  readonly toSigner?: SignerIdx;
  readonly command: EntityCommand;
};

export type ServerState = {
  readonly height: BlockHeight;
  readonly signers: ReadonlyMap<SignerIdx, SignerEntities>;  // NEW: hierarchical structure
  readonly registry: ReadonlyMap<EntityId, EntityMeta>;
  readonly mempool: readonly ServerTx[];
  // Temporary for migration - will be removed
  readonly entities?: ReadonlyMap<EntityId, EntityState>;
};

export type BlockData = {
  readonly height: BlockHeight;
  readonly timestamp: number;
  readonly transactions: readonly ServerTx[];
  readonly stateHash: string;
  readonly parentHash?: string;
};

// Command result type (moved here to avoid circular imports)
export type CommandResult = {
  readonly entity: EntityState;
  readonly messages: readonly OutboxMsg[];
};

// Re-export from primitives for convenience
export type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives.js';
