// ============================================================================
// utils/state-helpers.ts - Helper functions for working with hierarchical state
// ============================================================================

import type { EntityId, EntityState, ServerState, SignerEntities, SignerIdx } from '../types/state.js';

/**
 * Get all replicas of an entity across all signers
 */
export const getEntityAcrossSigners = (
  server: ServerState,
  entityId: EntityId
): ReadonlyMap<SignerIdx, EntityState> => {
  const results = new Map<SignerIdx, EntityState>();
  
  for (const [signerId, entities] of server.signers) {
    const entity = entities.get(entityId);
    if (entity) {
      results.set(signerId, entity);
    }
  }
  
  return results;
};

/**
 * Get the canonical (authoritative) entity state
 * Uses highest block height as the tiebreaker
 */
export const getCanonicalEntity = (
  server: ServerState,
  entityId: EntityId
): EntityState | undefined => {
  let best: EntityState | undefined;
  
  for (const [_, entities] of server.signers) {
    const entity = entities.get(entityId);
    if (entity && (!best || Number(entity.height) > Number(best.height))) {
      best = entity;
    }
  }
  
  return best;
};

/**
 * Get entity state from a specific signer
 */
export const getEntityFromSigner = (
  server: ServerState,
  signerId: SignerIdx,
  entityId: EntityId
): EntityState | undefined => {
  return server.signers.get(signerId)?.get(entityId);
};

/**
 * Check if entity exists at any signer
 */
export const entityExists = (
  server: ServerState,
  entityId: EntityId
): boolean => {
  for (const [_, entities] of server.signers) {
    if (entities.has(entityId)) {
      return true;
    }
  }
  return false;
};

/**
 * Get a flat view of all entities (for migration/compatibility)
 * In case of replicas, uses the one with highest block height
 */
export const getFlatEntities = (
  server: ServerState
): Map<EntityId, EntityState> => {
  const flat = new Map<EntityId, EntityState>();
  
  for (const [_, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const existing = flat.get(entityId);
      if (!existing || Number(entity.height) > Number(existing.height)) {
        flat.set(entityId, entity);
      }
    }
  }
  
  return flat;
};

/**
 * Count total entity replicas across all signers
 */
export const countEntityReplicas = (server: ServerState): number => {
  let count = 0;
  for (const [_, entities] of server.signers) {
    count += entities.size;
  }
  return count;
};

/**
 * Get all signers that have a replica of the given entity
 */
export const getEntitySigners = (
  server: ServerState,
  entityId: EntityId
): SignerIdx[] => {
  const signers: SignerIdx[] = [];
  
  for (const [signerId, entities] of server.signers) {
    if (entities.has(entityId)) {
      signers.push(signerId);
    }
  }
  
  return signers;
};