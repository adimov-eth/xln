// ============================================================================
// core/entity/commands.ts - Entity command processing
// ============================================================================

import type { SignerIdx } from '../../types/primitives.js';
import { height } from '../../types/primitives.js';
import type { ProtocolRegistry } from '../../types/protocol.js';
import { isNonced } from '../../types/protocol.js';
import type { Result } from '../../types/result.js';
import { Err, Ok } from '../../types/result.js';
import type { CommandResult, EntityCommand, EntityMeta, EntityState, OutboxMsg } from '../../types/state.js';
import { computeBlockHash } from '../../utils/hash.js';
import { getProposer, hasQuorum, isTimedOut } from '../consensus.js';

export type CommandContext = {
  readonly entity: EntityState;
  readonly command: EntityCommand;
  readonly signer: SignerIdx;
  readonly meta: EntityMeta;
  readonly protocols: ProtocolRegistry;
  readonly now: number;
};

// Command handlers
const handleAddTx = (ctx: CommandContext): Result<CommandResult> => {
  const { entity, command } = ctx;
  
  if (entity.stage !== 'idle') {
    return Err('Can only add transactions when idle');
  }
  
  if (command.type !== 'addTx') {
    return Err('Invalid command type');
  }
  
  return Ok({
    entity: { ...entity, mempool: [...entity.mempool, command.tx] },
    messages: []
  });
};

const handleProposeBlock = (ctx: CommandContext): Result<CommandResult> => {
  const { entity, signer, meta, now } = ctx;
  
  if (entity.stage !== 'idle') {
    return Err('Can only propose when idle');
  }
  
  if (entity.mempool.length === 0) {
    return Err('No transactions to propose');
  }
  
  const expectedProposer = getProposer(entity.height, meta.quorum);
  if (signer !== expectedProposer) {
    return Err(`Not the current proposer (expected: ${expectedProposer})`);
  }
  
  const blockHash = computeBlockHash(
    meta.id,
    entity.height,
    entity.data,
    entity.mempool
  );
  
  const proposal = {
    txs: entity.mempool,
    hash: blockHash,
    height: entity.height,
    proposer: signer,
    approvals: new Set([signer]),
    timestamp: now
  };
  
  // Single signer fast path
  if (meta.quorum.length === 1) {
    const committingEntity: EntityState = {
      ...entity,
      stage: 'committing',
      proposal,
      mempool: []
    };
    
    const commitMsg: OutboxMsg = {
      from: meta.id,
      to: meta.id,
      toSigner: signer,
      command: { type: 'commitBlock', hash: blockHash }
    };
    
    return Ok({ entity: committingEntity, messages: [commitMsg] });
  }
  
  // Multi-signer path
  const proposedEntity: EntityState = {
    ...entity,
    stage: 'proposed',
    proposal,
    mempool: []
  };
  
  const approvalMessages: readonly OutboxMsg[] = meta.quorum
    .filter(s => s !== signer)
    .map(s => ({
      from: meta.id,
      to: meta.id,
      toSigner: s,
      command: { type: 'approveBlock' as const, hash: blockHash }
    }));
  
  return Ok({ entity: proposedEntity, messages: approvalMessages });
};

const handleApproveBlock = (ctx: CommandContext): Result<CommandResult> => {
  const { entity, command, signer, meta } = ctx;
  
  if (entity.stage !== 'proposed') {
    return Err('Can only approve when proposed');
  }
  
  if (command.type !== 'approveBlock') {
    return Err('Invalid command type');
  }
  
  if (!entity.proposal) {
    return Err('No proposal to approve');
  }
  
  if (entity.proposal.hash !== command.hash) {
    return Err('Approval hash does not match proposal');
  }
  
  const approver = command.from ?? signer;
  if (!meta.quorum.includes(approver)) {
    return Err(`Approver ${approver} not in quorum`);
  }
  
  const newApprovals = new Set(entity.proposal.approvals);
  newApprovals.add(approver);
  
  const updatedProposal = {
    ...entity.proposal,
    approvals: newApprovals
  };
  
  // Check if quorum reached
  if (hasQuorum(newApprovals, meta.quorum)) {
    const committingEntity: EntityState = {
      ...entity,
      stage: 'committing',
      proposal: updatedProposal
    };
    
    const commitMsg: OutboxMsg = {
      from: meta.id,
      to: meta.id,
      toSigner: entity.proposal.proposer,
      command: { type: 'commitBlock', hash: command.hash }
    };
    
    return Ok({ entity: committingEntity, messages: [commitMsg] });
  }
  
  // Not enough approvals yet
  const updatedEntity: EntityState = {
    ...entity,
    proposal: updatedProposal
  };
  
  return Ok({ entity: updatedEntity, messages: [] });
};

const handleCommitBlock = (ctx: CommandContext): Result<CommandResult> => {
  const { entity, command, signer, meta, protocols } = ctx;
  
  if (entity.stage !== 'committing') {
    return Err('Can only commit when committing');
  }
  
  if (command.type !== 'commitBlock') {
    return Err('Invalid command type');
  }
  
  if (!entity.proposal) {
    return Err('No proposal to commit');
  }
  
  if (entity.proposal.hash !== command.hash) {
    return Err('Commit hash does not match proposal');
  }
  
  if (signer !== entity.proposal.proposer) {
    return Err('Only proposer can commit');
  }
  
  const protocol = protocols.get(meta.protocol);
  if (!protocol) {
    return Err(`Unknown protocol: ${meta.protocol}`);
  }
  
  // Apply transactions with centralized nonce checking
  let newData = entity.data;
  const failedTxs = [];
  const messages: OutboxMsg[] = [];
  
  for (const tx of entity.proposal.txs) {
    // Centralized nonce check for all protocols using type guard
    if (tx.nonce !== undefined && isNonced(newData)) {
      const expectedNonce = newData.nonce + 1;
      if (tx.nonce !== expectedNonce) {
        failedTxs.push(tx);
        continue;
      }
    }
    
    const validateResult = protocol.validateTx(tx);
    if (!validateResult.ok) {
      failedTxs.push(tx);
      continue;
    }
    
    const applyResult = protocol.applyTx(newData, validateResult.value, tx);
    if (!applyResult.ok) {
      failedTxs.push(tx);
      continue;
    }
    
    newData = applyResult.value;
    
    if (protocol.generateMessages) {
      messages.push(...protocol.generateMessages(meta.id, validateResult.value));
    }
  }
  
  // Transition to idle with new state
  const newEntity: EntityState = {
    ...entity,
    height: height(Number(entity.height) + 1),
    stage: 'idle',
    data: newData,
    mempool: failedTxs,
    proposal: undefined,
    lastBlockHash: command.hash
  };
  
  return Ok({ entity: newEntity, messages });
};

// Command handlers table for exhaustive dispatch
type CommandHandler = (ctx: CommandContext) => Result<CommandResult>;

const commandHandlers: Record<EntityCommand['type'], CommandHandler> = {
  addTx: handleAddTx,
  proposeBlock: handleProposeBlock,
  approveBlock: handleApproveBlock,
  commitBlock: handleCommitBlock
};

// Main command processor - simplified with table dispatch
export const processEntityCommand = (ctx: CommandContext): Result<CommandResult> => {
  // Check authorization first
  if (!ctx.meta.quorum.includes(ctx.signer)) {
    return Err(`Signer ${ctx.signer} not authorized`);
  }
  
  // Handle faulted state
  if (ctx.entity.stage === 'faulted') {
    return Err(`Entity is faulted: ${ctx.entity.faultReason}`);
  }
  
  // Handle timeouts - only if not already idle (prevent recursion)
  if (ctx.entity.stage === 'proposed' && 
      ctx.entity.proposal &&
      isTimedOut(ctx.entity.proposal.timestamp, ctx.meta.timeoutMs)) {
    // Transition to idle and reprocess
    const timedOutEntity: EntityState = {
      ...ctx.entity,
      stage: 'idle',
      mempool: [...ctx.entity.proposal.txs, ...ctx.entity.mempool],
      proposal: undefined
    };
    
    return processEntityCommand({
      ...ctx,
      entity: timedOutEntity
    });
  }
  
  // Dispatch to handler
  const handler = commandHandlers[ctx.command.type];
  if (!handler) {
    return Err(`Unknown command type: ${ctx.command.type}`);
  }
  
  return handler(ctx);
}; 