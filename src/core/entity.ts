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
  EntityId
} from '../types';
import { Err, Ok, toEntityId } from '../types';
import { computeHash } from '../utils/hash';
import { proposer } from './quorum';
import { entityReducer } from './entityReducers';

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
 * Phase 2: Apply a validated command to mutate entity state.
 * 
 * This function performs the actual state transitions and generates
 * any necessary outbox messages. It assumes the command has already
 * been validated by validateCmd.
 * 
 * Key behaviors:
 * - Handles timeout transitions before applying commands
 * - Delegates to modular reducers for each command type
 * - Generates consensus messages (approve_block, commit_block)
 * - Routes transfers through the messaging system
 * 
 * The function is deterministic - the same inputs always produce
 * the same outputs, which is critical for consensus.
 * 
 * @param state - Current entity state
 * @param cmd - Pre-validated command from validateCmd
 * @param meta - Entity metadata
 * @param now - Current timestamp for timeout checks
 * @returns Tuple of [newState, outboxMessages]
 */
export function applyCmd<T extends { balance: bigint }>(
  state: EntityState<T>,
  cmd: ValidatedCmd,
  meta: EntityMeta,
  now: number = Date.now()
): [EntityState<T>, OutboxMsg[]] {
  // Use the new reducer for most logic
  const [baseState, messages] = entityReducer(state, cmd, meta, now);
  
  // Special handling for CommitBlock to apply transactions
  // This is kept here for backward compatibility but should eventually move to protocol layer
  if (cmd.type === 'CommitBlock' && state.tag === 'Committing') {
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

    // Update the state from reducer with applied transactions
    // baseState should be Idle at this point after CommitBlock
    if (baseState.tag === 'Idle') {
      const updatedState: EntityState<T> = {
        ...baseState,
        state: newInnerState,
        mempool: [...failedTxs, ...baseState.mempool]
      };
      return [updatedState, [...messages, ...transferMsgs]];
    }
    
    // Fallback - should not happen
    return [baseState as EntityState<T>, [...messages, ...transferMsgs]];
  }
  
  return [baseState as EntityState<T>, messages];
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