import type { Height, SignerIdx } from './primitives.ts';

/**
 * Business-logic transaction variants.
 */
export type MintTx = Readonly<{ op: 'mint'; data: { readonly amount: bigint } }>;
export type TransferTx = Readonly<{
  op: 'transfer';
  data: { readonly to: string; readonly amount: bigint };
}>;

/**
 * Catch-all for unsupported operations – keeps exhaustiveness explicit.
 */
export type UnknownTx = Readonly<{ op: '__unknown__'; data: unknown }>;

export type EntityTx = MintTx | TransferTx | UnknownTx;

export type EntityInput =
  | { readonly type: 'add_tx'; readonly tx: EntityTx }
  | { readonly type: 'propose_block' }
  | { readonly type: 'commit_block'; readonly blockHash: string };

export type EntityState<TState = Record<string, unknown>> = Readonly<{
  height: Height;
  state: TState;
  mempool: readonly EntityTx[];
  proposed?: Readonly<{
    txs: readonly EntityTx[];
    hash: string;
    status: 'pending' | 'committed';
  }>;
  quorum: readonly SignerIdx[];
  status: 'idle' | 'proposed';
}>; 