/**
 * Centralized key-naming helpers for all storage adapters
 */

import type { BlockHeight, EntityId, SignerIdx } from '../types/primitives';

const pad = (n: number | BlockHeight) => n.toString().padStart(10, '0');

export const keys = {
  state: (signer: SignerIdx, entityId: EntityId) => 
    `state:${Number(signer)}:${entityId}`,
  
  registry: () => 'state:registry',
  
  meta: () => 'state:meta',
  
  wal: (height: BlockHeight, signer: SignerIdx, entityId: EntityId) => 
    `wal:${pad(height)}:${Number(signer)}:${entityId}`,
  
  walRegistry: (height: BlockHeight, id: string) => 
    `wal:reg:${pad(height)}:${id}`,
  
  block: (height: BlockHeight) => 
    `block:${pad(height)}`,
  
  archive: (hash: string) => 
    `archive:${hash}`,
  
  ref: (name: string) => 
    `ref:${name}`,
} as const;

// Export individual key prefixes for iteration
export const keyPrefixes = {
  state: 'state:',
  wal: 'wal:',
  block: 'block:',
  archive: 'archive:',
  ref: 'ref:',
} as const;