// ============================================================================
// engine/processor.ts - Main processing loop that reads like English
// ============================================================================

import { execute, transition } from '../entity/blocks.js';
import type { CommandResult } from '../entity/commands.js';
import { processEntityCommand } from '../entity/commands.js';
import type { EntityId, SignerIdx } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type {
  EntityState,
  OutboxMsg,
  ServerState,
  ServerTx
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

const findEntityAtSigner = (server: ServerState, signer: SignerIdx, entityId: EntityId): EntityState | undefined => server.signers.get(signer)?.get(entityId);

const applyEntityUpdate = (server: ServerState, signer: SignerIdx, entityId: EntityId, newEntity: EntityState): ServerState => {
  const signerEntities = server.signers.get(signer);
  if (!signerEntities) return server;
  const updatedSignerEntities = assoc(signerEntities, entityId, newEntity);
  return { ...server, signers: assoc(server.signers, signer, updatedSignerEntities) };
};

const shouldAutoPropose = (entity: EntityState, entityId: EntityId, signerId: SignerIdx, server: ServerState): boolean => {
  const meta = server.registry.get(entityId);
  return !!meta && entity.stage === 'idle' && entity.mempool.length > 0 && meta.quorum.length === 1 && meta.quorum[0] === signerId;
};