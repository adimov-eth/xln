// ============================================================================
// infra/runner.ts - Block runner with effects
// ============================================================================

import { processServerTick } from '../engine/processor.js';
import type { Storage } from '../storage/interface.js';
import { height } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, Clock, ProcessedBlock, ServerState } from '../types/state.js';
import { computeStateHash } from '../utils/hash.js';
import { createInitialState } from '../utils/serialization.js';
import type { Logger } from './deps.js';
import { ConsoleLogger, SystemClock } from './deps.js';
import { encode } from '../utils/encoding.js';

export type RunnerConfig = {
  readonly storage: Storage;
  readonly protocols: ProtocolRegistry;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly snapshotInterval?: number;
};

export const createBlockRunner = (config: RunnerConfig) => {
  const { 
    storage, 
    protocols, 
    clock = SystemClock, 
    logger = ConsoleLogger,
    snapshotInterval = 100 
  } = config;
  
  // Compatibility wrapper to convert new engine result to old format
  const processBlockPure = (ctx: { server: ServerState; protocols: ProtocolRegistry; clock: Clock }): Result<ProcessedBlock> => {
    const result = processServerTick(ctx.server, ctx.protocols, ctx.clock.now());
    
    if (!result.ok) {
      return Err(result.error);
    }
    
    // Convert new engine result to old format
    return Ok({
      server: result.value.server,
      stateHash: result.value.stateHash,
      appliedTxs: result.value.appliedCommands,
      failedTxs: result.value.failedCommands.map((f: any) => f.command),
      messages: result.value.generatedMessages
    });
  };
  
  const runner = {
    processBlock: async (server: ServerState, skipWal = false): Promise<Result<ServerState>> => {
      const nextHeight = height(Number(server.height) + 1);
      
      const blockResult = processBlockPure({ server, protocols, clock });
      if (!blockResult.ok) {
        return blockResult;
      }
      
      const processed = blockResult.value;
      
      if (!skipWal && server.mempool.length > 0) {
        const walResult = await storage.wal.append(nextHeight, server.mempool);
        if (!walResult.ok) {
          return Err(`WAL write failed: ${walResult.error}`);
        }
      }
      
      const blockContent = {
        height: nextHeight,
        timestamp: clock.now(),
        transactions: server.mempool,
        stateHash: processed.stateHash,
        parentHash: Number(server.height) > 0 ? computeStateHash(server) : undefined,
      };
      
      const blockData: BlockData = {
        ...blockContent,
        encodedData: encode.blockData(blockContent),
      };
      
      const saveResult = await storage.blocks.save(nextHeight, blockData);
      if (!saveResult.ok) {
        logger.error('Block save failed', saveResult.error);
      }
      
      if (Number(nextHeight) % snapshotInterval === 0) {
        const snapshotResult = await storage.snapshots.save(processed.server);
        if (!snapshotResult.ok) {
          logger.error('Snapshot failed', snapshotResult.error);
        } else {
          const truncateResult = await storage.wal.truncateBefore(nextHeight);
          if (!truncateResult.ok) {
            logger.warn('WAL truncation failed', truncateResult.error);
          }
        }
      }
      
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
      
      const snapshotResult = await storage.snapshots.loadLatest();
      if (!snapshotResult.ok) return Err(`Snapshot load failed: ${snapshotResult.error}`);
      
      let server = snapshotResult.value || initialState || createInitialState();
      logger.info(`Loaded snapshot at height ${server.height}`);
      
      const walResult = await storage.wal.readFromHeight(height(Number(server.height) + 1));
      if (!walResult.ok) return Err(`WAL read failed: ${walResult.error}`);
      
      const walTxs = walResult.value;
      if (walTxs.length === 0) {
        logger.info('No WAL entries to replay');
        return Ok(server);
      }
      
      logger.info(`Replaying ${walTxs.length} WAL transactions`);
      
      server = { ...server, mempool: walTxs };
      const processResult = await runner.processBlock(server, true);
      if (!processResult.ok) return Err(`Recovery replay failed: ${processResult.error}`);
      
      logger.info('Recovery complete', { height: processResult.value.height, replayed: walTxs.length });
      
      return Ok(processResult.value);
    }
  };
  
  return runner;
};