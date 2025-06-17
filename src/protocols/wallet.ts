
import type { WalletState } from '../entity/actions.js';
import { walletActions } from '../entity/actions.js';
import type { EntityId } from '../types/primitives.js';
import { id } from '../types/primitives.js';
import type { Protocol } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityTx, OutboxMsg } from '../types/state.js';

export type { WalletState } from '../entity/actions.js';

// ============================================================================
// Wallet Operations
// ============================================================================

export type WalletOp = 
  | { readonly type: 'credit'; readonly amount: bigint; readonly from: EntityId; readonly _internal?: boolean }
  | { readonly type: 'burn'; readonly amount: bigint }
  | { readonly type: 'transfer'; readonly amount: bigint; readonly to: EntityId };

// ============================================================================
// Transaction Validation - Parse and validate incoming transactions
// ============================================================================

const parseTransaction = (tx: EntityTx): Result<WalletOp> => {
  const amount = parseAmount(tx.data?.amount);
  switch (tx.op) {
    case 'credit': return parseCredit(tx, amount);
    case 'burn': return parseBurn(amount);
    case 'transfer': return parseTransfer(tx, amount);
    default: return Err(`Unknown wallet operation: ${tx.op}`);
  }
};

// ============================================================================
// Apply Operations - Execute validated operations on state
// ============================================================================

const applyOperation = (state: WalletState, op: WalletOp): Result<WalletState> => {
  switch (op.type) {
    case 'credit': {
      const result = walletActions.credit.validate(state, op);
      return result.ok ? Ok(walletActions.credit.execute(state, result.value)) : result;
    }
    case 'burn': {
      const result = walletActions.burn.validate(state, op);
      return result.ok ? Ok(walletActions.burn.execute(state, result.value)) : result;
    }
    case 'transfer': {
      const result = walletActions.transfer.validate(state, op);
      return result.ok ? Ok(walletActions.transfer.execute(state, result.value)) : result;
    }
  }
};

// ============================================================================
// Generate Messages - Create follow-up messages for operations
// ============================================================================

const generateMessages = (entityId: EntityId, op: WalletOp): readonly OutboxMsg[] => {
  if (op.type === 'transfer' && walletActions.transfer.generateMessages) {
    return walletActions.transfer.generateMessages(entityId, op);
  }
  return [];
};

// ============================================================================
// Helper Functions
// ============================================================================

const parseAmount = (value: any): bigint => {
  try { return BigInt(value); } catch { return 0n; }
};

const parseCredit = (tx: EntityTx, amount: bigint): Result<WalletOp> => {
  if (!tx.data?._internal) return Err('Credit operations cannot be submitted directly');
  if (amount <= 0n) return Err('Credit amount must be positive');
  if (!tx.data.from) return Err('Credit requires a source');
  return Ok({ type: 'credit', amount, from: id(tx.data.from), _internal: true });
};

const parseBurn = (amount: bigint): Result<WalletOp> => {
  if (amount <= 0n) return Err('Burn amount must be positive');
  return Ok({ type: 'burn', amount });
};

const parseTransfer = (tx: EntityTx, amount: bigint): Result<WalletOp> => {
  if (amount <= 0n) return Err('Transfer amount must be positive');
  if (!tx.data?.to) return Err('Transfer requires a recipient');
  return Ok({ type: 'transfer', amount, to: id(tx.data.to) });
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