// ============================================================================
// infra/runner.ts - Block runner with effects
// ============================================================================

import type { Clock } from '../core/block.js';
import { processBlockPure } from '../core/block.js';
import { processServerTick } from '../engine/processor.js';
import type { Storage } from '../storage/interface.js';
import { height } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, ServerState } from '../types/state.js';
import { computeStateHash } from '../utils/hash.js';
import { createInitialState } from '../utils/serialization.js';
import type { Logger } from './deps.js';
import { ConsoleLogger, SystemClock } from './deps.js';

export type RunnerConfig = {
  readonly storage: Storage;
  readonly protocols: ProtocolRegistry;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly snapshotInterval?: number;
  readonly useNewEngine?: boolean;
};

export const createBlockRunner = (config: RunnerConfig) => {
  const { 
    storage, 
    protocols, 
    clock = SystemClock, 
    logger = ConsoleLogger,
    snapshotInterval = 100,
    useNewEngine = false 
  } = config;
  
  // Create the runner object
  const runner = {
    processBlock: async (server: ServerState, skipWal = false): Promise<Result<ServerState>> => {
      const nextHeight = height(Number(server.height) + 1);
      
      // 1. Process block (pure computation)
      let processed;
      
      if (useNewEngine) {
        // Use new engine
        const result = processServerTick(server, protocols, clock.now());
        if (!result.ok) {
          return Err(result.error);
        }
        
        // Convert to old format for compatibility
        processed = {
          server: result.value.server,
          stateHash: computeStateHash(result.value.server),
          appliedTxs: result.value.appliedCommands,
          failedTxs: result.value.failedCommands.map(f => f.command),
          messages: result.value.generatedMessages
        };
      } else {
        // Use old engine
        const blockResult = processBlockPure({ server, protocols, clock });
        if (!blockResult.ok) {
          return blockResult;
        }
        processed = blockResult.value;
      }
      
      // N-1 FIX: Skip WAL write during recovery to prevent double-append
      if (!skipWal && server.mempool.length > 0) {
        const walResult = await storage.wal.append(nextHeight, server.mempool);
        if (!walResult.ok) {
          return Err(`WAL write failed: ${walResult.error}`);
        }
      }
      
      // 3. Persist block
      const blockData: BlockData = {
        height: nextHeight,
        timestamp: clock.now(),
        transactions: server.mempool,
        stateHash: processed.stateHash,
        parentHash: Number(server.height) > 0 ? computeStateHash(server) : undefined
      };
      
      const saveResult = await storage.blocks.save(nextHeight, blockData);
      if (!saveResult.ok) {
        logger.error('Block save failed', saveResult.error);
        // Continue - WAL ensures we can recover
      }
      
      // 4. Periodic snapshots
      if (Number(nextHeight) % snapshotInterval === 0) {
        const snapshotResult = await storage.snapshots.save(processed.server);
        if (!snapshotResult.ok) {
          logger.error('Snapshot failed', snapshotResult.error);
          // Continue - not critical
        } else {
          // Truncate WAL after successful snapshot
          const truncateResult = await storage.wal.truncateBefore(nextHeight);
          if (!truncateResult.ok) {
            logger.warn('WAL truncation failed', truncateResult.error);
          }
        }
      }
      
      // 5. Log results
      if (processed.failedTxs.length > 0) {
        logger.warn(`Block ${nextHeight}: ${processed.failedTxs.length} failed transactions`);
      }
      
      logger.info(`Block ${nextHeight} processed`, {
        applied: processed.appliedTxs.length,
        failed: processed.failedTxs.length,
        messages: processed.messages.length,
        newMempool: processed.server.mempool.length
      });
      
      return Ok(processed.server);
    },
    
    recover: async (initialState?: ServerState): Promise<Result<ServerState>> => {
      logger.info('Starting recovery...');
      
      // 1. Load latest snapshot
      const snapshotResult = await storage.snapshots.loadLatest();
      if (!snapshotResult.ok) {
        return Err(`Snapshot load failed: ${snapshotResult.error}`);
      }
      
      let server = snapshotResult.value || initialState || createInitialState();
      logger.info(`Loaded snapshot at height ${server.height}`);
      
      // 2. Read WAL entries after snapshot
      const walResult = await storage.wal.readFromHeight(
        height(Number(server.height) + 1)
      );
      if (!walResult.ok) {
        return Err(`WAL read failed: ${walResult.error}`);
      }
      
      const walTxs = walResult.value;
      if (walTxs.length === 0) {
        logger.info('No WAL entries to replay');
        return Ok(server);
      }
      
      logger.info(`Replaying ${walTxs.length} WAL transactions`);
      
      // 3. Replay transactions - use skipWal to prevent double-append
      server = { ...server, mempool: walTxs };
      const processResult = await runner.processBlock(server, true);
      if (!processResult.ok) {
        return Err(`Recovery replay failed: ${processResult.error}`);
      }
      
      logger.info('Recovery complete', { 
        height: processResult.value.height,
        replayed: walTxs.length 
      });
      
      return Ok(processResult.value);
    }
  };
  
  return runner;
}; 
