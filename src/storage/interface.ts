// ============================================================================
// storage/interface.ts - Storage interfaces
// ============================================================================

import type { Result } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';

export interface Storage {
  readonly wal: {
    append(height: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>>;
    readFromHeight(height: BlockHeight): Promise<Result<readonly ServerTx[]>>;
    truncateBefore(height: BlockHeight): Promise<Result<void>>;
  };
  
  readonly blocks: {
    save(height: BlockHeight, block: BlockData): Promise<Result<void>>;
    get(height: BlockHeight): Promise<Result<BlockData | null>>;
    iterator(options?: { reverse?: boolean; limit?: number }): AsyncIterableIterator<[string, any]>;
  };
  
  readonly snapshots: {
    save(state: ServerState): Promise<Result<void>>;
    loadLatest(): Promise<Result<ServerState | null>>;
  };
}