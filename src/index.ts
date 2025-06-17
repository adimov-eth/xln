
// Entity module - Core business logic
export * from './entity/actions.js';
export * from './entity/blocks.js';
export { processEntityCommand, type CommandContext, type CommandResult } from './entity/commands.js';
export * from './entity/transactions.js';

// Engine module - Processing engine
export * from './engine/processor.js';
export * from './engine/router.js';
export * from './engine/server.js';

// Protocols
export * from './protocols/dao.js';
export * from './protocols/registry.js';
export * from './protocols/wallet.js';

// Storage
export * from './storage/interface.js';
export * from './storage/memory.js';

// Infrastructure
export * from './infra/deps.js';
export * from './infra/runner.js';

// Test utilities
export * from './test/fluent-api.js';

// Types
export * from './types/brand.js';
export * from './types/primitives.js';
export * from './types/protocol.js';
export * from './types/result.js';
export * from './types/state.js';

// Utilities
export * from './utils/hash.js';
export * from './utils/immutable.js';
export * from './utils/mutex.js';
export * from './utils/serialization.js';
export * from './utils/state-helpers.js';

// Re-export commonly used types for convenience
export type {
  EntityCommand, EntityState, EntityTx,
  OutboxMsg,
  ProposedBlock, ServerState
} from './types/state.js';

export type {
  BlockHash,
  BlockHeight, EntityId, SignerIdx
} from './types/primitives.js';

export type {
  DaoState,
  Initiative, WalletState
} from './entity/actions.js';
