// ============================================================================
// infra/runner.ts - Block runner with effects
// ============================================================================

import { Server } from '../server/Server.js';
import type { Storage } from '../storage/interface.js';
import { height } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, Clock, ServerState } from '../types/state.js';
import { encode } from '../utils/encoding.js';
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
};

export const createBlockRunner = (config: RunnerConfig) => {
  const { 
    storage, 
    protocols, 
    clock = SystemClock, 
    logger = ConsoleLogger,
    snapshotInterval = 100 
  } = config;
  
  const serverComponent = Server({ protocols });
  
  const runner = {
    processBlock: async (serverState: ServerState, skipWal = false): Promise<Result<ServerState>> => {
      const now = clock.now();
      
      /* 0. Persist the *inputs* (serverState.mempool) first */
      if (!skipWal && serverState.mempool.length) {
        const walResult = await storage.wal.append(serverState.height, serverState.mempool);
        if (!walResult.ok) return Err(`WAL write failed: ${walResult.error}`);
      }

      /* 1. Pure tick */
      const ticked = serverComponent.tick(serverState, now);

      /* 2. Bump height (side-effect layer controls blocks) */
      const nextHeight = height(Number(serverState.height) + 1);
      const nextServerState: ServerState = { ...ticked, height: nextHeight };
      
      // --- Side Effects ---
      
      // 2. Save Block
      const stateHash = computeStateHash(nextServerState);
      const parentHash = Number(serverState.height) > 0 ? computeStateHash(serverState) : undefined;
      const blockContent = {
        height: nextHeight,
        timestamp: now,
        transactions: serverState.mempool,
        stateHash,
        parentHash,
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
        const snapshotResult = await storage.snapshots.save(nextServerState);
        if (!snapshotResult.ok) {
          logger.error('Snapshot failed', snapshotResult.error);
        } else {
          const truncateResult = await storage.wal.truncateBefore(nextHeight);
          if (!truncateResult.ok) {
            logger.warn('WAL truncation failed', truncateResult.error);
          }
        }
      }
      
      logger.info(`Block ${nextHeight} processed`, {
        inputs: serverState.mempool.length,
        outputs: nextServerState.eventBus.length,
        stateHash,
      });
      
      return Ok(nextServerState);
    },
    
    recover: async (initialState?: ServerState): Promise<Result<ServerState>> => {
      logger.info('Starting recovery...');
      
      const snapshotResult = await storage.snapshots.loadLatest();
      if (!snapshotResult.ok) return Err(`Snapshot load failed: ${snapshotResult.error}`);

      // ------------------------------------------------------------------
      // 1.  Establish the "anchor" height (snapshot or last persisted block)
      // ------------------------------------------------------------------
      let server = snapshotResult.value;
      let anchorHeight = server ? Number(server.height) : 0;

      if (!server) {                         /* no snapshot – find last block */
        for await (const [key] of storage.blocks.iterator({ reverse: true, limit: 1 })) {
          // key: "block:0000000015" → 15
          anchorHeight = Number(key.slice(6));
          break;
        }
        server = initialState ?? createInitialState();
        server = { ...server, height: height(anchorHeight) };
      }

      logger.info(`Recovery anchor height ${anchorHeight}`);
      
      const walResult = await storage.wal.readFromHeight(height(anchorHeight + 1));
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