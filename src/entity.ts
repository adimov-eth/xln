
import { hashEntityState } from './encoding';
import * as t from './types';

export function createEntity(id: t.EntityId): t.EntityState {
  return {
    status: 'idle',
    storage: { value: 0 },
    mempool: [],
    height: 0
  };
}

export function executeEntityTx(
  storage: t.EntityStorage,
  tx: t.EntityTx
): t.Result<t.EntityStorage> {
  switch (tx.op) {
    case 'Create':
      return { ok: true, value: { value: 0 } };
      
    case 'Increment': {
      const current = Number(storage.value || 0);
      const increment = Number(tx.args[0] || 1);
      return { 
        ok: true, 
        value: { ...storage, value: current + increment }
      };
    }
    
    case 'Set': {
      const [key, value] = tx.args;
      if (typeof key !== 'string') {
        return { ok: false, error: new Error('Invalid key') };
      }
      return {
        ok: true,
        value: { ...storage, [key]: value as string | number | boolean }
      };
    }
    
    default:
      return { ok: false, error: new Error(`Unknown operation: ${tx.op}`) };
  }
}

export function applyEntityInput(
  state: t.EntityState,
  input: t.EntityInput,
  outbox: t.OutboxMessage[] = []
): t.Result<t.EntityState> {
  switch (input.type) {
    case 'AddTx': {
      return {
        ok: true,
        value: {
          ...state,
          mempool: [...state.mempool, input.tx]
        }
      };
    }
    
    case 'ProposeBlock': {
      if (state.status !== 'idle') {
        return { 
          ok: false, 
          error: new Error('Cannot propose: entity not idle') 
        };
      }
      
      if (state.mempool.length === 0) {
        return { 
          ok: false, 
          error: new Error('Cannot propose: empty mempool') 
        };
      }
      
      let newStorage = state.storage;
      const executedTxs: t.EntityTx[] = [];
      
      for (const tx of state.mempool) {
        const result = executeEntityTx(newStorage, tx);
        if (result.ok) {
          newStorage = result.value;
          executedTxs.push(tx);
        }
      }
      
      const proposedBlock: t.EntityBlock = {
        height: state.height + 1,
        timestamp: Date.now(),
        txs: executedTxs,
        storage: newStorage,
        stateRoot: hashEntityState({ ...state, storage: newStorage })
      };
      
      return {
        ok: true,
        value: {
          ...state,
          status: 'proposing',
          proposedBlock,
          mempool: state.mempool.filter(tx => !executedTxs.includes(tx))
        }
      };
    }
    
    case 'CommitBlock': {
      if (state.status !== 'proposing' || !state.proposedBlock) {
        return { 
          ok: false, 
          error: new Error('No block to commit') 
        };
      }
      
      if (state.proposedBlock.stateRoot !== input.blockHash) {
        return { 
          ok: false, 
          error: new Error('Block hash mismatch') 
        };
      }
      
      return {
        ok: true,
        value: {
          ...state,
          status: 'idle',
          storage: state.proposedBlock.storage,
          lastBlock: state.proposedBlock,
          proposedBlock: undefined,
          height: state.proposedBlock.height
        }
      };
    }
    
    case 'Flush': {
      if (state.mempool.length === 0) {
        return { ok: true, value: state };
      }
      
      // For single-signer entity, auto-propose and commit
      const proposeResult = applyEntityInput(state, { type: 'ProposeBlock' });
      if (!proposeResult.ok) return proposeResult;
      
      const proposedState = proposeResult.value;
      if (!proposedState.proposedBlock) {
        return { ok: false, error: new Error('Failed to create block') };
      }
      
      return applyEntityInput(
        proposedState, 
        { 
          type: 'CommitBlock', 
          blockHash: proposedState.proposedBlock.stateRoot 
        }
      );
    }
    
    default:
      return { ok: false, error: new Error('Unknown input type') };
  }
}
