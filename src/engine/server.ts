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
    readonly quorum: readonly number[];
    readonly protocol: string;
    readonly timeoutMs?: number;
  }
): ServerState => {
  if (!isValidQuorum(config.quorum)) throw new Error(describeQuorumError(config.quorum));
  
  const meta: EntityMeta = {
    id: id(entityId),
    quorum: config.quorum.map(signer),
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    protocol: config.protocol
  };
  
  return { ...server, registry: assoc(server.registry, id(entityId), meta) };
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
  const meta = server.registry.get(id(entityId));
  if (!meta) throw new Error(`Cannot import entity "${entityId}" - it is not registered`);
  
  const signerIdx = signer(signerId);
  if (!signerIsInQuorum(signerIdx, meta)) throw new Error(`Signer ${signerId} is not authorized for entity "${entityId}"`);
  if (entityAlreadyImported(server, signerIdx, entityId)) return server;
  
  const entity = createEntityState(entityId, initialState ?? getDefaultState(meta.protocol));
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
  const serverTx: ServerTx = { signer: signer(fromSigner), entityId: id(toEntity), command };
  return { ...server, mempool: [...server.mempool, serverTx] };
};

// ============================================================================
// Query Functions - Ask questions about the server
// ============================================================================

export const query = {
  getEntity: (server: ServerState, signerId: number, entityId: string): EntityState | undefined => server.signers.get(signer(signerId))?.get(id(entityId)),
  getMetadata: (server: ServerState, entityId: string): EntityMeta | undefined => server.registry.get(id(entityId)),
  hasEntity: (server: ServerState, signerId: number, entityId: string): boolean => query.getEntity(server, signerId, entityId) !== undefined,
  pendingCommandCount: (server: ServerState): number => server.mempool.length,
  getSignerEntities: (server: ServerState, signerId: number): readonly EntityState[] => Array.from(server.signers.get(signer(signerId))?.values() ?? [])
};

// ============================================================================
// Helper Functions
// ============================================================================

const isValidQuorum = (quorum: readonly number[]): boolean => quorum.length > 0 && quorum.length <= MAX_QUORUM_SIZE;
const describeQuorumError = (quorum: readonly number[]): string => quorum.length === 0 ? 'Quorum cannot be empty' : `Quorum size ${quorum.length} exceeds maximum allowed (${MAX_QUORUM_SIZE})`;
const signerIsInQuorum = (signer: SignerIdx, meta: EntityMeta): boolean => meta.quorum.includes(signer);
const entityAlreadyImported = (server: ServerState, signer: SignerIdx, entityId: string): boolean => server.signers.get(signer)?.has(id(entityId)) ?? false;
const createEntityState = (entityId: string, data: any): EntityState => ({ id: id(entityId), height: height(0), stage: 'idle', data, mempool: [] });

const addEntityToSigner = (server: ServerState, signerIdx: SignerIdx, entity: EntityState): ServerState => {
  const signerEntities = server.signers.get(signerIdx) ?? new Map();
  const updatedSignerEntities = assoc(signerEntities, entity.id, entity);
  return { ...server, signers: assoc(server.signers, signerIdx, updatedSignerEntities) };
};

const getDefaultState = (protocol: string): any => {
  switch (protocol) {
    case 'wallet': return { balance: 0n, nonce: 0 };
    case 'dao': return { balance: 0n, nonce: 0, initiatives: new Map(), memberCount: 0, voteThreshold: 66 };
    default: return {};
  }
};