// ============================================================================
// index.ts - Main exports for XLN v3
// ============================================================================

// Entity module - Core business logic
export * from './entity/commands.js';
export * from './entity/transactions.js';
export { block, execute, transition, describeBlock, type BlockExecutionResult, type ExecutedTransaction, type FailedTransaction, type Quorum } from './entity/blocks.js';
export * from './entity/actions.js';

// Engine module - Processing engine
export * from './engine/server.js';
export * from './engine/processor.js';
export * from './engine/router.js';

// Protocols
export * from './protocols/wallet.js';
export * from './protocols/dao.js';
export * from './protocols/registry.js';

// Types
export * from './types/brand.js';
export * from './types/primitives.js';
export * from './types/protocol.js';
export * from './types/result.js';
export { type ServerState, type EntityState, type EntityCommand, type EntityTx, type OutboxMsg, type ProposedBlock, type EntityMeta, type ServerTx, type SignerEntities, type EntityStage, type BlockData } from './types/state.js';

// Utilities
export * from './utils/hash.js';
export * from './utils/immutable.js';
export * from './utils/mutex.js';
export * from './utils/serialization.js';
export * from './utils/state-helpers.js';

// Storage
export * from './storage/interface.js';
export * from './storage/memory.js';

// Infrastructure
export * from './infra/deps.js';
export * from './infra/runner.js';

// Test utilities
export * from './test/fluent-api.js';

// Re-export commonly used types for convenience

export type {
  SignerIdx,
  EntityId,
  BlockHash,
  BlockHeight
} from './types/primitives.js';

export type {
  WalletState,
  DaoState,
  Initiative
} from './entity/actions.js';