import { processServerTick } from '../engine/processor.js';
// router import no longer needed and removed
import type { ProtocolRegistry } from '../types/protocol.js';
import type { ServerState } from '../types/state.js';

export type ServerDeps = {
  readonly protocols: ProtocolRegistry;
};

export const Server = (deps: ServerDeps) => ({
  tick(state: ServerState, now: number): ServerState {
    const res = processServerTick(state, deps.protocols, now);
    if (!res.ok) throw new Error(`Processor error: ${res.error}`);

    /*  processServerTick has already:
        – executed commands,
        – routed messages,
        – generated/queued auto‑proposals.
       Re‑routing here only duplicates work and produces loops.            */
    return res.value.server;
  },
});