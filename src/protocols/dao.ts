// ============================================================================
// protocols/dao.ts - DAO protocol that reads like English
// ============================================================================

import type { DaoState } from '../entity/actions.js';
import { daoActions } from '../entity/actions.js';
import type { EntityId, SignerIdx } from '../types/primitives.js';
import { signer } from '../types/primitives.js';
import type { Protocol } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityTx, OutboxMsg } from '../types/state.js';
import type { WalletOp } from './wallet.js';
import { WalletProtocol } from './wallet.js';

// Re-export types from actions
export type { DaoState, Initiative } from '../entity/actions.js';

// ============================================================================
// DAO Operations
// ============================================================================

export type DaoOp = WalletOp 
  | { type: 'createInitiative'; title: string; description: string; author: SignerIdx; actions: EntityTx[] }
  | { type: 'voteInitiative'; initiativeId: string; support: boolean; voter: SignerIdx }
  | { type: 'executeInitiative'; initiativeId: string; actions: EntityTx[] };

// ============================================================================
// Transaction Parsing - Convert raw transactions to typed operations
// ============================================================================

const parseTransaction = (tx: EntityTx): Result<DaoOp> => {
  console.log('[DEBUG] DAO parseTransaction:', { op: tx.op, data: tx.data });
  
  // First check if it's a wallet operation
  const walletResult = WalletProtocol.validateTx(tx);
  if (walletResult.ok) {
    return walletResult;
  }

  // Then parse DAO-specific operations
  switch (tx.op) {
    case 'createInitiative':
      return parseCreateInitiative(tx);
      
    case 'voteInitiative':
      console.log('[DEBUG] Parsing vote transaction');
      return parseVote(tx);
      
    case 'executeInitiative':
      return parseExecute(tx);
      
    default:
      return Err(`Unknown DAO operation: ${tx.op}`);
  }
};

const parseCreateInitiative = (tx: EntityTx): Result<DaoOp> => {
  const { title, description, author, actions } = tx.data;
  
  if (!title || typeof title !== 'string') {
    return Err('Initiative requires a title');
  }
  if (!description || typeof description !== 'string') {
    return Err('Initiative requires a description');
  }
  if (typeof author !== 'number') {
    return Err('Initiative requires valid author');
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    return Err('Initiative requires at least one action');
  }

  return Ok({
    type: 'createInitiative',
    title,
    description,
    author: signer(author),
    actions
  });
};

const parseVote = (tx: EntityTx): Result<DaoOp> => {
  const { initiativeId, support, voter } = tx.data;
  
  if (!initiativeId || typeof initiativeId !== 'string') {
    return Err('Vote requires initiative ID');
  }
  if (typeof support !== 'boolean') {
    return Err('Vote requires boolean support value');
  }
  if (typeof voter !== 'number') {
    return Err('Vote requires valid voter');
  }

  return Ok({
    type: 'voteInitiative',
    initiativeId,
    support,
    voter: signer(voter)
  });
};

const parseExecute = (tx: EntityTx): Result<DaoOp> => {
  const { initiativeId, actions } = tx.data;
  
  if (!initiativeId || typeof initiativeId !== 'string') {
    return Err('Execute requires initiative ID');
  }
  if (!Array.isArray(actions)) {
    return Err('Execute requires actions array');
  }

  return Ok({
    type: 'executeInitiative',
    initiativeId,
    actions
  });
};

// ============================================================================
// Apply Operations - Execute validated operations using actions
// ============================================================================

const applyOperation = (state: DaoState, op: DaoOp, tx?: EntityTx): Result<DaoState> => {
  // Handle wallet operations
  if (isWalletOperation(op)) {
    return WalletProtocol.applyTx(state, op as WalletOp, tx!) as Result<DaoState>;
  }

  // Handle DAO operations using actions
  switch (op.type) {
    case 'createInitiative': {
      const result = daoActions.createInitiative.validate(state, {
        title: op.title,
        description: op.description,
        author: op.author,
        actions: op.actions
      });
      
      if (!result.ok) return result;
      
      return Ok(daoActions.createInitiative.execute(state, result.value));
    }

    case 'voteInitiative': {
      console.log('[DEBUG] DAO applyOperation: voteInitiative', {
        initiativeId: op.initiativeId,
        support: op.support,
        voter: op.voter
      });
      
      const result = daoActions.vote.validate(state, {
        initiativeId: op.initiativeId,
        support: op.support,
        voter: op.voter
      });
      
      if (!result.ok) {
        console.log('[DEBUG] Vote validation failed:', result.error);
        return result;
      }
      
      const newState = daoActions.vote.execute(state, result.value);
      console.log('[DEBUG] After vote execution, initiative count:', newState.initiatives.size);
      
      return Ok(newState);
    }

    case 'executeInitiative': {
      const result = daoActions.executeInitiative.validate(state, {
        initiativeId: op.initiativeId,
        actions: op.actions
      });
      
      if (!result.ok) return result;
      
      return Ok(daoActions.executeInitiative.execute(state, result.value));
    }

    default:
      return Err(`Unknown DAO operation`);
  }
};

const isWalletOperation = (op: DaoOp): boolean => {
  return op.type === 'transfer' || op.type === 'burn' || op.type === 'credit';
};

// ============================================================================
// Generate Messages - Create follow-up messages for operations
// ============================================================================

const generateMessages = (entityId: EntityId, op: DaoOp): readonly OutboxMsg[] => {
  // Handle wallet operations
  if (isWalletOperation(op)) {
    return WalletProtocol.generateMessages!(entityId, op as WalletOp);
  }

  // Handle DAO operations
  if (op.type === 'executeInitiative') {
    return daoActions.executeInitiative.generateMessages!(entityId, {
      initiativeId: op.initiativeId,
      actions: op.actions
    });
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

// ============================================================================
// Helper Functions
// ============================================================================

export const createDaoState = (
  balance: bigint = 0n,
  memberCount: number = 1,
  voteThreshold: number = 66
): DaoState => ({
  balance,
  nonce: 0,
  initiatives: new Map(),
  memberCount,
  voteThreshold
});