// ============================================================================
// utils/migration.ts - Migration utilities for signer layer transition
// ============================================================================

import type { ServerState, SignerEntities, SignerIdx } from '../types/state.js';
import { signer } from '../types/primitives.js';
import { assoc } from './immutable.js';

/**
 * Migrate from old flat entities structure to new signer hierarchy
 * This is for backward compatibility during the transition period
 */
export const migrateFromFlatEntities = (server: ServerState): ServerState => {
  // If already has signers, return as-is
  if (server.signers.size > 0) {
    return server;
  }
  
  // If has legacy entities field, migrate them
  if (server.entities && server.entities.size > 0) {
    const signers = new Map<SignerIdx, SignerEntities>();
    
    // For each entity, create replicas at all quorum signers
    for (const [entityId, entity] of server.entities) {
      const meta = server.registry.get(entityId);
      if (!meta) continue;
      
      // Create replica at each signer in quorum
      for (const signerId of meta.quorum) {
        const signerEntities = signers.get(signerId) ?? new Map();
        signers.set(signerId, assoc(signerEntities, entityId, entity));
      }
    }
    
    return {
      ...server,
      signers,
      entities: undefined // Remove legacy field
    };
  }
  
  return server;
};

/**
 * Create a compatibility wrapper that maintains both views
 * This allows gradual migration of code
 */
export const createCompatibilityWrapper = (server: ServerState): ServerState => {
  // Build flat entities view from signers
  const flatEntities = new Map();
  
  for (const [_, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const existing = flatEntities.get(entityId);
      // Use highest block height as canonical
      if (!existing || entity.height > existing.height) {
        flatEntities.set(entityId, entity);
      }
    }
  }
  
  return {
    ...server,
    entities: flatEntities
  };
};