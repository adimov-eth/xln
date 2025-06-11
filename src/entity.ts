// entity.ts
import { encode, hash } from './encoding';
import { type EntityBlock, type EntityInput, type EntityState, type EntityTx, type Hash, type OutboxMessage } from './types';

export function createEntity(id: string): EntityState {
  return {
    height: 0,
    nonce: 0,
    data: { counter: 0 },
    mempool: [],
    status: 'idle'
  };
}

export function applyEntityInput(
  state: EntityState,
  input: EntityInput,
  outbox: OutboxMessage[],
  signerIndex: number,
  entityId: string
): EntityState {
  switch (input.type) {
    case 'import':
      return input.state;
    
    case 'add_tx': 
      if (state.status !== 'idle') return state;
      
      return {
        ...state,
        mempool: [...state.mempool, input.tx]
      };
    
    case 'propose_block':
      if (state.status !== 'idle' || state.mempool.length === 0) {
        return state;
      }
      
      // Create proposed block
      const block: EntityBlock = {
        height: state.height + 1,
        txs: [...state.mempool],
        prevHash: state.consensusBlock ? 
          hash(encode(state.consensusBlock)) : 
          Buffer.alloc(32),
        stateRoot: Buffer.alloc(32), // Will be computed after dry-run
        proposer: signerIndex,
        signatures: new Map()
      };
      
      // Dry-run to compute state root
      const dryRunState = applyBlockTransactions(state, block.txs);
      block.stateRoot = getEntityStateRoot(dryRunState);
      
      // For multi-signer, send to validators
      if (input.quorum && input.quorum.length > 1) {
        for (const [signer, weight] of input.quorum) {
          if (signer !== signerIndex) {
            outbox.push({
              fromEntity: entityId,
              toEntity: entityId,
              toSigner: signer,
              payload: { type: 'validate_block', block }
            });
          }
        }
        
        return {
          ...state,
          status: 'awaiting_signatures',
          proposedBlock: block
        };
      }
      
      // Single-signer auto-commit
      return finalizeBlock(state, block);
    
    case 'validate_block':
      // Validator receives block
      if (!input.block || state.status !== 'idle') return state;
      
      // Verify block execution
      const testState = applyBlockTransactions(state, input.block.txs);
      const expectedRoot = getEntityStateRoot(testState);
      
      if (!expectedRoot.equals(input.block.stateRoot)) {
        console.error('Block validation failed: state root mismatch');
        return state;
      }
      
      // Send signature back
      outbox.push({
        fromEntity: entityId,
        toEntity: entityId,
        toSigner: input.block.proposer,
        payload: {
          type: 'block_signature',
          height: input.block.height,
          signature: Buffer.from('dummy-sig'), // Would be real signature
          signerIndex: signerIndex,
          quorum: [] // Would be passed from validation context
        }
      });
      
      return state;
    
    case 'block_signature':
      if (!state.proposedBlock || 
          state.proposedBlock.height !== input.height) {
        return state;
      }
      
      // Add signature
      state.proposedBlock.signatures.set(
        input.signerIndex, 
        input.signature
      );
      
      // Check if we have quorum (67%)
      const totalWeight = input.quorum.reduce((sum, [_, w]) => sum + w, 0);
      let signedWeight = 0;
      
      for (const [signer, weight] of input.quorum) {
        if (state.proposedBlock.signatures.has(signer)) {
          signedWeight += weight;
        }
      }
      
      if (signedWeight >= totalWeight * 0.67) {
        // Finalize with signatures
        return finalizeBlock(state, state.proposedBlock);
      }
      
      return state;
    
    case 'commit_block':
      // Handle explicit block commit
      if (state.proposedBlock && state.proposedBlock.height === input.height) {
        return finalizeBlock(state, state.proposedBlock);
      }
      return state;
    
    default:
      return state;
  }
}

function applyBlockTransactions(state: EntityState, txs: EntityTx[]): EntityState {
  let newData = state.data;
  let maxNonce = state.nonce;
  
  for (const tx of txs) {
    newData = applyEntityTx(newData, tx);
    maxNonce = Math.max(maxNonce, tx.nonce);
  }
  
  return {
    ...state,
    data: newData,
    nonce: maxNonce
  };
}

function finalizeBlock(state: EntityState, block: EntityBlock): EntityState {
  const finalState = applyBlockTransactions(state, block.txs);
  
  return {
    ...finalState,
    height: block.height,
    mempool: [],
    status: 'idle',
    consensusBlock: block,
    proposedBlock: undefined
  };
}

function applyEntityTx(data: any, tx: EntityTx): any {
  switch (tx.op) {
    case 'increment':
      return { ...data, counter: (data.counter || 0) + 1 };
    
    case 'set':
      return { ...data, ...tx.data };
    
    default:
      return data;
  }
}

export function getEntityStateRoot(state: EntityState): Hash {
  return hash(encode({
    height: state.height,
    nonce: state.nonce,
    data: state.data
  }));
}