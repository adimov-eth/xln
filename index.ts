// ============================================================================
// XLN v2.1 - Production-Ready Distributed Ledger
// Main entry point for the modular implementation
// ============================================================================

// Export all key types
export type { BlockHash, BlockHeight, EntityId, SignerIdx } from './src/types/primitives.js';

export type { CommandResult, Result } from './src/types/result.js';

export type { EntityCommand, EntityState, OutboxMsg, ServerState, ServerTx } from './src/types/state.js';

export type {
    Protocol, ProtocolRegistry
} from './src/types/protocol.js';

// Export utilities
export { hash, height, id, signer } from './src/types/primitives.js';
export { Err, Ok } from './src/types/result.js';

// Export core functionality
export { processBlockPure } from './src/core/block.js';
export { processEntityCommand } from './src/core/entity/commands.js';
export { registerEntity, submitTransaction } from './src/core/server.js';

// Export protocols
export { createProtocolRegistry, defaultRegistry } from './src/protocols/registry.js';
export { WalletProtocol } from './src/protocols/wallet.js';

// Export storage
export type { Storage } from './src/storage/interface.js';
export { MemoryStorage } from './src/storage/memory.js';

// Export infrastructure
export { ConsoleLogger, SilentLogger, SystemClock } from './src/infra/deps.js';
export { createBlockRunner } from './src/infra/runner.js';

// Export utilities
export { computeStateHash, deterministicHash } from './src/utils/hash.js';
export { createInitialState } from './src/utils/serialization.js';

// Export testing utilities
export { createTestScenario } from './src/test/helpers.js';

// Export examples
export { runExample } from './src/examples.js';

// Run example if this is the main module
async function main() {
  try {
    const { runExample } = await import('./src/examples.js');
    await runExample();
  } catch (error) {
    console.error('Error running example:', error);
    process.exit(1);
  }
}

// Check if this is the main module (for both CommonJS and ESM)
if (typeof require !== 'undefined' && require.main === module) {
  // CommonJS
  main();
} else if (typeof import.meta !== 'undefined' && import.meta.url) {
  // ESM - check if this file is the main module
  const scriptPath = process.argv[1];
  if (scriptPath) {
    import('url').then(({ pathToFileURL }) => {
      if (import.meta.url === pathToFileURL(scriptPath).href) {
        main();
      }
    });
  }
}