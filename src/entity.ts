// entity.ts
import { encode, hash } from './encoding';
import { type EntityInput, type EntityState, type EntityTx, type Hash, type OutboxMessage } from './types';

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
  outbox: OutboxMessage[]
): EntityState {
  switch (input.kind) {
    case 'import':
      return { ...input.state, mempool: [], status: 'idle' };
    
    case 'add_tx':
      return {
        ...state,
        mempool: [...state.mempool, input.tx]
      };
    
    case 'propose_block':
      if (state.status !== 'idle' || state.mempool.length === 0) {
        return state;
      }
      // For single-signer, immediately finalize
      return finalizeBlock(state);
    
    case 'commit_block':
      // In single-signer mode, blocks are auto-committed
      return state;
    
    default:
      return state;
  }
}

function finalizeBlock(state: EntityState): EntityState {
  const newState = { ...state };
  
  // Apply all transactions
  for (const tx of state.mempool) {
    newState.data = applyEntityTx(newState.data, tx);
    newState.nonce = Math.max(newState.nonce, tx.nonce);
  }
  
  // Clear mempool and increment height
  newState.height++;
  newState.mempool = [];
  newState.status = 'idle';
  
  return newState;
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