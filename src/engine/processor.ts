// ============================================================================
// engine/processor.ts - Main processing loop that reads like English
// ============================================================================

import { processCommand } from '../entity/commands.js';
import type { CommandResult } from '../entity/commands.js';
import { execute, transition } from '../entity/blocks.js';
import type { SignerIdx, BlockHash, EntityId } from '../types/primitives.js';
import { id, hash as blockHash } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { 
  ServerState, 
  ServerTx, 
  OutboxMsg,
  EntityState,
  EntityMeta,
  SignerEntities
} from '../types/state.js';
import { assoc } from '../utils/immutable.js';
import { getProposer } from '../core/consensus.js';

// ============================================================================
// Processing Result Types
// ============================================================================

export type ProcessingResult = {
  server: ServerState;
  appliedCommands: ServerTx[];
  failedCommands: FailedCommand[];
  generatedMessages: OutboxMsg[];
};

export type FailedCommand = {
  command: ServerTx;
  error: string;
};

// ============================================================================
// Main Processing Function - The heart of the engine
// ============================================================================

export const processServerTick = (
  server: ServerState,
  protocols: ProtocolRegistry,
  timestamp: number = Date.now()
): Result<ProcessingResult> => {
  // Start with empty results
  let updatedServer = server;
  const applied: ServerTx[] = [];
  const failed: FailedCommand[] = [];
  const messages: OutboxMsg[] = [];
  
  // Process each pending command
  for (const command of server.mempool) {
    const result = processOneCommand(
      updatedServer,
      command,
      protocols,
      timestamp
    );
    
    if (result.ok) {
      // Update server with new entity state
      updatedServer = applyEntityUpdate(
        updatedServer,
        command.signer,
        command.entityId,
        result.value.entity
      );
      
      // Collect results
      applied.push(command);
      messages.push(...result.value.messages);
    } else {
      failed.push({
        command,
        error: result.error
      });
    }
  }
  
  // Route messages to create new commands
  const routedCommands = routeMessagesToCommands(messages, updatedServer);
  
  // Generate auto-proposals for single-signer entities
  const autoProposals = generateAutomaticProposals(updatedServer);
  
  // Create final server state
  const finalServer: ServerState = {
    ...updatedServer,
    height: updatedServer.height + 1 as any, // Will be fixed with proper type
    mempool: [...routedCommands, ...autoProposals]
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
  timestamp: number
): Result<CommandResult> => {
  // Find the entity at the specified signer
  const entity = findEntityAtSigner(server, command.signer, command.entityId);
  if (!entity) {
    return Err(`Entity ${command.entityId} not found at signer ${command.signer}`);
  }
  
  // Get entity metadata
  const meta = server.registry.get(command.entityId);
  if (!meta) {
    return Err(`Entity ${command.entityId} not registered`);
  }
  
  // Get the protocol
  const protocol = protocols.get(meta.protocol);
  if (!protocol) {
    return Err(`Unknown protocol: ${meta.protocol}`);
  }
  
  // Special handling for commit commands - they need to execute blocks
  if (command.command.type === 'commitBlock' && canCommit(entity, command.command.hash)) {
    return processCommitWithExecution(entity, command, meta, protocol);
  }
  
  // Process regular commands
  return processCommand({
    entity,
    command: command.command,
    signer: command.signer,
    meta,
    timestamp
  });
};

// ============================================================================
// Block Execution - Special handling for commits
// ============================================================================

const processCommitWithExecution = (
  entity: EntityState,
  command: ServerTx,
  meta: EntityMeta,
  protocol: any
): Result<CommandResult> => {
  if (command.command.type !== 'commitBlock') {
    return Err('Not a commit command');
  }
  
  const commitHash = command.command.hash;
  if (!entity.proposal || entity.proposal.hash !== commitHash) {
    return Err('Invalid block hash for commit');
  }
  
  // Execute the block
  const executionResult = execute.block(
    entity.data,
    entity.proposal,
    meta.id,
    protocol
  );
  
  // Transition to idle with new state
  const committedEntity = transition.toIdle(
    entity,
    executionResult.newState,
    commitHash,
    executionResult.failedTransactions.map(f => f.transaction)
  );
  
  // Add execution messages
  const allMessages = [...executionResult.messages];
  
  // Add commit notifications if we're the proposer
  if (shouldNotifyOthersOfCommit(entity, command.signer)) {
    allMessages.push(...createCommitNotifications(meta, command.signer, commitHash));
  }
  
  return Ok({
    entity: committedEntity,
    messages: allMessages
  });
};

// ============================================================================
// Message Routing - Convert messages to new commands
// ============================================================================

const routeMessagesToCommands = (
  messages: OutboxMsg[],
  server: ServerState
): ServerTx[] => {
  const routed: ServerTx[] = [];
  
  for (const message of messages) {
    if (message.toSigner !== undefined) {
      // Route to specific signer
      if (entityExistsAtSigner(server, message.toSigner, message.to)) {
        routed.push({
          signer: message.toSigner,
          entityId: message.to,
          command: message.command
        });
      }
    } else {
      // Route to all quorum members
      const meta = server.registry.get(message.to);
      if (meta) {
        for (const signer of meta.quorum) {
          if (entityExistsAtSigner(server, signer, message.to)) {
            routed.push({
              signer,
              entityId: message.to,
              command: message.command
            });
          }
        }
      }
    }
  }
  
  return routed;
};

// ============================================================================
// Auto-proposal Generation - For single-signer entities
// ============================================================================

const generateAutomaticProposals = (server: ServerState): ServerTx[] => {
  const proposals: ServerTx[] = [];
  
  // Check each signer's entities
  for (const [signerId, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      if (shouldAutoPropose(entity, entityId, signerId, server)) {
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

// ============================================================================
// Helper Functions
// ============================================================================

const findEntityAtSigner = (
  server: ServerState,
  signer: SignerIdx,
  entityId: string
): EntityState | undefined => {
  const signerEntities = server.signers.get(signer);
  return signerEntities?.get(id(entityId));
};

const entityExistsAtSigner = (
  server: ServerState,
  signer: SignerIdx,
  entityId: string
): boolean => {
  return findEntityAtSigner(server, signer, entityId) !== undefined;
};

const applyEntityUpdate = (
  server: ServerState,
  signer: SignerIdx,
  entityId: string,
  newEntity: EntityState
): ServerState => {
  const signerEntities = server.signers.get(signer);
  if (!signerEntities) return server;
  
  const updatedSignerEntities = assoc(signerEntities, id(entityId), newEntity);
  
  return {
    ...server,
    signers: assoc(server.signers, signer, updatedSignerEntities)
  };
};

const shouldAutoPropose = (
  entity: EntityState,
  entityId: string,
  signerId: SignerIdx,
  server: ServerState
): boolean => {
  const meta = server.registry.get(id(entityId));
  if (!meta) return false;
  
  return entity.stage === 'idle' &&
         entity.mempool.length > 0 &&
         meta.quorum.length === 1 &&
         meta.quorum[0] === signerId;
};

const canCommit = (entity: EntityState, blockHash: string): boolean => {
  return (entity.stage === 'committing' || entity.stage === 'proposed') &&
         entity.proposal !== undefined &&
         entity.proposal.hash === blockHash;
};

const shouldNotifyOthersOfCommit = (entity: EntityState, signer: SignerIdx): boolean => {
  return entity.stage === 'committing' &&
         entity.proposal !== undefined &&
         entity.proposal.proposer === signer;
};

const createCommitNotifications = (
  meta: EntityMeta,
  signer: SignerIdx,
  hash: string
): OutboxMsg[] => {
  return meta.quorum
    .filter(s => s !== signer)
    .map(targetSigner => ({
      from: meta.id,
      to: meta.id,
      toSigner: targetSigner,
      command: { type: 'commitBlock' as const, hash: blockHash(hash) }
    }));
};