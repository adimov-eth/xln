import { createHash } from 'crypto';
import RLP from 'rlp';
import { BlockHash, EntityTx, toBlockHash } from '../core/types/primitives';

// Convert any object to RLP-compatible format
const toRlpData = (obj: any): any => {
  if (obj == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof obj)) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(toRlpData);
  if (obj instanceof Set) return Array.from(obj).map(toRlpData).sort();
  if (obj instanceof Map) {
    return Array.from(obj.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, v]) => [toRlpData(k), toRlpData(v)]);
  }
  if (typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .map(key => [key, toRlpData(obj[key])]);
  }
  return obj.toString();
};

// Compute SHA256 hash of data
export const computeHash = (data: any): string => {
  const rlpData = toRlpData(data);
  const encoded = RLP.encode(rlpData);
  return createHash('sha256').update(encoded).digest('hex');
};

// Compute hash and return as BlockHash
export const computeBlockHash = (data: any): BlockHash => {
  return toBlockHash(computeHash(data));
};

// Compute integrity hash of the entire state tree
export const computeStateHash = (signers: Map<any, Map<any, any>>): string => {
  const stateData: any[] = [];
  
  // Sort signers by index
  const sortedSigners = Array.from(signers.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  
  for (const [signerIdx, entities] of sortedSigners) {
    const entityData: any[] = [];
    
    // Sort entities by ID
    const sortedEntities = Array.from(entities.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    
    for (const [entityId, entity] of sortedEntities) {
      // Include all entity fields that affect state
      entityData.push([
        entityId,
        entity.height,
        entity.tag || entity.status, // Handle both old and new field names
        toRlpData(entity.state),
        entity.mempool?.map((tx: EntityTx) => toRlpData(tx)) || [],
        entity.proposed || entity.proposal ? [
          entity.proposed?.hash || entity.proposal?.hash,
          Array.from(entity.proposed?.approves || entity.proposal?.approves || [])
            .sort((a, b) => Number(a) - Number(b))
        ] : null,
        entity.lastBlockHash || ''
      ]);
    }
    
    stateData.push([signerIdx, entityData]);
  }
  
  return computeHash(stateData);
};