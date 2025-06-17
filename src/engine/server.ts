// ============================================================================
// engine/server.ts - Server state management that reads like English
// ============================================================================

import { height, id, signer } from '../types/primitives.js';
import type { 
  EntityCommand, 
  EntityMeta, 
  EntityState, 
  ServerState, 
  ServerTx, 
  SignerIdx 
} from '../types/state.js';
import { assoc } from '../utils/immutable.js';

// ============================================================================
// Server Configuration
// ============================================================================

const MAX_QUORUM_SIZE = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================================================
// Server Creation
// ============================================================================

export const createServer = (): ServerState => ({
  height: height(0),
  signers: new Map(),
  registry: new Map(),
  mempool: []
});

// ============================================================================
// Entity Registration - Tell the server about entities
// ============================================================================

export const registerEntity = (
  server: ServerState,
  entityId: string,
  config: {
    quorum: number[];
    protocol: string;
    timeoutMs?: number;
  }
): ServerState => {
  // Validate quorum
  if (!isValidQuorum(config.quorum)) {
    throw new Error(describeQuorumError(config.quorum));
  }
  
  // Create entity metadata
  const meta: EntityMeta = {
    id: id(entityId),
    quorum: config.quorum.map(signer),
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    protocol: config.protocol
  };
  
  // Register in the registry
  return {
    ...server,
    registry: assoc(server.registry, id(entityId), meta)
  };
};

// ============================================================================
// Entity Import - Signers claim their entities
// ============================================================================

export const importEntity = (
  server: ServerState,
  signerId: number,
  entityId: string,
  initialState?: any
): ServerState => {
  // Check if entity is registered
  const meta = server.registry.get(id(entityId));
  if (!meta) {
    throw new Error(`Cannot import entity "${entityId}" - it is not registered`);
  }
  
  // Check if signer is authorized
  const signerIdx = signer(signerId);
  if (!signerIsInQuorum(signerIdx, meta)) {
    throw new Error(`Signer ${signerId} is not authorized for entity "${entityId}"`);
  }
  
  // Check if already imported
  if (entityAlreadyImported(server, signerIdx, entityId)) {
    return server; // No-op
  }
  
  // Create the entity state
  const entity = createEntityState(entityId, initialState ?? getDefaultState(meta.protocol));
  
  // Add to signer's entities
  return addEntityToSigner(server, signerIdx, entity);
};

// ============================================================================
// Command Submission - How work enters the system
// ============================================================================

export const submitCommand = (
  server: ServerState,
  fromSigner: number,
  toEntity: string,
  command: EntityCommand
): ServerState => {
  const serverTx: ServerTx = {
    signer: signer(fromSigner),
    entityId: id(toEntity),
    command
  };
  
  return {
    ...server,
    mempool: [...server.mempool, serverTx]
  };
};

// ============================================================================
// Query Functions - Ask questions about the server
// ============================================================================

export const query = {
  // Get an entity from a specific signer
  getEntity: (
    server: ServerState, 
    signerId: number, 
    entityId: string
  ): EntityState | undefined => {
    const signerEntities = server.signers.get(signer(signerId));
    return signerEntities?.get(id(entityId));
  },
  
  // Get entity metadata
  getMetadata: (
    server: ServerState,
    entityId: string
  ): EntityMeta | undefined => {
    return server.registry.get(id(entityId));
  },
  
  // Check if entity exists at signer
  hasEntity: (
    server: ServerState,
    signerId: number,
    entityId: string
  ): boolean => {
    return query.getEntity(server, signerId, entityId) !== undefined;
  },
  
  // Count pending commands
  pendingCommandCount: (server: ServerState): number => {
    return server.mempool.length;
  },
  
  // Get all entities for a signer
  getSignerEntities: (
    server: ServerState,
    signerId: number
  ): EntityState[] => {
    const signerEntities = server.signers.get(signer(signerId));
    return signerEntities ? Array.from(signerEntities.values()) : [];
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

const isValidQuorum = (quorum: number[]): boolean => {
  return quorum.length > 0 && quorum.length <= MAX_QUORUM_SIZE;
};

const describeQuorumError = (quorum: number[]): string => {
  if (quorum.length === 0) {
    return 'Quorum cannot be empty';
  }
  if (quorum.length > MAX_QUORUM_SIZE) {
    return `Quorum size ${quorum.length} exceeds maximum allowed (${MAX_QUORUM_SIZE})`;
  }
  return 'Invalid quorum';
};

const signerIsInQuorum = (signer: SignerIdx, meta: EntityMeta): boolean => {
  return meta.quorum.includes(signer);
};

const entityAlreadyImported = (
  server: ServerState,
  signer: SignerIdx,
  entityId: string
): boolean => {
  const signerEntities = server.signers.get(signer);
  return signerEntities?.has(id(entityId)) ?? false;
};

const createEntityState = (entityId: string, data: any): EntityState => ({
  id: id(entityId),
  height: height(0),
  stage: 'idle',
  data,
  mempool: []
});

const addEntityToSigner = (
  server: ServerState,
  signerIdx: SignerIdx,
  entity: EntityState
): ServerState => {
  const signerEntities = server.signers.get(signerIdx) ?? new Map();
  const updatedSignerEntities = assoc(signerEntities, entity.id, entity);
  
  return {
    ...server,
    signers: assoc(server.signers, signerIdx, updatedSignerEntities)
  };
};

const getDefaultState = (protocol: string): any => {
  switch (protocol) {
    case 'wallet':
      return { balance: 0n, nonce: 0 };
    case 'dao':
      return { 
        balance: 0n, 
        nonce: 0, 
        initiatives: new Map(), 
        memberCount: 0, 
        voteThreshold: 66 
      };
    default:
      return {};
  }
};

// ============================================================================
// Fluent API for Server Creation
// ============================================================================

export class ServerBuilder {
  private server: ServerState;
  
  constructor() {
    this.server = createServer();
  }
  
  withEntity(entityId: string, config: {
    quorum: number[];
    protocol: string;
    timeoutMs?: number;
    initialState?: any;
  }): this {
    this.server = registerEntity(this.server, entityId, config);
    
    // Auto-import for all quorum members
    for (const signerId of config.quorum) {
      this.server = importEntity(
        this.server, 
        signerId, 
        entityId, 
        config.initialState
      );
    }
    
    return this;
  }
  
  withCommand(from: number, to: string, command: EntityCommand): this {
    this.server = submitCommand(this.server, from, to, command);
    return this;
  }
  
  build(): ServerState {
    return this.server;
  }
}
