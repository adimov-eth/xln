import { createHash } from 'crypto';
import { Level } from 'level';
import RLP from 'rlp';
import { 
  EntityId, SignerIdx, BlockHeight, BlockHash, 
  toEntityId, toSignerIdx, toBlockHeight, toBlockHash,
  Result, Ok, Err, ProcessingError
} from './types';
import { 
  parseSignerIdx, parseBlockHeight, parseEntityId, 
  incrementBlockHeight, nextBlockHeight, signerIdxFromAny, 
  mapToSignerIdx 
} from './typeHelpers';
import { 
  ErrorCollector, ErrorSeverity, CollectedResult, 
  CollectedOk, CollectedErr 
} from './errorHandling';

// --- Types & Registry ---
export type EntityMeta = {
  id: EntityId;
  quorum: SignerIdx[];    // participating signers
  proposer: SignerIdx;    // default signer index
};

export type Registry = Map<EntityId, EntityMeta>;
export const createRegistry = (): Registry => new Map();

// Register entity (pure function)
export const registerEntity = (
  registry: Registry,
  id: string,
  quorum: number[],
  proposer = 0
): Registry => {
  const newRegistry = new Map(registry);
  const entityId = parseEntityId(id);
  newRegistry.set(entityId, { 
    id: entityId, 
    quorum: mapToSignerIdx(quorum), 
    proposer: parseSignerIdx(proposer) 
  });
  return newRegistry;
};

// Register entity (pure function)

export const isSignerAuthorized = (
  registry: Registry,
  entityId: EntityId,
  signer: SignerIdx
): boolean => {
  const meta = registry.get(entityId);
  return meta ? meta.quorum.some(s => s === signer) : false;
};

// --- Core Types ---
export type EntityTx = { op: string; data: any };

export type EntityInput =
  | { type: 'add_tx'; tx: EntityTx }
  | { type: 'propose_block'; txs: EntityTx[]; hash: string }
  | { type: 'approve_block'; hash: string; from?: SignerIdx }
  | { type: 'commit_block'; hash: string };

export type ServerTx = {
  signer: SignerIdx;
  entityId: EntityId;
  input: EntityInput;
};

export type OutboxMsg = {
  from: EntityId;
  toEntity: EntityId;
  toSigner?: SignerIdx;  // Optional - let server figure it out if not specified
  input: EntityInput;
};

// --- State ---
export type EntityState = {
  height: BlockHeight;
  state: any;
  mempool: EntityTx[];
  proposed?: {
    txs: EntityTx[];
    hash: BlockHash;
    approves: Set<SignerIdx>;
  };
  quorumHash: string;
  status: 'Idle' | 'Proposed';
  lastBlockHash?: BlockHash;  // Chain integrity verification
  lastProcessedHeight?: BlockHeight;  // Track last processed server height to prevent replays
};

export type ServerState = {
  height: BlockHeight;
  registry: Registry;
  signers: Map<SignerIdx, Map<EntityId, EntityState>>;
  mempool: ServerTx[];
  lastBlockHash?: BlockHash;  // Server chain integrity
};

// --- Storage Keys with padded height ---
const pad = (n: number | BlockHeight) => n.toString().padStart(10, '0');
const keys = {
  state: (signer: SignerIdx, entityId: EntityId) => `${signer}:${entityId}`,
  registry: () => 'registry',
  wal: (height: BlockHeight, signer: SignerIdx, entityId: EntityId) => `wal:${pad(height)}:${signer}:${entityId}`,
  walRegistry: (height: BlockHeight, id: EntityId) => `wal:reg:${pad(height)}:${id}`,  // Include padded height for proper ordering
  block: (height: BlockHeight) => `block:${pad(height)}`,
  meta: () => 'meta:height'
};

// --- RLP & Hashing ---
const toRlpData = (obj: any): any => {
  if (obj == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof obj)) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(toRlpData);
  if (typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .map(key => [key, toRlpData(obj[key])]);
  }
  return obj.toString();
};

const hash = (data: any): BlockHash => {
  const rlpData = toRlpData(data);
  return toBlockHash(createHash('sha256').update(RLP.encode(rlpData)).digest('hex'));
};

// Compute integrity hash of the entire state tree
const computeStateHash = (signers: Map<SignerIdx, Map<EntityId, EntityState>>): BlockHash => {
  const stateData: any[] = [];
  
  // Sort signers by index
  const sortedSigners = Array.from(signers.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
  
  for (const [signerIdx, entities] of sortedSigners) {
    const entityData: any[] = [];
    
    // Sort entities by ID
    const sortedEntities = Array.from(entities.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    
    for (const [entityId, entity] of sortedEntities) {
      entityData.push([
        entityId,
        entity.height,
        toRlpData(entity.state),
        entity.mempool.map(tx => toRlpData(tx)),
        entity.status,
        entity.proposed ? [entity.proposed.hash, Array.from(entity.proposed.approves).sort((a, b) => Number(a) - Number(b))] : null,
        entity.lastBlockHash || ''
      ]);
    }
    
    stateData.push([signerIdx, entityData]);
  }
  
  return hash(stateData);
};

// --- Entity Logic ---
const createEntity = (quorum: SignerIdx[]): EntityState => ({
  height: toBlockHeight(0),
  state: { balance: 0n },
  mempool: [],
  quorumHash: hash(quorum).slice(0, 16),  // Just use first 16 chars for quorum hash
  status: 'Idle',
  lastBlockHash: undefined
});

const applyEntityTx = (state: any, tx: EntityTx): any => {
  switch (tx.op) {
    case 'mint': return { ...state, balance: state.balance + BigInt(tx.data.amount) };
    case 'burn': return { ...state, balance: state.balance - BigInt(tx.data.amount) };
    case 'transfer': return { ...state, balance: state.balance - BigInt(tx.data.amount) };
    default: return state;
  }
};

const generateTransferMessages = (txs: EntityTx[], fromEntityId: EntityId): OutboxMsg[] => {
  const messages: OutboxMsg[] = [];
  
  txs.forEach(tx => {
    if (tx.op === 'transfer') {
      messages.push({
        from: fromEntityId,
        toEntity: toEntityId(tx.data.to),
        // No toSigner - let the server figure out routing
        input: { 
          type: 'add_tx', 
          tx: { op: 'mint', data: { amount: tx.data.amount } } 
        }
      });
    }
  });
  
  return messages;
};

export const processEntityInput = (
  entity: EntityState,
  input:  EntityInput,
  signer: SignerIdx,
  meta:   EntityMeta
): Result<[EntityState, OutboxMsg[]], ProcessingError> => {
  const outbox: OutboxMsg[] = [];
  switch (input.type) {
    case 'add_tx':
      if (entity.status === 'Idle') {
        return Ok<[EntityState, OutboxMsg[]], ProcessingError>([{ ...entity, mempool: [...entity.mempool, input.tx] }, []]);
      }
      return Ok<[EntityState, OutboxMsg[]], ProcessingError>([entity, []]);

    case 'propose_block':
      if (entity.status !== 'Idle') {
        return Err({ type: 'validation', field: 'status', message: 'Entity is not idle' });
      }
      const blockHash = toBlockHash(input.hash);
      const block = { txs: input.txs, hash: blockHash };
      
      // If this is a broadcast from another signer (not the original proposer)
      if (signer !== meta.proposer) {
        // Accept the proposal and immediately approve it
        const proposed = { ...block, approves: new Set([signer]) };
        
        // Send approval to ALL signers (including ourselves and proposer)
        const approvalMsgs = meta.quorum.map(s => ({
          from: meta.id,
          toEntity: meta.id,
          toSigner: s,
          input: { type: 'approve_block' as const, hash: input.hash, from: signer }
        }));
        
        return Ok<[EntityState, OutboxMsg[]], ProcessingError>([{ ...entity, proposed, status: 'Proposed' as const }, approvalMsgs]);
      }
      
      // Original proposer creating the proposal
      const proposed = { ...block, approves: new Set([signer]) };
      
      // Single-signer entity: immediate apply with transfer messages
      if (meta.quorum.length === 1) {
        const newState = input.txs.reduce(applyEntityTx, entity.state);
        const transferMessages = generateTransferMessages(input.txs, meta.id);
        const newHeight = incrementBlockHeight(entity.height);
        return Ok<[EntityState, OutboxMsg[]], ProcessingError>([{
          ...entity,
          height: newHeight,
          state: newState,
          mempool: [],
          proposed: undefined,
          status: 'Idle' as const,
          lastBlockHash: blockHash
        }, transferMessages]);
      }
      
      // Multi-signer entity: broadcast proposal to committee
      return Ok<[EntityState, OutboxMsg[]], ProcessingError>([{ ...entity, proposed, status: 'Proposed' as const },
        meta.quorum.filter(p => p !== signer).map(p => ({
          from: meta.id,
          toEntity: meta.id,
          toSigner: p,
          input: { type: 'propose_block' as const, txs: input.txs, hash: input.hash }
        }))
      ]);

    case 'approve_block':
      if (entity.status !== 'Proposed' || !entity.proposed) {
        return Err({ type: 'validation', field: 'status', message: 'No active proposal' });
      }
      if (entity.proposed.hash !== toBlockHash(input.hash)) {
        return Err({ type: 'validation', field: 'hash', message: 'Hash mismatch' });
      }
      
      // Use the 'from' field if provided, otherwise use the executing signer
      const approvingSigner = input.from ?? signer;
      
      if (!meta.quorum.some(q => q === approvingSigner)) {
        return Err({ type: 'unauthorized', signer: approvingSigner, entity: meta.id });
      }
      
      const approves = new Set(entity.proposed.approves).add(approvingSigner);
      // if quorum reached, proposer issues commit
      if (approves.size * 3 >= meta.quorum.length * 2) {
        // only proposer commits
        outbox.push({
          from: meta.id,
          toEntity: meta.id,
          toSigner: meta.proposer,
          input: { type: 'commit_block' as const, hash: input.hash }
        });
        return Ok<[EntityState, OutboxMsg[]], ProcessingError>([{ ...entity, proposed: { ...entity.proposed, approves } }, outbox]);
      }
      return Ok<[EntityState, OutboxMsg[]], ProcessingError>([{ ...entity, proposed: { ...entity.proposed, approves } }, []]);

    case 'commit_block':
      if (entity.status !== 'Proposed' || !entity.proposed) {
        return Err({ type: 'validation', field: 'status', message: 'No active proposal' });
      }
      if (entity.proposed.hash !== toBlockHash(input.hash)) {
        return Err({ type: 'validation', field: 'hash', message: 'Hash mismatch' });
      }
      if (signer !== meta.proposer) {
        return Err({ type: 'unauthorized', signer, entity: meta.id });
      }
      
      // final apply with transfer messages
      const nextState = entity.proposed.txs.reduce(applyEntityTx, entity.state);
      const transferMessages = generateTransferMessages(entity.proposed.txs, meta.id);
      const newHeight = incrementBlockHeight(entity.height);
      return Ok<[EntityState, OutboxMsg[]], ProcessingError>([{
        ...entity,
        height: newHeight,
        state: nextState,
        mempool: [],
        proposed: undefined,
        status: 'Idle' as const,
        lastBlockHash: entity.proposed.hash
      }, transferMessages]);

    default:
      return Err({ type: 'validation', field: 'type', message: 'Unknown input type' });
  }
};

// --- Server Processing ---
export const processServerTx = (
  server: ServerState,
  tx:     ServerTx
): Result<[ServerState, OutboxMsg[]], ProcessingError> => {
  if (!isSignerAuthorized(server.registry, tx.entityId, tx.signer)) {
    return Err({ type: 'unauthorized', signer: tx.signer, entity: tx.entityId });
  }
  
  const signerMap = server.signers.get(tx.signer);
  const meta      = server.registry.get(tx.entityId);
  if (!signerMap || !meta) {
    return Err({ type: 'not_found', resource: 'entity', id: tx.entityId });
  }

  const entity = signerMap.get(tx.entityId);
  if (!entity) {
    return Err({ type: 'not_found', resource: 'entity_state', id: tx.entityId });
  }
  
  const result = processEntityInput(entity, tx.input, tx.signer, meta);
  if (!result.ok) {
    return result;
  }
  
  const [newEntity, msgs] = result.value;
  const newSignerMap = new Map(signerMap);
  newSignerMap.set(tx.entityId, newEntity);
  
  return Ok<[ServerState, OutboxMsg[]], ProcessingError>([{ ...server, signers: new Map(server.signers).set(tx.signer, newSignerMap) }, msgs]);
};

export const processMempool = async (
  server: ServerState,
  storage?: Storage,
  targetHeight?: BlockHeight  // Pass the target height for WAL logging
): Promise<CollectedResult<[ServerState, OutboxMsg[]]>> => {
  const walHeight = targetHeight || nextBlockHeight(server);
  const errorCollector = new ErrorCollector();
  
  // Log to WAL if storage is provided
  if (storage && server.mempool.length > 0) {
    try {
      const batch = storage.wal.batch();
      server.mempool.forEach(tx => {
        batch.put(keys.wal(walHeight, tx.signer, tx.entityId), JSON.stringify(tx));
      });
      await batch.write();
    } catch (walError) {
      errorCollector.addError(walError, {
        operation: 'WAL write',
        height: walHeight
      });
      // Continue processing even if WAL fails
    }
  }
  
  // Process transactions sequentially to maintain consistency
  let currentServer = server;
  const allMessages: OutboxMsg[] = [];
  let processedCount = 0;
  let failedCount = 0;
  
  for (const tx of server.mempool) {
    const result = processServerTx(currentServer, tx);
    if (result.ok) {
      const [nextServer, msgs] = result.value;
      currentServer = nextServer;
      allMessages.push(...msgs);
      processedCount++;
    } else {
      failedCount++;
      // Determine severity based on error type
      const severity = result.error.type === 'validation' 
        ? ErrorSeverity.WARNING 
        : ErrorSeverity.ERROR;
      
      errorCollector.add(result.error, severity, {
        entityId: tx.entityId,
        signer: tx.signer,
        operation: tx.input.type,
        height: walHeight
      });
      
      // Continue processing other transactions unless critical
      if (result.error.type === 'not_found' && 
          (result.error.resource === 'entity' || result.error.resource === 'entity_state')) {
        // Critical error - entity doesn't exist or state is corrupted
        errorCollector.addCritical(
          new Error(`Critical: ${result.error.resource} ${tx.entityId} not found - stopping batch`),
          { entityId: tx.entityId, signer: tx.signer }
        );
        break;
      }
    }
  }
  
  // Log summary if there were errors
  if (errorCollector.hasErrors()) {
    console.warn(`Mempool processing completed with errors: ${processedCount} succeeded, ${failedCount} failed`);
    console.debug(errorCollector.format());
  }
  
  // Return success with collected errors even if some transactions failed
  return CollectedOk(
    [{ ...currentServer, mempool: [] }, allMessages],
    errorCollector
  );
};

export const routeMessages = (server: ServerState, msgs: OutboxMsg[]): ServerState => {
  const routed = msgs.map(msg => {
    // If toSigner is specified, use it; otherwise look up in registry
    if (msg.toSigner !== undefined) {
      return { signer: msg.toSigner, entityId: msg.toEntity, input: msg.input };
    }
    
    // Server knows which signer controls each entity
    const meta = server.registry.get(msg.toEntity);
    if (!meta) {
      console.debug(`Dropping message to unknown entity: ${msg.toEntity}`);
      return null;  // Drop if target doesn't exist
    }
    
    return {
      signer: meta.proposer,  // Server does the lookup
      entityId: msg.toEntity,
      input: msg.input
    };
  }).filter(Boolean) as ServerTx[];
  
  return { ...server, mempool: [...server.mempool, ...routed] };
};

// --- Auto-Propose Logic ---
type AutoProposeCandidate = {
  signerIdx: SignerIdx;
  entityId: EntityId;
  entity: EntityState;
  meta: EntityMeta;
};

const findAutoProposeEligible = (
  server: ServerState
): AutoProposeCandidate[] => {
  const candidates: AutoProposeCandidate[] = [];
  
  for (const [signerIdx, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const meta = server.registry.get(entityId);
      if (!meta) continue;
      
      if (entity.mempool.length > 0 && 
          entity.status === 'Idle' && 
          meta.quorum.length === 1) {
        candidates.push({ signerIdx, entityId, entity, meta });
      }
    }
  }
  
  return candidates;
};

const createProposeTx = (
  candidate: AutoProposeCandidate
): ServerTx => {
  const txs = candidate.entity.mempool;
  const blockHash = hash([candidate.entity.height + 1, txs]);
  
  return {
    signer: candidate.signerIdx,
    entityId: candidate.entityId,
    input: { type: 'propose_block', txs, hash: blockHash }
  };
};

const autoProposeSingleSigners = (
  server: ServerState
): ServerState => {
  const candidates = findAutoProposeEligible(server);
  
  // Add propose transactions to mempool instead of processing directly
  const proposeTxs = candidates.map(createProposeTx);
  
  return { 
    ...server, 
    mempool: [...server.mempool, ...proposeTxs] 
  };
};

// --- Content-Addressed Storage ---
export type ArchiveEntry = {
  height: BlockHeight;
  timestamp: number;
  stateRoot: BlockHash;
  parentHash?: BlockHash;  // Previous archive hash
  signers: Record<number, Record<string, any>>;
  registry: [EntityId, EntityMeta][];
};

// Helper to convert Map to object for serialization
const mapToObject = <K extends string | number, V, R>(
  map: Map<K, V>,
  valueTransform: (v: V) => R
): Record<K, R> => {
  const obj: Record<K, R> = {} as any;
  for (const [key, value] of map) {
    obj[key] = valueTransform(value);
  }
  return obj;
};

// Serialize entity for archiving (without double JSON conversion)
const serializeEntityForArchive = (entity: EntityState): any => ({
  ...entity,
  state: { ...entity.state, balance: entity.state.balance.toString() },
  proposed: entity.proposed ? {
    ...entity.proposed,
    approves: Array.from(entity.proposed.approves)
  } : undefined,
  lastProcessedHeight: entity.lastProcessedHeight
});

export const archiveSnapshot = async (
  server: ServerState, 
  storage: Storage,
  parentHash?: string
): Promise<string> => {
  // Create immutable snapshot
  const entry: ArchiveEntry = {
    height: server.height,
    timestamp: Date.now(),
    stateRoot: computeStateHash(server.signers),
    parentHash: parentHash ? toBlockHash(parentHash) : undefined,
    signers: mapToObject(server.signers, (entities) => 
      mapToObject(entities, serializeEntityForArchive)
    ),
    registry: [...server.registry]
  };
  
  // Store by content hash
  const contentHash = hash(entry);
  await storage.archive.put(contentHash, JSON.stringify(entry));
  
  // Update mutable reference
  await storage.refs.put('HEAD', contentHash);
  
  // Keep mutable snapshot for fast access
  await saveSnapshot(server, storage);
  
  return contentHash;
};

// --- Enhanced Recovery ---
export const recoverFromArchive = async (
  storage: Storage, 
  hashOrRef: string = 'HEAD'
): Promise<ServerState | null> => {
  try {
    // Resolve reference if needed
    let targetHash = hashOrRef;
    try {
      targetHash = await storage.refs.get(hashOrRef) as string;
    } catch (err) {
      // Not a ref, assume it's a direct hash
      console.debug(`Not a ref, treating as hash: ${hashOrRef}`, err);
    }
    
    // Load immutable snapshot
    const data = await storage.archive.get(targetHash) as string;
    const entry: ArchiveEntry = JSON.parse(data);
    
    // Reconstruct server state
    const signers = new Map<SignerIdx, Map<EntityId, EntityState>>();
    for (const [signerIdxStr, entities] of Object.entries(entry.signers)) {
      const signerIdx = parseSignerIdx(signerIdxStr);
      const entityMap = new Map<EntityId, EntityState>();
      for (const [entityIdStr, entityData] of Object.entries(entities)) {
        const entityId = parseEntityId(entityIdStr);
        // entityData is already deserialized from JSON, just need to convert types
        const entity = {
          ...entityData,
          height: toBlockHeight(entityData.height),
          state: { ...entityData.state, balance: BigInt(entityData.state.balance) },
          proposed: entityData.proposed ? {
            ...entityData.proposed,
            hash: toBlockHash(entityData.proposed.hash),
            approves: new Set(entityData.proposed.approves.map((a: any) => signerIdxFromAny(a)))
          } : undefined,
          lastBlockHash: entityData.lastBlockHash ? toBlockHash(entityData.lastBlockHash) : undefined,
          lastProcessedHeight: entityData.lastProcessedHeight ? toBlockHeight(entityData.lastProcessedHeight) : undefined
        } as EntityState;
        entityMap.set(entityId, entity);
      }
      signers.set(signerIdx, entityMap);
    }
    
    return {
      height: entry.height,
      registry: new Map(entry.registry.map(([id, meta]) => [
        id,
        { ...meta, quorum: meta.quorum.map((q: any) => signerIdxFromAny(q)), proposer: signerIdxFromAny(meta.proposer) }
      ])),
      signers,
      mempool: [],
      lastBlockHash: entry.stateRoot
    };
  } catch (err) {
    console.debug(`Failed to load archive ${hashOrRef}:`, err);
    return null;
  }
};

// --- History Traversal ---
export const getHistory = async function* (
  storage: Storage,
  startHash: string,
  maxDepth = 100
): AsyncGenerator<ArchiveEntry> {
  let currentHash = startHash;
  let depth = 0;
  
  while (currentHash && depth < maxDepth) {
    try {
      const data = await storage.archive.get(currentHash) as string;
      const entry: ArchiveEntry = JSON.parse(data);
      yield entry;
      
      currentHash = entry.parentHash || '';
      depth++;
    } catch (err) {
      console.debug(`Failed to traverse history at ${currentHash}:`, err);
      break;
    }
  }
};

export const processBlock = async (
  server: ServerState,
  storage?: Storage,
  archiveInterval = 100  // Archive every N blocks
): Promise<ServerState> => {
  const targetHeight = nextBlockHeight(server);
  const blockTxs = server.mempool;
  const errorCollector = new ErrorCollector();
  
  // Track which entities were touched in this block
  const touchedEntities = new Set<string>();
  blockTxs.forEach(tx => touchedEntities.add(`${tx.signer}:${tx.entityId}`));
  
  // Process mempool with target height for WAL
  const processingResult = await processMempool(server, storage, targetHeight);
  
  // Handle errors from mempool processing
  if (!processingResult.ok || processingResult.errors.hasCritical()) {
    console.error('Critical error in mempool processing:', processingResult.errors.format());
    throw new Error('Failed to process mempool - critical errors encountered');
  }
  
  const [afterApply, msgs] = processingResult.value;
  errorCollector.merge(processingResult.errors);
  
  // Update lastProcessedHeight for all touched entities
  const updatedSigners = new Map(afterApply.signers);
  for (const [signerIdx, entities] of updatedSigners) {
    const updatedEntities = new Map(entities);
    for (const [entityId, entity] of updatedEntities) {
      if (touchedEntities.has(`${signerIdx}:${entityId}`)) {
        updatedEntities.set(entityId, { ...entity, lastProcessedHeight: targetHeight });
      }
    }
    updatedSigners.set(signerIdx, updatedEntities);
  }
  
  const afterUpdate = { ...afterApply, signers: updatedSigners };
  
  if (storage) {
    // Regular block storage
    if (blockTxs.length > 0) {
      try {
        const stateHash = computeStateHash(afterUpdate.signers);
        const payload = [
          targetHeight,
          Date.now(),
          stateHash,
          blockTxs.map(tx => [tx.signer, tx.entityId, toRlpData(tx.input)])
        ];
        await storage.blocks.put(
          keys.block(targetHeight), 
          Buffer.from(RLP.encode(payload)).toString('hex')
        );
      } catch (blockError) {
        errorCollector.addError(blockError, {
          operation: 'block storage',
          height: targetHeight
        });
        // Continue - block storage failure is not critical
      }
    }
    
    // Create immutable archive at intervals
    if (targetHeight % archiveInterval === 0) {
      try {
        const parentHash = await storage.refs.get('HEAD').catch(() => undefined);
        await archiveSnapshot(
          { ...afterUpdate, height: targetHeight }, 
          storage, 
          parentHash as string
        );
      } catch (archiveError) {
        errorCollector.addWarning(archiveError, {
          operation: 'archive snapshot',
          height: targetHeight
        });
        // Archive failure is not critical
      }
    }
  }
  
  // Log final error summary if any errors occurred
  if (errorCollector.hasErrors()) {
    console.warn(`Block ${targetHeight} processed with errors:`, errorCollector.format());
  }
  
  const routed = routeMessages({ ...afterUpdate, mempool: [] }, msgs);
  const withAutoPropose = autoProposeSingleSigners(routed);
  
  return { ...withAutoPropose, height: targetHeight };
};

// Helper function to trigger proposals for multi-signer entities
export const proposeBlock = (server: ServerState, signer: SignerIdx, entityId: EntityId): ServerState => {
  const entity = server.signers.get(signer)?.get(entityId);
  if (!entity || entity.status !== 'Idle' || entity.mempool.length === 0) {
    return server;
  }
  
  const txs = entity.mempool;
  const blockHash = hash([entity.height + 1, txs]);
  
  const proposeTx: ServerTx = {
    signer: signer,
    entityId: entityId,
    input: { type: 'propose_block', txs, hash: blockHash }
  };
  
  return { ...server, mempool: [...server.mempool, proposeTx] };
};

type Storage = {
  state: Level;      // Mutable current state
  wal: Level;        // Write-ahead log
  blocks: Level;     // Blocks by height
  archive: Level;    // Immutable snapshots by hash
  refs: Level;       // Named references (like git refs)
};

export const createStorage = (path = './data'): Storage => ({
  state: new Level(`${path}/state`),
  wal: new Level(`${path}/wal`),
  blocks: new Level(`${path}/blocks`),
  archive: new Level(`${path}/archive`),
  refs: new Level(`${path}/refs`)
});

// Register entity with WAL logging
export const registerEntityWithLog = async (
  server: ServerState,
  storage: Storage,
  id: string,
  quorum: number[],
  proposer = 0
): Promise<ServerState> => {
  // Use next height for WAL logging to ensure proper ordering
  const targetHeight = nextBlockHeight(server);
  const entityId = parseEntityId(id);
  
  // 1) Log to WAL as system transaction with type marker
  const entry = JSON.stringify({ 
    type: 'registry_update',
    id, 
    quorum, 
    proposer, 
    height: targetHeight 
  });
  await storage.wal.put(
    keys.walRegistry(targetHeight, entityId),
    entry
  );

  // 2) Update registry in memory
  const newReg = new Map(server.registry);
  newReg.set(entityId, { 
    id: entityId, 
    quorum: quorum.map(toSignerIdx), 
    proposer: toSignerIdx(proposer) 
  });
  return { ...server, registry: newReg };
};

const serializeEntity = (entity: EntityState) => JSON.stringify({
  ...entity,
  state: { ...entity.state, balance: entity.state.balance.toString() },
  proposed: entity.proposed ? {
    ...entity.proposed,
    approves: Array.from(entity.proposed.approves)
  } : undefined,
  lastProcessedHeight: entity.lastProcessedHeight
});

const deserializeEntity = (data: string): EntityState => {
  const parsed = JSON.parse(data);
  return {
    ...parsed,
    state: { ...parsed.state, balance: BigInt(parsed.state.balance) },
    proposed: parsed.proposed ? {
      ...parsed.proposed,
      approves: new Set(parsed.proposed.approves)
    } : undefined,
    lastProcessedHeight: parsed.lastProcessedHeight
  };
};

export const saveSnapshot = async (server: ServerState, storage: Storage) => {
  const batch = storage.state.batch();
  
  // Save registry for fast recovery
  batch.put(keys.registry(), JSON.stringify([...server.registry]));
  
  for (const [signerIdx, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      batch.put(keys.state(signerIdx, entityId), serializeEntity(entity));
    }
  }
  
  batch.put(keys.meta(), server.height.toString());
  await batch.write();
  
  // Clean up old WAL after snapshot (including registry updates)
  const snapshotHeight = server.height;
  const walBatch = storage.wal.batch();
  
  // Delete old transaction WAL entries
  for await (const [key] of storage.wal.iterator({
    gte: 'wal:',
    lt: `wal:${pad(snapshotHeight)}:`
  })) {
    walBatch.del(key as string);
  }
  
  // Delete old registry WAL entries
  for await (const [key] of storage.wal.iterator({
    gte: 'wal:reg:',
    lt: `wal:reg:${pad(snapshotHeight)}:`
  })) {
    walBatch.del(key as string);
  }
  
  await walBatch.write();
};

export const loadSnapshot = async (storage: Storage): Promise<ServerState | null> => {
  try {
    const height = parseBlockHeight(await storage.state.get(keys.meta()) as string);
    
    // Load registry from snapshot
    let registry: Registry;
    try {
      const registryData = await storage.state.get(keys.registry()) as string;
      const rawRegistry = JSON.parse(registryData) as Array<[string, EntityMeta]>;
      registry = new Map(rawRegistry.map(([id, meta]) => [
        toEntityId(id),
        { ...meta, id: toEntityId(id), quorum: meta.quorum.map((q: any) => toSignerIdx(Number(q))), proposer: toSignerIdx(Number(meta.proposer)) }
      ]));
    } catch {
      registry = createRegistry();  // Fallback for old snapshots
    }
    
    const signers = new Map<SignerIdx, Map<EntityId, EntityState>>();
    
    for await (const [key, value] of storage.state.iterator()) {
      if (key === keys.meta() || key === keys.registry()) continue;
      
      // Only parse keys that match the pattern: <number>:<entityId>
      const keyStr = key as string;
      if (!/^\d+:/.test(keyStr)) continue;
      
      const parts = keyStr.split(':');
      if (parts.length !== 2) continue;
      
      // Use try-catch to handle invalid conversions
      try {
        const signerIdx = parseSignerIdx(parts[0]);
        const entityId = parseEntityId(parts[1]);
        
        if (!signers.has(signerIdx)) {
          signers.set(signerIdx, new Map());
        }
        
        const entity = deserializeEntity(value as string);
        signers.get(signerIdx)!.set(entityId, entity);
      } catch (conversionErr) {
        // Skip invalid entries
        console.debug(`Skipping invalid state entry ${keyStr}:`, conversionErr);
        continue;
      }
    }
    
    console.log(`Recovered state at height ${height} with ${signers.size} signers`);
    return { height, registry, signers, mempool: [] };
  } catch (err) {
    return null;
  }
};

export const initializeServer = (): ServerState => {
  let registry = createRegistry();
  
  // Register all entities with their proposers
  registry = registerEntity(registry, 'alice', [0], 0);
  registry = registerEntity(registry, 'bob', [1], 1);
  registry = registerEntity(registry, 'carol', [2], 2);
  registry = registerEntity(registry, 'hub', [1], 1);
  registry = registerEntity(registry, 'dao', [0, 1, 2], 0);  // signer 0 is the default proposer
  
  const s0 = toSignerIdx(0);
  const s1 = toSignerIdx(1);
  const s2 = toSignerIdx(2);
  
  return {
    height: toBlockHeight(0),
    registry,
    mempool: [],
    signers: new Map([
      [s0, new Map([
        [toEntityId('alice'), createEntity([s0])],           
        [toEntityId('dao'), createEntity([s0, s1, s2])]         
      ])],
      [s1, new Map([
        [toEntityId('bob'), createEntity([s1])],               
        [toEntityId('hub'), createEntity([s1])],               
        [toEntityId('dao'), createEntity([s0, s1, s2])]         
      ])],
      [s2, new Map([
        [toEntityId('carol'), createEntity([s2])],           
        [toEntityId('dao'), createEntity([s0, s1, s2])]         
      ])]
    ])
  };
};

export const recoverServer = async (storage: Storage): Promise<ServerState> => {
  // Load snapshot (or initialize)
  let server = await loadSnapshot(storage) || initializeServer();
  
  // First replay registry updates from dedicated prefix (only those AFTER snapshot height)
  for await (const [key, value] of storage.wal.iterator({
    gte: `wal:reg:${pad(Number(server.height) + 1)}:`,
    lt: 'wal:reg:\xff'
  })) {
    try {
      const data = JSON.parse(value as string);
      if (data.type === 'registry_update' && data.height > Number(server.height)) {
        server.registry = registerEntity(server.registry, data.id, data.quorum, data.proposer);
      }
    } catch (err) {
      console.debug(`Failed to parse registry WAL entry ${key}:`, err);
    }
  }
  
  // Then replay regular WAL entries (only those AFTER snapshot height)
  const walEntries: Array<{height: number, tx: ServerTx}> = [];
  
  for await (const [key, value] of storage.wal.iterator({
    gte: keys.wal(toBlockHeight(Number(server.height) + 1), toSignerIdx(0), toEntityId(''))
  })) {
    try {
      // Extract height from WAL key
      const keyParts = (key as string).split(':');
      if (keyParts.length >= 4) {
        const walHeight = parseInt(keyParts[1]);
        if (!isNaN(walHeight) && walHeight > Number(server.height)) {
          const rawTx = JSON.parse(value as string);
          const tx: ServerTx = {
            signer: signerIdxFromAny(rawTx.signer),
            entityId: parseEntityId(rawTx.entityId),
            input: rawTx.input
          };
          
          // Check if this entity has already processed this height
          const entity = server.signers.get(tx.signer)?.get(tx.entityId);
          if (!entity || !entity.lastProcessedHeight || walHeight > Number(entity.lastProcessedHeight)) {
            walEntries.push({ height: walHeight, tx });
          }
        }
      }
    } catch (err) {
      console.debug(`Failed to parse WAL entry ${key}:`, err);
    }
  }
  
  // Sort by height and add to mempool
  walEntries.sort((a, b) => a.height - b.height);
  server = { ...server, mempool: walEntries.map(e => e.tx) };
  
  // Process any pending transactions
  if (server.mempool.length > 0) {
    server = await processBlock(server);
  }
  
  return server;
};

// --- Block Replay ---
const replayBlocksFromTo = async (
  state: ServerState,
  storage: Storage,
  fromHeight: number,
  toHeight: number
): Promise<ServerState> => {
  let current = state;
  
  for (let h = fromHeight; h <= toHeight; h++) {
    try {
      const blockHeight = toBlockHeight(h);
      const blockData = await storage.blocks.get(keys.block(blockHeight)) as string;
      const decoded = RLP.decode(Buffer.from(blockData, 'hex')) as any;
      
      // Validate block format
      if (!Array.isArray(decoded) || decoded.length < 4) {
        console.warn(`Invalid block format at height ${h}`);
        break;
      }
      
      const blockTxs = decoded[3].map((txData: any) => ({
        signer: signerIdxFromAny(txData[0]),
        entityId: parseEntityId(txData[1]),
        input: txData[2]
      }));
      
      // Apply block transactions
      for (const tx of blockTxs) {
        current.mempool.push(tx);
      }
      const processingResult = await processMempool(current, undefined, blockHeight);
      if (!processingResult.ok) {
        console.error(`Failed to replay block ${h}:`, processingResult.errors.format());
        break;
      }
      const [processed] = processingResult.value;
      current = { ...processed, height: blockHeight, mempool: [] };
    } catch (err) {
      console.warn(`Failed to replay block ${h}:`, err);
      break;
    }
  }
  
  return current;
};

// --- Time Travel Queries ---
export const getStateAtHeight = async (
  storage: Storage,
  targetHeight: number
): Promise<ServerState | null> => {
  // Search through archive for matching height
  const head = await storage.refs.get('HEAD').catch(() => undefined) as string;
  if (!head) {
    console.debug('No HEAD reference found in archive');
    return null;
  }
  
  for await (const entry of getHistory(storage, head)) {
    if (entry.height <= targetHeight) {
      // Found closest archive point
      const state = await recoverFromArchive(storage, hash(entry));
      
      if (state && entry.height < targetHeight) {
        // Replay blocks from archive point to target
        return replayBlocksFromTo(state, storage, entry.height + 1, targetHeight);
      }
      
      return state;
    }
  }
  
  console.debug(`No archive found for height ${targetHeight}`);
  return null;
};