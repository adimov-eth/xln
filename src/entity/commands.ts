import type { BlockHash, BlockHeight, EntityId, SignerIdx } from '../types/primitives.js';
import { hash as blockHash } from '../types/primitives.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type {
  EntityCommand,
  EntityMeta,
  EntityState,
  EntityTx,
  OutboxMsg,
  ProposedBlock
} from '../types/state.js';
import { computeBlockHash } from '../utils/hash.js';

// ============================================================================
// Consensus Utilities
// ============================================================================

export const calcRequiredApprovals = (quorumSize: number, thresholdPercent: number = 66): number => {
  if (quorumSize > 1_000_000) {
    throw new Error('Quorum size exceeds maximum allowed (1M signers)');
  }
  // Using ceiling to ensure we always require at least the threshold
  return Math.ceil((quorumSize * thresholdPercent) / 100);
};

const getProposer = (h: BlockHeight, quorum: readonly SignerIdx[]): SignerIdx => {
  if (quorum.length === 0) throw new Error('Empty quorum');
  const index = Number(h) % quorum.length;
  const proposer = quorum[index];
  if (proposer === undefined) throw new Error('Invalid proposer calculation');
  return proposer;
};

const hasQuorum = (
  approvals: Set<SignerIdx>, 
  quorum: readonly SignerIdx[],
  thresholdPercent: number = 66
): boolean => {
  const required = calcRequiredApprovals(quorum.length, thresholdPercent);
  return approvals.size >= required;
};

const isTimedOut = (timestamp: number, timeoutMs: number): boolean => {
  return Date.now() - timestamp > timeoutMs;
};

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
  
  // Pre-flight timeout recovery to avoid double validation
  const activeEntity = proposalHasTimedOut(entity, now, meta.timeoutMs) 
    ? recoverFromTimeout(entity) 
    : entity;
  
  switch (command.type) {
    case 'addTx': return addTransactionToMempool(activeEntity, command.tx);
    case 'proposeBlock': return createBlockProposal(activeEntity, signer, meta, now);
    case 'shareProposal': return receiveSharedProposal(activeEntity, command.proposal, signer, meta);
    case 'approveBlock': return addApprovalToBlock(activeEntity, command, signer, meta);
    case 'commitBlock': return finalizeAndCommitBlock(activeEntity, command.hash, signer, meta);
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
  
  // SECURITY NOTE: Currently, nodes approve blocks optimistically without validating transactions.
  // This design prioritizes liveness over immediate validation, relying on the execution phase
  // to reject invalid transactions. This could be enhanced by adding pre-approval validation
  // using the protocol's validateTx method, though it would require passing the protocol registry
  // through the command processing pipeline.
  
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
  
  if (hasQuorum(new Set(updatedProposal.approvals), meta.quorum, meta.thresholdPercent)) {
    return moveToCommittingWithConsensus(entity, updatedProposal, meta.id);
  }
  
  return Ok({ entity: { ...entity, proposal: updatedProposal }, messages: [] });
};

const finalizeAndCommitBlock = (entity: EntityState, blockHash: BlockHash, signer: SignerIdx, meta: EntityMeta): Result<CommandResult> => {
  if (entityAlreadyCommittedThisBlock(entity, blockHash)) return Ok({ entity, messages: [] });
  if (!canCommitBlock(entity)) return Err('Can only commit when in committing or proposed state');
  if (!entity.proposal || entity.proposal.hash !== blockHash) return Err('Block hash does not match current proposal');
  
  // Critical: Check quorum in proposed stage to prevent early commits
  if (entity.stage === 'proposed' && !hasQuorum(new Set(entity.proposal.approvals), meta.quorum, meta.thresholdPercent)) {
    return Err('Cannot commit block: quorum not reached');
  }
  
  if (entity.stage === 'committing' && signer !== entity.proposal.proposer) {
    return Err('Only the proposer can commit when in committing state');
  }
  
  // NOTE: Block execution is now handled by the engine/processor.
  // This command handler's job is to prepare the state for execution.
  const committedEntity: EntityState = { ...entity, stage: 'committing' };
  
  const notifications = shouldNotifyOthers(entity, signer) 
    ? createCommitNotifications(meta, signer, blockHash as BlockHash)
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