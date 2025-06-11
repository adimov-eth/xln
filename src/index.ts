// Core types
export type * from './types/entity.ts';
export type * from './types/primitives.ts';
export type * from './types/server.ts';

// Pure functions  
export {
    applyEntityInput,
    applyServerBlock, applyTxs, computeServerHash,
    hashBlock, importEntity, initServer
} from './core.ts';

// Utilities
export { MerkleTree, StreamingHash } from './utils.ts';

// Persistence functions  
export {
    appendWAL, closeDatabases, initDatabases, restoreServer, saveSnapshot, SNAPSHOT_INTERVAL, storeBlock
} from './persistence.ts';

// Storage abstractions
export { DatabaseManager } from './databaseManager.ts';
export { LevelDBStorage } from './leveldbStorage.ts';
export { MemoryStorage } from './storageInterface.ts';
export type { Storage } from './storageInterface.ts';

// Configuration & Observability
export { loadConfig, type ServerConfig } from './config.ts';
export { events, type EventMap } from './events.ts';
export { logger, type LogEntry, type LogLevel } from './logger.ts';
export { metricsCollector, startMetricsServer, type Metrics } from './metrics.ts';

// High-level server operations
export {
    addMessage,
    applyServerBlockWithPersistence, runServer,
    startServer
} from './server.ts';
