import type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives.js';

export type EntityStage = 'idle' | 'proposed' | 'committing' | 'faulted';
export type SignerEntities = ReadonlyMap<EntityId, EntityState>;

export type EntityTx = {
  readonly op: string;
  readonly data: any;
  nonce?: number;
};

export type ProposedBlock = {
  readonly txs: readonly EntityTx[];
  readonly hash: BlockHash;
  readonly height: BlockHeight;
  readonly proposer: SignerIdx;
  readonly approvals: ReadonlySet<SignerIdx>;
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
  readonly signers: ReadonlyMap<SignerIdx, SignerEntities>;
  readonly registry: ReadonlyMap<EntityId, EntityMeta>;
  readonly mempool: readonly ServerTx[];
};

export type BlockData = {
  readonly height: BlockHeight;
  readonly timestamp: number;
  readonly transactions: readonly ServerTx[];
  readonly stateHash: string;
  readonly parentHash?: string;
  readonly encodedData?: Buffer;
};

export type CommandResult = {
  readonly entity: EntityState;
  readonly messages: readonly OutboxMsg[];
};

export type Clock = {
  readonly now: () => number;
};

export type ProcessedBlock = {
  readonly server: ServerState;
  readonly stateHash: string;
  readonly appliedTxs: readonly ServerTx[];
  readonly failedTxs: readonly ServerTx[];
  readonly messages: readonly OutboxMsg[];
};

export type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives.js';
