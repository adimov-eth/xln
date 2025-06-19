
import { height } from '../types/primitives.js';
import type { ServerState } from '../types/state.js';

export const serializeWithBigInt = (obj: any): string => {
  return JSON.stringify(obj, (_, value) => 
    typeof value === 'bigint' ? { _type: 'bigint', value: value.toString() } : value
  );
};

export const deserializeWithBigInt = (text: string): any => {
  return JSON.parse(text, (_, value) => 
    value && typeof value === 'object' && value._type === 'bigint' ? BigInt(value.value) : value
  );
};

export const createInitialState = (): ServerState => ({
  height: height(0),
  signers: new Map(),
  registry: new Map(),
  mempool: [],
  eventBus: []
});