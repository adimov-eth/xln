// ============================================================================
// entity/commands.ts - Entity command processing that reads like English
// ============================================================================

import type { SignerIdx, BlockHash, EntityId } from '../types/primitives.js';
import { hash as blockHash, id } from '../types/primitives.js';
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
import { getProposer, hasQuorum } from '../core/consensus.js';

// ============================================================================
// Command Processing Context
// ============================================================================

export type CommandContext = {
  entity: EntityState;
  command: EntityCommand;
  signer: SignerIdx;
  meta: EntityMeta;
  timestamp: number;
};

export type CommandResult = {
  entity: EntityState;
  messages: OutboxMsg[];
};

// ============================================================================
// Main Command Processor - Reads like English
// ============================================================================

export const processCommand = (context: CommandContext): Result<CommandResult> => {
  const { entity, command, signer, meta } = context;
  
  // Check if signer is authorized
  if (!signerIsAuthorized(signer, meta)) {
    return Err(`Signer ${signer} is not authorized for this entity`);
  }
  
  // Handle faulted entities
  if (entityIsFaulted(entity)) {
    return Err(`Entity is faulted: ${entity.faultReason}`);
  }
  
  // Handle timeout recovery
  if (proposalHasTimedOut(entity, context)) {
    return processCommand({
      ...context,
      entity: recoverFromTimeout(entity)
    });
  }
  
  // Process the actual command
  if (command.type === 'addTx') {
    return addTransactionToMempool(entity, command.tx);
  }
  
  if (command.type === 'proposeBlock') {
    return createBlockProposal(entity, signer, meta, context.timestamp);
  }
  
  if (command.type === 'shareProposal') {
    return receiveSharedProposal(entity, command.proposal, signer, meta);
  }
  
  if (command.type === 'approveBlock') {
    return addApprovalToBlock(entity, command, signer, meta);
  }
  
  if (command.type === 'commitBlock') {
    return finalizeAndCommitBlock(entity, command.hash, signer, meta);
  }
  
  return Err('Unknown command type');
};

// ============================================================================
// Command Handlers - Each reads like a sentence
// ============================================================================

const addTransactionToMempool = (
  entity: EntityState, 
  transaction: EntityTx
): Result<CommandResult> => {
  if (entity.stage !== 'idle') {
    return Err('Can only add transactions when entity is idle');
  }
  
  const updatedEntity = {
    ...entity,
    mempool: [...entity.mempool, transaction]
  };
  
  return Ok({ entity: updatedEntity, messages: [] });
};

const createBlockProposal = (
  entity: EntityState,
  signer: SignerIdx,
  meta: EntityMeta,
  timestamp: number
): Result<CommandResult> => {
  // Check preconditions
  if (entity.stage !== 'idle') {
    return Err('Can only propose blocks when idle');
  }
  
  if (entity.mempool.length === 0) {
    return Err('No transactions to propose');
  }
  
  if (!signerIsCurrentProposer(signer, entity.height, meta.quorum)) {
    const expected = getProposer(entity.height, meta.quorum);
    return Err(`Not the current proposer (expected signer ${expected})`);
  }
  
  // Create the proposal
  const proposal = createProposal(entity, signer, timestamp, meta.id);
  
  // Handle single-signer fast path
  if (isSingleSigner(meta)) {
    return moveStraightToCommitting(entity, proposal, signer, meta.id);
  }
  
  // Multi-signer path: share with others
  return shareProposalWithOthers(entity, proposal, signer, meta);
};

const receiveSharedProposal = (
  entity: EntityState,
  proposal: ProposedBlock,
  signer: SignerIdx,
  meta: EntityMeta
): Result<CommandResult> => {
  if (entity.stage !== 'idle') {
    return Err('Can only receive proposals when idle');
  }
  
  if (!proposalIsFromValidProposer(proposal, entity.height, meta.quorum)) {
    return Err(`Invalid proposer: ${proposal.proposer}`);
  }
  
  // Accept the proposal and send approval
  const updatedEntity = {
    ...entity,
    stage: 'proposed' as const,
    proposal,
    mempool: []
  };
  
  const approvalMessage = createApprovalMessage(
    meta.id,
    proposal.proposer,
    proposal.hash,
    signer
  );
  
  return Ok({ 
    entity: updatedEntity, 
    messages: [approvalMessage] 
  });
};

const addApprovalToBlock = (
  entity: EntityState,
  command: { type: 'approveBlock'; hash: string; from?: SignerIdx },
  signer: SignerIdx,
  meta: EntityMeta
): Result<CommandResult> => {
  // Handle late approvals gracefully
  if (entity.stage === 'committing') {
    return Ok({ entity, messages: [] });
  }
  
  if (entity.stage !== 'proposed' || !entity.proposal) {
    return Err('Can only approve blocks when proposed');
  }
  
  if (entity.proposal.hash !== command.hash) {
    return Err('Approval hash does not match proposal');
  }
  
  const approver = command.from ?? signer;
  if (!approverIsInQuorum(approver, meta.quorum)) {
    return Err(`Approver ${approver} is not in quorum`);
  }
  
  if (proposalAlreadyHasApproval(entity.proposal, approver)) {
    return Err(`Signer ${approver} already approved`);
  }
  
  // Add the approval
  const updatedProposal = addApproval(entity.proposal, approver);
  
  // Check if we have consensus
  if (hasQuorum(updatedProposal.approvals, meta.quorum)) {
    return moveToCommittingWithConsensus(entity, updatedProposal, meta.id);
  }
  
  // Still waiting for more approvals
  return Ok({
    entity: { ...entity, proposal: updatedProposal },
    messages: []
  });
};

const finalizeAndCommitBlock = (
  entity: EntityState,
  blockHash: BlockHash,
  signer: SignerIdx,
  meta: EntityMeta
): Result<CommandResult> => {
  // Handle idempotent commits
  if (entityAlreadyCommittedThisBlock(entity, blockHash)) {
    return Ok({ entity, messages: [] });
  }
  
  // Validate state
  if (!canCommitBlock(entity)) {
    return Err('Can only commit when in committing or proposed state');
  }
  
  if (!entity.proposal || entity.proposal.hash !== blockHash) {
    return Err('Block hash does not match current proposal');
  }
  
  // Only proposer can commit from 'committing' state
  if (entity.stage === 'committing' && signer !== entity.proposal.proposer) {
    return Err('Only the proposer can commit when in committing state');
  }
  
  // Execute the block - this is where transactions are applied
  // (This will be handled by the block execution module)
  const committedEntity: EntityState = {
    ...entity,
    height: entity.height + 1 as any, // Will fix with proper height type
    stage: 'idle',
    proposal: undefined,
    lastBlockHash: blockHash,
    mempool: [] // Failed txs will be added back during execution
  };
  
  // Notify other signers if we're the proposer
  const notifications = shouldNotifyOthers(entity, signer) 
    ? createCommitNotifications(meta, signer, blockHash)
    : [];
  
  return Ok({ 
    entity: committedEntity, 
    messages: notifications 
  });
};

// ============================================================================
// Helper Functions - Named to be self-documenting
// ============================================================================

const signerIsAuthorized = (signer: SignerIdx, meta: EntityMeta): boolean =>
  meta.quorum.includes(signer);

const entityIsFaulted = (entity: EntityState): boolean =>
  entity.stage === 'faulted';

const proposalHasTimedOut = (entity: EntityState, context: CommandContext): boolean =>
  entity.stage === 'proposed' && 
  entity.proposal !== undefined &&
  (context.timestamp - entity.proposal.timestamp) > context.meta.timeoutMs;

const recoverFromTimeout = (entity: EntityState): EntityState => ({
  ...entity,
  stage: 'idle',
  mempool: entity.proposal ? [...entity.proposal.txs, ...entity.mempool] : entity.mempool,
  proposal: undefined
});

const signerIsCurrentProposer = (
  signer: SignerIdx, 
  height: any, 
  quorum: readonly SignerIdx[]
): boolean =>
  signer === getProposer(height, quorum);

const isSingleSigner = (meta: EntityMeta): boolean =>
  meta.quorum.length === 1;

const createProposal = (
  entity: EntityState,
  proposer: SignerIdx,
  timestamp: number,
  entityId: EntityId
): ProposedBlock => ({
  txs: entity.mempool,
  hash: blockHash(computeBlockHash(entityId, entity.height, entity.data, entity.mempool)),
  height: entity.height,
  proposer,
  approvals: new Set([proposer]),
  timestamp
});

const moveStraightToCommitting = (
  entity: EntityState,
  proposal: ProposedBlock,
  signer: SignerIdx,
  entityId: EntityId
): Result<CommandResult> => {
  const committingEntity = {
    ...entity,
    stage: 'committing' as const,
    proposal,
    mempool: []
  };
  
  const commitMessage: OutboxMsg = {
    from: entityId,
    to: entityId,
    toSigner: signer,
    command: { type: 'commitBlock', hash: proposal.hash }
  };
  
  return Ok({ 
    entity: committingEntity, 
    messages: [commitMessage] 
  });
};

const shareProposalWithOthers = (
  entity: EntityState,
  proposal: ProposedBlock,
  signer: SignerIdx,
  meta: EntityMeta
): Result<CommandResult> => {
  const proposedEntity = {
    ...entity,
    stage: 'proposed' as const,
    proposal,
    mempool: []
  };
  
  const shareMessages = meta.quorum
    .filter(s => s !== signer)
    .map(targetSigner => ({
      from: meta.id,
      to: meta.id,
      toSigner: targetSigner,
      command: { type: 'shareProposal' as const, proposal }
    }));
  
  return Ok({ 
    entity: proposedEntity, 
    messages: shareMessages 
  });
};

const proposalIsFromValidProposer = (
  proposal: ProposedBlock,
  currentHeight: any,
  quorum: readonly SignerIdx[]
): boolean =>
  proposal.proposer === getProposer(currentHeight, quorum);

const createApprovalMessage = (
  entityId: EntityId,
  proposer: SignerIdx,
  hash: BlockHash,
  from: SignerIdx
): OutboxMsg => ({
  from: entityId,
  to: entityId,
  toSigner: proposer,
  command: { 
    type: 'approveBlock', 
    hash,
    from
  }
});

const approverIsInQuorum = (approver: SignerIdx, quorum: readonly SignerIdx[]): boolean =>
  quorum.includes(approver);

const proposalAlreadyHasApproval = (proposal: ProposedBlock, approver: SignerIdx): boolean =>
  proposal.approvals.has(approver);

const addApproval = (proposal: ProposedBlock, approver: SignerIdx): ProposedBlock => ({
  ...proposal,
  approvals: new Set([...proposal.approvals, approver])
});

const moveToCommittingWithConsensus = (
  entity: EntityState,
  proposal: ProposedBlock,
  entityId: EntityId
): Result<CommandResult> => {
  const committingEntity = {
    ...entity,
    stage: 'committing' as const,
    proposal
  };
  
  const commitMessage: OutboxMsg = {
    from: entityId,
    to: entityId,
    toSigner: proposal.proposer,
    command: { type: 'commitBlock', hash: proposal.hash }
  };
  
  return Ok({ 
    entity: committingEntity, 
    messages: [commitMessage] 
  });
};

const entityAlreadyCommittedThisBlock = (entity: EntityState, hash: BlockHash): boolean =>
  entity.stage === 'idle' && entity.lastBlockHash === hash;

const canCommitBlock = (entity: EntityState): boolean =>
  entity.stage === 'committing' || entity.stage === 'proposed';

const shouldNotifyOthers = (entity: EntityState, signer: SignerIdx): boolean =>
  entity.stage === 'committing' && 
  entity.proposal !== undefined &&
  signer === entity.proposal.proposer;

const createCommitNotifications = (
  meta: EntityMeta,
  signer: SignerIdx,
  hash: BlockHash
): OutboxMsg[] =>
  meta.quorum
    .filter(s => s !== signer)
    .map(targetSigner => ({
      from: meta.id,
      to: meta.id,
      toSigner: targetSigner,
      command: { type: 'commitBlock', hash }
    }));