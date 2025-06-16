import type { EntityTx, Result, OutboxMsg, EntityId } from '../types';
import { Ok, Err, entity } from '../types';
import type { Protocol } from './types';

/**
 * Wallet state - tracks balance and nonce
 */
export type WalletState = {
  readonly balance: bigint;
  readonly nonce: number;
};

/**
 * Wallet operations
 */
export type WalletOp = 
  | { readonly type: 'credit'; readonly amount: bigint; readonly from?: EntityId }
  | { readonly type: 'burn'; readonly amount: bigint }
  | { readonly type: 'transfer'; readonly amount: bigint; readonly to: EntityId };

/**
 * Validate wallet transaction
 */
const validateWalletTx = (tx: EntityTx): Result<WalletOp, string> => {
  switch (tx.op) {
    case 'mint':    // Deprecated: use 'credit' instead
    case 'credit': {
      const amount = BigInt(tx.data.amount);
      if (amount <= 0n) return Err('Amount must be positive');
      return Ok({ 
        type: 'credit', 
        amount, 
        from: tx.data.from ? entity(tx.data.from) : undefined 
      });
    }
    
    case 'burn': {
      const amount = BigInt(tx.data.amount);
      if (amount <= 0n) return Err('Amount must be positive');
      return Ok({ type: 'burn', amount });
    }
    
    case 'transfer': {
      const amount = BigInt(tx.data.amount);
      const to = tx.data.to;
      if (amount <= 0n) return Err('Amount must be positive');
      if (!to) return Err('Transfer requires recipient');
      return Ok({ type: 'transfer', amount, to: entity(to) });
    }
    
    default:
      return Err(`Unknown wallet operation: ${tx.op}`);
  }
};

/**
 * Apply wallet operation to state
 */
const applyWalletOp = (state: WalletState, op: WalletOp): Result<WalletState, string> => {
  switch (op.type) {
    case 'credit':
      return Ok({
        balance: state.balance + op.amount,
        nonce: state.nonce  // Don't increment nonce on passive receipt
      });
    
    case 'burn':
      if (state.balance < op.amount) {
        return Err('Insufficient balance');
      }
      return Ok({
        balance: state.balance - op.amount,
        nonce: state.nonce + 1
      });
    
    case 'transfer':
      if (state.balance < op.amount) {
        return Err('Insufficient balance');
      }
      return Ok({
        balance: state.balance - op.amount,
        nonce: state.nonce + 1
      });
  }
};

/**
 * Generate messages for wallet operations
 */
const generateWalletMessages = (from: EntityId, op: WalletOp): readonly OutboxMsg[] => {
  if (op.type === 'transfer') {
    return [{
      from,
      toEntity: op.to,
      input: {
        type: 'add_tx',
        tx: {
          op: 'credit',
          data: { 
            amount: op.amount.toString(), 
            from: from 
          }
        }
      }
    }];
  }
  return [];
};

/**
 * Wallet protocol implementation
 */
export const WalletProtocol: Protocol<WalletState, WalletOp> = {
  name: 'wallet',
  validateTx: validateWalletTx,
  applyTx: applyWalletOp,
  generateMessages: generateWalletMessages
};

/**
 * Create initial wallet state
 */
export const createWalletState = (initialBalance: bigint = 0n): WalletState => ({
  balance: initialBalance,
  nonce: 0
});