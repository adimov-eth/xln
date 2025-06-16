// ============================================================================
// core/block.ts - Block processing
// ============================================================================

import { height } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { CommandResult, Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityMeta, OutboxMsg, ServerState, ServerTx } from '../types/state.js';
import { computeStateHash } from '../utils/hash.js';
import { assoc } from '../utils/immutable.js';
import { processEntityCommand } from './entity/commands.js';

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
  const tempEntities = new Map(server.entities);
  
  for (const tx of transactions) {
    const entity = tempEntities.get(tx.entityId);
    const meta = server.registry.get(tx.entityId);
    
    if (!entity || !meta) {
      return Err(`Entity ${tx.entityId} not found`);
    }
    
    const result = processEntityCommand({
      entity,
      command: tx.command,
      signer: tx.signer,
      meta,
      protocols,
      now
    });
    
    if (!result.ok) {
      return Err(`Validation failed for ${tx.entityId}: ${result.error}`);
    }
    
    // Store the validation result
    results.push({ tx, result: result.value });
    
    // Update temp state for dependent validations
    tempEntities.set(tx.entityId, result.value.entity);
  }
  
  return Ok(results);
};

// Apply validated changes atomically - efficient copy-on-write
const applyValidatedChanges = (
  server: ServerState,
  validatedChanges: ValidationEntry[]
): ServerState => {
  // Use copy-on-write to avoid unnecessary clones
  let entities = server.entities;
  
  for (const { result } of validatedChanges) {
    entities = assoc(entities, result.entity.id, result.entity);
  }
  
  return {
    ...server,
    entities
  };
};

// Route messages to create new transactions
const routeMessages = (
  messages: readonly OutboxMsg[],
  registry: ReadonlyMap<string, EntityMeta>
): ServerTx[] => {
  const routedTxs: ServerTx[] = [];
  
  for (const msg of messages) {
    if (msg.toSigner !== undefined) {
      routedTxs.push({
        signer: msg.toSigner,
        entityId: msg.to,
        command: msg.command
      });
    } else {
      // Route to all quorum members if no specific signer
      const meta = registry.get(msg.to);
      if (meta) {
        for (const s of meta.quorum) {
          routedTxs.push({
            signer: s,
            entityId: msg.to,
            command: msg.command
          });
        }
      }
    }
  }
  
  return routedTxs;
};

// Generate auto-propose transactions
const generateAutoPropose = (server: ServerState): ServerTx[] => {
  const proposals: ServerTx[] = [];
  
  for (const [entityId, entity] of server.entities) {
    const meta = server.registry.get(entityId);
    if (!meta) continue;
    
    // Auto-propose for single-signer entities with pending transactions
    if (entity.stage === 'idle' && 
        entity.mempool.length > 0 && 
        meta.quorum.length === 1) {
      const firstSigner = meta.quorum[0];
      if (firstSigner !== undefined) {
        proposals.push({
          signer: firstSigner,
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
  const routedTxs = routeMessages(allMessages, newServer.registry);
  
  // 5. Generate auto-propose for single-signer entities
  const autoProposeTxs = generateAutoPropose(newServer);
  
  // 6. Create final state
  const finalServer: ServerState = {
    ...newServer,
    height: nextHeight,
    mempool: [...routedTxs, ...autoProposeTxs]
  };
  
  // P-3 FIX: Only include successfully applied transactions
  const appliedTxs = validationResult.value.map(entry => entry.tx);
  
  return Ok({
    server: finalServer,
    stateHash: computeStateHash(finalServer),
    appliedTxs: appliedTxs,
    failedTxs: [], // Currently no transactions fail in validation
    messages: allMessages
  });
}; 