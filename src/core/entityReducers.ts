import type {
  EntityState,
  EntityMeta,
  SignerIdx,
  OutboxMsg
} from '../types';
import { toBlockHeight } from '../types';
import type { ValidatedCmd } from './entity';
import { hasQuorum } from './quorum';
import { processBlockTransactions } from '../protocols/consensus';

/**
 * Command reducer context
 */
export type ReducerContext<T> = {
  readonly state: EntityState<T>;
  readonly cmd: ValidatedCmd;
  readonly meta: EntityMeta;
  readonly now: number;
};

/**
 * Command reducer result
 */
export type ReducerResult<T> = [EntityState<T>, OutboxMsg[]];

/**
 * Command reducer function type
 */
export type CommandReducer<T, C extends ValidatedCmd = ValidatedCmd> = (
  ctx: ReducerContext<T> & { cmd: C }
) => ReducerResult<T>;

/**
 * Handle timeout transitions for proposed blocks.
 * 
 * When a block proposal times out, the entity transitions back to Idle state
 * and all transactions (both proposed and pending) are re-queued in the mempool.
 * This ensures no transactions are lost during timeout scenarios.
 * 
 * @param state - Current entity state
 * @param meta - Entity metadata containing timeout configuration
 * @param now - Current timestamp for timeout calculation
 * @returns New state if timeout occurred, null otherwise
 */
const handleTimeout = <T>(
  state: EntityState<T>,
  meta: EntityMeta,
  now: number
): EntityState<T> | null => {
  if (state.tag === 'Proposed' && meta.timeoutMs) {
    const isTimedOut = now - state.proposal.timestamp > meta.timeoutMs;
    if (isTimedOut) {
      // Transition back to Idle, re-queue all transactions
      const requeuedTxs = [...state.proposal.txs, ...state.mempool];
      return {
        tag: 'Idle',
        height: state.height,
        state: state.state,
        mempool: requeuedTxs,
        lastBlockHash: state.lastBlockHash,
        lastProcessedHeight: state.lastProcessedHeight
      };
    }
  }
  return null;
};

/**
 * AddTx command reducer
 */
export const addTxReducer: CommandReducer<any, Extract<ValidatedCmd, { type: 'AddTx' }>> = (ctx) => {
  const { state, cmd } = ctx;
  
  if (state.tag === 'Faulted') {
    return [state, []];
  }
  
  return [
    { ...state, mempool: [...state.mempool, cmd.tx] },
    []
  ];
};

/**
 * ProposeBlock command reducer
 */
export const proposeBlockReducer: CommandReducer<any, Extract<ValidatedCmd, { type: 'ProposeBlock' }>> = (ctx) => {
  const { state, cmd, meta, now } = ctx;
  
  if (state.tag === 'Faulted') {
    return [state, []];
  }
  
  const proposedBlock = {
    txs: cmd.txs,
    hash: cmd.hash,
    approves: new Set([cmd.proposer]),
    timestamp: now,
    proposer: cmd.proposer
  };

  // Single signer fast path
  if (meta.quorum.length === 1) {
    const committingState: EntityState<any> = {
      tag: 'Committing',
      height: state.height,
      state: state.state,
      mempool: state.mempool,
      proposal: proposedBlock,
      lastBlockHash: state.lastBlockHash,
      lastProcessedHeight: state.lastProcessedHeight
    };
    
    const commitMsg: OutboxMsg = {
      from: meta.id,
      toEntity: meta.id,
      toSigner: cmd.proposer,
      input: { type: 'commit_block', hash: cmd.hash }
    };
    
    return [committingState, [commitMsg]];
  }

  // Multi-signer: transition to Proposed
  const proposedState: EntityState<any> = {
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
    .filter((signer: SignerIdx) => signer !== cmd.proposer)
    .map((signer: SignerIdx) => ({
      from: meta.id,
      toEntity: meta.id,
      toSigner: signer,
      input: { type: 'approve_block', hash: cmd.hash }
    }));

  return [proposedState, approvalMsgs];
};

/**
 * ApproveBlock command reducer
 */
export const approveBlockReducer: CommandReducer<any, Extract<ValidatedCmd, { type: 'ApproveBlock' }>> = (ctx) => {
  const { state, cmd, meta } = ctx;
  
  if (state.tag !== 'Proposed') {
    return [state, []];
  }

  const approves = new Set(state.proposal.approves);
  approves.add(cmd.approver);
  const updatedProposal = { ...state.proposal, approves };

  // Check if quorum reached
  if (hasQuorum(approves, meta.quorum)) {
    // Transition to Committing
    const committingState: EntityState<any> = {
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
  const updatedState: EntityState<any> = {
    ...state,
    proposal: updatedProposal
  };

  return [updatedState, []];
};

/**
 * CommitBlock command reducer
 * Applies transactions using the protocol system
 */
export const commitBlockReducer: CommandReducer<any, Extract<ValidatedCmd, { type: 'CommitBlock' }>> = (ctx) => {
  const { state, cmd, meta } = ctx;
  
  if (state.tag !== 'Committing') {
    return [state, []];
  }

  // Apply transactions through protocol system
  const [newBusinessState, messages] = processBlockTransactions(
    state.proposal.txs,
    state.state,
    meta.id
  );

  // Transition to next height with updated state
  const nextHeight = toBlockHeight(Number(state.height) + 1);
  const idleState: EntityState<any> = {
    tag: 'Idle',
    height: nextHeight,
    state: newBusinessState,
    mempool: state.mempool,
    lastBlockHash: cmd.hash,
    lastProcessedHeight: state.lastProcessedHeight
  };

  return [idleState, messages];
};

/**
 * Main reducer dispatcher with automatic timeout handling.
 * 
 * This is the central dispatch function that:
 * 1. Checks for timeouts before processing any command
 * 2. Routes commands to appropriate sub-reducers
 * 3. Re-runs itself if a timeout transition occurred
 * 
 * The timeout check ensures that stale proposals don't block the entity
 * from making progress. If a timeout is detected, the state transitions
 * to Idle and the command is processed against the new state.
 * 
 * @param state - Current entity state
 * @param cmd - Validated command to process
 * @param meta - Entity metadata
 * @param now - Current timestamp (defaults to Date.now())
 * @returns Tuple of [newState, outboxMessages]
 */
export const entityReducer = <T>(
  state: EntityState<T>,
  cmd: ValidatedCmd,
  meta: EntityMeta,
  now: number = Date.now()
): ReducerResult<T> => {
  // Handle timeout first
  const timedOutState = handleTimeout(state, meta, now);
  if (timedOutState) {
    // Re-run reducer with timed-out state
    return entityReducer(timedOutState, cmd, meta, now);
  }
  
  const ctx: ReducerContext<T> = { state, cmd, meta, now };
  
  switch (cmd.type) {
    case 'AddTx':
      return addTxReducer(ctx as any);
    case 'ProposeBlock':
      return proposeBlockReducer(ctx as any);
    case 'ApproveBlock':
      return approveBlockReducer(ctx as any);
    case 'CommitBlock':
      return commitBlockReducer(ctx as any);
    default:
      // Exhaustiveness check
      return [state, []] as never;
  }
};