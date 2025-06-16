// Types
export * from './types';

// Core functionality
export * from './core/entity';
export * from './core/server';
export * from './core/quorum';

// Protocols
export * from './protocols';

// Storage
export * from './storage';

// Utilities
export { computeHash, computeBlockHash } from './utils/hash';  // Don't export computeStateHash to avoid conflict
export * from './utils/runSteps';
export { 
  ErrorCollector,
  // Immutable error utilities
  type Issue,
  type ImmutableErrors,
  emptyErrors,
  addIssue,
  addCritical,
  addError,
  addWarning,
  hasCritical,
  hasErrors,
  formatErrors,
  mergeErrors
} from './utils/errors';

