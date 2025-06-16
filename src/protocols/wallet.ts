// ============================================================================
// protocols/wallet.ts - Wallet protocol implementation
// ============================================================================

import type { EntityId } from '../types/primitives.js';
import { id } from '../types/primitives.js';
import type { Protocol } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityTx, OutboxMsg } from '../types/state.js';

export type WalletState = {
  readonly balance: bigint;
  readonly nonce: number;
};

export type WalletOp = 
  | { readonly type: 'credit'; readonly amount: bigint; readonly from: EntityId; readonly _internal?: boolean }
  | { readonly type: 'burn'; readonly amount: bigint }
  | { readonly type: 'transfer'; readonly amount: bigint; readonly to: EntityId };

const validateWalletTx = (tx: EntityTx): Result<WalletOp> => {
  // Helper to safely parse BigInt
  const parseBigInt = (value: any): bigint => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string' || typeof value === 'number') {
      return BigInt(value);
    }
    return 0n;
  };

  switch (tx.op) {
    case 'credit': {
      // N-2 FIX: Credits should only be generated internally via transfers
      // In a real system, this would be enforced at the network layer
      return Err('Credit operations cannot be submitted directly');
    }
    
    case 'burn': {
      const amount = parseBigInt(tx.data.amount);
      if (amount <= 0n) return Err('Amount must be positive');
      return Ok({ type: 'burn', amount });
    }
    
    case 'transfer': {
      const amount = parseBigInt(tx.data.amount);
      const to = tx.data.to;
      if (amount <= 0n) return Err('Amount must be positive');
      if (!to) return Err('Transfer requires recipient');
      return Ok({ type: 'transfer', amount, to: id(to) });
    }
    
    default:
      return Err(`Unknown wallet operation: ${tx.op}`);
  }
};

// N-2 FIX: Separate internal validation for system-generated credits
const validateInternalCredit = (tx: EntityTx): Result<WalletOp> => {
  if (tx.op !== 'credit' || !tx.data._internal) {
    return Err('Invalid internal credit');
  }
  
  // P-2 FIX: Use parseBigInt helper for consistent parsing
  const parseBigInt = (value: any): bigint => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string' || typeof value === 'number') {
      return BigInt(value);
    }
    return 0n;
  };
  
  const amount = parseBigInt(tx.data.amount);
  if (amount <= 0n) return Err('Amount must be positive');
  
  return Ok({ 
    type: 'credit', 
    amount, 
    from: tx.data.from, 
    _internal: true 
  });
};

// NONCE POLICY DOCUMENTED
// Credits increment the receiver's nonce to maintain monotonic ordering
// and prevent replay of old credit operations. This differs from EVM
// where only sender-initiated actions bump nonce.
const applyWalletOp = (state: WalletState, op: WalletOp, tx?: EntityTx): Result<WalletState> => {
  switch (op.type) {
    case 'credit':
      return Ok({
        balance: state.balance + op.amount,
        nonce: state.nonce + 1  // Intentional: see comment above
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

const generateWalletMessages = (from: EntityId, op: WalletOp): readonly OutboxMsg[] => {
  if (op.type === 'transfer') {
    return [{
      from,
      to: op.to,
      command: {
        type: 'addTx',
        tx: {
          op: 'credit',
          data: { 
            amount: op.amount.toString(), 
            from,
            _internal: true
          }
        }
      }
    }];
  }
  return [];
};

export const WalletProtocol: Protocol<WalletState, WalletOp> = {
  name: 'wallet',
  validateTx: (tx: EntityTx) => {
    // N-2 FIX: Use internal validator for credits with _internal flag
    if (tx.op === 'credit' && tx.data?._internal) {
      return validateInternalCredit(tx);
    }
    return validateWalletTx(tx);
  },
  applyTx: (state, op, tx) => applyWalletOp(state, op, tx),
  generateMessages: generateWalletMessages
}; 