// ============================================================================
// protocols/dao.ts - DAO protocol implementation extending wallet
// ============================================================================

import type { EntityId, SignerIdx } from '../types/primitives.js';
import { id, signer } from '../types/primitives.js';
import type { Protocol } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityTx, OutboxMsg } from '../types/state.js';
import type { WalletState, WalletOp } from './wallet.js';
import { WalletProtocol } from './wallet.js';

// ============================================================================
// Types
// ============================================================================

export type Initiative = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly author: SignerIdx;
  readonly actions: readonly EntityTx[];
  readonly votes: Map<SignerIdx, boolean>;
  readonly status: 'active' | 'passed' | 'rejected' | 'executed';
  readonly createdAt: number;
  readonly executedAt?: number;
};

export type DaoState = WalletState & {
  readonly initiatives: Map<string, Initiative>;
  readonly memberCount: number;
  readonly voteThreshold: number; // Percentage (e.g., 66 for 2/3 majority)
};

export type DaoOp = WalletOp 
  | { readonly type: 'createInitiative'; readonly initiative: Omit<Initiative, 'id' | 'votes' | 'status' | 'createdAt' | 'executedAt'> }
  | { readonly type: 'voteInitiative'; readonly initiativeId: string; readonly support: boolean; readonly voter: SignerIdx }
  | { readonly type: 'executeInitiative'; readonly initiativeId: string; readonly actions: readonly EntityTx[] };

// ============================================================================
// Validation
// ============================================================================

const validateDaoTx = (tx: EntityTx): Result<DaoOp> => {
  // First check if it's a wallet operation
  const walletResult = WalletProtocol.validateTx(tx);
  if (walletResult.ok) {
    return walletResult;
  }

  // Then check DAO operations
  switch (tx.op) {
    case 'createInitiative': {
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
        initiative: {
          title,
          description,
          author: signer(author),
          actions
        }
      });
    }

    case 'voteInitiative': {
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
    }

    case 'executeInitiative': {
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
    }

    default:
      return Err(`Unknown DAO operation: ${tx.op}`);
  }
};

// ============================================================================
// State Transitions
// ============================================================================

const applyDaoOp = (state: DaoState, op: DaoOp, tx?: EntityTx): Result<DaoState> => {
  // Handle wallet operations
  if ('amount' in op) {
    const walletResult = WalletProtocol.applyTx(state, op as WalletOp, tx!);
    if (!walletResult.ok) return walletResult;
    
    return Ok({
      ...state,
      ...walletResult.value
    });
  }

  // Handle DAO operations
  switch (op.type) {
    case 'createInitiative': {
      const initiativeId = `init-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const initiative: Initiative = {
        id: initiativeId,
        ...op.initiative,
        votes: new Map(),
        status: 'active',
        createdAt: Date.now()
      };

      const newInitiatives = new Map(state.initiatives);
      newInitiatives.set(initiativeId, initiative);

      return Ok({
        ...state,
        initiatives: newInitiatives,
        nonce: state.nonce + 1
      });
    }

    case 'voteInitiative': {
      const initiative = state.initiatives.get(op.initiativeId);
      if (!initiative) {
        return Err('Initiative not found');
      }
      if (initiative.status !== 'active') {
        return Err('Initiative is not active');
      }
      if (initiative.votes.has(op.voter)) {
        return Err('Already voted on this initiative');
      }

      // Create new votes map with the new vote
      const newVotes = new Map(initiative.votes);
      newVotes.set(op.voter, op.support);

      // Check if threshold is reached
      const supportVotes = Array.from(newVotes.values()).filter(v => v).length;
      const votePercentage = (supportVotes / state.memberCount) * 100;
      const newStatus = votePercentage >= state.voteThreshold ? 'passed' : 'active';

      // Create updated initiative
      const updatedInitiative: Initiative = {
        ...initiative,
        votes: newVotes,
        status: newStatus
      };

      // Update initiatives map
      const newInitiatives = new Map(state.initiatives);
      newInitiatives.set(op.initiativeId, updatedInitiative);

      return Ok({
        ...state,
        initiatives: newInitiatives,
        nonce: state.nonce + 1
      });
    }

    case 'executeInitiative': {
      const initiative = state.initiatives.get(op.initiativeId);
      if (!initiative) {
        return Err('Initiative not found');
      }
      if (initiative.status !== 'passed') {
        return Err('Initiative has not passed');
      }

      // Verify actions match
      if (JSON.stringify(initiative.actions) !== JSON.stringify(op.actions)) {
        return Err('Actions do not match initiative');
      }

      // Update initiative status
      const updatedInitiative: Initiative = {
        ...initiative,
        status: 'executed',
        executedAt: Date.now()
      };

      const newInitiatives = new Map(state.initiatives);
      newInitiatives.set(op.initiativeId, updatedInitiative);

      return Ok({
        ...state,
        initiatives: newInitiatives,
        nonce: state.nonce + 1
      });
    }

    default:
      // @ts-expect-error - Exhaustive check
      return Err(`Unknown DAO operation: ${op.type}`);
  }
};

// ============================================================================
// Message Generation
// ============================================================================

const generateDaoMessages = (from: EntityId, op: DaoOp): readonly OutboxMsg[] => {
  // Wallet operations might generate messages
  if ('amount' in op && op.type === 'transfer') {
    return WalletProtocol.generateMessages!(from, op as WalletOp);
  }

  // Execute initiative generates messages for each action
  if (op.type === 'executeInitiative') {
    return op.actions.map(tx => ({
      from,
      to: from, // Actions are sent back to self
      command: {
        type: 'addTx',
        tx
      }
    }));
  }

  return [];
};

// ============================================================================
// Protocol Definition
// ============================================================================

export const DaoProtocol: Protocol<DaoState, DaoOp> = {
  name: 'dao',
  validateTx: validateDaoTx,
  applyTx: applyDaoOp,
  generateMessages: generateDaoMessages
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