// ============================================================================
// utils/migration.ts - Migration utilities for signer layer transition
// ============================================================================

import type { ServerState, SignerEntities, SignerIdx } from '../types/state.js';
import { assoc } from './immutable.js';

export const migrateFromFlatEntities = (server: ServerState): ServerState => {
  if (server.signers.size > 0) return server;
  
  if (server.entities && server.entities.size > 0) {
    const signers = new Map<SignerIdx, SignerEntities>();
    
    for (const [entityId, entity] of server.entities) {
      const meta = server.registry.get(entityId);
      if (!meta) continue;
      
      for (const signerId of meta.quorum) {
        const signerEntities = signers.get(signerId) ?? new Map();
        signers.set(signerId, assoc(signerEntities, entityId, entity));
      }
    }
    
    return { ...server, signers, entities: undefined };
  }
  
  return server;
};

export const createCompatibilityWrapper = (server: ServerState): ServerState => {
  const flatEntities = new Map();
  
  for (const [, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const existing = flatEntities.get(entityId);
      if (!existing || Number(entity.height) > Number(existing.height)) {
        flatEntities.set(entityId, entity);
      }
    }
  }
  
  return { ...server, entities: flatEntities };
};