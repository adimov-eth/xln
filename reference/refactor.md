

# /Users/adimov/Developer/xln/v3/src/entity/actions.ts

```typescript
// ============================================================================
// entity/actions.ts - Pure state mutations that read like English
// ============================================================================

import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityId, SignerIdx } from '../types/primitives.js';
import type { EntityTx, OutboxMsg } from '../types/state.js';

// ============================================================================
// Action Types - Clear intent and side effects
// ============================================================================

export type Action<TState, TParams> = {
  name: string;
  validate: (state: TState, params: TParams) => Result<TParams>;
  execute: (state: TState, params: TParams) => TState;
  generateMessages?: (entityId: EntityId, params: TParams) => OutboxMsg[];
};

export type ActionResult<TState> = {
  newState: TState;
  messages: OutboxMsg[];
};

// ============================================================================
// Wallet Actions - Money operations
// ============================================================================

export type WalletState = {
  readonly balance: bigint;
  readonly nonce: number;
};

export type TransferParams = {
  readonly to: EntityId;
  readonly amount: bigint;
};

export type BurnParams = {
  readonly amount: bigint;
};

export type CreditParams = {
  readonly amount: bigint;
  readonly from: EntityId;
};

export const walletActions = {
  transfer: {
    name: 'transfer',
    
    validate: (state: WalletState, params: TransferParams): Result<TransferParams> => {
      if (params.amount <= 0n) return Err('Transfer amount must be positive');
      if (state.balance < params.amount) return Err('Insufficient balance for transfer');
      if (!params.to) return Err('Transfer requires a recipient');
      return Ok(params);
    },
    
    execute: (state: WalletState, params: TransferParams): WalletState => ({
      balance: state.balance - params.amount,
      nonce: state.nonce + 1
    }),
    
    generateMessages: (entityId: EntityId, params: TransferParams): OutboxMsg[] => [{
      from: entityId,
      to: params.to,
      command: {
        type: 'addTx',
        tx: {
          op: 'credit',
          data: {
            amount: params.amount.toString(),
            from: entityId,
            _internal: true
          }
        }
      }
    }]
  },
  
  burn: {
    name: 'burn',
    
    validate: (state: WalletState, params: BurnParams): Result<BurnParams> => {
      if (params.amount <= 0n) return Err('Burn amount must be positive');
      if (state.balance < params.amount) return Err('Insufficient balance to burn');
      return Ok(params);
    },
    
    execute: (state: WalletState, params: BurnParams): WalletState => ({
      balance: state.balance - params.amount,
      nonce: state.nonce + 1
    })
  },
  
  credit: {
    name: 'credit',
    
    validate: (state: WalletState, params: CreditParams): Result<CreditParams> => {
      if (params.amount <= 0n) return Err('Credit amount must be positive');
      if (!params.from) return Err('Credit requires a source');
      return Ok(params);
    },
    
    execute: (state: WalletState, params: CreditParams): WalletState => ({
      balance: state.balance + params.amount,
      nonce: state.nonce + 1
    })
  }
};

// ============================================================================
// DAO Actions - Governance operations
// ============================================================================

export type Initiative = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly author: SignerIdx;
  readonly actions: readonly EntityTx[];
  readonly votes: ReadonlyMap<SignerIdx, boolean>;
  readonly status: 'active' | 'passed' | 'rejected' | 'executed';
  readonly createdAt: number;
  readonly executedAt?: number;
};

export type DaoState = WalletState & {
  readonly initiatives: ReadonlyMap<string, Initiative>;
  readonly memberCount: number;
  readonly voteThreshold: number; // Percentage
};

export type CreateInitiativeParams = {
  readonly title: string;
  readonly description: string;
  readonly author: SignerIdx;
  readonly actions: readonly EntityTx[];
};

export type VoteParams = {
  readonly initiativeId: string;
  readonly support: boolean;
  readonly voter: SignerIdx;
};

export type ExecuteInitiativeParams = {
  readonly initiativeId: string;
  readonly actions: readonly EntityTx[];
};

export const daoActions = {
  createInitiative: {
    name: 'createInitiative',
    
    validate: (state: DaoState, params: CreateInitiativeParams): Result<CreateInitiativeParams> => {
      if (!params.title) return Err('Initiative requires a title');
      if (!params.description) return Err('Initiative requires a description');
      if (!params.actions || params.actions.length === 0) return Err('Initiative requires at least one action');
      return Ok(params);
    },
    
    execute: (state: DaoState, params: CreateInitiativeParams): DaoState => {
      const initiativeId = generateInitiativeId(state);
      const initiative: Initiative = {
        id: initiativeId,
        ...params,
        votes: new Map(),
        status: 'active',
        createdAt: Date.now()
      };
      
      const newInitiatives = new Map(state.initiatives);
      newInitiatives.set(initiativeId, initiative);
      
      return {
        ...state,
        initiatives: newInitiatives,
        nonce: state.nonce + 1
      };
    }
  },
  
  vote: {
    name: 'vote',
    
    validate: (state: DaoState, params: VoteParams): Result<VoteParams> => {
      const initiative = state.initiatives.get(params.initiativeId);
      if (!initiative) return Err('Initiative not found');
      if (initiative.status !== 'active') return Err('Can only vote on active initiatives');
      if (initiative.votes.has(params.voter)) return Err('Already voted on this initiative');
      return Ok(params);
    },
    
    execute: (state: DaoState, params: VoteParams): DaoState => {
      const initiatives = new Map(state.initiatives);
      const initiative = initiatives.get(params.initiativeId)!;
      
      const newVotes = new Map(initiative.votes);
      newVotes.set(params.voter, params.support);
      
      const newStatus = checkIfInitiativePasses(newVotes, state.memberCount, state.voteThreshold)
        ? 'passed' as const
        : 'active' as const;
        
      const updatedInitiative: Initiative = { ...initiative, votes: newVotes, status: newStatus };
      initiatives.set(params.initiativeId, updatedInitiative);
      
      return { ...state, initiatives };
    }
  },
  
  executeInitiative: {
    name: 'executeInitiative',
    
    validate: (state: DaoState, params: ExecuteInitiativeParams): Result<ExecuteInitiativeParams> => {
      const initiative = state.initiatives.get(params.initiativeId);
      if (!initiative) return Err('Initiative not found');
      if (initiative.status !== 'passed') return Err('Initiative has not passed');
      return Ok(params);
    },
    
    execute: (state: DaoState, params: ExecuteInitiativeParams): DaoState => {
      const initiatives = new Map(state.initiatives);
      const initiative = initiatives.get(params.initiativeId)!;
      
      const executedInitiative: Initiative = { ...initiative, status: 'executed', executedAt: Date.now() };
      initiatives.set(params.initiativeId, executedInitiative);
      
      return { ...state, initiatives, nonce: state.nonce + 1 };
    },
    
    generateMessages: (entityId: EntityId, params: ExecuteInitiativeParams): OutboxMsg[] => {
      return params.actions.map(tx => ({
        from: entityId,
        to: entityId,
        command: { type: 'addTx', tx }
      }));
    }
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

const generateInitiativeId = (state: DaoState): string => `init-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const checkIfInitiativePasses = (
  votes: ReadonlyMap<SignerIdx, boolean>,
  memberCount: number,
  threshold: number
): boolean => {
  const supportVotes = Array.from(votes.values()).filter(v => v).length;
  if (memberCount === 0) return false;
  const supportPercentage = (supportVotes / memberCount) * 100;
  return supportPercentage >= threshold;
};
```

# /Users/adimov/Developer/xln/v3/src/entity/blocks.ts

```typescript
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
```

# /Users/adimov/Developer/xln/v3/src/entity/commands.ts

```typescript
// ============================================================================
// entity/commands.ts - Entity command processing that reads like English
// ============================================================================

import type { SignerIdx, BlockHash, EntityId } from '../types/primitives.js';
import { hash as blockHash } from '../types/primitives.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { 
  EntityCommand, 
  EntityState, 
  EntityMeta, 
  OutboxMsg,
  ProposedBlock,
  EntityTx
} from '../types/state.js';
import { computeBlockHash } from '../utils/hash.js';
import { getProposer, hasQuorum, isTimedOut } from '../core/consensus.js';

// ============================================================================
// Command Processing Context
// ============================================================================

export type CommandContext = {
  readonly entity: EntityState;
  readonly command: EntityCommand;
  readonly signer: SignerIdx;
  readonly meta: EntityMeta;
  readonly now: number;
};

export type CommandResult = {
  readonly entity: EntityState;
  readonly messages: readonly OutboxMsg[];
};

// ============================================================================
// Main Command Processor - Reads like English
// ============================================================================

export const processEntityCommand = (context: CommandContext): Result<CommandResult> => {
  const { entity, command, signer, meta, now } = context;
  
  if (!signerIsAuthorized(signer, meta)) return Err(`Signer ${signer} is not authorized for this entity`);
  if (entityIsFaulted(entity)) return Err(`Entity is faulted: ${entity.faultReason}`);
  
  if (proposalHasTimedOut(entity, now, meta.timeoutMs)) {
    return processEntityCommand({ ...context, entity: recoverFromTimeout(entity) });
  }
  
  switch (command.type) {
    case 'addTx': return addTransactionToMempool(entity, command.tx);
    case 'proposeBlock': return createBlockProposal(entity, signer, meta, now);
    case 'shareProposal': return receiveSharedProposal(entity, command.proposal, signer, meta);
    case 'approveBlock': return addApprovalToBlock(entity, command, signer, meta);
    case 'commitBlock': return finalizeAndCommitBlock(entity, command.hash, signer, meta);
    default: return Err('Unknown command type');
  }
};

// ============================================================================
// Command Handlers - Each reads like a sentence
// ============================================================================

const addTransactionToMempool = (entity: EntityState, transaction: EntityTx): Result<CommandResult> => {
  if (entity.stage !== 'idle') return Err('Can only add transactions when entity is idle');
  const updatedEntity = { ...entity, mempool: [...entity.mempool, transaction] };
  return Ok({ entity: updatedEntity, messages: [] });
};

const createBlockProposal = (entity: EntityState, signer: SignerIdx, meta: EntityMeta, now: number): Result<CommandResult> => {
  if (entity.stage !== 'idle') return Err('Can only propose blocks when idle');
  if (entity.mempool.length === 0) return Err('No transactions to propose');
  if (!signerIsCurrentProposer(signer, entity.height, meta.quorum)) {
    const expected = getProposer(entity.height, meta.quorum);
    return Err(`Not the current proposer (expected signer ${expected})`);
  }
  
  const proposal = createProposal(entity, signer, now, meta.id);
  
  if (isSingleSigner(meta)) {
    return moveStraightToCommitting(entity, proposal, signer, meta.id);
  }
  
  return shareProposalWithOthers(entity, proposal, signer, meta);
};

const receiveSharedProposal = (entity: EntityState, proposal: ProposedBlock, signer: SignerIdx, meta: EntityMeta): Result<CommandResult> => {
  if (entity.stage !== 'idle') return Err('Can only receive proposals when idle');
  if (!proposalIsFromValidProposer(proposal, entity.height, meta.quorum)) return Err(`Invalid proposer: ${proposal.proposer}`);
  
  const updatedEntity = { ...entity, stage: 'proposed' as const, proposal, mempool: [] };
  const approvalMessage = createApprovalMessage(meta.id, proposal.proposer, proposal.hash, signer);
  return Ok({ entity: updatedEntity, messages: [approvalMessage] });
};

const addApprovalToBlock = (entity: EntityState, command: { type: 'approveBlock'; hash: string; from?: SignerIdx }, signer: SignerIdx, meta: EntityMeta): Result<CommandResult> => {
  if (entity.stage === 'committing') return Ok({ entity, messages: [] });
  if (entity.stage !== 'proposed' || !entity.proposal) return Err('Can only approve blocks when proposed');
  if (entity.proposal.hash !== command.hash) return Err('Approval hash does not match proposal');
  
  const approver = command.from ?? signer;
  if (!approverIsInQuorum(approver, meta.quorum)) return Err(`Approver ${approver} is not in quorum`);
  if (proposalAlreadyHasApproval(entity.proposal, approver)) return Err(`Signer ${approver} already approved`);
  
  const updatedProposal = addApproval(entity.proposal, approver);
  
  if (hasQuorum(updatedProposal.approvals, meta.quorum)) {
    return moveToCommittingWithConsensus(entity, updatedProposal, meta.id);
  }
  
  return Ok({ entity: { ...entity, proposal: updatedProposal }, messages: [] });
};

const finalizeAndCommitBlock = (entity: EntityState, blockHash: string, signer: SignerIdx, meta: EntityMeta): Result<CommandResult> => {
  if (entityAlreadyCommittedThisBlock(entity, blockHash)) return Ok({ entity, messages: [] });
  if (!canCommitBlock(entity)) return Err('Can only commit when in committing or proposed state');
  if (!entity.proposal || entity.proposal.hash !== blockHash) return Err('Block hash does not match current proposal');
  if (entity.stage === 'committing' && signer !== entity.proposal.proposer) return Err('Only the proposer can commit when in committing state');
  
  // NOTE: Block execution is now handled by the engine/processor.
  // This command handler's job is to prepare the state for execution.
  const committedEntity: EntityState = { ...entity, stage: 'committing' };
  
  const notifications = shouldNotifyOthers(entity, signer) 
    ? createCommitNotifications(meta, signer, blockHash)
    : [];
  
  return Ok({ entity: committedEntity, messages: notifications });
};

// ============================================================================
// Helper Functions - Named to be self-documenting
// ============================================================================

const signerIsAuthorized = (signer: SignerIdx, meta: EntityMeta): boolean => meta.quorum.includes(signer);
const entityIsFaulted = (entity: EntityState): boolean => entity.stage === 'faulted';
const proposalHasTimedOut = (entity: EntityState, now: number, timeoutMs: number): boolean => entity.stage === 'proposed' && entity.proposal !== undefined && isTimedOut(entity.proposal.timestamp, timeoutMs);
const recoverFromTimeout = (entity: EntityState): EntityState => ({ ...entity, stage: 'idle', mempool: entity.proposal ? [...entity.proposal.txs, ...entity.mempool] : entity.mempool, proposal: undefined });
const signerIsCurrentProposer = (signer: SignerIdx, height: any, quorum: readonly SignerIdx[]): boolean => signer === getProposer(height, quorum);
const isSingleSigner = (meta: EntityMeta): boolean => meta.quorum.length === 1;

const createProposal = (entity: EntityState, proposer: SignerIdx, now: number, entityId: EntityId): ProposedBlock => ({
  txs: entity.mempool,
  hash: blockHash(computeBlockHash(entityId, entity.height, entity.data, entity.mempool)),
  height: entity.height,
  proposer,
  approvals: new Set([proposer]),
  timestamp: now
});

const moveStraightToCommitting = (entity: EntityState, proposal: ProposedBlock, signer: SignerIdx, entityId: EntityId): Result<CommandResult> => {
  const committingEntity = { ...entity, stage: 'committing' as const, proposal, mempool: [] };
  const commitMessage: OutboxMsg = { from: entityId, to: entityId, toSigner: signer, command: { type: 'commitBlock', hash: proposal.hash } };
  return Ok({ entity: committingEntity, messages: [commitMessage] });
};

const shareProposalWithOthers = (entity: EntityState, proposal: ProposedBlock, signer: SignerIdx, meta: EntityMeta): Result<CommandResult> => {
  const proposedEntity = { ...entity, stage: 'proposed' as const, proposal, mempool: [] };
  const shareMessages = meta.quorum.filter(s => s !== signer).map(targetSigner => ({ from: meta.id, to: meta.id, toSigner: targetSigner, command: { type: 'shareProposal' as const, proposal } }));
  return Ok({ entity: proposedEntity, messages: shareMessages });
};

const proposalIsFromValidProposer = (proposal: ProposedBlock, currentHeight: any, quorum: readonly SignerIdx[]): boolean => proposal.proposer === getProposer(currentHeight, quorum);

const createApprovalMessage = (entityId: EntityId, proposer: SignerIdx, hash: BlockHash, from: SignerIdx): OutboxMsg => ({
  from: entityId, to: entityId, toSigner: proposer, command: { type: 'approveBlock', hash, from }
});

const approverIsInQuorum = (approver: SignerIdx, quorum: readonly SignerIdx[]): boolean => quorum.includes(approver);
const proposalAlreadyHasApproval = (proposal: ProposedBlock, approver: SignerIdx): boolean => proposal.approvals.has(approver);
const addApproval = (proposal: ProposedBlock, approver: SignerIdx): ProposedBlock => ({ ...proposal, approvals: new Set([...proposal.approvals, approver]) });

const moveToCommittingWithConsensus = (entity: EntityState, proposal: ProposedBlock, entityId: EntityId): Result<CommandResult> => {
  const committingEntity = { ...entity, stage: 'committing' as const, proposal };
  const commitMessage: OutboxMsg = { from: entityId, to: entityId, toSigner: proposal.proposer, command: { type: 'commitBlock', hash: proposal.hash } };
  return Ok({ entity: committingEntity, messages: [commitMessage] });
};

const entityAlreadyCommittedThisBlock = (entity: EntityState, hash: BlockHash): boolean => entity.stage === 'idle' && entity.lastBlockHash === hash;
const canCommitBlock = (entity: EntityState): boolean => entity.stage === 'committing' || entity.stage === 'proposed';
const shouldNotifyOthers = (entity: EntityState, signer: SignerIdx): boolean => entity.stage === 'committing' && entity.proposal !== undefined && signer === entity.proposal.proposer;

const createCommitNotifications = (meta: EntityMeta, signer: SignerIdx, hash: BlockHash): OutboxMsg[] =>
  meta.quorum.filter(s => s !== signer).map(targetSigner => ({ from: meta.id, to: meta.id, toSigner: targetSigner, command: { type: 'commitBlock', hash } }));
```

# /Users/adimov/Developer/xln/v3/src/entity/transactions.ts

```typescript
// ============================================================================
// entity/transactions.ts - Business operations that read like English
// ============================================================================

import type { EntityId } from '../types/primitives.js';
import type { EntityTx } from '../types/state.js';

// ============================================================================
// Transaction Builders - Create transactions with clear intent
// ============================================================================

export const transaction = {
  transfer: (to: EntityId, amount: string | bigint, nonce: number): EntityTx => ({
    op: 'transfer',
    data: { to, amount: amount.toString() },
    nonce
  }),
  
  burn: (amount: string | bigint, nonce: number): EntityTx => ({
    op: 'burn',
    data: { amount: amount.toString() },
    nonce
  }),
  
  credit: (amount: string | bigint, from: EntityId): EntityTx => ({
    op: 'credit',
    data: { amount: amount.toString(), from, _internal: true }
  }),
  
  createInitiative: (config: {
    title: string;
    description: string;
    author: number;
    actions: readonly EntityTx[];
  }): EntityTx => ({
    op: 'createInitiative',
    data: config
  }),
  
  voteOnInitiative: (initiativeId: string, support: boolean, voter: number): EntityTx => ({
    op: 'voteInitiative',
    data: { initiativeId, support, voter }
  }),
  
  executeInitiative: (initiativeId: string, actions: readonly EntityTx[]): EntityTx => ({
    op: 'executeInitiative',
    data: { initiativeId, actions }
  })
};

// ============================================================================
// Transaction Description Helpers
// ============================================================================

export const describe = {
  transaction: (tx: EntityTx): string => {
    switch (tx.op) {
      case 'transfer': return `Transfer ${tx.data.amount} to ${tx.data.to}`;
      case 'burn': return `Burn ${tx.data.amount}`;
      case 'credit': return `Credit ${tx.data.amount} from ${tx.data.from}`;
      case 'createInitiative': return `Create initiative: ${tx.data.title}`;
      case 'voteInitiative': return `Vote ${tx.data.support ? 'for' : 'against'} initiative ${tx.data.initiativeId}`;
      case 'executeInitiative': return `Execute initiative ${tx.data.initiativeId}`;
      default: return `Unknown operation: ${tx.op}`;
    }
  },
  
  failure: (tx: EntityTx, reason: string): string => `Failed to ${describe.transaction(tx).toLowerCase()}: ${reason}`
};
```

# /Users/adimov/Developer/xln/v3/src/engine/processor.ts

```typescript
// ============================================================================
// engine/processor.ts - Main processing loop that reads like English
// ============================================================================

import { processEntityCommand } from '../entity/commands.js';
import type { CommandResult } from '../entity/commands.js';
import { execute, transition } from '../entity/blocks.js';
import type { SignerIdx } from '../types/primitives.js';
import type { Protocol, ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { 
  ServerState, 
  ServerTx, 
  OutboxMsg,
  EntityState,
  EntityMeta
} from '../types/state.js';
import { assoc } from '../utils/immutable.js';
import { router } from './router.js';

// ============================================================================
// Processing Result Types
// ============================================================================

export type ProcessingResult = {
  readonly server: ServerState;
  readonly appliedCommands: readonly ServerTx[];
  readonly failedCommands: readonly FailedCommand[];
  readonly generatedMessages: readonly OutboxMsg[];
};

export type FailedCommand = {
  readonly command: ServerTx;
  readonly error: string;
};

// ============================================================================
// Main Processing Function - The heart of the engine
// ============================================================================

export const processServerTick = (
  server: ServerState,
  protocols: ProtocolRegistry,
  now: number = Date.now()
): Result<ProcessingResult> => {
  let updatedServer = server;
  const applied: ServerTx[] = [];
  const failed: FailedCommand[] = [];
  let messages: OutboxMsg[] = [];
  
  for (const command of server.mempool) {
    const result = processOneCommand(updatedServer, command, protocols, now);
    
    if (result.ok) {
      updatedServer = applyEntityUpdate(updatedServer, command.signer, command.entityId, result.value.entity);
      applied.push(command);
      messages.push(...result.value.messages);
    } else {
      failed.push({ command, error: result.error });
    }
  }
  
  const routingResult = router.routeMessages(messages, updatedServer);
  const autoProposals = generateAutomaticProposals(updatedServer);
  
  const finalServer: ServerState = {
    ...updatedServer,
    height: updatedServer.height + 1 as any,
    mempool: [...routingResult.routedCommands, ...autoProposals]
  };
  
  return Ok({
    server: finalServer,
    appliedCommands: applied,
    failedCommands: failed,
    generatedMessages: messages
  });
};

// ============================================================================
// Command Processing - Handle individual commands
// ============================================================================

const processOneCommand = (
  server: ServerState,
  command: ServerTx,
  protocols: ProtocolRegistry,
  now: number
): Result<CommandResult> => {
  const entity = findEntityAtSigner(server, command.signer, command.entityId);
  if (!entity) return Err(`Entity ${command.entityId} not found at signer ${command.signer}`);
  
  const meta = server.registry.get(command.entityId);
  if (!meta) return Err(`Entity ${command.entityId} not registered`);
  
  const protocol = protocols.get(meta.protocol);
  if (!protocol) return Err(`Unknown protocol: ${meta.protocol}`);
  
  // First, process the command to get the next state and messages
  const commandResult = processEntityCommand({ entity, command: command.command, signer: command.signer, meta, now });
  if (!commandResult.ok) return commandResult;
  
  let { entity: nextEntity, messages } = commandResult.value;
  
  // If the command resulted in a 'committing' state, execute the block
  if (nextEntity.stage === 'committing' && nextEntity.proposal) {
    const executionResult = execute.block(entity.data, nextEntity.proposal, meta.id, protocol);
    
    nextEntity = transition.toIdle(
      nextEntity,
      executionResult.newState,
      nextEntity.proposal.hash,
      executionResult.failedTransactions.map(f => f.transaction)
    );
    
    messages = [...messages, ...executionResult.messages];
  }
  
  return Ok({ entity: nextEntity, messages });
};

// ============================================================================
// Auto-proposal Generation - For single-signer entities
// ============================================================================

const generateAutomaticProposals = (server: ServerState): ServerTx[] => {
  const proposals: ServerTx[] = [];
  for (const [signerId, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      if (shouldAutoPropose(entity, entityId, signerId, server)) {
        proposals.push({ signer: signerId, entityId, command: { type: 'proposeBlock' } });
      }
    }
  }
  return proposals;
};

// ============================================================================
// Helper Functions
// ============================================================================

const findEntityAtSigner = (server: ServerState, signer: SignerIdx, entityId: string): EntityState | undefined => server.signers.get(signer)?.get(entityId);

const applyEntityUpdate = (server: ServerState, signer: SignerIdx, entityId: string, newEntity: EntityState): ServerState => {
  const signerEntities = server.signers.get(signer);
  if (!signerEntities) return server;
  const updatedSignerEntities = assoc(signerEntities, entityId, newEntity);
  return { ...server, signers: assoc(server.signers, signer, updatedSignerEntities) };
};

const shouldAutoPropose = (entity: EntityState, entityId: string, signerId: SignerIdx, server: ServerState): boolean => {
  const meta = server.registry.get(entityId);
  return !!meta && entity.stage === 'idle' && entity.mempool.length > 0 && meta.quorum.length === 1 && meta.quorum[0] === signerId;
};
```

# /Users/adimov/Developer/xln/v3/src/engine/router.ts

```typescript
// ============================================================================
// engine/router.ts - Message routing that reads like English
// ============================================================================

import type { SignerIdx } from '../types/primitives.js';
import type { 
  ServerState, 
  ServerTx, 
  OutboxMsg, 
  EntityMeta,
  ProposedBlock
} from '../types/state.js';

// ============================================================================
// Routing Types
// ============================================================================

export type RoutingResult = {
  readonly routedCommands: readonly ServerTx[];
  readonly undeliverable: readonly UndeliverableMessage[];
};

export type UndeliverableMessage = {
  readonly message: OutboxMsg;
  readonly reason: string;
};

// ============================================================================
// Message Router - Direct messages to their destinations
// ============================================================================

export const router = {
  routeMessages: (messages: readonly OutboxMsg[], server: ServerState): RoutingResult => {
    const routed: ServerTx[] = [];
    const undeliverable: UndeliverableMessage[] = [];
    
    for (const message of messages) {
      const result = router.routeOneMessage(message, server);
      if (result.delivered) {
        routed.push(...result.commands);
      } else {
        undeliverable.push({ message, reason: result.reason });
      }
    }
    
    return { routedCommands: routed, undeliverable };
  },
  
  routeOneMessage: (message: OutboxMsg, server: ServerState): { delivered: boolean; commands: ServerTx[]; reason: string } => {
    const meta = server.registry.get(message.to);
    if (!meta) return { delivered: false, commands: [], reason: `Destination entity "${message.to}" not registered` };
    
    return message.toSigner !== undefined
      ? routeToSpecificSigner(message, server)
      : broadcastToQuorum(message, meta, server);
  }
};

// ============================================================================
// Routing Strategies
// ============================================================================

const routeToSpecificSigner = (message: OutboxMsg, server: ServerState): { delivered: boolean; commands: ServerTx[]; reason: string } => {
  if (!entityExistsAtSigner(server, message.toSigner!, message.to)) {
    return { delivered: false, commands: [], reason: `Entity "${message.to}" not imported by signer ${message.toSigner}` };
  }
  const command: ServerTx = { signer: message.toSigner!, entityId: message.to, command: message.command };
  return { delivered: true, commands: [command], reason: '' };
};

const broadcastToQuorum = (message: OutboxMsg, meta: EntityMeta, server: ServerState): { delivered: boolean; commands: ServerTx[]; reason: string } => {
  const commands: ServerTx[] = [];
  for (const signer of meta.quorum) {
    if (entityExistsAtSigner(server, signer, message.to)) {
      commands.push({ signer, entityId: message.to, command: message.command });
    }
  }
  
  if (commands.length === 0) {
    return { delivered: false, commands: [], reason: `No quorum members have imported entity "${message.to}"` };
  }
  
  return { delivered: true, commands, reason: '' };
};

// ============================================================================
// Helper Functions
// ============================================================================

const entityExistsAtSigner = (server: ServerState, signer: SignerIdx, entityId: string): boolean => server.signers.get(signer)?.has(entityId) ?? false;
```

# /Users/adimov/Developer/xln/v3/src/engine/server.ts

```typescript
// ============================================================================
// engine/server.ts - Server state management that reads like English
// ============================================================================

import { height, id, signer } from '../types/primitives.js';
import type { 
  EntityCommand, 
  EntityMeta, 
  EntityState, 
  ServerState, 
  ServerTx, 
  SignerIdx 
} from '../types/state.js';
import { assoc } from '../utils/immutable.js';

// ============================================================================
// Server Configuration
// ============================================================================

const MAX_QUORUM_SIZE = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================================================
// Server Creation
// ============================================================================

export const createServer = (): ServerState => ({
  height: height(0),
  signers: new Map(),
  registry: new Map(),
  mempool: []
});

// ============================================================================
// Entity Registration - Tell the server about entities
// ============================================================================

export const registerEntity = (
  server: ServerState,
  entityId: string,
  config: {
    readonly quorum: readonly number[];
    readonly protocol: string;
    readonly timeoutMs?: number;
  }
): ServerState => {
  if (!isValidQuorum(config.quorum)) throw new Error(describeQuorumError(config.quorum));
  
  const meta: EntityMeta = {
    id: id(entityId),
    quorum: config.quorum.map(signer),
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    protocol: config.protocol
  };
  
  return { ...server, registry: assoc(server.registry, id(entityId), meta) };
};

// ============================================================================
// Entity Import - Signers claim their entities
// ============================================================================

export const importEntity = (
  server: ServerState,
  signerId: number,
  entityId: string,
  initialState?: any
): ServerState => {
  const meta = server.registry.get(id(entityId));
  if (!meta) throw new Error(`Cannot import entity "${entityId}" - it is not registered`);
  
  const signerIdx = signer(signerId);
  if (!signerIsInQuorum(signerIdx, meta)) throw new Error(`Signer ${signerId} is not authorized for entity "${entityId}"`);
  if (entityAlreadyImported(server, signerIdx, entityId)) return server;
  
  const entity = createEntityState(entityId, initialState ?? getDefaultState(meta.protocol));
  return addEntityToSigner(server, signerIdx, entity);
};

// ============================================================================
// Command Submission - How work enters the system
// ============================================================================

export const submitCommand = (
  server: ServerState,
  fromSigner: number,
  toEntity: string,
  command: EntityCommand
): ServerState => {
  const serverTx: ServerTx = { signer: signer(fromSigner), entityId: id(toEntity), command };
  return { ...server, mempool: [...server.mempool, serverTx] };
};

// ============================================================================
// Query Functions - Ask questions about the server
// ============================================================================

export const query = {
  getEntity: (server: ServerState, signerId: number, entityId: string): EntityState | undefined => server.signers.get(signer(signerId))?.get(id(entityId)),
  getMetadata: (server: ServerState, entityId: string): EntityMeta | undefined => server.registry.get(id(entityId)),
  hasEntity: (server: ServerState, signerId: number, entityId: string): boolean => query.getEntity(server, signerId, entityId) !== undefined,
  pendingCommandCount: (server: ServerState): number => server.mempool.length,
  getSignerEntities: (server: ServerState, signerId: number): readonly EntityState[] => Array.from(server.signers.get(signer(signerId))?.values() ?? [])
};

// ============================================================================
// Helper Functions
// ============================================================================

const isValidQuorum = (quorum: readonly number[]): boolean => quorum.length > 0 && quorum.length <= MAX_QUORUM_SIZE;
const describeQuorumError = (quorum: readonly number[]): string => quorum.length === 0 ? 'Quorum cannot be empty' : `Quorum size ${quorum.length} exceeds maximum allowed (${MAX_QUORUM_SIZE})`;
const signerIsInQuorum = (signer: SignerIdx, meta: EntityMeta): boolean => meta.quorum.includes(signer);
const entityAlreadyImported = (server: ServerState, signer: SignerIdx, entityId: string): boolean => server.signers.get(signer)?.has(id(entityId)) ?? false;
const createEntityState = (entityId: string, data: any): EntityState => ({ id: id(entityId), height: height(0), stage: 'idle', data, mempool: [] });

const addEntityToSigner = (server: ServerState, signerIdx: SignerIdx, entity: EntityState): ServerState => {
  const signerEntities = server.signers.get(signerIdx) ?? new Map();
  const updatedSignerEntities = assoc(signerEntities, entity.id, entity);
  return { ...server, signers: assoc(server.signers, signerIdx, updatedSignerEntities) };
};

const getDefaultState = (protocol: string): any => {
  switch (protocol) {
    case 'wallet': return { balance: 0n, nonce: 0 };
    case 'dao': return { balance: 0n, nonce: 0, initiatives: new Map(), memberCount: 0, voteThreshold: 66 };
    default: return {};
  }
};
```

# /Users/adimov/Developer/xln/v3/src/protocols/dao.ts

```typescript
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
```

# /Users/adimov/Developer/xln/v3/src/protocols/wallet.ts

```typescript
// ============================================================================
// protocols/wallet.ts - Wallet protocol that reads like English
// ============================================================================

import { walletActions } from '../entity/actions.js';
import type { WalletState } from '../entity/actions.js';
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
```

# /Users/adimov/Developer/xln/v3/src/test/dao-fluent.test.ts

```typescript
// ============================================================================
// test/dao-fluent.test.ts - DAO tests using fluent API
// ============================================================================

import { describe, test } from 'bun:test';
import { transaction } from '../entity/transactions.js';
import { defaultRegistry } from '../protocols/registry.js';
import { patterns, scenario } from './fluent-api.js';

describe('DAO Protocol with Fluent API', () => {
  test('single signer DAO creates and executes initiative', async () => {
    const s = scenario('single signer DAO')
      .withProtocols(defaultRegistry)
      .withDao('dao', [0], { balance: 1000n, voteThreshold: 100 });
      
    const burnAction = transaction.burn('100', 2);
    
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Burn tokens',
      description: 'Burn 100 tokens for testing',
      author: 0,
      actions: [burnAction]
    }));
    
    await s.processUntilIdle();
    s.expectInitiativeCount('dao', 1);
    
    const initiativeId = s.getInitiativeId('dao', 0);
    
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'passed');
      
    s.sendTransaction(0, 'dao', transaction.executeInitiative(initiativeId, [burnAction]));
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'executed');
      
    await s.processUntilIdle();
    s.expectBalance('dao', 900n);
    s.expectNonce('dao', 3); // create, execute, burn
  });
  
  test('multi-signer DAO requires quorum', async () => {
    const s = patterns.multiSigDao(defaultRegistry);
      
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Fund operations',
      description: 'Transfer 500 tokens',
      author: 0,
      actions: [transaction.burn('500', 2)]
    }));
    
    await s.processUntilIdle();
    s.expectInitiativeCount('dao', 1);
    
    const initiativeId = s.getInitiativeId('dao', 0);
    
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'active');
      
    s.sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, true, 1));
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'passed');
  });
  
  test('DAO with treasury transfers', async () => {
    const s = patterns.daoWithTreasury(defaultRegistry)
      .expectBalance('dao', 1000n)
      .expectBalance('treasury', 0n);
      
    const transferAction = transaction.transfer('treasury', '200', 2);
    
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Fund treasury',
      description: 'Transfer 200 to treasury',
      author: 0,
      actions: [transferAction]
    }));
      
    await s.processUntilIdle();
    const initiativeId = s.getInitiativeId('dao', 0);
    
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    s.sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, true, 1));
    await s.processUntilIdle();
      
    s.sendTransaction(0, 'dao', transaction.executeInitiative(initiativeId, [transferAction]));
    await s.processUntilIdle();
      
    s.expectBalance('dao', 800n)
      .expectBalance('treasury', 200n);
  });
  
  test('failed votes keep initiative active', async () => {
    const s = scenario('DAO voting')
      .withProtocols(defaultRegistry)
      .withDao('dao', [0, 1, 2]);
      
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Controversial proposal',
      description: 'This will be voted down',
      author: 0,
      actions: [transaction.burn('999', 2)]
    }));
      
    await s.processUntilIdle();
    const initiativeId = s.getInitiativeId('dao', 0);
    
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    s.sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, false, 1));
    s.sendTransaction(2, 'dao', transaction.voteOnInitiative(initiativeId, false, 2));
    await s.processUntilIdle();
      
    s.expectInitiativeStatus('dao', 0, 'active')
      .expectBalance('dao', 1000n);
  });
});
```

# /Users/adimov/Developer/xln/v3/src/test/fluent-api.ts

```typescript
// ============================================================================
// test/fluent-api.ts - Fluent test API that reads like English
// ============================================================================

import { createBlockRunner } from '../infra/runner.js';
import { MemoryStorage } from '../storage/memory.js';
import { SilentLogger } from '../infra/deps.js';
import { createServer, registerEntity, importEntity, submitCommand, query } from '../engine/server.js';
import { transaction } from '../entity/transactions.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { EntityCommand, ServerState } from '../types/state.js';
import { expect } from 'bun:test';
import { id } from '../types/primitives.js';

// ============================================================================
// Test Scenario Builder
// ============================================================================

export class TestScenario {
  private server: ServerState;
  private runner: ReturnType<typeof createBlockRunner>;
  
  constructor(public description: string, protocols: ProtocolRegistry) {
    this.server = createServer();
    this.runner = createBlockRunner({
      storage: new MemoryStorage(),
      protocols,
      logger: SilentLogger
    });
  }
  
  withEntity(entityId: string, config: { protocol: string; signers: number[]; initialState?: any; timeoutMs?: number; }): this {
    this.server = registerEntity(this.server, entityId, { quorum: config.signers, protocol: config.protocol, timeoutMs: config.timeoutMs });
    for (const signerId of config.signers) {
      this.server = importEntity(this.server, signerId, entityId, config.initialState);
    }
    return this;
  }
  
  withWallet(walletId: string, owner: number, balance: bigint): this {
    return this.withEntity(walletId, { protocol: 'wallet', signers: [owner], initialState: { balance, nonce: 0 } });
  }
  
  withDao(daoId: string, members: number[], config?: { balance?: bigint; voteThreshold?: number; }): this {
    return this.withEntity(daoId, {
      protocol: 'dao',
      signers: members,
      initialState: {
        balance: config?.balance ?? 1000n,
        nonce: 0,
        initiatives: new Map(),
        memberCount: members.length,
        voteThreshold: config?.voteThreshold ?? 66
      }
    });
  }
  
  sendCommand(from: number, to: string, command: EntityCommand): this {
    this.server = submitCommand(this.server, from, to, command);
    return this;
  }
  
  sendTransaction(from: number, to: string, tx: any): this {
    const nextNonce = this.getNextNonce(to);
    if (tx.nonce === undefined) {
      tx.nonce = nextNonce;
    }
    return this.sendCommand(from, to, { type: 'addTx', tx });
  }
  
  async tick(): Promise<this> {
    const result = await this.runner.processBlock(this.server);
    if (!result.ok) throw new Error(`Processing failed: ${result.error}`);
    this.server = result.value;
    return this;
  }
  
  async processBlocks(count: number): Promise<this> {
    for (let i = 0; i < count; i++) await this.tick();
    return this;
  }
  
  async processUntilIdle(maxIterations = 20): Promise<this> {
    for (let i = 0; i < maxIterations && this.server.mempool.length > 0; i++) {
      await this.tick();
    }
    if (this.server.mempool.length > 0) {
      console.warn(`Mempool not empty after ${maxIterations} iterations.`);
    }
    return this;
  }
  
  expectBalance(entity: string, expectedBalance: bigint): this {
    expect(this.findEntityState(entity).balance).toBe(expectedBalance);
    return this;
  }
  
  expectNonce(entity: string, expectedNonce: number): this {
    expect(this.findEntityState(entity).nonce).toBe(expectedNonce);
    return this;
  }
  
  expectInitiativeCount(entity: string, expectedCount: number): this {
    expect(this.findEntityState(entity).initiatives?.size ?? 0).toBe(expectedCount);
    return this;
  }
  
  expectInitiativeStatus(entity: string, initiativeIdOrIndex: string | number, expectedStatus: string): this {
    const state = this.findEntityState(entity);
    const initiative = (typeof initiativeIdOrIndex === 'number')
      ? Array.from(state.initiatives?.values() ?? [])[initiativeIdOrIndex]
      : state.initiatives?.get(initiativeIdOrIndex);
    expect(initiative).toBeDefined();
    expect(initiative!.status).toBe(expectedStatus);
    return this;
  }
  
  getInitiativeId(entity: string, index: number = 0): string {
    const state = this.findEntityState(entity);
    const initiatives = Array.from(state.initiatives?.keys() ?? []);
    if (initiatives.length <= index) throw new Error(`Initiative at index ${index} not found`);
    return initiatives[index]!;
  }
  
  private findEntity(entityId: string, atSigner?: number): any {
    if (atSigner !== undefined) {
      const entity = query.getEntity(this.server, atSigner, entityId);
      if (!entity) throw new Error(`Entity "${entityId}" not found at signer ${atSigner}`);
      return entity;
    }
    const meta = this.server.registry.get(id(entityId));
    if (!meta) throw new Error(`Entity "${entityId}" not registered`);
    for (const signer of meta.quorum) {
      const entity = query.getEntity(this.server, signer, entityId);
      if (entity) return entity;
    }
    throw new Error(`Entity "${entityId}" not found at any signer`);
  }
  
  private findEntityState(entityId: string): any { return this.findEntity(entityId).data; }
  private getNextNonce(entityId: string): number { return (this.findEntityState(entityId).nonce ?? 0) + 1; }
}

// ============================================================================
// Test Scenario Factory and Patterns
// ============================================================================

export const scenario = (description: string) => ({
  withProtocols: (protocols: ProtocolRegistry) => new TestScenario(description, protocols)
});

export const patterns = {
  walletTransfer: (p: ProtocolRegistry) => scenario('wallet transfer').withProtocols(p).withWallet('alice', 0, 1000n).withWallet('bob', 1, 0n),
  multiSigDao: (p: ProtocolRegistry, m: number[] = [0, 1, 2]) => scenario('multi-sig DAO').withProtocols(p).withDao('dao', m),
  daoWithTreasury: (p: ProtocolRegistry) => scenario('DAO with treasury').withProtocols(p).withDao('dao', [0, 1, 2]).withWallet('treasury', 3, 0n)
};
```

# /Users/adimov/Developer/xln/v3/src/index.ts

```typescript
// ============================================================================
// index.ts - Main exports for XLN v3
// ============================================================================

// Entity module - Core business logic
export * from './entity/actions.js';
export * from './entity/blocks.js';
export * from './entity/commands.js';
export * from './entity/transactions.js';

// Engine module - Processing engine
export * from './engine/processor.js';
export * from './engine/router.js';
export * from './engine/server.js';

// Protocols
export * from './protocols/dao.js';
export * from './protocols/registry.js';
export * from './protocols/wallet.js';

// Storage
export * from './storage/interface.js';
export * from './storage/memory.js';

// Infrastructure
export * from './infra/deps.js';
export * from './infra/runner.js';

// Test utilities
export * from './test/fluent-api.js';

// Types
export * from './types/brand.js';
export * from './types/primitives.js';
export * from './types/protocol.js';
export * from './types/result.js';
export * from './types/state.js';

// Utilities
export * from './utils/hash.js';
export * from './utils/immutable.js';
export * from './utils/mutex.js';
export * from './utils/serialization.js';
export * from './utils/state-helpers.js';

// Re-export commonly used types for convenience
export type { 
  ServerState,
  EntityState,
  EntityCommand,
  EntityTx,
  OutboxMsg,
  ProposedBlock
} from './types/state.js';

export type {
  SignerIdx,
  EntityId,
  BlockHash,
  BlockHeight
} from './types/primitives.js';

export type {
  WalletState,
  DaoState,
  Initiative
} from './entity/actions.js';
```

# /Users/adimov/Developer/xln/v3/src/core/block.ts

```typescript
// ============================================================================
// core/block.ts - Block processing
// ============================================================================

import { height } from '../types/primitives.js';
import type { SignerIdx } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { CommandResult, EntityMeta, OutboxMsg, ServerState, ServerTx, SignerEntities } from '../types/state.js';
import { computeStateHash } from '../utils/hash.js';
import { assoc } from '../utils/immutable.js';
import { processEntityCommand } from '../entity/commands.js';

export type Clock = {
  readonly now: () => number;
};

export type BlockContext = {
  readonly server: ServerState;
  readonly protocols: ProtocolRegistry;
  readonly clock: Clock;
};

export type ProcessedBlock = {
  readonly server: ServerState;
  readonly stateHash: string;
  readonly appliedTxs: readonly ServerTx[];
  readonly failedTxs: readonly ServerTx[];
  readonly messages: readonly OutboxMsg[];
};

// Validate all transactions
type ValidationEntry = {
  tx: ServerTx;
  result: CommandResult;
};

const validateTransactions = (
  server: ServerState,
  transactions: readonly ServerTx[],
  protocols: ProtocolRegistry,
  now: number
): Result<ValidationEntry[]> => {
  const results: ValidationEntry[] = [];
  
  // Create a temporary copy of signers map for validation
  const tempSigners = new Map<SignerIdx, Map<string, any>>();
  for (const [signerId, entities] of server.signers) {
    tempSigners.set(signerId, new Map(entities));
  }
  
  for (const tx of transactions) {
    // Get entity from the specific signer
    const signerEntities = tempSigners.get(tx.signer);
    if (!signerEntities) {
      return Err(`Signer ${tx.signer} not found`);
    }
    
    const entity = signerEntities.get(tx.entityId);
    const meta = server.registry.get(tx.entityId);
    
    if (!entity || !meta) {
      return Err(`Entity ${tx.entityId} not found at signer ${tx.signer}`);
    }
    
    const result = processEntityCommand({
      entity,
      command: tx.command,
      signer: tx.signer,
      meta,
      now
    });
    
    if (!result.ok) {
      return Err(`Validation failed for ${tx.entityId} at signer ${tx.signer}, stage=${entity.stage}, cmd=${tx.command.type}: ${result.error}`);
    }
    
    // Store the validation result
    results.push({ tx, result: result.value });
    
    // Update temp state for dependent validations
    signerEntities.set(tx.entityId, result.value.entity);
  }
  
  return Ok(results);
};

// Apply validated changes atomically - efficient copy-on-write
const applyValidatedChanges = (
  server: ServerState,
  validatedChanges: ValidationEntry[]
): ServerState => {
  // Use copy-on-write to avoid unnecessary clones
  let signers = server.signers;
  
  for (const { tx, result } of validatedChanges) {
    const signerEntities = signers.get(tx.signer as SignerIdx);
    if (!signerEntities) continue; // Should not happen after validation
    
    // Update the specific signer's entities
    const updatedSignerEntities = assoc(signerEntities, result.entity.id, result.entity);
    signers = assoc(signers, tx.signer as SignerIdx, updatedSignerEntities);
  }
  
  return {
    ...server,
    signers
  };
};

// Route messages to create new transactions
const routeMessages = (
  messages: readonly OutboxMsg[],
  registry: ReadonlyMap<string, EntityMeta>,
  signers: ReadonlyMap<SignerIdx, SignerEntities>
): ServerTx[] => {
  const routedTxs: ServerTx[] = [];
  
  for (const msg of messages) {
    if (msg.toSigner !== undefined) {
      // Check if target signer has the entity
      const signerEntities = signers.get(msg.toSigner);
      if (signerEntities && signerEntities.has(msg.to)) {
        routedTxs.push({
          signer: msg.toSigner,
          entityId: msg.to,
          command: msg.command
        });
      }
      // Silently skip if signer hasn't imported the entity
    } else {
      // Route to all quorum members if no specific signer
      const meta = registry.get(msg.to);
      if (meta) {
        for (const s of meta.quorum) {
          // Check if signer has the entity
          const signerEntities = signers.get(s);
          if (signerEntities && signerEntities.has(msg.to)) {
            routedTxs.push({
              signer: s,
              entityId: msg.to,
              command: msg.command
            });
          }
        }
      }
    }
  }
  
  return routedTxs;
};

// Generate auto-propose transactions
const generateAutoPropose = (server: ServerState): ServerTx[] => {
  const proposals: ServerTx[] = [];
  
  // Iterate through all signers and their entities
  for (const [signerId, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const meta = server.registry.get(entityId);
      if (!meta) continue;
      
      // Auto-propose for single-signer entities with pending transactions
      if (entity.stage === 'idle' && 
          entity.mempool.length > 0 && 
          meta.quorum.length === 1 &&
          meta.quorum[0] === signerId) {
        // This signer is the sole member of the quorum
        proposals.push({
          signer: signerId,
          entityId,
          command: { type: 'proposeBlock' }
        });
      }
    }
  }
  
  return proposals;
};

// Process block - pure function
export const processBlockPure = (ctx: BlockContext): Result<ProcessedBlock> => {
  const { server, protocols, clock } = ctx;
  const nextHeight = height(Number(server.height) + 1);
  
  if (server.mempool.length === 0) {
    // Fixed empty block hash computation
    const newServer = { ...server, height: nextHeight, mempool: [] };
    return Ok({
      server: newServer,
      stateHash: computeStateHash(newServer),
      appliedTxs: [],
      failedTxs: [],
      messages: []
    });
  }
  
  // 1. Validate all transactions
  const validationResult = validateTransactions(
    server, 
    server.mempool, 
    protocols, 
    clock.now()
  );
  
  if (!validationResult.ok) {
    return Err(validationResult.error);
  }
  
  // 2. Apply changes atomically
  const newServer = applyValidatedChanges(server, validationResult.value);
  
  // 3. Collect messages
  const allMessages: OutboxMsg[] = [];
  for (const { result } of validationResult.value) {
    allMessages.push(...result.messages);
  }
  
  // 4. Route messages to create new transactions
  const routedTxs = routeMessages(allMessages, newServer.registry, newServer.signers);
  
  // 5. Generate auto-propose for single-signer entities
  const autoProposeTxs = generateAutoPropose(newServer);
  
  // 6. Create final state
  const finalServer: ServerState = {
    ...newServer,
    height: nextHeight,
    mempool: [...routedTxs, ...autoProposeTxs]
  };
  
  const appliedTxs = validationResult.value.map(entry => entry.tx);
  
  return Ok({
    server: finalServer,
    stateHash: computeStateHash(finalServer),
    appliedTxs: appliedTxs,
    failedTxs: [], // Currently no transactions fail in validation
    messages: allMessages
  });
};
```

# /Users/adimov/Developer/xln/v3/src/core/consensus.ts

```typescript
// ============================================================================
// core/consensus.ts - Consensus utilities
// ============================================================================

import type { BlockHeight, SignerIdx } from '../types/primitives.js';

export const getProposer = (h: BlockHeight, quorum: readonly SignerIdx[]): SignerIdx => {
  if (quorum.length === 0) throw new Error('Empty quorum');
  const index = Number(h) % quorum.length;
  const proposer = quorum[index];
  if (proposer === undefined) throw new Error('Invalid proposer calculation');
  return proposer;
};

export const hasQuorum = (
  approvals: Set<SignerIdx>, 
  quorum: readonly SignerIdx[]
): boolean => {
  if (quorum.length > 1_000_000) {
    throw new Error('Quorum size exceeds maximum allowed (1M signers)');
  }
  
  const a = BigInt(approvals.size);
  const q = BigInt(quorum.length);
  return a * 3n >= q * 2n;
};

export const isTimedOut = (timestamp: number, timeoutMs: number): boolean => {
  return Date.now() - timestamp > timeoutMs;
};
```

# /Users/adimov/Developer/xln/v3/src/core/server.ts

```typescript
// ============================================================================
// core/server.ts - Server state management
// ============================================================================

import { height, id, signer } from '../types/primitives.js';
import type { EntityCommand, EntityMeta, EntityState, ServerState, ServerTx, SignerIdx } from '../types/state.js';
import { assoc } from '../utils/immutable.js';

const MAX_QUORUM_SIZE = 1_000_000;

/**
 * Register an entity in the registry only.
 * Does NOT create replicas - signers must explicitly import.
 */
export const registerEntity = (
  server: ServerState,
  entityId: string,
  quorum: number[],
  initialState: any = { balance: 0n, nonce: 0 },
  protocol = 'wallet',
  timeoutMs = 30000
): ServerState => {
  if (quorum.length === 0) {
    throw new Error('Quorum cannot be empty');
  }
  
  if (quorum.length > MAX_QUORUM_SIZE) {
    throw new Error(`Quorum size ${quorum.length} exceeds maximum allowed (${MAX_QUORUM_SIZE})`);
  }
  
  const meta: EntityMeta = {
    id: id(entityId),
    quorum: quorum.map(signer),
    timeoutMs,
    protocol
  };
  
  return {
    ...server,
    registry: assoc(server.registry, id(entityId), meta)
  };
};

/**
 * Import an entity to a specific signer.
 * Signer must be in the entity's quorum.
 * This creates the actual replica.
 */
export const importEntity = (
  server: ServerState,
  signerId: SignerIdx,
  entityId: string,
  initialState?: any
): ServerState => {
  const meta = server.registry.get(id(entityId));
  if (!meta) {
    throw new Error(`Entity ${entityId} not registered`);
  }
  
  if (!meta.quorum.includes(signerId)) {
    throw new Error(`Signer ${signerId} not in quorum for entity ${entityId}`);
  }
  
  const signerEntities = server.signers.get(signerId) ?? new Map();
  
  if (signerEntities.has(id(entityId))) {
    return server; // Already imported, no-op
  }
  
  const entity: EntityState = {
    id: id(entityId),
    height: height(0),
    stage: 'idle',
    data: initialState ?? getDefaultProtocolState(meta.protocol),
    mempool: []
  };
  
  const updatedSignerEntities = assoc(signerEntities, id(entityId), entity);
  
  return {
    ...server,
    signers: assoc(server.signers, signerId, updatedSignerEntities)
  };
};

/**
 * Helper to get default state for a protocol
 */
const getDefaultProtocolState = (protocol: string): any => {
  switch (protocol) {
    case 'wallet':
      return { balance: 0n, nonce: 0 };
    case 'dao':
      return { balance: 0n, nonce: 0, initiatives: new Map(), memberCount: 0, voteThreshold: 66 };
    default:
      return {};
  }
};

export const submitTransaction = (
  server: ServerState,
  signerIdx: number,
  entityId: string,
  command: EntityCommand
): ServerState => {
  const tx: ServerTx = {
    signer: signer(signerIdx),
    entityId: id(entityId),
    command
  };
  
  return {
    ...server,
    mempool: [...server.mempool, tx]
  };
};
```

# /Users/adimov/Developer/xln/v3/src/infra/deps.ts

```typescript
// ============================================================================
// infra/deps.ts - External dependencies
// ============================================================================

import type { Clock } from '../core/block.js';

export type Logger = {
  readonly info: (msg: string, data?: any) => void;
  readonly warn: (msg: string, data?: any) => void;
  readonly error: (msg: string, data?: any) => void;
};

export const SystemClock: Clock = {
  now: () => Date.now()
};

export const ConsoleLogger: Logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || '')
};

export const SilentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};
```

# /Users/adimov/Developer/xln/v3/src/infra/runner.ts

```typescript
// ============================================================================
// infra/runner.ts - Block runner with effects
// ============================================================================

import type { Clock } from '../core/block.js';
import { processBlockPure } from '../core/block.js';
import type { Storage } from '../storage/interface.js';
import { height } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, ServerState } from '../types/state.js';
import { computeStateHash } from '../utils/hash.js';
import { createInitialState } from '../utils/serialization.js';
import type { Logger } from './deps.js';
import { ConsoleLogger, SystemClock } from './deps.js';

export type RunnerConfig = {
  readonly storage: Storage;
  readonly protocols: ProtocolRegistry;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly snapshotInterval?: number;
};

export const createBlockRunner = (config: RunnerConfig) => {
  const { 
    storage, 
    protocols, 
    clock = SystemClock, 
    logger = ConsoleLogger,
    snapshotInterval = 100 
  } = config;
  
  const runner = {
    processBlock: async (server: ServerState, skipWal = false): Promise<Result<ServerState>> => {
      const nextHeight = height(Number(server.height) + 1);
      
      const blockResult = processBlockPure({ server, protocols, clock });
      if (!blockResult.ok) {
        return blockResult;
      }
      
      const processed = blockResult.value;
      
      if (!skipWal && server.mempool.length > 0) {
        const walResult = await storage.wal.append(nextHeight, server.mempool);
        if (!walResult.ok) {
          return Err(`WAL write failed: ${walResult.error}`);
        }
      }
      
      const blockData: BlockData = {
        height: nextHeight,
        timestamp: clock.now(),
        transactions: server.mempool,
        stateHash: processed.stateHash,
        parentHash: Number(server.height) > 0 ? computeStateHash(server) : undefined
      };
      
      const saveResult = await storage.blocks.save(nextHeight, blockData);
      if (!saveResult.ok) {
        logger.error('Block save failed', saveResult.error);
      }
      
      if (Number(nextHeight) % snapshotInterval === 0) {
        const snapshotResult = await storage.snapshots.save(processed.server);
        if (!snapshotResult.ok) {
          logger.error('Snapshot failed', snapshotResult.error);
        } else {
          const truncateResult = await storage.wal.truncateBefore(nextHeight);
          if (!truncateResult.ok) {
            logger.warn('WAL truncation failed', truncateResult.error);
          }
        }
      }
      
      if (processed.failedTxs.length > 0) {
        logger.warn(`Block ${nextHeight}: ${processed.failedTxs.length} failed transactions`);
      }
      
      logger.info(`Block ${nextHeight} processed`, {
        applied: processed.appliedTxs.length,
        failed: processed.failedTxs.length,
        messages: processed.messages.length,
        newMempool: processed.server.mempool.length
      });
      
      return Ok(processed.server);
    },
    
    recover: async (initialState?: ServerState): Promise<Result<ServerState>> => {
      logger.info('Starting recovery...');
      
      const snapshotResult = await storage.snapshots.loadLatest();
      if (!snapshotResult.ok) return Err(`Snapshot load failed: ${snapshotResult.error}`);
      
      let server = snapshotResult.value || initialState || createInitialState();
      logger.info(`Loaded snapshot at height ${server.height}`);
      
      const walResult = await storage.wal.readFromHeight(height(Number(server.height) + 1));
      if (!walResult.ok) return Err(`WAL read failed: ${walResult.error}`);
      
      const walTxs = walResult.value;
      if (walTxs.length === 0) {
        logger.info('No WAL entries to replay');
        return Ok(server);
      }
      
      logger.info(`Replaying ${walTxs.length} WAL transactions`);
      
      server = { ...server, mempool: walTxs };
      const processResult = await runner.processBlock(server, true);
      if (!processResult.ok) return Err(`Recovery replay failed: ${processResult.error}`);
      
      logger.info('Recovery complete', { height: processResult.value.height, replayed: walTxs.length });
      
      return Ok(processResult.value);
    }
  };
  
  return runner;
};
```

# /Users/adimov/Developer/xln/v3/src/protocols/registry.ts

```typescript
// ============================================================================
// protocols/registry.ts - Protocol registry
// ============================================================================

import type { Protocol, ProtocolRegistry } from '../types/protocol.js';
import { DaoProtocol } from './dao.js';
import { WalletProtocol } from './wallet.js';

export const createProtocolRegistry = (
  ...protocols: Protocol<any, any>[]
): ProtocolRegistry => {
  return new Map(protocols.map(p => [p.name, p]));
};

export const defaultRegistry = createProtocolRegistry(
  WalletProtocol,
  DaoProtocol
);
```

# /Users/adimov/Developer/xln/v3/src/storage/interface.ts

```typescript
// ============================================================================
// storage/interface.ts - Storage interfaces
// ============================================================================

import type { Result } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';

export interface Storage {
  readonly wal: {
    append(height: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>>;
    readFromHeight(height: BlockHeight): Promise<Result<readonly ServerTx[]>>;
    truncateBefore(height: BlockHeight): Promise<Result<void>>;
  };
  
  readonly blocks: {
    save(height: BlockHeight, block: BlockData): Promise<Result<void>>;
    get(height: BlockHeight): Promise<Result<BlockData | null>>;
  };
  
  readonly snapshots: {
    save(state: ServerState): Promise<Result<void>>;
    loadLatest(): Promise<Result<ServerState | null>>;
  };
}
```

# /Users/adimov/Developer/xln/v3/src/storage/memory.ts

```typescript
// ============================================================================
// storage/memory.ts - In-memory storage implementation
// ============================================================================

import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';
import { Mutex } from '../utils/mutex.js';
import { deserializeWithBigInt, serializeWithBigInt } from '../utils/serialization.js';
import type { Storage } from './interface.js';

export class MemoryStorage implements Storage {
  private walEntries = new Map<string, ServerTx[]>();
  private blockStore = new Map<BlockHeight, BlockData>();
  private latestSnapshot: any = null;
  private mutex = new Mutex();
  
  readonly wal = {
    append: async (h: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const key = `wal:${Number(h).toString().padStart(10, '0')}`;
        const existing = this.walEntries.get(key) || [];
        this.walEntries.set(key, [...existing, ...txs]);
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL append failed: ${e}`);
      } finally {
        release();
      }
    },
    
    readFromHeight: async (h: BlockHeight): Promise<Result<readonly ServerTx[]>> => {
      try {
        const result: ServerTx[] = [];
        const startKey = `wal:${Number(h).toString().padStart(10, '0')}`;
        const sortedKeys = Array.from(this.walEntries.keys()).sort();
        
        for (const key of sortedKeys) {
          if (key >= startKey) {
            result.push(...(this.walEntries.get(key) ?? []));
          }
        }
        return Ok(result);
      } catch (e) {
        return Err(`WAL read failed: ${e}`);
      }
    },
    
    truncateBefore: async (h: BlockHeight): Promise<Result<void>> => {
      try {
        const endKey = `wal:${Number(h).toString().padStart(10, '0')}`;
        for (const key of this.walEntries.keys()) {
          if (key < endKey) {
            this.walEntries.delete(key);
          }
        }
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL truncate failed: ${e}`);
      }
    }
  };
  
  readonly blocks = {
    save: async (h: BlockHeight, block: BlockData): Promise<Result<void>> => {
      this.blockStore.set(h, block);
      return Ok(undefined);
    },
    get: async (h: BlockHeight): Promise<Result<BlockData | null>> => Ok(this.blockStore.get(h) || null)
  };
  
  readonly snapshots = {
    save: async (state: ServerState): Promise<Result<void>> => {
      try {
        const serialized = serializeWithBigInt(state);
        this.latestSnapshot = deserializeWithBigInt(serialized); // Simulate DB roundtrip
        return Ok(undefined);
      } catch (e) {
        return Err(`Snapshot save failed: ${e}`);
      }
    },
    
    loadLatest: async (): Promise<Result<ServerState | null>> => {
      try {
        if (!this.latestSnapshot) return Ok(null);
        return Ok(deserializeWithBigInt(serializeWithBigInt(this.latestSnapshot)));
      } catch (e) {
        return Err(`Snapshot load failed: ${e}`);
      }
    }
  };
  
  clear(): void {
    this.walEntries.clear();
    this.blockStore.clear();
    this.latestSnapshot = null;
  }
}
```

# /Users/adimov/Developer/xln/v3/src/test/dao.test.ts

```typescript
// ============================================================================
// test/dao.test.ts - DAO protocol tests
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { importEntity, registerEntity, submitTransaction } from '../core/server.js';
import { SilentLogger } from '../infra/deps.js';
import { createBlockRunner } from '../infra/runner.js';
import { createDaoState, type Initiative } from '../protocols/dao.js';
import { defaultRegistry } from '../protocols/registry.js';
import { MemoryStorage } from '../storage/memory.js';
import { id, signer, type SignerIdx } from '../types/primitives.js';
import { createInitialState } from '../utils/serialization.js';
import { getEntityFromSigner } from '../utils/state-helpers.js';

describe('DAO Protocol', () => {
  test('single signer DAO - basic initiative flow', async () => {
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({ storage, protocols: defaultRegistry, logger: SilentLogger });
    
    server = registerEntity(server, 'dao', [0], undefined, 'dao');
    server = importEntity(server, signer(0), 'dao', createDaoState(1000n, 1, 50));

    server = submitTransaction(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Fund Development',
          description: 'Transfer 100 tokens to dev team',
          author: 0,
          actions: [{ op: 'transfer', data: { amount: '100', to: 'dev-wallet' }, nonce: 2 }]
        },
        nonce: 1
      }
    });

    for (let i = 0; i < 3; i++) {
      const res = await runner.processBlock(server);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      server = res.value;
    }

    const entity1 = getEntityFromSigner(server, signer(0), id('dao'))!;
    expect(entity1.data.initiatives.size).toBe(1);
    const [initiativeId, initiative] = Array.from((entity1.data.initiatives as Map<string, Initiative>).entries())[0]!;
    
    server = submitTransaction(server, 0, 'dao', {
      type: 'addTx',
      tx: { op: 'voteInitiative', data: { initiativeId, support: true, voter: 0 }, nonce: 2 }
    });

    for (let i = 0; i < 3; i++) {
      const res = await runner.processBlock(server);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      server = res.value;
    }

    const entity2 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const initiative2 = entity2.data.initiatives.get(initiativeId)!;
    expect(initiative2.status).toBe('passed');
  });
});
```

# /Users/adimov/Developer/xln/v3/src/test/helpers.ts

```typescript
// ============================================================================
// test/helpers.ts - Testing utilities
// ============================================================================

import { importEntity, registerEntity, submitTransaction } from '../core/server.js';
import { SilentLogger } from '../infra/deps.js';
import { createBlockRunner } from '../infra/runner.js';
import { defaultRegistry } from '../protocols/registry.js';
import { MemoryStorage } from '../storage/memory.js';
import type { BlockHeight } from '../types/primitives.js';
import { id, signer } from '../types/primitives.js';
import type { EntityCommand, EntityState, ServerState, ServerTx } from '../types/state.js';
import { createInitialState } from '../utils/serialization.js';
import { getCanonicalEntity } from '../utils/state-helpers.js';

export class TestScenario {
  private server: ServerState;
  private storage: MemoryStorage;
  private runner: ReturnType<typeof createBlockRunner>;
  
  constructor(public name: string) {
    this.server = createInitialState();
    this.storage = new MemoryStorage();
    this.runner = createBlockRunner({ 
      storage: this.storage, 
      protocols: defaultRegistry,
      logger: SilentLogger,
      snapshotInterval: 10
    });
  }
  
  entity(entityId: string, signers: number[], initialBalance = 1000n): this {
    this.server = registerEntity(this.server, entityId, signers, { balance: initialBalance, nonce: 0 });
    for (const signerIdx of signers) {
      this.server = importEntity(this.server, signer(signerIdx), entityId, { balance: initialBalance, nonce: 0 });
    }
    return this;
  }
  
  multiSigEntity(entityId: string, signers: number[], initialBalance = 10000n): this {
    this.server = registerEntity(this.server, entityId, signers, { balance: initialBalance, nonce: 0 }, 'wallet', 5000);
    for (const signerIdx of signers) {
      this.server = importEntity(this.server, signer(signerIdx), entityId, { balance: initialBalance, nonce: 0 });
    }
    return this;
  }
  
  async transaction(signerIdx: number, entityId: string, command: EntityCommand): Promise<this> {
    this.server = submitTransaction(this.server, signerIdx, entityId, command);
    const result = await this.runner.processBlock(this.server, false);
    if (result.ok) this.server = result.value;
    else throw new Error(result.error);
    return this;
  }
  
  async processBlock(): Promise<this> {
    const result = await this.runner.processBlock(this.server, false);
    if (result.ok) this.server = result.value;
    else throw new Error(result.error);
    return this;
  }
  
  async recover(): Promise<this> {
    const result = await this.runner.recover();
    if (result.ok) this.server = result.value;
    else throw new Error(result.error);
    return this;
  }
  
  getEntity(entityId: string): EntityState | undefined {
    return getCanonicalEntity(this.server, id(entityId));
  }
  
  getHeight(): BlockHeight { return this.server.height; }
  getMempool(): readonly ServerTx[] { return this.server.mempool; }
  getStorage(): MemoryStorage { return this.storage; }
  getState(): ServerState { return this.server; }
}

export const createTestScenario = (name: string): TestScenario => new TestScenario(name);
```

# /Users/adimov/Developer/xln/v3/src/test/multisig-flow.test.ts

```typescript
// ============================================================================
// test/multisig-flow.test.ts - Tests for multi-sig consensus flow
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { importEntity, registerEntity, submitTransaction } from '../core/server.js';
import { createBlockRunner } from '../infra/runner.js';
import { defaultRegistry } from '../protocols/registry.js';
import { MemoryStorage } from '../storage/memory.js';
import { id, signer } from '../types/primitives.js';
import { createInitialState } from '../utils/serialization.js';
import { getEntityFromSigner } from '../utils/state-helpers.js';
import { SilentLogger } from '../infra/deps.js';

describe('Multi-sig Flow', () => {
  test('multi-sig entity should process through consensus', async () => {
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({ storage, protocols: defaultRegistry, logger: SilentLogger });
    
    server = registerEntity(server, 'dao', [0, 1, 2], { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(0), 'dao', { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(1), 'dao', { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(2), 'dao', { balance: 1000n, nonce: 0 });
    
    server = submitTransaction(server, 0, 'dao', {
      type: 'addTx',
      tx: { op: 'burn', data: { amount: '100' }, nonce: 1 }
    });
    
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
    
    const dao0 = getEntityFromSigner(server, signer(0), id('dao'));
    expect(dao0?.mempool.length).toBe(1);
    
    server = submitTransaction(server, 0, 'dao', { type: 'proposeBlock' });
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
    
    const dao0Proposed = getEntityFromSigner(server, signer(0), id('dao'));
    expect(dao0Proposed?.stage).toBe('proposed');
    
    for (let i = 0; i < 5; i++) {
      result = await runner.processBlock(server);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      server = result.value;
      
      const daoCheck = getEntityFromSigner(server, signer(0), id('dao'));
      if (daoCheck?.stage === 'idle' && daoCheck.data.balance === 900n) break;
    }
    
    const daoFinal = getEntityFromSigner(server, signer(0), id('dao'));
    expect(daoFinal?.data.balance).toBe(900n);
    expect(daoFinal?.data.nonce).toBe(1);
  });
});
```

# /Users/adimov/Developer/xln/v3/src/test/signer-layer.test.ts

```typescript
// ============================================================================
// test/signer-layer.test.ts - Tests for signer layer functionality
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { importEntity, registerEntity } from '../core/server.js';
import { id, signer } from '../types/primitives.js';
import { createInitialState } from '../utils/serialization.js';
import { getEntityAcrossSigners, getEntityFromSigner } from '../utils/state-helpers.js';

describe('Signer Layer', () => {
  test('registerEntity only adds to registry', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0, 1], { balance: 100n, nonce: 0 });
    expect(server.registry.has(id('test'))).toBe(true);
    expect(server.signers.size).toBe(0);
  });
  
  test('importEntity creates replicas at signers', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0, 1], { balance: 100n, nonce: 0 });
    server = importEntity(server, signer(0), 'test');
    expect(server.signers.has(signer(0))).toBe(true);
    expect(getEntityFromSigner(server, signer(0), id('test'))).toBeDefined();
    expect(server.signers.has(signer(1))).toBe(false);
    server = importEntity(server, signer(1), 'test');
    expect(server.signers.size).toBe(2);
    expect(getEntityFromSigner(server, signer(1), id('test'))).toBeDefined();
  });
  
  test('getEntityAcrossSigners returns all replicas', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0, 1, 2], { balance: 100n, nonce: 0 });
    server = importEntity(server, signer(0), 'test');
    server = importEntity(server, signer(1), 'test');
    server = importEntity(server, signer(2), 'test');
    const replicas = getEntityAcrossSigners(server, id('test'));
    expect(replicas.size).toBe(3);
    expect(replicas.has(signer(0))).toBe(true);
  });
  
  test('import fails if signer not in quorum', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0, 1], { balance: 100n, nonce: 0 });
    expect(() => importEntity(server, signer(2), 'test')).toThrow('Signer 2 not in quorum');
  });
  
  test('import is idempotent', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0], { balance: 100n, nonce: 0 });
    server = importEntity(server, signer(0), 'test');
    const firstImport = server;
    server = importEntity(server, signer(0), 'test');
    expect(server).toBe(firstImport);
  });
});
```

# /Users/adimov/Developer/xln/v3/src/types/brand.ts

```typescript
// ============================================================================
// types/brand.ts - Branded type utilities
// ============================================================================

export type Brand<T, B> = T & { readonly _brand: B };
```

# /Users/adimov/Developer/xln/v3/src/types/primitives.ts

```typescript
// ============================================================================
// types/primitives.ts - Core primitive types
// ============================================================================

import type { Brand } from './brand.js';

export type EntityId = Brand<string, 'EntityId'>;
export type SignerIdx = Brand<number, 'SignerIdx'>;
export type BlockHeight = Brand<number, 'BlockHeight'>;
export type BlockHash = Brand<string, 'BlockHash'>;
export type TxHash = Brand<string, 'TxHash'>;

// Ergonomic constructors
export const id = (s: string): EntityId => s as EntityId;
export const signer = (n: number): SignerIdx => n as SignerIdx;
export const height = (n: number): BlockHeight => n as BlockHeight;
export const hash = (s: string): BlockHash => s as BlockHash;
export const txHash = (s: string): TxHash => s as TxHash;
```

# /Users/adimov/Developer/xln/v3/src/types/protocol.ts

```typescript
// ============================================================================
// types/protocol.ts - Protocol system types
// ============================================================================

import type { EntityId } from './primitives.js';
import type { Result } from './result.js';
import type { EntityTx, OutboxMsg } from './state.js';

export type Protocol<TState, TData> = {
  readonly name: string;
  readonly validateTx: (tx: EntityTx) => Result<TData>;
  readonly applyTx: (state: TState, data: TData, tx: EntityTx) => Result<TState>;
  readonly generateMessages?: (entityId: EntityId, data: TData) => readonly OutboxMsg[];
};

export type ProtocolRegistry = ReadonlyMap<string, Protocol<any, any>>;

export interface Nonced {
  readonly nonce: number;
}

export const isNonced = (state: any): state is Nonced => {
  return state !== null && 
         typeof state === 'object' && 
         'nonce' in state && 
         Number.isSafeInteger(state.nonce);
};
```

# /Users/adimov/Developer/xln/v3/src/types/result.ts

```typescript
// ============================================================================
// types/result.ts - Result type for error handling
// ============================================================================

export type Result<T, E = string> = 
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T, E = string>(value: T): Result<T, E> => ({ ok: true, value });
export const Err = <E = string>(error: E): Result<never, E> => ({ ok: false, error });

export const mapResult = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> => result.ok ? Ok<U, E>(fn(result.value)) : result;
export const flatMapResult = <T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> => result.ok ? fn(result.value) : result;

export const collectResults = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return Ok<T[], E>(values);
};
```

# /Users/adimov/Developer/xln/v3/src/types/state.ts

```typescript
// ============================================================================
// types/state.ts - Core state types
// ============================================================================

import type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives.js';

export type EntityStage = 'idle' | 'proposed' | 'committing' | 'faulted';
export type SignerEntities = ReadonlyMap<EntityId, EntityState>;

export type EntityTx = {
  readonly op: string;
  readonly data: any;
  nonce?: number;
};

export type ProposedBlock = {
  readonly txs: readonly EntityTx[];
  readonly hash: BlockHash;
  readonly height: BlockHeight;
  readonly proposer: SignerIdx;
  readonly approvals: ReadonlySet<SignerIdx>;
  readonly timestamp: number;
};

export type EntityState<T = any> = {
  readonly id: EntityId;
  readonly height: BlockHeight;
  readonly stage: EntityStage;
  readonly data: T;
  readonly mempool: readonly EntityTx[];
  readonly proposal?: ProposedBlock;
  readonly lastBlockHash?: BlockHash;
  readonly faultReason?: string;
};

export type EntityMeta = {
  readonly id: EntityId;
  readonly quorum: readonly SignerIdx[];
  readonly timeoutMs: number;
  readonly protocol: string;
};

export type EntityCommand = 
  | { readonly type: 'addTx'; readonly tx: EntityTx }
  | { readonly type: 'proposeBlock' }
  | { readonly type: 'shareProposal'; readonly proposal: ProposedBlock }
  | { readonly type: 'approveBlock'; readonly hash: BlockHash; readonly from?: SignerIdx }
  | { readonly type: 'commitBlock'; readonly hash: BlockHash };

export type ServerTx = {
  readonly signer: SignerIdx;
  readonly entityId: EntityId;
  readonly command: EntityCommand;
};

export type OutboxMsg = {
  readonly from: EntityId;
  readonly to: EntityId;
  readonly toSigner?: SignerIdx;
  readonly command: EntityCommand;
};

export type ServerState = {
  readonly height: BlockHeight;
  readonly signers: ReadonlyMap<SignerIdx, SignerEntities>;
  readonly registry: ReadonlyMap<EntityId, EntityMeta>;
  readonly mempool: readonly ServerTx[];
  readonly entities?: ReadonlyMap<EntityId, EntityState>; // For migration
};

export type BlockData = {
  readonly height: BlockHeight;
  readonly timestamp: number;
  readonly transactions: readonly ServerTx[];
  readonly stateHash: string;
  readonly parentHash?: string;
};

export type CommandResult = {
  readonly entity: EntityState;
  readonly messages: readonly OutboxMsg[];
};

export type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives.js';
```

# /Users/adimov/Developer/xln/v3/src/utils/hash.ts

```typescript
// ============================================================================
// utils/hash.ts - Deterministic hashing
// ============================================================================

import { createHash } from 'crypto';
import type { BlockHash, BlockHeight, EntityId } from '../types/primitives.js';
import { hash } from '../types/primitives.js';
import type { EntityState, EntityTx, ServerState } from '../types/state.js';

const toCanonical = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'bigint') return obj.toString();
  if (typeof obj !== 'object') return obj;
  
  if (obj instanceof Set || obj instanceof Map) {
    return Array.from(obj.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, v]) => [toCanonical(k), toCanonical(v)]);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(toCanonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  
  return Object.keys(obj).sort().reduce((acc: any, key) => {
    acc[key] = toCanonical(obj[key]);
    return acc;
  }, {});
};

export const deterministicHash = (data: any): string => {
  const canonical = toCanonical(data);
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
};

export const computeBlockHash = (
  entityId: EntityId,
  blockHeight: BlockHeight,
  state: any,
  txs: readonly EntityTx[]
): BlockHash => {
  return hash(deterministicHash({ entityId, height: blockHeight, state, txs }));
};

let stateHashCache = new WeakMap<EntityState, string>();
let cacheHits = 0;

export const computeStateHash = (server: ServerState): string => {
  if (++cacheHits > 10_000) {
    stateHashCache = new WeakMap<EntityState, string>();
    cacheHits = 0;
  }
  
  const signerHashes: [string, [string, string][]][] = [];
  
  for (const [signerId, entities] of server.signers) {
    const entityHashes: [string, string][] = [];
    for (const [entityId, entity] of entities) {
      let entityHash = stateHashCache.get(entity);
      if (!entityHash) {
        entityHash = deterministicHash({
          height: entity.height,
          stage: entity.stage,
          data: entity.data,
          lastBlockHash: entity.lastBlockHash
        });
        stateHashCache.set(entity, entityHash);
      }
      entityHashes.push([entityId, entityHash]);
    }
    entityHashes.sort(([a], [b]) => a.localeCompare(b));
    signerHashes.push([String(signerId), entityHashes]);
  }
  
  signerHashes.sort(([a], [b]) => a.localeCompare(b));
  
  const stateData = {
    height: server.height,
    signers: signerHashes,
    registry: Array.from(server.registry.entries()).sort(([a], [b]) => a.localeCompare(b))
  };
  
  return deterministicHash(stateData);
};
```

# /Users/adimov/Developer/xln/v3/src/utils/immutable.ts

```typescript
// ============================================================================
// utils/immutable.ts - Efficient immutable operations
// ============================================================================

export const assoc = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> => {
  if (map.get(key) === value) return map;
  const newMap = new Map(map);
  newMap.set(key, value);
  return newMap;
};

export const dissoc = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  if (!map.has(key)) return map;
  const newMap = new Map(map);
  newMap.delete(key);
  return newMap;
};
```

# /Users/adimov/Developer/xln/v3/src/utils/migration.ts

```typescript
// ============================================================================
// utils/migration.ts - Migration utilities for signer layer transition
// ============================================================================

import type { ServerState, SignerEntities, SignerIdx } from '../types/state.js';
import { assoc } from './immutable.js';

export const migrateFromFlatEntities = (server: ServerState): ServerState => {
  if (server.signers.size > 0) return server;
  
  if (server.entities && server.entities.size > 0) {
    const signers = new Map<SignerIdx, SignerEntities>();
    
    for (const [entityId, entity] of server.entities) {
      const meta = server.registry.get(entityId);
      if (!meta) continue;
      
      for (const signerId of meta.quorum) {
        const signerEntities = signers.get(signerId) ?? new Map();
        signers.set(signerId, assoc(signerEntities, entityId, entity));
      }
    }
    
    return { ...server, signers, entities: undefined };
  }
  
  return server;
};

export const createCompatibilityWrapper = (server: ServerState): ServerState => {
  const flatEntities = new Map();
  
  for (const [, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const existing = flatEntities.get(entityId);
      if (!existing || Number(entity.height) > Number(existing.height)) {
        flatEntities.set(entityId, entity);
      }
    }
  }
  
  return { ...server, entities: flatEntities };
};
```

# /Users/adimov/Developer/xln/v3/src/utils/mutex.ts

```typescript
// ============================================================================
// utils/mutex.ts - Simple async mutex for memory storage
// ============================================================================

export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;
  
  async acquire(): Promise<() => void> {
    if (this.queue.length >= 10_000) {
      throw new Error('Mutex queue overflow - possible deadlock');
    }
    
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    
    return new Promise(resolve => {
      this.queue.push(() => resolve(() => this.release()));
    });
  }
  
  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}
```

# /Users/adimov/Developer/xln/v3/src/utils/serialization.ts

```typescript
// ============================================================================
// utils/serialization.ts - JSON serialization with BigInt support
// ============================================================================

import { height } from '../types/primitives.js';
import type { ServerState } from '../types/state.js';

export const serializeWithBigInt = (obj: any): string => {
  return JSON.stringify(obj, (_, value) => 
    typeof value === 'bigint' ? { _type: 'bigint', value: value.toString() } : value
  );
};

export const deserializeWithBigInt = (text: string): any => {
  return JSON.parse(text, (_, value) => 
    value && typeof value === 'object' && value._type === 'bigint' ? BigInt(value.value) : value
  );
};

export const createInitialState = (): ServerState => ({
  height: height(0),
  signers: new Map(),
  registry: new Map(),
  mempool: []
});
```

# /Users/adimov/Developer/xln/v3/src/utils/state-helpers.ts

```typescript
// ============================================================================
// utils/state-helpers.ts - Helper functions for working with hierarchical state
// ============================================================================

import type { EntityId, EntityState, ServerState, SignerIdx } from '../types/state.js';

export const getEntityAcrossSigners = (server: ServerState, entityId: EntityId): ReadonlyMap<SignerIdx, EntityState> => {
  const results = new Map<SignerIdx, EntityState>();
  for (const [signerId, entities] of server.signers) {
    const entity = entities.get(entityId);
    if (entity) results.set(signerId, entity);
  }
  return results;
};

export const getCanonicalEntity = (server: ServerState, entityId: EntityId): EntityState | undefined => {
  let best: EntityState | undefined;
  for (const [, entities] of server.signers) {
    const entity = entities.get(entityId);
    if (entity && (!best || Number(entity.height) > Number(best.height))) {
      best = entity;
    }
  }
  return best;
};

export const getEntityFromSigner = (server: ServerState, signerId: SignerIdx, entityId: EntityId): EntityState | undefined => server.signers.get(signerId)?.get(entityId);
export const entityExists = (server: ServerState, entityId: EntityId): boolean => {
  for (const [, entities] of server.signers) {
    if (entities.has(entityId)) return true;
  }
  return false;
};

export const getFlatEntities = (server: ServerState): Map<EntityId, EntityState> => {
  const flat = new Map<EntityId, EntityState>();
  for (const [, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const existing = flat.get(entityId);
      if (!existing || Number(entity.height) > Number(existing.height)) {
        flat.set(entityId, entity);
      }
    }
  }
  return flat;
};

export const countEntityReplicas = (server: ServerState): number => {
  let count = 0;
  for (const [, entities] of server.signers) count += entities.size;
  return count;
};

export const getEntitySigners = (server: ServerState, entityId: EntityId): SignerIdx[] => {
  const signers: SignerIdx[] = [];
  for (const [signerId, entities] of server.signers) {
    if (entities.has(entityId)) signers.push(signerId);
  }
  return signers;
};
```

# /Users/adimov/Developer/xln/v3/src/examples.ts

```typescript
// ============================================================================
// examples.ts - Usage examples
// ============================================================================

import { importEntity, registerEntity, submitTransaction } from './core/server.js';
import { ConsoleLogger } from './infra/deps.js';
import { createBlockRunner } from './infra/runner.js';
import { defaultRegistry } from './protocols/registry.js';
import { MemoryStorage } from './storage/memory.js';
import { id, signer } from './types/primitives.js';
import { createInitialState } from './utils/serialization.js';
import { getCanonicalEntity } from './utils/state-helpers.js';

export async function runExample() {
  console.log('=== XLN v3 Example ===\n');
  
  const storage = new MemoryStorage();
  const runner = createBlockRunner({ storage, protocols: defaultRegistry, logger: ConsoleLogger, snapshotInterval: 5 });
  
  let server = createInitialState();
  
  server = registerEntity(server, 'alice', [0], { balance: 1000n, nonce: 0 });
  server = registerEntity(server, 'bob', [1], { balance: 500n, nonce: 0 });
  server = registerEntity(server, 'dao', [0, 1, 2], { balance: 10000n, nonce: 0 });
  
  server = importEntity(server, signer(0), 'alice', { balance: 1000n, nonce: 0 });
  server = importEntity(server, signer(1), 'bob', { balance: 500n, nonce: 0 });
  server = importEntity(server, signer(0), 'dao', { balance: 10000n, nonce: 0 });
  server = importEntity(server, signer(1), 'dao', { balance: 10000n, nonce: 0 });
  server = importEntity(server, signer(2), 'dao', { balance: 10000n, nonce: 0 });
  
  console.log('Registered entities: alice, bob, dao\n');
  
  console.log('=== Example 1: Simple Transfer ===');
  server = submitTransaction(server, 0, 'alice', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'bob', amount: '100' }, nonce: 1 }
  });
  
  for (let i = 0; i < 4; i++) {
    const result = await runner.processBlock(server);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
  }
  
  const finalAlice = getCanonicalEntity(server, id('alice'));
  const finalBob = getCanonicalEntity(server, id('bob'));
  console.log(`- Alice balance: ${finalAlice?.data.balance}, Bob balance: ${finalBob?.data.balance}\n`);
  
  console.log('=== Example 2: Multi-Sig Transaction ===');
  server = submitTransaction(server, 0, 'dao', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'alice', amount: '1000' }, nonce: 1 }
  });
  
  for (let i = 0; i < 5; i++) {
    const result = await runner.processBlock(server);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
  }
  
  const finalDao = getCanonicalEntity(server, id('dao'));
  console.log(`Final DAO balance: ${finalDao?.data.balance}\n`);
  
  console.log('=== Example 3: Recovery Test ===');
  const recoveryResult = await runner.recover();
  if (!recoveryResult.ok) throw new Error(recoveryResult.error);
  const recovered = recoveryResult.value;
  console.log(`Height after recovery: ${recovered.height}`);
}
```

# /Users/adimov/Developer/xln/v3/index.ts

```typescript
// ============================================================================
// XLN v3 - Main entry point
// ============================================================================

// Export all key types
export type { BlockHash, BlockHeight, EntityId, SignerIdx } from './src/types/primitives.js';
export type { Result } from './src/types/result.js';
export type { EntityCommand, EntityState, OutboxMsg, ServerState, ServerTx, SignerEntities } from './src/types/state.js';
export type { Protocol, ProtocolRegistry } from './src/types/protocol.js';
export type { DaoState, Initiative, DaoOp, WalletState, WalletOp } from './src/protocols/dao.js';

// Export core functionality
export { processBlockPure } from './src/core/block.js';
export { processEntityCommand } from './src/entity/commands.js';
export { importEntity, registerEntity, submitCommand } from './src/engine/server.js';
export { transaction } from './src/entity/transactions.js';

// Export protocols
export { createProtocolRegistry, defaultRegistry } from './src/protocols/registry.js';
export { WalletProtocol } from './src/protocols/wallet.js';
export { DaoProtocol, createDaoState } from './src/protocols/dao.js';

// Export storage and infrastructure
export type { Storage } from './src/storage/interface.js';
export { MemoryStorage } from './src/storage/memory.js';
export { ConsoleLogger, SilentLogger, SystemClock } from './src/infra/deps.js';
export { createBlockRunner } from './src/infra/runner.js';

// Export utilities
export { computeStateHash, deterministicHash } from './src/utils/hash.js';
export { createInitialState } from './src/utils/serialization.js';
export { getCanonicalEntity, getEntityAcrossSigners, getEntityFromSigner } from './src/utils/state-helpers.js';

// Export testing utilities
export { scenario, patterns } from './src/test/fluent-api.js';

// Export examples
export { runExample } from './src/examples.js';

async function main() {
  try {
    const { runExample } = await import('./src/examples.js');
    await runExample();
  } catch (error) {
    console.error('Error running example:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
```
