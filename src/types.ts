export type SignerId = string;    // 32-byte hex
export type EntityId = string;    // 32-byte hex
export type TxHash = string;      // 32-byte hex
export type BlockHash = string;   // 32-byte hex


export type EntityTx = {
  readonly op: string;
  readonly args: readonly (string | number)[];
  readonly nonce?: number;
};

export type EntityInput = 
  | { readonly type: 'AddTx'; readonly tx: EntityTx }
  | { readonly type: 'ProposeBlock' }
  | { readonly type: 'CommitBlock'; readonly blockHash: BlockHash }
  | { readonly type: 'Flush' };

export type ServerTx = {
  readonly signerId: SignerId;
  readonly entityId: EntityId;
  readonly input: EntityInput;
  readonly timestamp: number;
};

export type OutboxMessage = {
  readonly from: EntityId;
  readonly to: EntityId;
  readonly signerId: SignerId;
  readonly payload: EntityInput;
};

export type EntityStorage = {
  readonly [key: string]: string | number | boolean;
};

export type EntityBlock = {
  readonly height: number;
  readonly timestamp: number;
  readonly txs: readonly EntityTx[];
  readonly stateRoot: BlockHash;
  readonly storage: EntityStorage;
};

export type EntityStatus = 'idle' | 'proposing' | 'committing';

export type EntityState = {
  readonly status: EntityStatus;
  readonly storage: EntityStorage;
  readonly mempool: readonly EntityTx[];
  readonly lastBlock?: EntityBlock;
  readonly proposedBlock?: EntityBlock;
  readonly height: number;
};

export type ServerBlock = {
  readonly height: number;
  readonly timestamp: number;
  readonly inputs: readonly ServerTx[];
  readonly stateRoot: BlockHash;
};

export type MempoolEntry = {
  readonly tx: ServerTx;
  readonly timestamp: number;
};

export type ServerState = {
  readonly height: number;
  readonly mempool: ReadonlyMap<TxHash, MempoolEntry>;
  readonly entities: ReadonlyMap<SignerId, ReadonlyMap<EntityId, EntityState>>;
  readonly lastBlock?: ServerBlock;
};

export type MempoolConfig = {
  readonly maxAge: number;
};

export type ServerConfig = {
  readonly tickInterval: number;
  readonly mempool: MempoolConfig;
};

export type Result<T, E = Error> = 
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
