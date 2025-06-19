import { execute, transition } from '../entity/blocks.js';
import type { CommandResult } from '../entity/commands.js';
import { processEntityCommand } from '../entity/commands.js';
import type { BlockHeight, EntityId, SignerIdx } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type {
  EntityState,
  OutboxMsg,
  ServerState,
  ServerTx
} from '../types/state.js';
import { computeStateHash } from '../utils/hash.js';
import { assoc } from '../utils/immutable.js';
import { router } from './router.js';

// ============================================================================
// Processing Result Types
// ============================================================================

export type ProcessingResult = {
  readonly server: ServerState;
  readonly stateHash: string;
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
    mempool: [...routingResult.routedCommands, ...autoProposals],
    eventBus: messages
  };
  
  const stateHash = computeStateHash(finalServer);
  
  return Ok({
    server: finalServer,
    stateHash,
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
  
  // if (command.command.type === 'commitBlock') {
  //   console.log('[DEBUG] processOneCommand commitBlock:', {
  //     signer: command.signer,
  //     entityId: command.entityId,
  //     entityStage: entity.stage,
  //     approvalCount: command.command.approvalCount
  //   });
  // }
  
  const meta = server.registry.get(command.entityId);
  if (!meta) return Err(`Entity ${command.entityId} not registered`);
  
  const protocol = protocols.get(meta.protocol);
  if (!protocol) return Err(`Unknown protocol: ${meta.protocol}`);
  
  // First, process the command to get the next state and messages
  // console.log('[DEBUG] Before processEntityCommand, entity state:', {
  //   entityId: command.entityId,
  //   stage: entity.stage,
  //   mempoolLength: entity.mempool.length,
  //   hasData: !!entity.data
  // });
  
  const commandResult = processEntityCommand({ entity, command: command.command, signer: command.signer, meta, now });
  // console.log('[DEBUG] processEntityCommand result:', commandResult);
  
  if (!commandResult.ok) return commandResult;
  
  let { entity: nextEntity, messages } = commandResult.value;
  
  // Execute block if:
  // 1. Command resulted in 'committing' state (normal flow)
  // 2. We transitioned from 'proposed' to 'committing' (remote finalization)
  const shouldExecuteBlock = 
    nextEntity.stage === 'committing' && 
    nextEntity.proposal && 
    entity.stage !== 'committing'; // We weren't already committing
  
  if (shouldExecuteBlock && nextEntity.proposal) {
    // console.log('[DEBUG] Executing block:', {
    //   entityId: command.entityId,
    //   signer: command.signer,
    //   previousStage: entity.stage,
    //   nextStage: nextEntity.stage
    // });
    const executionResult = execute.block(entity.data, nextEntity.proposal, meta.id, protocol);
    
    const committedProposal = nextEntity.proposal;
    nextEntity = transition.toIdle(
      nextEntity,
      executionResult.newState,
      committedProposal.hash,
      executionResult.failedTransactions.map(f => f.transaction)
    );
    
    // Only the block proposer should generate messages for other entities.
    // Followers execute the block to validate the state transition, but we discard their generated messages.
    if (command.signer === committedProposal.proposer) {
      messages = [...messages, ...executionResult.messages];
    }
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

/** Return the expected proposer for `height` using the round-robin rule */
const proposerFor = (h: BlockHeight, quorum: readonly SignerIdx[]) =>
  quorum[Number(h) % quorum.length];

const shouldAutoPropose = (
  entity: EntityState,
  entityId: EntityId,
  signerId: SignerIdx,
  server: ServerState,
): boolean => {
  const meta = server.registry.get(entityId);
  if (!meta) return false;
  if (entity.stage !== 'idle' || entity.mempool.length === 0) return false;

  // proposer rule now works for **any** quorum size
  return signerId === proposerFor(entity.height, meta.quorum);
};