// ============================================================================
// engine/router.ts - Message routing that reads like English
// ============================================================================

import type { SignerIdx, EntityId, BlockHash } from '../types/primitives.js';
import { id, hash as blockHash } from '../types/primitives.js';
import type { 
  ServerState, 
  ServerTx, 
  OutboxMsg, 
  EntityMeta 
} from '../types/state.js';

// ============================================================================
// Routing Types
// ============================================================================

export type RoutingResult = {
  routedCommands: ServerTx[];
  undeliverable: UndeliverableMessage[];
};

export type UndeliverableMessage = {
  message: OutboxMsg;
  reason: string;
};

// ============================================================================
// Message Router - Direct messages to their destinations
// ============================================================================

export const router = {
  // Route a batch of messages
  routeMessages: (
    messages: OutboxMsg[],
    server: ServerState
  ): RoutingResult => {
    const routed: ServerTx[] = [];
    const undeliverable: UndeliverableMessage[] = [];
    
    for (const message of messages) {
      const result = router.routeOneMessage(message, server);
      
      if (result.delivered) {
        routed.push(...result.commands);
      } else {
        undeliverable.push({
          message,
          reason: result.reason || 'Unknown routing error'
        });
      }
    }
    
    return { routedCommands: routed, undeliverable };
  },
  
  // Route a single message
  routeOneMessage: (
    message: OutboxMsg,
    server: ServerState
  ): { delivered: boolean; commands: ServerTx[]; reason?: string } => {
    // Get destination metadata
    const meta = server.registry.get(message.to);
    if (!meta) {
      return {
        delivered: false,
        commands: [],
        reason: `Destination entity not registered`
      };
    }
    
    // Route to specific signer or broadcast
    if (message.toSigner !== undefined) {
      return routeToSpecificSigner(message, server);
    } else {
      return broadcastToQuorum(message, meta, server);
    }
  },
  
  // Check if a message can be delivered
  canDeliver: (
    message: OutboxMsg,
    server: ServerState
  ): boolean => {
    const meta = server.registry.get(message.to);
    if (!meta) return false;
    
    if (message.toSigner !== undefined) {
      return entityExistsAtSigner(server, message.toSigner, message.to);
    } else {
      // Can deliver if at least one quorum member has the entity
      return meta.quorum.some(signer => 
        entityExistsAtSigner(server, signer, message.to)
      );
    }
  }
};

// ============================================================================
// Routing Strategies
// ============================================================================

const routeToSpecificSigner = (
  message: OutboxMsg,
  server: ServerState
): { delivered: boolean; commands: ServerTx[]; reason?: string } => {
  if (!entityExistsAtSigner(server, message.toSigner!, message.to)) {
    return {
      delivered: false,
      commands: [],
      reason: `Entity not imported by signer ${message.toSigner}`
    };
  }
  
  const command: ServerTx = {
    signer: message.toSigner!,
    entityId: message.to,
    command: message.command
  };
  
  return {
    delivered: true,
    commands: [command]
  };
};

const broadcastToQuorum = (
  message: OutboxMsg,
  meta: EntityMeta,
  server: ServerState
): { delivered: boolean; commands: ServerTx[]; reason?: string } => {
  const commands: ServerTx[] = [];
  
  // Send to all quorum members who have imported the entity
  for (const signer of meta.quorum) {
    if (entityExistsAtSigner(server, signer, message.to)) {
      commands.push({
        signer,
        entityId: message.to,
        command: message.command
      });
    }
  }
  
  if (commands.length === 0) {
    return {
      delivered: false,
      commands: [],
      reason: `No quorum members have imported entity`
    };
  }
  
  return {
    delivered: true,
    commands
  };
};

// ============================================================================
// Routing Analysis - Understand message flow
// ============================================================================

export const analyze = {
  // Count messages by destination
  messagesByDestination: (messages: OutboxMsg[]): Map<string, number> => {
    const counts = new Map<string, number>();
    
    for (const message of messages) {
      const current = counts.get(message.to) ?? 0;
      counts.set(message.to, current + 1);
    }
    
    return counts;
  },
  
  // Count messages by command type
  messagesByCommand: (messages: OutboxMsg[]): Map<string, number> => {
    const counts = new Map<string, number>();
    
    for (const message of messages) {
      const current = counts.get(message.command.type) ?? 0;
      counts.set(message.command.type, current + 1);
    }
    
    return counts;
  },
  
  // Find circular messages (entity sending to itself)
  findCircularMessages: (messages: OutboxMsg[]): OutboxMsg[] => {
    return messages.filter(msg => msg.from === msg.to);
  },
  
  // Find cross-entity messages
  findCrossEntityMessages: (messages: OutboxMsg[]): OutboxMsg[] => {
    return messages.filter(msg => msg.from !== msg.to);
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

const entityExistsAtSigner = (
  server: ServerState,
  signer: SignerIdx,
  entityId: EntityId
): boolean => {
  const signerEntities = server.signers.get(signer);
  return signerEntities?.has(entityId) ?? false;
};

// ============================================================================
// Message Creation Helpers
// ============================================================================

export const createMessage = {
  // Create a transaction message
  transaction: (
    from: string,
    to: string,
    tx: any
  ): OutboxMsg => ({
    from: id(from),
    to: id(to),
    command: { type: 'addTx', tx }
  }),
  
  // Create a proposal share message
  shareProposal: (
    from: string,
    to: string,
    toSigner: SignerIdx,
    proposal: any
  ): OutboxMsg => ({
    from: id(from),
    to: id(to),
    toSigner,
    command: { type: 'shareProposal', proposal }
  }),
  
  // Create an approval message
  approval: (
    from: string,
    to: string,
    toSigner: SignerIdx,
    hash: string,
    approver: SignerIdx
  ): OutboxMsg => ({
    from: id(from),
    to: id(to),
    toSigner,
    command: { type: 'approveBlock', hash: blockHash(hash), from: approver }
  }),
  
  // Create a commit message
  commit: (
    from: string,
    to: string,
    toSigner: SignerIdx,
    hash: string
  ): OutboxMsg => ({
    from: id(from),
    to: id(to),
    toSigner,
    command: { type: 'commitBlock', hash: blockHash(hash) }
  })
};