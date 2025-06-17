// ============================================================================
// utils/hash.ts - Deterministic hashing
// ============================================================================

import { createHash } from 'crypto';
import type { BlockHash, BlockHeight, EntityId } from '../types/primitives.js';
import { hash } from '../types/primitives.js';
import type { EntityState, EntityTx, ServerState } from '../types/state.js';

// Simplified canonical form conversion
const toCanonical = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'bigint') return obj.toString();
  if (typeof obj !== 'object') return obj;
  
  if (obj instanceof Set) {
    return Array.from(obj).sort().map(toCanonical);
  }
  
  if (obj instanceof Map) {
    return Array.from(obj.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, v]) => [toCanonical(k), toCanonical(v)]);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(toCanonical).sort((a, b) => {
      const aStr = JSON.stringify(a);
      const bStr = JSON.stringify(b);
      return aStr.localeCompare(bStr);
    });
  }
  
  // Handle plain objects
  const sorted: any = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = toCanonical(obj[key]);
  });
  return sorted;
};

export const deterministicHash = (data: any): string => {
  const canonical = toCanonical(data);
  // TODO: Replace with RLP encoding for production
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

// State hash cache for unchanged entities
let stateHashCache = new WeakMap<EntityState, string>();
let cacheHits = 0;

export const computeStateHash = (server: ServerState): string => {
  // Clear cache periodically to prevent unbounded growth
  if (++cacheHits > 10_000) {
    stateHashCache = new WeakMap<EntityState, string>();
    cacheHits = 0;
  }
  
  // Build hierarchical hash structure: signer -> entities
  const signerHashes: [string, [string, string][]][] = [];
  
  for (const [signerId, entities] of server.signers) {
    const entityHashes: [string, string][] = [];
    
    for (const [entityId, entity] of entities) {
      let entityHash = stateHashCache.get(entity);
      
      if (!entityHash) {
        // Compute hash for new/changed entity
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
    
    // Sort entities within signer for determinism
    entityHashes.sort(([a], [b]) => a.localeCompare(b));
    signerHashes.push([String(signerId), entityHashes]);
  }
  
  // Sort signers for determinism
  signerHashes.sort(([a], [b]) => a.localeCompare(b));
  
  // Hash the overall state
  const stateData = {
    height: server.height,
    signers: signerHashes,
    registry: Array.from(server.registry.entries())
      .sort(([a], [b]) => a.localeCompare(b))
  };
  
  return deterministicHash(stateData);
}; 
