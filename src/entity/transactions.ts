
import type { EntityId } from '../types/primitives.js';
import type { EntityTx } from '../types/state.js';

// ============================================================================
// Transaction Builders - Create transactions with clear intent
// ============================================================================

export const transaction = {
  transfer: (to: EntityId, amount: string | bigint, nonce: number): EntityTx => ({
    op: 'transfer',
    data: { to, amount: amount.toString() },
    nonce
  }),
  
  burn: (amount: string | bigint, nonce: number): EntityTx => ({
    op: 'burn',
    data: { amount: amount.toString() },
    nonce
  }),
  
  credit: (amount: string | bigint, from: EntityId): EntityTx => ({
    op: 'credit',
    data: { amount: amount.toString(), from, _internal: true }
  }),
  
  createInitiative: (config: {
    title: string;
    description: string;
    author: number;
    actions: readonly EntityTx[];
  }): EntityTx => ({
    op: 'createInitiative',
    data: config
  }),
  
  voteOnInitiative: (initiativeId: string, support: boolean, voter: number): EntityTx => ({
    op: 'voteInitiative',
    data: { initiativeId, support, voter }
  }),
  
  executeInitiative: (initiativeId: string, actions: readonly EntityTx[]): EntityTx => ({
    op: 'executeInitiative',
    data: { initiativeId, actions }
  })
};

// ============================================================================
// Transaction Description Helpers
// ============================================================================

export const describe = {
  transaction: (tx: EntityTx): string => {
    switch (tx.op) {
      case 'transfer': return `Transfer ${tx.data.amount} to ${tx.data.to}`;
      case 'burn': return `Burn ${tx.data.amount}`;
      case 'credit': return `Credit ${tx.data.amount} from ${tx.data.from}`;
      case 'createInitiative': return `Create initiative: ${tx.data.title}`;
      case 'voteInitiative': return `Vote ${tx.data.support ? 'for' : 'against'} initiative ${tx.data.initiativeId}`;
      case 'executeInitiative': return `Execute initiative ${tx.data.initiativeId}`;
      default: return `Unknown operation: ${tx.op}`;
    }
  },
  
  failure: (tx: EntityTx, reason: string): string => `Failed to ${describe.transaction(tx).toLowerCase()}: ${reason}`
};