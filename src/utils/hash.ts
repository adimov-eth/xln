
import { createHash } from 'crypto';
import type { BlockHash, BlockHeight, EntityId } from '../types/primitives.js';
import { hash } from '../types/primitives.js';
import type { EntityState, EntityTx, ServerState } from '../types/state.js';

const toCanonical = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'bigint') return obj.toString();
  if (typeof obj !== 'object') return obj;
  
  if (obj instanceof Set || obj instanceof Map) {
    return Array.from(obj.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, v]) => [toCanonical(k), toCanonical(v)]);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(toCanonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  
  return Object.keys(obj).sort().reduce((acc: any, key) => {
    acc[key] = toCanonical(obj[key]);
    return acc;
  }, {});
};

export const deterministicHash = (data: any): string => {
  const canonical = toCanonical(data);
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
};

export const computeBlockHash = (
  entityId: EntityId,
  blockHeight: BlockHeight,
  state: any,
  txs: readonly EntityTx[]
): BlockHash => {
  return hash(deterministicHash({ entityId, height: blockHeight, state, txs }));
};

let stateHashCache = new WeakMap<EntityState, string>();
let cacheHits = 0;

export const computeStateHash = (server: ServerState): string => {
  if (++cacheHits > 10_000) {
    stateHashCache = new WeakMap<EntityState, string>();
    cacheHits = 0;
  }
  
  const signerHashes: [string, [string, string][]][] = [];
  
  for (const [signerId, entities] of server.signers) {
    const entityHashes: [string, string][] = [];
    for (const [entityId, entity] of entities) {
      let entityHash = stateHashCache.get(entity);
      if (!entityHash) {
        entityHash = deterministicHash({
          height: entity.height,
          stage: entity.stage,
          data: entity.data,
          lastBlockHash: entity.lastBlockHash
        });
        stateHashCache.set(entity, entityHash);
      }
      entityHashes.push([entityId, entityHash]);
    }
    entityHashes.sort(([a], [b]) => a.localeCompare(b));
    signerHashes.push([String(signerId), entityHashes]);
  }
  
  signerHashes.sort(([a], [b]) => a.localeCompare(b));
  
  const stateData = {
    height: server.height,
    signers: signerHashes,
    registry: Array.from(server.registry.entries()).sort(([a], [b]) => a.localeCompare(b))
  };
  
  return deterministicHash(stateData);
};