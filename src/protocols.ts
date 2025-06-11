import type { EntityTx, MintTx, TransferTx } from './types/entity.ts';
import { MAX_BALANCE, validateAmount } from './validators.ts';

export type Protocol<S, P> = Readonly<{
  op: string;
  apply: (state: S, payload: P) => S;
  validate?: (payload: P) => boolean;
}>;

export type ProtocolMap<S> = Map<string, Protocol<S, any>>;

// Wallet-specific state shape (extend as needed)
export type WalletState = Readonly<{ balance?: bigint } & Record<string, unknown>>;

// ------ Built-in protocols --------------------------------------------------

const mintProtocol: Protocol<WalletState, MintTx['data']> = {
  op: 'mint',
  validate: (p) => validateAmount(p.amount).ok,
  apply: (state, payload) => {
    const current = state.balance ?? 0n;
    const next = current + payload.amount;
    if (next > MAX_BALANCE) return state; // overflow protection
    return { ...state, balance: next };
  },
};

const transferProtocol: Protocol<WalletState, TransferTx['data']> = {
  op: 'transfer',
  validate: (p) =>
    validateAmount(p.amount).ok && typeof p.to === 'string' && p.to.length > 0,
  apply: (state, payload) => {
    const current = state.balance ?? 0n;
    if (current < payload.amount) return state; // insufficient funds
    const next = current - payload.amount;
    return { ...state, balance: next };
  },
};

export const defaultProtocols: ProtocolMap<WalletState> = new Map(
  [mintProtocol, transferProtocol].map((p) => [p.op, p]),
);

export const composeApplyTxs = <S>(protocols: ProtocolMap<S>) =>
  (state: S, txs: readonly EntityTx[]): S =>
    txs.reduce<S>((acc, tx) => {
      const proto = protocols.get(tx.op);
      return proto ? proto.apply(acc, (tx as any).data) : acc;
    }, state); 