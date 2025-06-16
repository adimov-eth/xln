import type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives';

// Entity transaction type
export type EntityTx = { 
  readonly op: string; 
  readonly data: any;
};

// Entity input discriminated union
export type EntityInput =
  | { readonly type: 'add_tx'; readonly tx: EntityTx }
  | { readonly type: 'propose_block'; readonly txs: EntityTx[]; readonly hash: string }
  | { readonly type: 'approve_block'; readonly hash: string; readonly from?: SignerIdx }
  | { readonly type: 'commit_block'; readonly hash: string };

// Proposed block type
export type ProposedBlock = {
  readonly txs: EntityTx[];
  readonly hash: BlockHash;
  readonly approves: Set<SignerIdx>;
};

// Entity state discriminated union
export type EntityState =
  | { readonly tag: 'Idle'; readonly height: BlockHeight; readonly state: any; readonly mempool: EntityTx[]; readonly lastBlockHash?: BlockHash; readonly lastProcessedHeight?: BlockHeight }
  | { readonly tag: 'Proposed'; readonly height: BlockHeight; readonly state: any; readonly mempool: EntityTx[]; readonly proposal: ProposedBlock; readonly lastBlockHash?: BlockHash; readonly lastProcessedHeight?: BlockHeight }
  | { readonly tag: 'Committing'; readonly height: BlockHeight; readonly state: any; readonly mempool: EntityTx[]; readonly proposal: ProposedBlock; readonly lastBlockHash?: BlockHash; readonly lastProcessedHeight?: BlockHeight }
  | { readonly tag: 'Faulted'; readonly reason: string; readonly height: BlockHeight; readonly lastProcessedHeight?: BlockHeight };

// Entity metadata
export type EntityMeta = {
  readonly id: EntityId;
  readonly quorum: SignerIdx[];
  readonly proposer: SignerIdx;
};

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