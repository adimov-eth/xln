// ============================================================================
// protocols/wallet.ts - Wallet protocol that reads like English
// ============================================================================

import { walletActions } from '../entity/actions.js';
import type { WalletState } from '../entity/actions.js';
import type { EntityId } from '../types/primitives.js';
import { id } from '../types/primitives.js';
import type { Protocol } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityTx, OutboxMsg } from '../types/state.js';

// Re-export for compatibility
export type { WalletState } from '../entity/actions.js';

// ============================================================================
// Wallet Operations
// ============================================================================

export type WalletOp = 
  | { type: 'credit'; amount: bigint; from: EntityId; _internal?: boolean }
  | { type: 'burn'; amount: bigint }
  | { type: 'transfer'; amount: bigint; to: EntityId };

// ============================================================================
// Transaction Validation - Parse and validate incoming transactions
// ============================================================================

const parseTransaction = (tx: EntityTx): Result<WalletOp> => {
  const amount = parseAmount(tx.data?.amount);
  
  switch (tx.op) {
    case 'credit':
      return parseCredit(tx, amount);
      
    case 'burn':
      return parseBurn(amount);
      
    case 'transfer':
      return parseTransfer(tx, amount);
      
    default:
      return Err(`Unknown wallet operation: ${tx.op}`);
  }
};

// ============================================================================
// Apply Operations - Execute validated operations on state
// ============================================================================

const applyOperation = (state: WalletState, op: WalletOp): Result<WalletState> => {
  switch (op.type) {
    case 'credit': {
      const result = walletActions.credit.validate(state, {
        amount: op.amount,
        from: op.from
      });
      
      if (!result.ok) return result;
      
      return Ok(walletActions.credit.execute(state, result.value));
    }
    
    case 'burn': {
      const result = walletActions.burn.validate(state, { amount: op.amount });
      
      if (!result.ok) return result;
      
      return Ok(walletActions.burn.execute(state, result.value));
    }
    
    case 'transfer': {
      const result = walletActions.transfer.validate(state, {
        to: op.to,
        amount: op.amount
      });
      
      if (!result.ok) return result;
      
      return Ok(walletActions.transfer.execute(state, result.value));
    }
  }
};

// ============================================================================
// Generate Messages - Create follow-up messages for operations
// ============================================================================

const generateMessages = (entityId: EntityId, op: WalletOp): OutboxMsg[] => {
  if (op.type === 'transfer') {
    return walletActions.transfer.generateMessages!(entityId, {
      to: op.to,
      amount: op.amount
    });
  }
  
  return [];
};

// ============================================================================
// Helper Functions
// ============================================================================

const parseAmount = (value: any): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' || typeof value === 'number') {
    return BigInt(value);
  }
  return 0n;
};

const parseCredit = (tx: EntityTx, amount: bigint): Result<WalletOp> => {
  // Credits should only come from internal transfers
  if (!tx.data?._internal) {
    return Err('Credit operations cannot be submitted directly');
  }
  
  if (amount <= 0n) {
    return Err('Credit amount must be positive');
  }
  
  if (!tx.data.from) {
    return Err('Credit requires a source');
  }
  
  return Ok({ 
    type: 'credit', 
    amount, 
    from: id(tx.data.from), 
    _internal: true 
  });
};

const parseBurn = (amount: bigint): Result<WalletOp> => {
  if (amount <= 0n) {
    return Err('Burn amount must be positive');
  }
  
  return Ok({ type: 'burn', amount });
};

const parseTransfer = (tx: EntityTx, amount: bigint): Result<WalletOp> => {
  if (amount <= 0n) {
    return Err('Transfer amount must be positive');
  }
  
  if (!tx.data?.to) {
    return Err('Transfer requires a recipient');
  }
  
  return Ok({ 
    type: 'transfer', 
    amount, 
    to: id(tx.data.to) 
  });
};

// ============================================================================
// Protocol Definition
// ============================================================================

export const WalletProtocol: Protocol<WalletState, WalletOp> = {
  name: 'wallet',
  validateTx: parseTransaction,
  applyTx: applyOperation,
  generateMessages
}; 
