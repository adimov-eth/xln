// ============================================================================
// entity/transactions.ts - Business operations that read like English
// ============================================================================

import type { EntityTx } from '../types/state.js';

// ============================================================================
// Transaction Type Definition
// ============================================================================

export type Transaction = {
  operation: string;
  parameters: any;
  nonce?: number;
  description: string;
};

// ============================================================================
// Transaction Builders - Create transactions with clear intent
// ============================================================================

export const transaction = {
  // Wallet transactions
  transfer: (to: string, amount: string | bigint, nonce: number): EntityTx => ({
    op: 'transfer',
    data: { to, amount: amount.toString() },
    nonce
  }),
  
  burn: (amount: string | bigint, nonce: number): EntityTx => ({
    op: 'burn',
    data: { amount: amount.toString() },
    nonce
  }),
  
  credit: (amount: string | bigint, from: string): EntityTx => ({
    op: 'credit',
    data: { 
      amount: amount.toString(), 
      from,
      _internal: true // Internal credits from transfers
    }
  }),
  
  // DAO transactions
  createInitiative: (config: {
    title: string;
    description: string;
    author: number;
    actions: EntityTx[];
  }): EntityTx => ({
    op: 'createInitiative',
    data: config
  }),
  
  voteOnInitiative: (initiativeId: string, support: boolean, voter: number): EntityTx => ({
    op: 'voteInitiative',
    data: { initiativeId, support, voter }
  }),
  
  executeInitiative: (params: {
    initiativeId: string;
    actions: EntityTx[];
  }): EntityTx => ({
    op: 'executeInitiative',
    data: params
  }),
  
  // Aliases for convenience
  vote: (initiativeId: string, support: boolean, voter: number): EntityTx => 
    transaction.voteOnInitiative(initiativeId, support, voter)
};

// ============================================================================
// Transaction Validation Helpers
// ============================================================================

export const validate = {
  hasPositiveAmount: (data: any): boolean => {
    if (!data.amount) return false;
    const amount = BigInt(data.amount);
    return amount > 0n;
  },
  
  hasValidRecipient: (data: any): boolean => {
    return typeof data.to === 'string' && data.to.length > 0;
  },
  
  hasValidNonce: (tx: EntityTx, expectedNonce: number): boolean => {
    return tx.nonce === expectedNonce;
  },
  
  isInternalCredit: (tx: EntityTx): boolean => {
    return tx.op === 'credit' && tx.data?._internal === true;
  }
};

// ============================================================================
// Transaction Description Helpers
// ============================================================================

export const describe = {
  transaction: (tx: EntityTx): string => {
    switch (tx.op) {
      case 'transfer':
        return `Transfer ${tx.data.amount} tokens to ${tx.data.to}`;
      case 'burn':
        return `Burn ${tx.data.amount} tokens`;
      case 'credit':
        return `Credit ${tx.data.amount} tokens from ${tx.data.from}`;
      case 'createInitiative':
        return `Create initiative: ${tx.data.title}`;
      case 'voteInitiative':
        return `Vote ${tx.data.support ? 'for' : 'against'} initiative ${tx.data.initiativeId}`;
      case 'executeInitiative':
        return `Execute initiative ${tx.data.initiativeId}`;
      default:
        return `Unknown operation: ${tx.op}`;
    }
  },
  
  failure: (tx: EntityTx, reason: string): string => {
    return `Failed to ${describe.transaction(tx).toLowerCase()}: ${reason}`;
  }
};

// ============================================================================
// Transaction Queue Helpers
// ============================================================================

export const queue = {
  add: (mempool: readonly EntityTx[], tx: EntityTx): readonly EntityTx[] => {
    return [...mempool, tx];
  },
  
  remove: (mempool: readonly EntityTx[], tx: EntityTx): readonly EntityTx[] => {
    return mempool.filter(t => t !== tx);
  },
  
  clear: (): readonly EntityTx[] => {
    return [];
  },
  
  hasTransactions: (mempool: readonly EntityTx[]): boolean => {
    return mempool.length > 0;
  }
};

// ============================================================================
// Transaction Batch Helpers
// ============================================================================

export const batch = {
  // Group transactions by operation type
  groupByOperation: (transactions: readonly EntityTx[]): Map<string, EntityTx[]> => {
    const groups = new Map<string, EntityTx[]>();
    
    for (const tx of transactions) {
      const group = groups.get(tx.op) ?? [];
      groups.set(tx.op, [...group, tx]);
    }
    
    return groups;
  },
  
  // Get all transactions that require a nonce
  getNoncedTransactions: (transactions: readonly EntityTx[]): EntityTx[] => {
    return transactions.filter(tx => tx.nonce !== undefined);
  },
  
  // Get all transactions without nonce
  getNonNoncedTransactions: (transactions: readonly EntityTx[]): EntityTx[] => {
    return transactions.filter(tx => tx.nonce === undefined);
  }
};