// Entity-level pure functions for state transitions
import type { EntityState, EntityInput, EntityTx, EntityBlock, OutboxMessage } from '../types';

// Creates a genesis entity state
export function createGenesisEntity(
  entityId: string,
  quorum: readonly number[],
  proposerIndex?: number
): EntityState {
  return {
    entityId,
    height: 0,
    data: {},
    mempool: [],
    proposedBlock: undefined,
    quorum,
    proposerIndex: proposerIndex ?? quorum[0] ?? 0
  };
}

// Apply a list of transactions to entity data (pure reducer)
function reduceEntityData(data: unknown, txs: readonly EntityTx[]): unknown {
  return txs.reduce((currentData, tx) => {
    // Simple examples - extend based on your needs
    if (tx.op === 'MINT' && typeof currentData === 'object' && currentData !== null) {
      const amount = (tx.data as { amount: number }).amount;
      return { ...currentData, balance: ((currentData as any).balance || 0) + amount };
    }
    
    if (tx.op === 'SET' && typeof currentData === 'object' && currentData !== null) {
      const { key, value } = tx.data as { key: string; value: unknown };
      return { ...currentData, [key]: value };
    }
    
    return currentData;
  }, data);
}

// Process a single input for an entity, returning the new state
// Analogy: The Company's board processing a memo
export function applyEntityInput(
  entity: EntityState,
  input: EntityInput,
  signerIndex: number,
  outbox: OutboxMessage[] // Mutable array for side-effects
): EntityState {
  switch (input.kind) {
    case 'addTx':
      // Add transaction to mempool
      return {
        ...entity,
        mempool: [...entity.mempool, input.tx]
      };
    
    case 'importState':
      // Import a complete state (used for initial sync)
      return input.state;
    
    case 'proposeBlock':
      // Only the proposer can propose blocks
      if (signerIndex !== entity.proposerIndex) return entity;
      if (entity.proposedBlock) return entity; // Already have a pending block
      if (entity.mempool.length === 0) return entity; // Nothing to propose
      
      const block: EntityBlock = {
        height: entity.height + 1,
        txs: entity.mempool,
        hash: hashBlock(entity.height + 1, entity.mempool), // Simple hash
        signatures: { [signerIndex]: 'proposer_sig' } // Placeholder
      };
      
      // Send confirmBlock to all other signers in quorum
      for (const otherSigner of entity.quorum) {
        if (otherSigner !== signerIndex) {
          outbox.push({
            fromEntityId: entity.entityId,
            toEntityId: entity.entityId,
            toSignerIndex: otherSigner,
            payload: { kind: 'confirmBlock', block }
          });
        }
      }
      
      return {
        ...entity,
        proposedBlock: block,
        mempool: [] // Clear mempool after proposing
      };
    
    case 'confirmBlock': {
      // Verify and sign the block
      const { block } = input;
      if (!entity.proposedBlock) return entity;
      if (entity.proposedBlock.hash !== block.hash) return entity;
      
      // Add our signature
      const updatedBlock: EntityBlock = {
        ...entity.proposedBlock,
        signatures: {
          ...entity.proposedBlock.signatures,
          [signerIndex]: `signer_${signerIndex}_sig`
        }
      };
      
      // Check if we have quorum (simple majority)
      const requiredSigs = Math.floor(entity.quorum.length / 2) + 1;
      const currentSigs = Object.keys(updatedBlock.signatures).length;
      
      if (currentSigs >= requiredSigs) {
        // Block is finalized - apply state transition
        const newData = reduceEntityData(entity.data, updatedBlock.txs);
        return {
          ...entity,
          height: updatedBlock.height,
          data: newData,
          proposedBlock: undefined
        };
      } else {
        // Just update the signatures
        return {
          ...entity,
          proposedBlock: updatedBlock
        };
      }
    }
    
    default:
      return entity;
  }
}

// Simple hash function for blocks (replace with proper implementation)
function hashBlock(height: number, txs: readonly EntityTx[]): string {
  const content = JSON.stringify({ height, txs });
  // Simple hash for MVP - replace with Keccak256
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash) + content.charCodeAt(i);
    hash = hash & hash;
  }
  return `block_${height}_${Math.abs(hash).toString(16)}`;
}