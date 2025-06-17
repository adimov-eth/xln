// ============================================================================
// entity/blocks.ts - Block creation and consensus that reads like English
// ============================================================================

import type { BlockHash, BlockHeight, EntityId, SignerIdx } from '../types/primitives.js';
import { height } from '../types/primitives.js';
import type { Protocol } from '../types/protocol.js';
import { isNonced } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityState, EntityTx, ProposedBlock, OutboxMsg } from '../types/state.js';
import { computeBlockHash } from '../utils/hash.js';
import { describe } from './transactions.js';

// ============================================================================
// Block Types
// ============================================================================

export type BlockExecutionResult = {
  readonly newState: any;
  readonly executedTransactions: readonly ExecutedTransaction[];
  readonly failedTransactions: readonly FailedTransaction[];
  readonly messages: readonly OutboxMsg[];
};

export type ExecutedTransaction = {
  readonly transaction: EntityTx;
  readonly result: any;
};

export type FailedTransaction = {
  readonly transaction: EntityTx;
  readonly error: string;
};

export type Quorum = {
  readonly members: readonly SignerIdx[];
  readonly threshold: number; // As percentage (e.g., 66 for 2/3)
};

// ============================================================================
// Block Creation and Management
// ============================================================================

export const block = {
  create: (
    entity: EntityState,
    proposer: SignerIdx,
    timestamp: number
  ): ProposedBlock => ({
    txs: entity.mempool,
    hash: computeBlockHash(entity.id, entity.height, entity.data, entity.mempool),
    height: entity.height,
    proposer,
    approvals: new Set([proposer]),
    timestamp
  }),
  
  approve: (block: ProposedBlock, signer: SignerIdx): ProposedBlock => ({
    ...block,
    approvals: new Set([...block.approvals, signer])
  }),
  
  hasConsensus: (block: ProposedBlock, quorum: Quorum): boolean => {
    const approvalCount = block.approvals.size;
    const requiredApprovals = calculateRequiredApprovals(quorum);
    return approvalCount >= requiredApprovals;
  },
  
  hasApprovalFrom: (block: ProposedBlock, signer: SignerIdx): boolean => {
    return block.approvals.has(signer);
  },
  
  nextHeight: (current: BlockHeight): BlockHeight => {
    return height(Number(current) + 1);
  }
};

// ============================================================================
// Block Execution - Where transactions become reality
// ============================================================================

export const execute = {
  block: (
    currentState: any,
    block: ProposedBlock,
    entityId: EntityId,
    protocol: Protocol<any, any>
  ): BlockExecutionResult => {
    let state = currentState;
    const executed: ExecutedTransaction[] = [];
    const failed: FailedTransaction[] = [];
    const messages: OutboxMsg[] = [];
    
    for (const transaction of block.txs) {
      const result = execute.transaction(state, transaction, protocol, entityId);
      
      if (result.ok) {
        state = result.value.newState;
        executed.push({ transaction, result: result.value });
        if (result.value.messages) {
          messages.push(...result.value.messages);
        }
      } else {
        failed.push({ transaction, error: result.error });
      }
    }
    
    return {
      newState: state,
      executedTransactions: executed,
      failedTransactions: failed,
      messages
    };
  },
  
  transaction: (
    state: any,
    transaction: EntityTx,
    protocol: Protocol<any, any>,
    entityId: EntityId
  ): Result<{ newState: any; messages?: readonly OutboxMsg[] }> => {
    if (transactionRequiresNonce(transaction) && stateHasNonce(state)) {
      const expectedNonce = state.nonce + 1;
      if (transaction.nonce !== expectedNonce) {
        return Err(`Invalid nonce: expected ${expectedNonce}, got ${transaction.nonce}`);
      }
    }
    
    const validation = protocol.validateTx(transaction);
    if (!validation.ok) return Err(validation.error);
    
    const application = protocol.applyTx(state, validation.value, transaction);
    if (!application.ok) return Err(application.error);
    
    const messages = protocol.generateMessages
      ? protocol.generateMessages(entityId, validation.value)
      : [];
    
    return Ok({ newState: application.value, messages });
  }
};

// ============================================================================
// Block Validation Helpers
// ============================================================================

export const validate = {
  heightIsSequential: (block: ProposedBlock, currentHeight: BlockHeight): boolean => {
    return Number(block.height) === Number(currentHeight);
  },
  
  hashMatchesContent: (block: ProposedBlock, entityId: EntityId, state: any): boolean => {
    const computedHash = computeBlockHash(entityId, block.height, state, block.txs);
    return computedHash === block.hash;
  },
  
  proposerIsValid: (block: ProposedBlock, expectedProposer: SignerIdx): boolean => {
    return block.proposer === expectedProposer;
  },
  
  hasExpired: (block: ProposedBlock, currentTime: number, timeoutMs: number): boolean => {
    return (currentTime - block.timestamp) > timeoutMs;
  }
};

// ============================================================================
// Block State Transitions
// ============================================================================

export const transition = {
  toProposed: (entity: EntityState, block: ProposedBlock): EntityState => ({
    ...entity,
    stage: 'proposed',
    proposal: block,
    mempool: []
  }),
  
  toCommitting: (entity: EntityState, block: ProposedBlock): EntityState => ({
    ...entity,
    stage: 'committing',
    proposal: block
  }),
  
  toIdle: (
    entity: EntityState,
    newState: any,
    blockHash: BlockHash,
    failedTransactions: readonly EntityTx[]
  ): EntityState => ({
    ...entity,
    stage: 'idle',
    data: newState,
    height: block.nextHeight(entity.height),
    proposal: undefined,
    lastBlockHash: blockHash,
    mempool: failedTransactions
  }),
  
  fromTimeout: (entity: EntityState): EntityState => ({
    ...entity,
    stage: 'idle',
    proposal: undefined,
    mempool: entity.proposal 
      ? [...entity.proposal.txs, ...entity.mempool] 
      : entity.mempool
  })
};

// ============================================================================
// Helper Functions
// ============================================================================

const calculateRequiredApprovals = (quorum: Quorum): number => {
  return Math.ceil(quorum.members.length * quorum.threshold / 100);
};

const transactionRequiresNonce = (tx: EntityTx): boolean => tx.nonce !== undefined;
const stateHasNonce = (state: any): state is { nonce: number } => isNonced(state);

// ============================================================================
// Block Description Helpers
// ============================================================================

export const describeBlock = {
  summary: (block: ProposedBlock): string => `Block #${block.height} with ${block.txs.length} transactions`,
  approvals: (block: ProposedBlock): string => `${block.approvals.size} approvals from signers: ${Array.from(block.approvals).join(', ')}`,
  transactions: (block: ProposedBlock): string[] => block.txs.map(tx => describe.transaction(tx)),
  executionResult: (result: BlockExecutionResult): string => `Executed ${result.executedTransactions.length} txs, ${result.failedTransactions.length} failed, ${result.messages.length} messages generated`
};