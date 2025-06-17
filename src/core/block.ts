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
  
  // Create a temporary copy of signers map for validation
  const tempSigners = new Map<string, Map<string, any>>();
  for (const [signerId, entities] of server.signers) {
    tempSigners.set(String(signerId), new Map(entities));
  }
  
  for (const tx of transactions) {
    // Get entity from the specific signer
    const signerEntities = tempSigners.get(String(tx.signer));
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
      protocols,
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
