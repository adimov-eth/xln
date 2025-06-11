import { loadConfig, type ServerConfig } from './config.ts';
import { applyServerBlock, computeServerHash } from './core.ts';
import { DatabaseManager } from './databaseManager.ts';
import { events } from './events.ts';
import { LevelDBStorage } from './leveldbStorage.ts';
import { logger } from './logger.ts';
import { startMetricsServer } from './metrics.ts';
import { restoreServerRes, saveSnapshotRes } from './persistence.ts';
import { MemoryStorage } from './storageInterface.ts';
import type { Message, ServerState } from './types/server.ts';

// Create database manager based on config
const createDatabaseManager = (config: ServerConfig): DatabaseManager => {
  const storage = config.storage.type === 'memory' 
    ? new MemoryStorage() 
    : new LevelDBStorage();
  return new DatabaseManager(storage);
};

/**
 * Apply server block with persistence side effects.
 */
export const applyServerBlockWithPersistence = async (
  server: ServerState,
  dbManager: DatabaseManager,
  config: ServerConfig,
): Promise<ServerState> => {
  // Batch WAL append
  const walRes = await dbManager.appendWALBatch(server.height, server.mempool);
  if (!walRes.ok) {
    logger.error('Persistence', 'WAL batch failed', walRes.error);
    events.emit('block:failed', server.height, walRes.error);
    return server;
  }

  // Store block atomically
  const blockRes = await dbManager.storeBlock(server.height, server.mempool);
  if (!blockRes.ok) {
    logger.error('Persistence', 'Block store failed', blockRes.error);
    events.emit('block:failed', server.height, blockRes.error);
    return server;
  }

  // Apply pure state transition
  const newServer = applyServerBlock(server);

  // Emit success event
  const hash = computeServerHash(newServer);
  events.emit('block:processed', newServer.height, server.mempool.length, hash);

  // Periodic snapshot + WAL pruning
  if (newServer.height % config.server.snapshotInterval === 0) {
    const snapRes = await saveSnapshotRes(newServer);
    if (!snapRes.ok) {
      logger.error('Persistence', 'Snapshot failed', snapRes.error);
    } else {
      logger.info('Persistence', `Snapshot saved at height ${newServer.height}`);
      // Prune WAL after successful snapshot
      const pruneRes = await dbManager.pruneWAL(newServer.height - config.server.snapshotInterval);
      if (!pruneRes.ok) {
        logger.error('Persistence', 'WAL pruning failed', pruneRes.error);
      } else {
        logger.debug('Persistence', `WAL pruned up to height ${newServer.height - config.server.snapshotInterval}`);
      }
    }
  }

  return newServer;
};

/**
 * Main server loop with configurable ticks and persistence.
 */
export const runServer = async (
  initialServer?: ServerState,
  userConfig?: Partial<ServerConfig>
): Promise<void> => {
  const config = { ...loadConfig(), ...userConfig };
  const dbManager = createDatabaseManager(config);
  
  // Initialize database manager
  await dbManager.init();
  
  let server: ServerState;
  if (initialServer) {
    server = initialServer;
  } else {
    const res = await restoreServerRes();
    if (!res.ok) {
      logger.error('Server', 'Failed to restore server', res.error);
      throw res.error;
    }
    server = res.value;
  }
  
  logger.info('Server', `Started at height ${server.height}`);
  logger.info('Server', `Initial hash: ${computeServerHash(server)}`);

  // Start metrics server if enabled
  startMetricsServer(config);

  // Graceful shutdown handler
  const shutdown = async () => {
    events.emit('shutdown');
    await dbManager.close();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (true) {
    // Configurable tick
    await new Promise(resolve => setTimeout(resolve, config.server.tickMs));

    if (server.mempool.length > 0) {
      server = await applyServerBlockWithPersistence(server, dbManager, config);
    }
  }
};

/**
 * Add message to server mempool (for external use).
 */
export const addMessage = (
  server: ServerState, 
  msg: Message
): ServerState => ({
  ...server,
  mempool: [...server.mempool, msg],
});

/**
 * Initialize and run server from persistence or create new.
 */
export const startServer = async (userConfig?: Partial<ServerConfig>): Promise<void> => {
  const config = { ...loadConfig(), ...userConfig };
  const dbManager = createDatabaseManager(config);
  
  try {
    await runServer(undefined, config);
  } catch (error) {
    logger.error('Server', 'Failed to start server', error);
    await dbManager.close();
    process.exit(1);
  }
};

export { loadConfig, type ServerConfig };
