import { createHash } from 'crypto';
import { Level } from 'level';
import RLP from 'rlp';

// --- Types & Registry ---
export type EntityMeta = {
  id: string;
  quorum: number[];    // participating signers
  proposer: number;    // default signer index
};

export type Registry = Map<string, EntityMeta>;
export const createRegistry = (): Registry => new Map();

// Register entity (pure function)
export const registerEntity = (
  registry: Registry,
  id: string,
  quorum: number[],
  proposer = 0
): Registry => {
  const newRegistry = new Map(registry);
  newRegistry.set(id, { id, quorum, proposer });
  return newRegistry;
};

// Register entity (pure function)

export const isSignerAuthorized = (
  registry: Registry,
  entityId: string,
  signer: number
): boolean => {
  const meta = registry.get(entityId);
  return meta ? meta.quorum.includes(signer) : false;
};

// --- Core Types ---
export type EntityTx = { op: string; data: any };

export type EntityInput =
  | { type: 'add_tx'; tx: EntityTx }
  | { type: 'propose_block'; txs: EntityTx[]; hash: string }
  | { type: 'approve_block'; hash: string }
  | { type: 'commit_block'; hash: string };

export type ServerTx = {
  signer: number;
  entityId: string;
  input: EntityInput;
};

export type OutboxMsg = {
  from: string;
  toEntity: string;
  toSigner?: number;  // Optional - let server figure it out if not specified
  input: EntityInput;
};

// --- State ---
export type EntityState = {
  height: number;
  state: any;
  mempool: EntityTx[];
  proposed?: {
    txs: EntityTx[];
    hash: string;
    approves: Set<number>;
  };
  quorumHash: string;
  status: 'Idle' | 'Proposed';
  lastProcessedHeight?: number;  // Track last processed server height to prevent replays
};

export type ServerState = {
  height: number;
  registry: Registry;
  signers: Map<number, Map<string, EntityState>>;
  mempool: ServerTx[];
};

// --- Storage Keys with padded height ---
const pad = (n: number) => n.toString().padStart(10, '0');
const keys = {
  state: (signer: number, entityId: string) => `${signer}:${entityId}`,
  registry: () => 'registry',
  wal: (height: number, signer: number, entityId: string) => `wal:${pad(height)}:${signer}:${entityId}`,
  walRegistry: (height: number, id: string) => `wal:reg:${pad(height)}:${id}`,  // Include padded height for proper ordering
  block: (height: number) => `block:${pad(height)}`,
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

const hash = (data: any): string => {
  const rlpData = toRlpData(data);
  return createHash('sha256').update(RLP.encode(rlpData)).digest('hex');
};

// Compute integrity hash of the entire state tree
const computeStateHash = (signers: Map<number, Map<string, EntityState>>): string => {
  const stateData: any[] = [];
  
  // Sort signers by index
  const sortedSigners = Array.from(signers.entries()).sort((a, b) => a[0] - b[0]);
  
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
        entity.proposed ? [entity.proposed.hash, Array.from(entity.proposed.approves).sort()] : null
      ]);
    }
    
    stateData.push([signerIdx, entityData]);
  }
  
  return hash(stateData);
};

// --- Entity Logic ---
const createEntity = (quorum: number[]): EntityState => ({
  height: 0,
  state: { balance: 0n },
  mempool: [],
  quorumHash: hash(quorum),
  status: 'Idle'
});

const applyEntityTx = (state: any, tx: EntityTx): any => {
  switch (tx.op) {
    case 'mint': return { ...state, balance: state.balance + BigInt(tx.data.amount) };
    case 'burn': return { ...state, balance: state.balance - BigInt(tx.data.amount) };
    case 'transfer': return { ...state, balance: state.balance - BigInt(tx.data.amount) };
    default: return state;
  }
};

const generateTransferMessages = (txs: EntityTx[], fromEntityId: string): OutboxMsg[] => {
  const messages: OutboxMsg[] = [];
  
  txs.forEach(tx => {
    if (tx.op === 'transfer') {
      messages.push({
        from: fromEntityId,
        toEntity: tx.data.to,
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
  signer: number,
  meta:   EntityMeta
): [EntityState, OutboxMsg[]] => {
  const outbox: OutboxMsg[] = [];
  switch (input.type) {
    case 'add_tx':
      if (entity.status === 'Idle') {
        return [{ ...entity, mempool: [...entity.mempool, input.tx] }, []];
      }
      return [entity, []];

    case 'propose_block':
      if (entity.status !== 'Idle') return [entity, []];
      const block = { txs: input.txs, hash: input.hash };
      const proposed = { ...block, approves: new Set([signer]) };
      
      // Single-signer entity: immediate apply with transfer messages
      if (meta.quorum.length === 1) {
        const newState = input.txs.reduce(applyEntityTx, entity.state);
        const transferMessages = generateTransferMessages(input.txs, meta.id);
        return [{
          ...entity,
          height: entity.height + 1,
          state: newState,
          mempool: [],         // ⬅ CLEAR mempool here
          proposed: undefined,
          status: 'Idle' as const
        }, transferMessages];
      }
      
      // Multi-signer entity: broadcast approve to committee
      return [{ ...entity, proposed, status: 'Proposed' as const },
        meta.quorum.filter(p => p !== signer).map(p => ({
          from: meta.id,
          toEntity: meta.id,
          toSigner: p,
          input: { type: 'approve_block' as const, hash: input.hash }
        }))
      ];

    case 'approve_block':
      if (entity.status !== 'Proposed' || entity.proposed?.hash !== input.hash || !meta.quorum.includes(signer)) {
        return [entity, []];
      }
      const approves = new Set(entity.proposed.approves).add(signer);
      // if quorum reached, proposer issues commit
      if (approves.size * 3 >= meta.quorum.length * 2) {
        // only proposer commits
        outbox.push({
          from: meta.id,
          toEntity: meta.id,
          toSigner: meta.proposer,
          input: { type: 'commit_block' as const, hash: input.hash }
        });
        return [{ ...entity, proposed: { ...entity.proposed, approves } }, outbox];
      }
      return [{ ...entity, proposed: { ...entity.proposed, approves } }, []];

    case 'commit_block':
      if (entity.status !== 'Proposed' || entity.proposed?.hash !== input.hash || signer !== meta.proposer) {
        return [entity, []];
      }
      // final apply with transfer messages
      const nextState = entity.proposed.txs.reduce(applyEntityTx, entity.state);
      const transferMessages = generateTransferMessages(entity.proposed.txs, meta.id);
      return [{
        ...entity,
        height: entity.height + 1,
        state: nextState,
        mempool: [],
        proposed: undefined,
        status: 'Idle' as const
      }, transferMessages];

    default:
      return [entity, []];
  }
};

// --- Server Processing ---
export const processServerTx = (
  server: ServerState,
  tx:     ServerTx
): [ServerState, OutboxMsg[]] => {
  if (!isSignerAuthorized(server.registry, tx.entityId, tx.signer)) return [server, []];
  const signerMap = server.signers.get(tx.signer);
  const meta      = server.registry.get(tx.entityId);
  if (!signerMap || !meta) return [server, []];

  const entity = signerMap.get(tx.entityId);
  if (!entity) return [server, []];
  
  // Remove the problematic replay check - it prevented multiple txs per entity per block
  const [newEntity, msgs] = processEntityInput(entity, tx.input, tx.signer, meta);
  
  const newSignerMap = new Map(signerMap);
  newSignerMap.set(tx.entityId, newEntity);
  
  return [{ ...server, signers: new Map(server.signers).set(tx.signer, newSignerMap) }, msgs];
};

export const processMempool = async (
  server: ServerState,
  storage?: Storage,
  targetHeight?: number  // Pass the target height for WAL logging
): Promise<[ServerState, OutboxMsg[]]> => {
  const walHeight = targetHeight || server.height + 1;
  
  if (storage && server.mempool.length > 0) {
    const batch = storage.wal.batch();
    server.mempool.forEach(tx => {
      batch.put(keys.wal(walHeight, tx.signer, tx.entityId), JSON.stringify(tx));
    });
    await batch.write();
  }
  let cur = server; const all: OutboxMsg[] = [];
  for (const tx of server.mempool) {
    const [next, msgs] = processServerTx(cur, tx);
    cur = next; all.push(...msgs);
  }
  return [{ ...cur, mempool: [] }, all];
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
  signerIdx: number;
  entityId: string;
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
  height: number;
  timestamp: number;
  stateRoot: string;
  parentHash?: string;  // Previous archive hash
  signers: Record<number, Record<string, any>>;
  registry: [string, EntityMeta][];
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
    parentHash,
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
    const signers = new Map<number, Map<string, EntityState>>();
    for (const [signerIdx, entities] of Object.entries(entry.signers)) {
      const entityMap = new Map<string, EntityState>();
      for (const [entityId, entityData] of Object.entries(entities)) {
        // entityData is already deserialized from JSON, just need to convert BigInt
        const entity = {
          ...entityData,
          state: { ...entityData.state, balance: BigInt(entityData.state.balance) },
          proposed: entityData.proposed ? {
            ...entityData.proposed,
            approves: new Set(entityData.proposed.approves)
          } : undefined,
          lastProcessedHeight: entityData.lastProcessedHeight
        } as EntityState;
        entityMap.set(entityId, entity);
      }
      signers.set(Number(signerIdx), entityMap);
    }
    
    return {
      height: entry.height,
      registry: new Map(entry.registry),
      signers,
      mempool: []
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
  const targetHeight = server.height + 1;
  const blockTxs = server.mempool;
  
  // Track which entities were touched in this block
  const touchedEntities = new Set<string>();
  blockTxs.forEach(tx => touchedEntities.add(`${tx.signer}:${tx.entityId}`));
  
  // Process mempool with target height for WAL
  const [afterApply, msgs] = await processMempool(server, storage, targetHeight);
  
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
    }
    
    // Create immutable archive at intervals
    if (targetHeight % archiveInterval === 0) {
      const parentHash = await storage.refs.get('HEAD').catch(() => undefined);
      await archiveSnapshot(
        { ...afterUpdate, height: targetHeight }, 
        storage, 
        parentHash as string
      );
    }
  }
  
  const routed = routeMessages({ ...afterUpdate, mempool: [] }, msgs);
  const withAutoPropose = autoProposeSingleSigners(routed);
  
  return { ...withAutoPropose, height: targetHeight };
};

// Helper function to trigger proposals for multi-signer entities
export const proposeBlock = (server: ServerState, signer: number, entityId: string): ServerState => {
  const entity = server.signers.get(signer)?.get(entityId);
  if (!entity || entity.status !== 'Idle' || entity.mempool.length === 0) {
    return server;
  }
  
  const txs = entity.mempool;
  const blockHash = hash([entity.height + 1, txs]);
  
  const proposeTx: ServerTx = {
    signer,
    entityId,
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
  const targetHeight = server.height + 1;
  
  // 1) Log to WAL as system transaction with type marker
  const entry = JSON.stringify({ 
    type: 'registry_update',
    id, 
    quorum, 
    proposer, 
    height: targetHeight 
  });
  await storage.wal.put(
    keys.walRegistry(targetHeight, id),
    entry
  );

  // 2) Update registry in memory
  const newReg = new Map(server.registry);
  newReg.set(id, { id, quorum, proposer });
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
    const height = parseInt(await storage.state.get(keys.meta()) as string);
    
    // Load registry from snapshot
    let registry: Registry;
    try {
      const registryData = await storage.state.get(keys.registry()) as string;
      registry = new Map(JSON.parse(registryData));
    } catch {
      registry = createRegistry();  // Fallback for old snapshots
    }
    
    const signers = new Map<number, Map<string, EntityState>>();
    
    for await (const [key, value] of storage.state.iterator()) {
      if (key === keys.meta() || key === keys.registry()) continue;
      
      // Only parse keys that match the pattern: <number>:<entityId>
      const keyStr = key as string;
      if (!/^\d+:/.test(keyStr)) continue;
      
      const parts = keyStr.split(':');
      if (parts.length !== 2) continue;
      
      const signerIdx = parseInt(parts[0]);
      const entityId = parts[1];
      
      // Validate signerIdx is a valid number
      if (isNaN(signerIdx)) continue;
      
      if (!signers.has(signerIdx)) {
        signers.set(signerIdx, new Map());
      }
      
      const entity = deserializeEntity(value as string);
      signers.get(signerIdx)!.set(entityId, entity);
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
  
  return {
    height: 0,
    registry,
    mempool: [],
    signers: new Map([
      [0, new Map([
        ['alice', createEntity([0])],           
        ['dao', createEntity([0, 1, 2])]         
      ])],
      [1, new Map([
        ['bob', createEntity([1])],               
        ['hub', createEntity([1])],               
        ['dao', createEntity([0, 1, 2])]         
      ])],
      [2, new Map([
        ['carol', createEntity([2])],           
        ['dao', createEntity([0, 1, 2])]         
      ])]
    ])
  };
};

export const recoverServer = async (storage: Storage): Promise<ServerState> => {
  // Load snapshot (or initialize)
  let server = await loadSnapshot(storage) || initializeServer();
  
  // First replay registry updates from dedicated prefix (only those AFTER snapshot height)
  for await (const [key, value] of storage.wal.iterator({
    gte: `wal:reg:${pad(server.height + 1)}:`,
    lt: 'wal:reg:\xff'
  })) {
    try {
      const data = JSON.parse(value as string);
      if (data.type === 'registry_update' && data.height > server.height) {
        server.registry = registerEntity(server.registry, data.id, data.quorum, data.proposer);
      }
    } catch (err) {
      console.debug(`Failed to parse registry WAL entry ${key}:`, err);
    }
  }
  
  // Then replay regular WAL entries (only those AFTER snapshot height)
  const walEntries: Array<{height: number, tx: ServerTx}> = [];
  
  for await (const [key, value] of storage.wal.iterator({
    gte: keys.wal(server.height + 1, 0, '')
  })) {
    try {
      // Extract height from WAL key
      const keyParts = (key as string).split(':');
      if (keyParts.length >= 4) {
        const walHeight = parseInt(keyParts[1]);
        if (!isNaN(walHeight) && walHeight > server.height) {
          const tx = JSON.parse(value as string) as ServerTx;
          
          // Check if this entity has already processed this height
          const entity = server.signers.get(tx.signer)?.get(tx.entityId);
          if (!entity || !entity.lastProcessedHeight || walHeight > entity.lastProcessedHeight) {
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
      const blockData = await storage.blocks.get(keys.block(h)) as string;
      const decoded = RLP.decode(Buffer.from(blockData, 'hex')) as any;
      
      // Validate block format
      if (!Array.isArray(decoded) || decoded.length < 4) {
        console.warn(`Invalid block format at height ${h}`);
        break;
      }
      
      const blockTxs = decoded[3].map((txData: any) => ({
        signer: txData[0],
        entityId: txData[1],
        input: txData[2]
      }));
      
      // Apply block transactions
      for (const tx of blockTxs) {
        current.mempool.push(tx);
      }
      const [processed] = await processMempool(current, undefined, h);
      current = { ...processed, height: h, mempool: [] };
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