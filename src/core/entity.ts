import type {
  BlockHash,
  EntityState,
  EntityInput,
  EntityMeta,
  EntityTx,
  OutboxMsg,
  ProcessingError,
  Result,
  SignerIdx,
  BlockHeight,
  ProposedBlock,
  EntityId
} from '../types';
import { Err, Ok, toBlockHeight, toEntityId } from '../types';
import { computeHash } from '../utils/hash';
import { proposer, hasQuorum } from './quorum';

// Re-export quorum utilities for backward compatibility
export { proposer as getProposer, hasQuorum } from './quorum';

/**
 * Narrowed, validated commands extracted from EntityInput + signer + meta
 */
export type ValidatedCmd =
  | { type: 'AddTx'; tx: EntityTx }
  | { type: 'ProposeBlock'; txs: EntityTx[]; hash: BlockHash; proposer: SignerIdx }
  | { type: 'ApproveBlock'; hash: BlockHash; approver: SignerIdx }
  | { type: 'CommitBlock'; hash: BlockHash; committer: SignerIdx };

/**
 * Check if proposal has timed out
 */
const isTimedOut = (timestamp: number, timeoutMs: number = 30000): boolean => {
  return Date.now() - timestamp > timeoutMs;
};

/**
 * Compute deterministic hash for a block
 */
export const computeEntityBlockHash = (
  entityId: EntityId,
  height: BlockHeight,
  state: any,
  txs: EntityTx[]
): BlockHash => {
  return computeHash({ entityId, height, state, txs }) as BlockHash;
};

/**
 * Apply a transaction to the state
 */
const applyEntityTx = <T extends { balance: bigint }>(
  state: T,
  tx: EntityTx
): Result<T, ProcessingError> => {
  switch (tx.op) {
    case 'mint': {
      const amount = BigInt(tx.data.amount);
      if (amount <= 0n) {
        return Err({ type: 'validation', field: 'amount', message: 'Amount must be positive' });
      }
      return Ok({ ...state, balance: state.balance + amount });
    }
    
    case 'burn': {
      const amount = BigInt(tx.data.amount);
      if (amount <= 0n) {
        return Err({ type: 'validation', field: 'amount', message: 'Amount must be positive' });
      }
      if (state.balance < amount) {
        return Err({ type: 'validation', field: 'balance', message: 'Insufficient balance' });
      }
      return Ok({ ...state, balance: state.balance - amount });
    }
    
    case 'transfer': {
      const amount = BigInt(tx.data.amount);
      if (amount <= 0n) {
        return Err({ type: 'validation', field: 'amount', message: 'Amount must be positive' });
      }
      if (state.balance < amount) {
        return Err({ type: 'validation', field: 'balance', message: 'Insufficient balance' });
      }
      if (!tx.data.to) {
        return Err({ type: 'validation', field: 'to', message: 'Transfer requires recipient' });
      }
      return Ok({ ...state, balance: state.balance - amount });
    }
    
    default:
      return Err({ type: 'validation', field: 'op', message: `Unknown operation: ${tx.op}` });
  }
};

/**
 * Generate transfer messages from transactions
 */
const generateTransferMessages = (
  txs: EntityTx[],
  fromEntityId: EntityId
): OutboxMsg[] => {
  return txs
    .filter(tx => tx.op === 'transfer' && tx.data.to)
    .map(tx => ({
      from: fromEntityId,
      toEntity: toEntityId(tx.data.to),
      input: {
        type: 'add_tx' as const,
        tx: {
          op: 'mint',
          data: {
            amount: tx.data.amount,
            from: fromEntityId
          }
        }
      }
    }));
};

/**
 * Phase 1: Check if 'input' is allowed in this state by this signer/meta
 */
export function validateCmd<T>(
  state: EntityState<T>,
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta
): Result<ValidatedCmd, ProcessingError> {
  // Check for faulted state
  if (state.tag === 'Faulted') {
    return Err({ 
      type: 'validation', 
      field: 'state', 
      message: `Entity is faulted: ${state.reason}` 
    });
  }

  // Check timeout for proposed state
  if (state.tag === 'Proposed' && meta.timeoutMs) {
    if (isTimedOut(state.proposal.timestamp, meta.timeoutMs)) {
      // For timeout, we allow the transaction but will handle in apply
      // This allows the state to transition back to Idle
    }
  }

  switch (input.type) {
    case 'add_tx': {
      if (state.tag !== 'Idle') {
        return Err({ 
          type: 'validation', 
          field: 'state', 
          message: 'Can only add transactions in Idle state' 
        });
      }
      if (!meta.quorum.includes(signer)) {
        return Err({ 
          type: 'unauthorized', 
          signer, 
          entity: meta.id,
          message: 'Signer not in quorum'
        });
      }
      return Ok({ type: 'AddTx', tx: input.tx });
    }

    case 'propose_block': {
      if (state.tag !== 'Idle') {
        return Err({ 
          type: 'validation', 
          field: 'state', 
          message: 'Can only propose blocks in Idle state' 
        });
      }
      
      const expectedProposer = proposer(state.height, meta.quorum);
      if (signer !== expectedProposer) {
        return Err({ 
          type: 'unauthorized', 
          signer, 
          entity: meta.id,
          message: `Not the current proposer (expected: ${expectedProposer})`
        });
      }
      
      if (!input.txs || input.txs.length === 0) {
        return Err({ 
          type: 'validation', 
          field: 'txs', 
          message: 'No transactions to propose' 
        });
      }
      
      // Server now computes hash
      const hash = computeEntityBlockHash(meta.id, state.height, state.state, input.txs);
      
      return Ok({ 
        type: 'ProposeBlock', 
        txs: input.txs, 
        hash, 
        proposer: signer 
      });
    }

    case 'approve_block': {
      if (state.tag !== 'Proposed') {
        return Err({ 
          type: 'validation', 
          field: 'state', 
          message: 'Can only approve blocks in Proposed state' 
        });
      }
      
      const approver = input.from ?? signer;
      if (!meta.quorum.includes(approver)) {
        return Err({ 
          type: 'unauthorized', 
          signer: approver, 
          entity: meta.id,
          message: 'Approver not in quorum'
        });
      }
      
      if (state.proposal.hash !== input.hash) {
        return Err({ 
          type: 'validation', 
          field: 'hash', 
          message: 'Approval hash does not match proposal' 
        });
      }
      
      return Ok({ 
        type: 'ApproveBlock', 
        hash: input.hash, 
        approver 
      });
    }

    case 'commit_block': {
      if (state.tag !== 'Committing') {
        return Err({ 
          type: 'validation', 
          field: 'state', 
          message: 'Can only commit blocks in Committing state' 
        });
      }
      
      if (signer !== state.proposal.proposer) {
        return Err({ 
          type: 'unauthorized', 
          signer, 
          entity: meta.id,
          message: 'Only the original proposer can commit'
        });
      }
      
      if (state.proposal.hash !== input.hash) {
        return Err({ 
          type: 'validation', 
          field: 'hash', 
          message: 'Commit hash does not match proposal' 
        });
      }
      
      return Ok({ 
        type: 'CommitBlock', 
        hash: input.hash, 
        committer: signer 
      });
    }

    default:
      return Err({ 
        type: 'validation', 
        field: 'type', 
        message: `Unknown input type: ${(input as any).type}` 
      });
  }
}

/**
 * Phase 2: Given a validated command, produce new state + outgoing messages
 */
export function applyCmd<T extends { balance: bigint }>(
  state: EntityState<T>,
  cmd: ValidatedCmd,
  meta: EntityMeta,
  now: number = Date.now()
): [EntityState<T>, OutboxMsg[]] {
  // Handle timeout transitions first
  if (state.tag === 'Proposed' && meta.timeoutMs) {
    if (isTimedOut(state.proposal.timestamp, meta.timeoutMs)) {
      // Transition back to Idle, re-queue all transactions
      const requeuedTxs = [...state.proposal.txs, ...state.mempool];
      const idleState: EntityState<T> = {
        tag: 'Idle',
        height: state.height,
        state: state.state,
        mempool: requeuedTxs,
        lastBlockHash: state.lastBlockHash,
        lastProcessedHeight: state.lastProcessedHeight
      };
      // Now apply the command to the idle state
      return applyCmd(idleState, cmd, meta, now);
    }
  }

  switch (cmd.type) {
    case 'AddTx': {
      if (state.tag === 'Faulted') {
        return [state, []];
      }
      return [
        { ...state, mempool: [...state.mempool, cmd.tx] },
        []
      ];
    }

    case 'ProposeBlock': {
      if (state.tag === 'Faulted') {
        return [state, []];
      }
      
      const proposedBlock: ProposedBlock = {
        txs: cmd.txs,
        hash: cmd.hash,
        approves: new Set([cmd.proposer]),
        timestamp: now,
        proposer: cmd.proposer
      };

      // Single signer fast path
      if (meta.quorum.length === 1) {
        // Directly transition to Committing
        const committingState: EntityState<T> = {
          tag: 'Committing',
          height: state.height,
          state: state.state,
          mempool: state.mempool,
          proposal: proposedBlock,
          lastBlockHash: state.lastBlockHash,
          lastProcessedHeight: state.lastProcessedHeight
        };
        
        // Auto-commit for single signer
        const commitMsg: OutboxMsg = {
          from: meta.id,
          toEntity: meta.id,
          toSigner: cmd.proposer,
          input: { type: 'commit_block', hash: cmd.hash }
        };
        
        return [committingState, [commitMsg]];
      }

      // Multi-signer: transition to Proposed
      const proposedState: EntityState<T> = {
        tag: 'Proposed',
        height: state.height,
        state: state.state,
        mempool: state.mempool,
        proposal: proposedBlock,
        lastBlockHash: state.lastBlockHash,
        lastProcessedHeight: state.lastProcessedHeight
      };

      // Broadcast approval requests
      const approvalMsgs: OutboxMsg[] = meta.quorum
        .filter(signer => signer !== cmd.proposer)
        .map(signer => ({
          from: meta.id,
          toEntity: meta.id,
          toSigner: signer,
          input: { type: 'approve_block', hash: cmd.hash }
        }));

      return [proposedState, approvalMsgs];
    }

    case 'ApproveBlock': {
      if (state.tag !== 'Proposed') {
        // Should not happen due to validation, but be defensive
        return [state, []];
      }

      const approves = new Set(state.proposal.approves);
      approves.add(cmd.approver);
      const updatedProposal = { ...state.proposal, approves };

      // Check if quorum reached
      if (hasQuorum(approves, meta.quorum)) {
        // Transition to Committing
        const committingState: EntityState<T> = {
          tag: 'Committing',
          height: state.height,
          state: state.state,
          mempool: state.mempool,
          proposal: updatedProposal,
          lastBlockHash: state.lastBlockHash,
          lastProcessedHeight: state.lastProcessedHeight
        };

        // Send commit to original proposer
        const commitMsg: OutboxMsg = {
          from: meta.id,
          toEntity: meta.id,
          toSigner: state.proposal.proposer,
          input: { type: 'commit_block', hash: cmd.hash }
        };

        return [committingState, [commitMsg]];
      }

      // Not enough approvals yet
      const updatedState: EntityState<T> = {
        ...state,
        proposal: updatedProposal
      };

      return [updatedState, []];
    }

    case 'CommitBlock': {
      if (state.tag !== 'Committing') {
        // Should not happen due to validation, but be defensive
        return [state, []];
      }

      // Apply all transactions
      let newInnerState = state.state;
      const failedTxs: EntityTx[] = [];

      for (const tx of state.proposal.txs) {
        const result = applyEntityTx(newInnerState, tx);
        if (result.ok) {
          newInnerState = result.value;
        } else {
          failedTxs.push(tx);
        }
      }

      // Generate transfer messages
      const transferMsgs = generateTransferMessages(state.proposal.txs, meta.id);

      // Transition to Idle with updated state
      const nextHeight = toBlockHeight(Number(state.height) + 1);
      const idleState: EntityState<T> = {
        tag: 'Idle',
        height: nextHeight,
        state: newInnerState,
        mempool: [...failedTxs, ...state.mempool], // Re-queue failed txs
        lastBlockHash: cmd.hash,
        lastProcessedHeight: state.lastProcessedHeight
      };

      return [idleState, transferMsgs];
    }
  }
}

/**
 * Main state transition function
 * @deprecated Use validateCmd + applyCmd instead for better separation of concerns
 */
export function transitionEntity<T extends { balance: bigint }>(
  state: EntityState<T>,
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta,
  now: number = Date.now()
): Result<[EntityState<T>, OutboxMsg[]], ProcessingError> {
  const validationResult = validateCmd(state, input, signer, meta);
  if (!validationResult.ok) {
    return Err(validationResult.error);
  }
  
  const [newState, messages] = applyCmd(state, validationResult.value, meta, now);
  return Ok([newState, messages]);
}

/**
 * Format error for logging
 */
export const formatError = (error: ProcessingError): string => {
  switch (error.type) {
    case 'validation':
      return `Validation error on ${error.field}: ${error.message}`;
    case 'not_found':
      return `${error.resource} not found: ${error.id}`;
    case 'unauthorized':
      return error.message 
        ? `Unauthorized: ${error.message}`
        : `Signer ${error.signer} unauthorized for entity ${error.entity}`;
  }
};