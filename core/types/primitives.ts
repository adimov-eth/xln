// Branded types for type safety
export type EntityId = string & { readonly __brand: 'EntityId' };
export type SignerIdx = number & { readonly __brand: 'SignerIdx' };
export type BlockHeight = number & { readonly __brand: 'BlockHeight' };
export type BlockHash = string & { readonly __brand: 'BlockHash' };
export type TxHash = string & { readonly __brand: 'TxHash' };

// Type constructors
export const toEntityId = (s: string): EntityId => s as EntityId;
export const toSignerIdx = (n: number): SignerIdx => n as SignerIdx;
export const toBlockHeight = (n: number): BlockHeight => n as BlockHeight;
export const toBlockHash = (s: string): BlockHash => s as BlockHash;
export const toTxHash = (s: string): TxHash => s as TxHash;

// Type guards
export const isEntityId = (x: any): x is EntityId => typeof x === 'string';
export const isSignerIdx = (x: any): x is SignerIdx => typeof x === 'number';
export const isBlockHeight = (x: any): x is BlockHeight => typeof x === 'number';
export const isBlockHash = (x: any): x is BlockHash => typeof x === 'string';
export const isTxHash = (x: any): x is TxHash => typeof x === 'string';

// Result type for functional error handling
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const Ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const Err = <E>(error: E): Err<E> => ({ ok: false, error });

// Entity state discriminated union
export type EntityState =
  | { tag: 'Idle'; height: BlockHeight; state: any; mempool: EntityTx[]; lastBlockHash?: BlockHash; lastProcessedHeight?: BlockHeight }
  | { tag: 'Proposed'; height: BlockHeight; state: any; mempool: EntityTx[]; proposal: ProposedBlock; lastBlockHash?: BlockHash; lastProcessedHeight?: BlockHeight }
  | { tag: 'Committing'; height: BlockHeight; state: any; mempool: EntityTx[]; proposal: ProposedBlock; lastBlockHash?: BlockHash; lastProcessedHeight?: BlockHeight }
  | { tag: 'Faulted'; reason: string; height: BlockHeight; lastProcessedHeight?: BlockHeight };

// Entity transaction type
export type EntityTx = { op: string; data: any };

// Proposed block type
export type ProposedBlock = {
  txs: EntityTx[];
  hash: BlockHash;
  approves: Set<SignerIdx>;
};

// Entity input discriminated union
export type EntityInput =
  | { type: 'add_tx'; tx: EntityTx }
  | { type: 'propose_block'; txs: EntityTx[]; hash: string }
  | { type: 'approve_block'; hash: string; from?: SignerIdx }
  | { type: 'commit_block'; hash: string };

// Server transaction type
export type ServerTx = {
  signer: SignerIdx;
  entityId: EntityId;
  input: EntityInput;
};

// Outbox message type
export type OutboxMsg = {
  from: EntityId;
  toEntity: EntityId;
  toSigner?: SignerIdx;
  input: EntityInput;
};

// Entity metadata
export type EntityMeta = {
  id: EntityId;
  quorum: SignerIdx[];
  proposer: SignerIdx;
};

// Registry type
export type Registry = Map<EntityId, EntityMeta>;

// Server state type
export type ServerState = {
  height: BlockHeight;
  registry: Registry;
  signers: Map<SignerIdx, Map<EntityId, EntityState>>;
  mempool: ServerTx[];
  lastBlockHash?: BlockHash;
};

// Error types
export type ValidationError = {
  type: 'validation';
  field: string;
  message: string;
};

export type NotFoundError = {
  type: 'not_found';
  resource: string;
  id: string;
};

export type UnauthorizedError = {
  type: 'unauthorized';
  signer: SignerIdx;
  entity: EntityId;
};

export type ProcessingError = ValidationError | NotFoundError | UnauthorizedError;