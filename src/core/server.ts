// Server-level pure functions for processing blocks
import type { ServerState, ServerTx, ServerBlock, OutboxMessage, EntityState } from '../types';
import { applyEntityInput } from './entity';

// Create initial server state
export function createServerState(): ServerState {
  return {
    height: 0,
    signers: new Map(),
    mempool: []
  };
}

// Initialize a signer with empty entity map
export function initializeSigner(state: ServerState, signerIndex: number): ServerState {
  const newSigners = new Map(state.signers);
  if (!newSigners.has(signerIndex)) {
    newSigners.set(signerIndex, new Map());
  }
  return { ...state, signers: newSigners };
}

// Process all transactions in the mempool for one server block
// Analogy: The end-of-day sorting process at the Post Office
export function processServerBlock(state: ServerState): ServerState {
  const outbox: OutboxMessage[] = [];
  const processedTxs = state.mempool; // Snapshot current mempool
  
  // Deep clone the signers map for immutability
  const newSigners = new Map<number, Map<string, EntityState>>();
  for (const [signerIndex, entities] of state.signers) {
    newSigners.set(signerIndex, new Map(entities));
  }
  
  // Process each transaction
  for (const tx of processedTxs) {
    const signer = newSigners.get(tx.signerIndex);
    if (!signer) {
      console.warn(`Signer ${tx.signerIndex} not found for tx targeting entity ${tx.entityId}`);
      continue;
    }
    
    const entity = signer.get(tx.entityId);
    if (!entity) {
      console.warn(`Entity ${tx.entityId} not found in signer ${tx.signerIndex}`);
      continue;
    }
    
    // Apply the input to get new entity state
    const updatedEntity = applyEntityInput(entity, tx.input, tx.signerIndex, outbox);
    signer.set(tx.entityId, updatedEntity);
  }
  
  // Convert outbox messages to new ServerTx for next cycle
  const newMempool: ServerTx[] = outbox.map(msg => ({
    signerIndex: msg.toSignerIndex,
    entityId: msg.toEntityId,
    input: msg.payload
  }));
  
  // Create the server block for history
  const block: ServerBlock = {
    height: state.height,
    txs: processedTxs,
    timestamp: Date.now()
  };
  
  // Return new state with incremented height
  return {
    height: state.height + 1,
    signers: newSigners,
    mempool: newMempool
  };
}

// Add a transaction to the mempool
export function addToMempool(state: ServerState, tx: ServerTx): ServerState {
  return {
    ...state,
    mempool: [...state.mempool, tx]
  };
}

// Import an entity into a signer's state
export function importEntity(
  state: ServerState,
  signerIndex: number,
  entityId: string,
  entityState: EntityState
): ServerState {
  const newSigners = new Map(state.signers);
  
  // Ensure signer exists
  if (!newSigners.has(signerIndex)) {
    newSigners.set(signerIndex, new Map());
  }
  
  const signerEntities = new Map(newSigners.get(signerIndex)!);
  signerEntities.set(entityId, entityState);
  newSigners.set(signerIndex, signerEntities);
  
  return { ...state, signers: newSigners };
}

// Get the state hash for integrity checking
export function getServerStateHash(state: ServerState): string {
  // Simple hash for MVP - replace with proper Merkle root
  const content = {
    height: state.height,
    signerCount: state.signers.size,
    entityCount: Array.from(state.signers.values()).reduce((sum, entities) => sum + entities.size, 0),
    mempoolSize: state.mempool.length
  };
  return `state_${state.height}_${JSON.stringify(content)}`;
}