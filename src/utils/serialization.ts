// ============================================================================
// utils/serialization.ts - JSON serialization with BigInt support
// ============================================================================

import { height } from '../types/primitives.js';
import type { ServerState } from '../types/state.js';

// Serialize with BigInt support
export const serializeWithBigInt = (obj: any): string => {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return { _type: 'bigint', value: value.toString() };
    }
    return value;
  });
};

// Deserialize with BigInt support
export const deserializeWithBigInt = (text: string): any => {
  return JSON.parse(text, (key, value) => {
    if (value && typeof value === 'object' && value._type === 'bigint') {
      return BigInt(value.value);
    }
    return value;
  });
};

export const createInitialState = (): ServerState => ({
  height: height(0),
  signers: new Map(),
  registry: new Map(),
  mempool: []
}); 
