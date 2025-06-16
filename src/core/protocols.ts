import type { EntityTx } from '../types';

// Protocol handler type
export type Protocol<TState, TData> = {
  readonly name: string;
  readonly validate: (tx: EntityTx) => tx is EntityTx & { data: TData };
  readonly apply: (state: TState, data: TData) => TState;
  readonly gasRequired?: number;
};

// Example wallet protocol
export type WalletState = {
  balance: bigint;
  nonce: number;
};

export type MintData = {
  amount: bigint;
  memo?: string;
};

export type TransferData = {
  to: string;
  amount: bigint;
  asset?: string;
};

export type BurnData = {
  amount: bigint;
};

export const WalletProtocol: Record<string, Protocol<WalletState, any>> = {
  mint: {
    name: 'mint',
    validate: (tx): tx is EntityTx & { data: MintData } => 
      tx.op === 'mint' && typeof tx.data?.amount === 'bigint',
    apply: (state, data) => ({
      ...state,
      balance: state.balance + data.amount
    })
  },
  
  transfer: {
    name: 'transfer',
    validate: (tx): tx is EntityTx & { data: TransferData } => 
      tx.op === 'transfer' && 
      typeof tx.data?.to === 'string' && 
      typeof tx.data?.amount === 'bigint',
    apply: (state, data) => ({
      ...state,
      balance: state.balance - data.amount
    })
  },
  
  burn: {
    name: 'burn',
    validate: (tx): tx is EntityTx & { data: BurnData } => 
      tx.op === 'burn' && typeof tx.data?.amount === 'bigint',
    apply: (state, data) => ({
      ...state,
      balance: state.balance - data.amount
    })
  }
};