export type EntityTx =
  | { readonly op: 'mint'; readonly data: { readonly amount: bigint } }
  | { readonly op: 'transfer'; readonly data: { readonly to: string; readonly amount: bigint } }
  | { readonly op: string; readonly data: Record<string, unknown> };

export type EntityInput =
  | { readonly type: 'add_tx'; readonly tx: EntityTx }
  | { readonly type: 'propose_block' }
  | { readonly type: 'commit_block'; readonly blockHash: string };

export type EntityState<TState = Record<string, unknown>> = Readonly<{
  height: number;
  state: TState;
  mempool: readonly EntityTx[];
  proposed?: Readonly<{
    txs: readonly EntityTx[];
    hash: string;
    status: 'pending' | 'committed';
  }>;
  quorum: readonly number[];
  status: 'idle' | 'proposed';
}>;

export type ServerTx = Readonly<{
  signer: number;
  entityId: string;
  input: EntityInput;
}>;

export type OutboxMsg = Readonly<{
  from: string;
  toEntity: string;
  toSigner: number;
  input: EntityInput;
}>;

export type ServerState = Readonly<{
  height: number;
  signers: Map<number, Map<string, EntityState>>;
  mempool: readonly ServerTx[];
}>; 