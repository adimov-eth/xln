import { applyTxs, hashBlock } from './core.ts';
import { events } from './events.ts';
import { validateEntityTx } from './guards/entityGuards.ts';
import type { EntityInput, EntityState, EntityTx } from './types/entity.ts';
import type { Message } from './types/server.ts';

// Adds transaction to mempool if entity idle and tx valid
export const addTxToMempool = <TState>(
  entity: EntityState<TState>,
  tx: EntityTx,
): EntityState<TState> => {
  if (entity.status !== 'idle') return entity;
  const res = validateEntityTx(tx);
  if (!res.ok) return entity;
  return { ...entity, mempool: [...entity.mempool, tx] };
};

// Moves mempool into proposed block
export const proposeBlock = <TState>(
  entity: EntityState<TState>,
): EntityState<TState> => {
  if (entity.status !== 'idle' || entity.mempool.length === 0) return entity;
  return {
    ...entity,
    proposed: {
      txs: [...entity.mempool],
      hash: hashBlock(entity.mempool),
      status: 'pending',
    },
    status: 'proposed',
  };
};

// Commit block, apply txs to state, maybe push outbox msgs
export const commitBlock = <TState extends Record<string, unknown>>(
  entity: EntityState<TState>,
  blockHash: string,
  entityId: string,
  outbox: Message[],
): EntityState<TState> => {
  if (entity.status !== 'proposed' || entity.proposed?.hash !== blockHash)
    return entity;
  const newState = applyTxs(entity.state, entity.proposed.txs);
  const bal = (newState as any).balance as bigint | undefined;
  if (bal !== undefined && bal > 1000n) {
    outbox.push({
      scope: 'outbox',
      from: entityId,
      toEntity: 'hub',
      toSigner: entity.quorum[0] ?? 0,
      input: { type: 'add_tx', tx: { op: '__unknown__', data: { balance: bal } } },
    });
  }
  const updatedEntity: EntityState<TState> = {
    ...entity,
    height: entity.height + 1,
    state: newState,
    mempool: [],
    proposed: undefined,
    status: 'idle',
  };

  // Emit entity updated event
  if (entity.quorum.length > 0) {
    events.emit('entity:updated', entity.quorum[0]!, entityId, updatedEntity.height);
  }

  return updatedEntity;
};

// State transition lookup table key generator
export const transitionKey = (status: EntityState['status'], inputType: EntityInput['type']) => `${status}:${inputType}` as const; 