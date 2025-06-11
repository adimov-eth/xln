import { applyServerBlock, computeServerHash } from './core.ts';
import {
  appendWAL,
  closeDatabases,
  initDatabases,
  restoreServer,
  saveSnapshot,
  SNAPSHOT_INTERVAL,
  storeBlock
} from './persistence.ts';
import type { ServerState, ServerTx } from './types.ts';

/**
 * Apply server block with persistence side effects.
 */
export const applyServerBlockWithPersistence = async (
  server: ServerState,
): Promise<ServerState> => {
  // Log all transactions to WAL first
  await Promise.all(
    server.mempool.map(tx => appendWAL(server.height, tx))
  );

  // Store block to block database
  await storeBlock(server.height, server.mempool);

  // Apply pure state transition
  const newServer = applyServerBlock(server);

  // Periodic snapshot
  if (newServer.height % SNAPSHOT_INTERVAL === 0) {
    await saveSnapshot(newServer);
  }

  return newServer;
};

/**
 * Main server loop with 100ms ticks and persistence.
 */
export const runServer = async (initialServer?: ServerState): Promise<void> => {
  // Initialize databases first
  await initDatabases();
  
  let server = initialServer ?? await restoreServer();
  
  console.log(`Server started at height ${server.height}`);
  console.log(`Initial hash: ${computeServerHash(server)}`);

  // Graceful shutdown handler
  const shutdown = async () => {
    console.log('\nShutting down server...');
    await closeDatabases();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (true) {
    // 100ms tick
    await new Promise(resolve => setTimeout(resolve, 100));

    if (server.mempool.length > 0) {
      try {
        server = await applyServerBlockWithPersistence(server);
        const hash = computeServerHash(server);
        console.log(`Block ${server.height}, txs: ${server.mempool.length}, hash: ${hash.slice(0, 8)}...`);
      } catch (error) {
        console.error(`Error processing block ${server.height}:`, error);
        // In production, implement proper error handling/recovery
      }
    }
  }
};

/**
 * Add transaction to server mempool (for external use).
 */
export const addTransaction = (
  server: ServerState, 
  tx: ServerTx
): ServerState => ({
  ...server,
  mempool: [...server.mempool, tx],
});

/**
 * Initialize and run server from persistence or create new.
 */
export const startServer = async (): Promise<void> => {
  try {
    await runServer();
  } catch (error) {
    console.error('Failed to start server:', error);
    await closeDatabases();
    process.exit(1);
  }
}; 