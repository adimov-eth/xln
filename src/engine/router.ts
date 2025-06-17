// ============================================================================
// engine/router.ts - Message routing that reads like English
// ============================================================================

import type { EntityId, SignerIdx } from '../types/primitives.js';
import type {
  EntityMeta,
  OutboxMsg,
  ServerState,
  ServerTx
} from '../types/state.js';

// ============================================================================
// Routing Types
// ============================================================================

export type RoutingResult = {
  readonly routedCommands: readonly ServerTx[];
  readonly undeliverable: readonly UndeliverableMessage[];
};

export type UndeliverableMessage = {
  readonly message: OutboxMsg;
  readonly reason: string;
};

// ============================================================================
// Message Router - Direct messages to their destinations
// ============================================================================

export const router = {
  routeMessages: (messages: readonly OutboxMsg[], server: ServerState): RoutingResult => {
    const routed: ServerTx[] = [];
    const undeliverable: UndeliverableMessage[] = [];
    
    for (const message of messages) {
      const result = router.routeOneMessage(message, server);
      if (result.delivered) {
        routed.push(...result.commands);
      } else {
        undeliverable.push({ message, reason: result.reason });
      }
    }
    
    return { routedCommands: routed, undeliverable };
  },
  
  routeOneMessage: (message: OutboxMsg, server: ServerState): { delivered: boolean; commands: ServerTx[]; reason: string } => {
    const meta = server.registry.get(message.to);
    if (!meta) return { delivered: false, commands: [], reason: `Destination entity "${message.to}" not registered` };
    
    return message.toSigner !== undefined
      ? routeToSpecificSigner(message, server)
      : broadcastToQuorum(message, meta, server);
  }
};

// ============================================================================
// Routing Strategies
// ============================================================================

const routeToSpecificSigner = (message: OutboxMsg, server: ServerState): { delivered: boolean; commands: ServerTx[]; reason: string } => {
  if (!entityExistsAtSigner(server, message.toSigner!, message.to)) {
    return { delivered: false, commands: [], reason: `Entity "${message.to}" not imported by signer ${message.toSigner}` };
  }
  const command: ServerTx = { signer: message.toSigner!, entityId: message.to, command: message.command };
  return { delivered: true, commands: [command], reason: '' };
};

const broadcastToQuorum = (message: OutboxMsg, meta: EntityMeta, server: ServerState): { delivered: boolean; commands: ServerTx[]; reason: string } => {
  const commands: ServerTx[] = [];
  for (const signer of meta.quorum) {
    if (entityExistsAtSigner(server, signer, message.to)) {
      commands.push({ signer, entityId: message.to, command: message.command });
    }
  }
  
  if (commands.length === 0) {
    return { delivered: false, commands: [], reason: `No quorum members have imported entity "${message.to}"` };
  }
  
  return { delivered: true, commands, reason: '' };
};

// ============================================================================
// Helper Functions
// ============================================================================

const entityExistsAtSigner = (server: ServerState, signer: SignerIdx, entityId: EntityId): boolean => server.signers.get(signer)?.has(entityId) ?? false;