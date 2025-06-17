import type { EntityId, EntityState, ServerState, SignerIdx } from '../types/state.js';

export const getEntityAcrossSigners = (server: ServerState, entityId: EntityId): ReadonlyMap<SignerIdx, EntityState> => {
  const results = new Map<SignerIdx, EntityState>();
  for (const [signerId, entities] of server.signers) {
    const entity = entities.get(entityId);
    if (entity) results.set(signerId, entity);
  }
  return results;
};

export const getCanonicalEntity = (server: ServerState, entityId: EntityId): EntityState | undefined => {
  let best: EntityState | undefined;
  for (const [, entities] of server.signers) {
    const entity = entities.get(entityId);
    if (entity && (!best || Number(entity.height) > Number(best.height))) {
      best = entity;
    }
  }
  return best;
};

export const getEntityFromSigner = (server: ServerState, signerId: SignerIdx, entityId: EntityId): EntityState | undefined => server.signers.get(signerId)?.get(entityId);
export const entityExists = (server: ServerState, entityId: EntityId): boolean => {
  for (const [, entities] of server.signers) {
    if (entities.has(entityId)) return true;
  }
  return false;
};

export const getFlatEntities = (server: ServerState): Map<EntityId, EntityState> => {
  const flat = new Map<EntityId, EntityState>();
  for (const [, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const existing = flat.get(entityId);
      if (!existing || Number(entity.height) > Number(existing.height)) {
        flat.set(entityId, entity);
      }
    }
  }
  return flat;
};

export const countEntityReplicas = (server: ServerState): number => {
  let count = 0;
  for (const [, entities] of server.signers) count += entities.size;
  return count;
};

export const getEntitySigners = (server: ServerState, entityId: EntityId): SignerIdx[] => {
  const signers: SignerIdx[] = [];
  for (const [signerId, entities] of server.signers) {
    if (entities.has(entityId)) signers.push(signerId);
  }
  return signers;
};