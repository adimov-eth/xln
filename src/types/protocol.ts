// ============================================================================
// types/protocol.ts - Protocol system types
// ============================================================================

import type { EntityId } from './primitives.js';
import type { Result } from './result.js';
import type { EntityTx, OutboxMsg } from './state.js';

export type Protocol<TState, TData> = {
  readonly name: string;
  readonly validateTx: (tx: EntityTx) => Result<TData>;
  readonly applyTx: (state: TState, data: TData, tx: EntityTx) => Result<TState>;
  readonly generateMessages?: (entityId: EntityId, data: TData) => readonly OutboxMsg[];
};

export type ProtocolRegistry = ReadonlyMap<string, Protocol<any, any>>;

// Nonce interface for replay protection
export interface Nonced {
  readonly nonce: number;
}

// Type guard for nonce checking
export const isNonced = (state: any): state is Nonced => {
  return state !== null && 
         typeof state === 'object' && 
         'nonce' in state && 
         Number.isSafeInteger(state.nonce);
}; 
