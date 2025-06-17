// ============================================================================
// XLN v3 - Main entry point
// ============================================================================

// Export all key types
export type { BlockHash, BlockHeight, EntityId, SignerIdx } from './src/types/primitives.js';
export type { Result } from './src/types/result.js';
export type { EntityCommand, EntityState, OutboxMsg, ServerState, ServerTx, SignerEntities } from './src/types/state.js';
export type { Protocol, ProtocolRegistry } from './src/types/protocol.js';
export type { DaoState, Initiative, DaoOp, WalletState, WalletOp } from './src/protocols/dao.js';

// Export core functionality
export { processBlockPure } from './src/core/block.js';
export { processEntityCommand } from './src/entity/commands.js';
export { importEntity, registerEntity, submitCommand } from './src/engine/server.js';
export { transaction } from './src/entity/transactions.js';

// Export protocols
export { createProtocolRegistry, defaultRegistry } from './src/protocols/registry.js';
export { WalletProtocol } from './src/protocols/wallet.js';
export { DaoProtocol, createDaoState } from './src/protocols/dao.js';

// Export storage and infrastructure
export type { Storage } from './src/storage/interface.js';
export { MemoryStorage } from './src/storage/memory.js';
export { ConsoleLogger, SilentLogger, SystemClock } from './src/infra/deps.js';
export { createBlockRunner } from './src/infra/runner.js';

// Export utilities
export { computeStateHash, deterministicHash } from './src/utils/hash.js';
export { createInitialState } from './src/utils/serialization.js';
export { getCanonicalEntity, getEntityAcrossSigners, getEntityFromSigner } from './src/utils/state-helpers.js';

// Export testing utilities
export { scenario, patterns } from './src/test/fluent-api.js';

// Export examples
export { runExample } from './src/examples.js';

async function main() {
  try {
    const { runExample } = await import('./src/examples.js');
    await runExample();
  } catch (error) {
    console.error('Error running example:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}