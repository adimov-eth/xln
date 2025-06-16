import type { OutboxMsg, ServerState, ServerTx } from './core';
import type { BlockHeight } from './primitives';

// Pipeline context types
export type BlockContextData = {
  server: ServerState;
  messages: OutboxMsg[];
  touchedEntities: Set<string>;
  targetHeight: BlockHeight;
  blockTxs: ServerTx[];
  validatedTxs?: ServerTx[];
  stateChanges?: Map<string, any>;
};

export type PipelineContext<T> = T & {
  errors: ErrorCollector;
};

export type PipelineStep<T> = (ctx: PipelineContext<T>) => Promise<PipelineContext<T>>;

// Error collection
export enum ErrorSeverity {
  DEBUG = 'DEBUG',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL'
}

export interface ErrorCollector {
  add(error: any, severity: ErrorSeverity, context?: any): void;
  addCritical(error: any, context?: any): void;
  addError(error: any, context?: any): void;
  addWarning(error: any, context?: any): void;
  hasCritical(): boolean;
  hasErrors(): boolean;
  format(): string;
  merge(other: ErrorCollector): void;
}