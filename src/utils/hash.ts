import { createHash } from 'crypto';
import RLP from 'rlp';
import type { BlockHash } from '../types';
import { toBlockHash } from '../types';
import { toDeterministicJson } from './deterministic';

export const sha256 = (bytes: Buffer | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const computeHash = (data: unknown): string => {
  const json = toDeterministicJson(data);
  // RLP.encode expects specific types, so we need to ensure compatibility
  const encoded = RLP.encode(json as any);
  return sha256(Buffer.from(encoded));
};

export const computeBlockHash = (data: unknown): BlockHash =>
  toBlockHash(computeHash(data));

export const computeStateHash = (entities: Map<any, any>): string => {
    const stateData: any[] = [];
    
    // Sort entities by ID for deterministic ordering
    const sortedEntities = Array.from(entities.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    
    for (const [entityId, entity] of sortedEntities) {
      // Include all entity fields that affect state
      stateData.push([
        entityId,
        entity.height,
        entity.tag,
        toDeterministicJson(entity.state),
        entity.mempool?.map((tx: any) => toDeterministicJson(tx)) || [],
        entity.proposal ? [
          entity.proposal?.hash,
          Array.from(entity.proposal?.approves || [])
            .sort((a, b) => Number(a) - Number(b))
        ] : null,
        entity.lastBlockHash || ''
      ]);
    }
    
    return computeHash(stateData);
  };