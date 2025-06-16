// ============================================================================
// storage/interface.ts - Storage interfaces
// ============================================================================

import type { Result } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';

export interface Storage {
  // WAL operations - critical for crash recovery
  readonly wal: {
    append(height: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>>;
    readFromHeight(height: BlockHeight): Promise<Result<readonly ServerTx[]>>;
    truncateBefore(height: BlockHeight): Promise<Result<void>>;
  };
  
  // Block storage
  readonly blocks: {
    save(height: BlockHeight, block: BlockData): Promise<Result<void>>;
    get(height: BlockHeight): Promise<Result<BlockData | null>>;
  };
  
  // State snapshots
  readonly snapshots: {
    save(state: ServerState): Promise<Result<void>>;
    loadLatest(): Promise<Result<ServerState | null>>;
  };
} 