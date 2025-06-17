// ============================================================================
// entity/blocks.ts - Block creation and consensus that reads like English
// ============================================================================

import type { BlockHash, BlockHeight, EntityId, SignerIdx } from '../types/primitives.js';
import { height } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
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
  newState: any;
  executedTransactions: ExecutedTransaction[];
  failedTransactions: FailedTransaction[];
  messages: OutboxMsg[];
};

export type ExecutedTransaction = {
  transaction: EntityTx;
  result: any;
};

export type FailedTransaction = {
  transaction: EntityTx;
  error: string;
};

export type Quorum = {
  members: readonly SignerIdx[];
  threshold: number; // As percentage (e.g., 66 for 2/3)
};

// ============================================================================
// Block Creation and Management
// ============================================================================

export const block = {
  // Create a new block proposal from pending transactions
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
  
  // Add an approval to the block
  approve: (block: ProposedBlock, signer: SignerIdx): ProposedBlock => ({
    ...block,
    approvals: new Set([...block.approvals, signer])
  }),
  
  // Check if block has enough approvals for consensus
  hasConsensus: (block: ProposedBlock, quorum: Quorum): boolean => {
    const approvalCount = block.approvals.size;
    const requiredApprovals = calculateRequiredApprovals(quorum);
    return approvalCount >= requiredApprovals;
  },
  
  // Check if a specific signer has approved
  hasApprovalFrom: (block: ProposedBlock, signer: SignerIdx): boolean => {
    return block.approvals.has(signer);
  },
  
  // Get the next block height
  nextHeight: (current: BlockHeight): BlockHeight => {
    return height(Number(current) + 1);
  }
};

// ============================================================================
// Block Execution - Where transactions become reality
// ============================================================================

export const execute = {
  // Execute all transactions in a block
  block: (
    currentState: any,
    block: ProposedBlock,
    entityId: EntityId,
    protocol: any // Will be properly typed with protocol
  ): BlockExecutionResult => {
    let state = currentState;
    const executed: ExecutedTransaction[] = [];
    const failed: FailedTransaction[] = [];
    const messages: OutboxMsg[] = [];
    
    for (const transaction of block.txs) {
      const result = execute.transaction(state, transaction, protocol, entityId);
      
      if (result.ok) {
        state = result.value.newState;
        executed.push({
          transaction,
          result: result.value
        });
        
        // Collect any messages generated
        if (result.value.messages) {
          messages.push(...result.value.messages);
        }
      } else {
        failed.push({
          transaction,
          error: result.error
        });
      }
    }
    
    return {
      newState: state,
      executedTransactions: executed,
      failedTransactions: failed,
      messages
    };
  },
  
  // Execute a single transaction
  transaction: (
    state: any,
    transaction: EntityTx,
    protocol: any,
    entityId: EntityId
  ): Result<{ newState: any; messages?: OutboxMsg[] }> => {
    // Check nonce if applicable
    if (transactionRequiresNonce(transaction) && stateHasNonce(state)) {
      const expectedNonce = state.nonce + 1;
      if (transaction.nonce !== expectedNonce) {
        return Err(`Invalid nonce: expected ${expectedNonce}, got ${transaction.nonce}`);
      }
    }
    
    // Validate transaction format
    const validation = protocol.validateTx(transaction);
    if (!validation.ok) {
      return Err(validation.error);
    }
    
    // Apply transaction to state
    const application = protocol.applyTx(state, validation.value, transaction);
    if (!application.ok) {
      return Err(application.error);
    }
    
    // Generate any follow-up messages
    const messages = protocol.generateMessages
      ? protocol.generateMessages(entityId, validation.value)
      : [];
    
    return Ok({
      newState: application.value,
      messages
    });
  }
};

// ============================================================================
// Block Validation Helpers
// ============================================================================

export const validate = {
  // Check if block height is sequential
  heightIsSequential: (block: ProposedBlock, currentHeight: BlockHeight): boolean => {
    return Number(block.height) === Number(currentHeight);
  },
  
  // Check if block hash matches content
  hashMatchesContent: (block: ProposedBlock, entityId: EntityId, state: any): boolean => {
    const computedHash = computeBlockHash(entityId, block.height, state, block.txs);
    return computedHash === block.hash;
  },
  
  // Check if proposer is valid for this height
  proposerIsValid: (block: ProposedBlock, expectedProposer: SignerIdx): boolean => {
    return block.proposer === expectedProposer;
  },
  
  // Check if block has expired
  hasExpired: (block: ProposedBlock, currentTime: number, timeoutMs: number): boolean => {
    return (currentTime - block.timestamp) > timeoutMs;
  }
};

// ============================================================================
// Block State Transitions
// ============================================================================

export const transition = {
  // Move entity to proposed state with block
  toProposed: (entity: EntityState, block: ProposedBlock): EntityState => ({
    ...entity,
    stage: 'proposed',
    proposal: block,
    mempool: [] // Clear mempool as transactions are now in proposal
  }),
  
  // Move entity to committing state
  toCommitting: (entity: EntityState, block: ProposedBlock): EntityState => ({
    ...entity,
    stage: 'committing',
    proposal: block
  }),
  
  // Finalize block and return to idle
  toIdle: (
    entity: EntityState,
    newState: any,
    blockHash: BlockHash,
    failedTransactions: EntityTx[]
  ): EntityState => ({
    ...entity,
    stage: 'idle',
    data: newState,
    height: block.nextHeight(entity.height),
    proposal: undefined,
    lastBlockHash: blockHash,
    mempool: failedTransactions // Re-queue failed transactions
  }),
  
  // Recover from timeout
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

const transactionRequiresNonce = (tx: EntityTx): boolean => {
  return tx.nonce !== undefined;
};

const stateHasNonce = (state: any): state is { nonce: number } => {
  return isNonced(state);
};

// ============================================================================
// Block Description Helpers
// ============================================================================

export const describeBlock = {
  summary: (block: ProposedBlock): string => {
    return `Block #${block.height} with ${block.txs.length} transactions`;
  },
  
  approvals: (block: ProposedBlock): string => {
    return `${block.approvals.size} approvals from signers: ${Array.from(block.approvals).join(', ')}`;
  },
  
  transactions: (block: ProposedBlock): string[] => {
    return block.txs.map(tx => describe.transaction(tx));
  },
  
  executionResult: (result: BlockExecutionResult): string => {
    return `Executed ${result.executedTransactions.length} transactions, ` +
           `${result.failedTransactions.length} failed, ` +
           `${result.messages.length} messages generated`;
  }
};