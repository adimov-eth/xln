
// Export all key types
export type { DaoOp, DaoState, Initiative } from './src/protocols/dao.js';
export type { WalletOp, WalletState } from './src/protocols/wallet.js';
export type { BlockHash, BlockHeight, EntityId, SignerIdx } from './src/types/primitives.js';
export type { Protocol, ProtocolRegistry } from './src/types/protocol.js';
export type { Result } from './src/types/result.js';
export type { EntityCommand, EntityState, OutboxMsg, ServerState, ServerTx, SignerEntities } from './src/types/state.js';

// Export core functionality
export { processServerTick } from './src/engine/processor.js';
export { importEntity, registerEntity, submitCommand } from './src/engine/server.js';
export { processEntityCommand } from './src/entity/commands.js';
export { transaction } from './src/entity/transactions.js';

// Export protocols
export { createDaoState, DaoProtocol } from './src/protocols/dao.js';
export { createProtocolRegistry, defaultRegistry } from './src/protocols/registry.js';
export { WalletProtocol } from './src/protocols/wallet.js';

// Export storage and infrastructure
export { ConsoleLogger, SilentLogger, SystemClock } from './src/infra/deps.js';
export { createBlockRunner } from './src/infra/runner.js';
export type { Storage } from './src/storage/interface.js';
export { MemoryStorage } from './src/storage/memory.js';

// Export utilities
export { computeStateHash, deterministicHash } from './src/utils/hash.js';
export { createInitialState } from './src/utils/serialization.js';
export { getCanonicalEntity, getEntityAcrossSigners, getEntityFromSigner } from './src/utils/state-helpers.js';

// Export testing utilities
export { patterns, scenario } from './src/test/fluent-api.js';

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