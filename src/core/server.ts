// ============================================================================
// core/server.ts - Server state management
// ============================================================================

import { height, id, signer } from '../types/primitives.js';
import type { EntityCommand, EntityMeta, EntityState, ServerState, ServerTx } from '../types/state.js';
import { assoc } from '../utils/immutable.js';

// Add constant for max quorum size
const MAX_QUORUM_SIZE = 1_000_000;

export const registerEntity = (
  server: ServerState,
  entityId: string,
  quorum: number[],
  initialState: any = { balance: 0n, nonce: 0 },
  protocol = 'wallet',
  timeoutMs = 30000
): ServerState => {
  // Validate quorum size on registration
  if (quorum.length === 0) {
    throw new Error('Quorum cannot be empty');
  }
  
  if (quorum.length > MAX_QUORUM_SIZE) {
    throw new Error(`Quorum size ${quorum.length} exceeds maximum allowed (${MAX_QUORUM_SIZE})`);
  }
  
  const meta: EntityMeta = {
    id: id(entityId),
    quorum: quorum.map(signer),
    timeoutMs,
    protocol
  };
  
  const entity: EntityState = {
    id: id(entityId),
    height: height(0),
    stage: 'idle',
    data: initialState,
    mempool: []
  };
  
  return {
    ...server,
    registry: assoc(server.registry, id(entityId), meta),
    entities: assoc(server.entities, id(entityId), entity)
  };
};

export const submitTransaction = (
  server: ServerState,
  signerIdx: number,
  entityId: string,
  command: EntityCommand
): ServerState => {
  const tx: ServerTx = {
    signer: signer(signerIdx),
    entityId: id(entityId),
    command
  };
  
  return {
    ...server,
    mempool: [...server.mempool, tx]
  };
}; 