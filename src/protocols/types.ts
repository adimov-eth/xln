import type { EntityTx, Result, OutboxMsg, EntityId } from '../types';

/**
 * Protocol interface for handling entity transactions
 * Each protocol defines how to validate and apply specific transaction types
 */
export interface Protocol<TState, TData> {
  readonly name: string;
  readonly validateTx: (tx: EntityTx) => Result<TData, string>;
  readonly applyTx: (state: TState, data: TData) => Result<TState, string>;
  readonly generateMessages?: (entityId: EntityId, data: TData) => readonly OutboxMsg[];
}

/**
 * Protocol registry maps protocol names to their implementations
 */
export type ProtocolRegistry = ReadonlyMap<string, Protocol<any, any>>;

// Re-export types from main types module that protocols need
export type { EntityTx, Result, OutboxMsg, EntityId } from '../types';