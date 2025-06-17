// ============================================================================
// engine/bridge.ts - Bridge between old runner and new engine
// ============================================================================

import { processServerTick } from './processor.js';
import type { ServerState, ServerTx } from '../types/state.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Ok, Err } from '../types/result.js';
import { processBlockPure } from '../core/block.js';
import type { ProcessedBlock } from '../core/block.js';

// ============================================================================
// Bridge Function - Routes to appropriate processor
// ============================================================================

export const processWithEngine = (
  server: ServerState,
  protocols: ProtocolRegistry,
  useNewEngine: boolean = false
): Result<ProcessedBlock> => {
  if (useNewEngine) {
    // Use new engine
    const result = processServerTick(server, protocols);
    
    if (!result.ok) {
      return Err(result.error);
    }
    
    // Convert new engine result to old format
    return Ok({
      server: result.value.server,
      stateHash: computeStateHash(result.value.server),
      appliedTxs: result.value.appliedCommands,
      failedTxs: result.value.failedCommands.map(f => f.command),
      messages: result.value.generatedMessages
    });
  } else {
    // Use old engine
    return processBlockPure({
      server,
      protocols,
      clock: { now: () => Date.now() }
    });
  }
};

// Helper to convert state hash
const computeStateHash = (server: ServerState): string => {
  return 'state-hash-placeholder'; // This would use the actual hash computation
};