// ============================================================================
// core/server.ts - Server state management
// ============================================================================

import { height, id, signer } from '../types/primitives.js';
import type { EntityCommand, EntityMeta, EntityState, ServerState, ServerTx, SignerIdx } from '../types/state.js';
import { assoc } from '../utils/immutable.js';

// Add constant for max quorum size
const MAX_QUORUM_SIZE = 1_000_000;

/**
 * Register an entity in the registry only.
 * Does NOT create replicas - signers must explicitly import.
 */
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
  
  // Only update registry - no replicas created
  return {
    ...server,
    registry: assoc(server.registry, id(entityId), meta)
  };
};

/**
 * Import an entity to a specific signer.
 * Signer must be in the entity's quorum.
 * This creates the actual replica.
 */
export const importEntity = (
  server: ServerState,
  signerId: SignerIdx,
  entityId: string,
  initialState?: any
): ServerState => {
  const meta = server.registry.get(id(entityId));
  if (!meta) {
    throw new Error(`Entity ${entityId} not registered`);
  }
  
  if (!meta.quorum.includes(signerId)) {
    throw new Error(`Signer ${signerId} not in quorum for entity ${entityId}`);
  }
  
  // Get or create signer's entity map
  const signerEntities = server.signers.get(signerId) ?? new Map();
  
  // Check if already imported
  if (signerEntities.has(id(entityId))) {
    return server; // Already imported, no-op
  }
  
  // Create entity state
  const entity: EntityState = {
    id: id(entityId),
    height: height(0),
    stage: 'idle',
    data: initialState ?? getDefaultProtocolState(meta.protocol),
    mempool: []
  };
  
  // Update signer's entities
  const updatedSignerEntities = assoc(signerEntities, id(entityId), entity);
  
  return {
    ...server,
    signers: assoc(server.signers, signerId, updatedSignerEntities)
  };
};

/**
 * Helper to get default state for a protocol
 */
const getDefaultProtocolState = (protocol: string): any => {
  switch (protocol) {
    case 'wallet':
      return { balance: 0n, nonce: 0 };
    default:
      return {};
  }
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