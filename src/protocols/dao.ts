// ============================================================================
// protocols/dao.ts - DAO protocol that reads like English
// ============================================================================

import { daoActions, walletActions } from '../entity/actions.js';
import type { DaoState, Initiative } from '../entity/actions.js';
import type { EntityId, SignerIdx } from '../types/primitives.js';
import { signer } from '../types/primitives.js';
import type { Protocol } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityTx, OutboxMsg } from '../types/state.js';
import type { WalletOp } from './wallet.js';
import { WalletProtocol } from './wallet.js';

export type { Initiative, DaoState } from '../entity/actions.js';

// ============================================================================
// DAO Operations
// ============================================================================

export type DaoOp = WalletOp 
  | { readonly type: 'createInitiative'; readonly title: string; readonly description: string; readonly author: SignerIdx; readonly actions: readonly EntityTx[] }
  | { readonly type: 'voteInitiative'; readonly initiativeId: string; readonly support: boolean; readonly voter: SignerIdx }
  | { readonly type: 'executeInitiative'; readonly initiativeId: string; readonly actions: readonly EntityTx[] };

// ============================================================================
// Transaction Parsing - Convert raw transactions to typed operations
// ============================================================================

const parseTransaction = (tx: EntityTx): Result<DaoOp> => {
  const walletResult = WalletProtocol.validateTx(tx);
  if (walletResult.ok) return walletResult;

  switch (tx.op) {
    case 'createInitiative': return parseCreateInitiative(tx);
    case 'voteInitiative': return parseVote(tx);
    case 'executeInitiative': return parseExecute(tx);
    default: return Err(`Unknown DAO operation: ${tx.op}`);
  }
};

const parseCreateInitiative = (tx: EntityTx): Result<DaoOp> => {
  const { title, description, author, actions } = tx.data;
  if (!title || typeof title !== 'string') return Err('Initiative requires a title');
  if (!description || typeof description !== 'string') return Err('Initiative requires a description');
  if (typeof author !== 'number') return Err('Initiative requires valid author');
  if (!Array.isArray(actions) || actions.length === 0) return Err('Initiative requires at least one action');
  return Ok({ type: 'createInitiative', title, description, author: signer(author), actions });
};

const parseVote = (tx: EntityTx): Result<DaoOp> => {
  const { initiativeId, support, voter } = tx.data;
  if (!initiativeId || typeof initiativeId !== 'string') return Err('Vote requires initiative ID');
  if (typeof support !== 'boolean') return Err('Vote requires boolean support value');
  if (typeof voter !== 'number') return Err('Vote requires valid voter');
  return Ok({ type: 'voteInitiative', initiativeId, support, voter: signer(voter) });
};

const parseExecute = (tx: EntityTx): Result<DaoOp> => {
  const { initiativeId, actions } = tx.data;
  if (!initiativeId || typeof initiativeId !== 'string') return Err('Execute requires initiative ID');
  if (!Array.isArray(actions)) return Err('Execute requires actions array');
  return Ok({ type: 'executeInitiative', initiativeId, actions });
};

// ============================================================================
// Apply Operations - Execute validated operations using actions
// ============================================================================

const applyOperation = (state: DaoState, op: DaoOp, tx: EntityTx): Result<DaoState> => {
  if (isWalletOperation(op)) {
    return WalletProtocol.applyTx(state, op as WalletOp, tx) as Result<DaoState>;
  }

  switch (op.type) {
    case 'createInitiative': {
      const result = daoActions.createInitiative.validate(state, op);
      return result.ok ? Ok(daoActions.createInitiative.execute(state, result.value)) : result;
    }
    case 'voteInitiative': {
      const result = daoActions.vote.validate(state, op);
      return result.ok ? Ok(daoActions.vote.execute(state, result.value)) : result;
    }
    case 'executeInitiative': {
      const result = daoActions.executeInitiative.validate(state, op);
      return result.ok ? Ok(daoActions.executeInitiative.execute(state, result.value)) : result;
    }
    default: // @ts-expect-error - Exhaustive check
      return Err(`Unknown DAO operation: ${op.type}`);
  }
};

const isWalletOperation = (op: DaoOp): op is WalletOp => op.type === 'transfer' || op.type === 'burn' || op.type === 'credit';

// ============================================================================
// Generate Messages - Create follow-up messages for operations
// ============================================================================

const generateMessages = (entityId: EntityId, op: DaoOp): readonly OutboxMsg[] => {
  if (isWalletOperation(op)) {
    return WalletProtocol.generateMessages!(entityId, op as WalletOp);
  }
  if (op.type === 'executeInitiative' && daoActions.executeInitiative.generateMessages) {
    return daoActions.executeInitiative.generateMessages(entityId, op);
  }
  return [];
};

// ============================================================================
// Protocol Definition
// ============================================================================

export const DaoProtocol: Protocol<DaoState, DaoOp> = {
  name: 'dao',
  validateTx: parseTransaction,
  applyTx: applyOperation,
  generateMessages
};

export const createDaoState = (balance: bigint = 0n, memberCount: number = 1, voteThreshold: number = 66): DaoState => ({
  balance, nonce: 0, initiatives: new Map(), memberCount, voteThreshold
});