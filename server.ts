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
  | { type: 'propose'; txs: EntityTx[]; hash: string }
  | { type: 'approve'; hash: string }
  | { type: 'commit'; hash: string };

export type ServerTx = {
  signer: number;
  entityId: string;
  input: EntityInput;
};

export type OutboxMsg = {
  from: string;
  toEntity: string;
  toSigner: number;
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

const generateTransferMessages = (txs: EntityTx[], fromEntityId: string, registry: Registry): OutboxMsg[] => {
  const messages: OutboxMsg[] = [];
  
  txs.forEach(tx => {
    if (tx.op === 'transfer') {
      const targetMeta = registry.get(tx.data.to);
      if (!targetMeta) return; // Skip if target entity doesn't exist
      
      messages.push({
        from: fromEntityId,
        toEntity: tx.data.to,
        toSigner: targetMeta.proposer, // Use the target's proposer
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

    case 'propose':
      if (entity.status !== 'Idle') return [entity, []];
      const block = { txs: input.txs, hash: input.hash };
      const proposed = { ...block, approves: new Set([signer]) };
      
      // Single-signer entity: immediate commit
      if (meta.quorum.length === 1) {
        outbox.push({
          from: meta.id,
          toEntity: meta.id,
          toSigner: meta.proposer,
          input: { type: 'commit' as const, hash: input.hash }
        });
        return [{ ...entity, proposed, status: 'Proposed' as const }, outbox];
      }
      
      // Multi-signer entity: broadcast approve to committee
      return [{ ...entity, proposed, status: 'Proposed' as const },
        meta.quorum.filter(p => p !== signer).map(p => ({
          from: meta.id,
          toEntity: meta.id,
          toSigner: p,
          input: { type: 'approve' as const, hash: input.hash }
        }))
      ];

    case 'approve':
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
          input: { type: 'commit' as const, hash: input.hash }
        });
        return [{ ...entity, proposed: { ...entity.proposed, approves } }, outbox];
      }
      return [{ ...entity, proposed: { ...entity.proposed, approves } }, []];

    case 'commit':
      if (entity.status !== 'Proposed' || entity.proposed?.hash !== input.hash || signer !== meta.proposer) {
        return [entity, []];
      }
      // final apply
      const nextState = entity.proposed.txs.reduce(applyEntityTx, entity.state);
      // Transfer messages are now handled in processServerTx
      return [{
        ...entity,
        height: entity.height + 1,
        state: nextState,
        mempool: [],
        proposed: undefined,
        status: 'Idle' as const
      }, []];

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
  
  const [newEntity, msgs] = processEntityInput(entity, tx.input, tx.signer, meta);
  
  // Handle transfer messages for commit
  let allMsgs = msgs;
  if (tx.input.type === 'commit' && entity.status === 'Proposed' && entity.proposed?.hash === tx.input.hash && tx.signer === meta.proposer) {
    const transferMessages = generateTransferMessages(entity.proposed.txs, meta.id, server.registry);
    allMsgs = [...msgs, ...transferMessages];
  }
  
  const newSignerMap = new Map(signerMap);
  newSignerMap.set(tx.entityId, newEntity);
  
  return [{ ...server, signers: new Map(server.signers).set(tx.signer, newSignerMap) }, allMsgs];
};

export const processMempool = async (
  server: ServerState,
  storage?: Storage
): Promise<[ServerState, OutboxMsg[]]> => {
  if (storage && server.mempool.length > 0) {
    const batch = storage.wal.batch();
    server.mempool.forEach(tx => {
      batch.put(keys.wal(server.height, tx.signer, tx.entityId), JSON.stringify(tx));
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
  const next = msgs.map(m => ({ signer: m.toSigner, entityId: m.toEntity, input: m.input }));
  return { ...server, mempool: [...server.mempool, ...next] };
};

export const processBlock = async (
  server: ServerState,
  storage?: Storage
): Promise<ServerState> => {
  // 1) Save original mempool for block serialization
  const blockTxs = server.mempool;
  
  // 2) Process mempool and get outbox messages
  const [afterApply, msgs] = await processMempool(server, storage);
  
  // 3) Serialize and save the original block with metadata
  if (storage && blockTxs.length > 0) {
    // Compute integrity hash of the entire state tree
    const stateHash = computeStateHash(afterApply.signers);
    
    const blockPayload = [
      server.height,
      Date.now(),
      stateHash,
      blockTxs.map(tx => [tx.signer, tx.entityId, toRlpData(tx.input)])
    ];
    
    const blockData = Buffer.from(RLP.encode(blockPayload));
    await storage.blocks.put(keys.block(server.height), blockData.toString('hex'));
  }
  
  // 4) Clear mempool (it was already processed)
  afterApply.mempool = [];
  
  // 5) Route outbox messages to create new mempool
  const routed = routeMessages(afterApply, msgs);
  
  // 6) Auto-propose for single-signer entities with pending transactions
  let s = routed;
  for (const [signerIdx, entities] of s.signers) {
    for (const [entityId, entity] of entities) {
      if (entity.mempool.length > 0 && entity.status === 'Idle') {
        const meta = s.registry.get(entityId);
        if (meta && meta.quorum.length === 1) {
          const txs = entity.mempool;
          const blockHash = hash([entity.height + 1, txs]);
          
          const [updatedServer] = processServerTx(s, {
            signer: signerIdx,
            entityId,
            input: { type: 'propose', txs, hash: blockHash }
          });
          
          s = updatedServer;
        }
      }
    }
  }
  
  return { ...s, height: server.height + 1 };
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
    input: { type: 'propose', txs, hash: blockHash }
  };
  
  return { ...server, mempool: [...server.mempool, proposeTx] };
};

type Storage = {
  state: Level;
  wal: Level;
  blocks: Level;
};

export const createStorage = (path = './data'): Storage => ({
  state: new Level(`${path}/state`),
  wal: new Level(`${path}/wal`),
  blocks: new Level(`${path}/blocks`)
});

// Register entity with WAL logging
export const registerEntityWithLog = async (
  server: ServerState,
  storage: Storage,
  id: string,
  quorum: number[],
  proposer = 0
): Promise<ServerState> => {
  const newRegistry = registerEntity(server.registry, id, quorum, proposer);
  
  // Log registry mutation to WAL
  const registryTx = {
    type: 'registry_update',
    id,
    quorum,
    proposer,
    height: server.height
  };
  
  await storage.wal.put(
    keys.wal(server.height, -1, `registry_${id}`), // -1 for system transactions
    JSON.stringify(registryTx)
  );
  
  return { ...server, registry: newRegistry };
};

const serializeEntity = (entity: EntityState) => JSON.stringify({
  ...entity,
  state: { ...entity.state, balance: entity.state.balance.toString() },
  proposed: entity.proposed ? {
    ...entity.proposed,
    approves: Array.from(entity.proposed.approves)
  } : undefined
});

const deserializeEntity = (data: string): EntityState => {
  const parsed = JSON.parse(data);
  return {
    ...parsed,
    state: { ...parsed.state, balance: BigInt(parsed.state.balance) },
    proposed: parsed.proposed ? {
      ...parsed.proposed,
      approves: new Set(parsed.proposed.approves)
    } : undefined
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
  
  // Clean up old WAL after snapshot
  const walBatch = storage.wal.batch();
  for await (const [key] of storage.wal.iterator({
    lt: keys.wal(server.height, 0, '')
  })) {
    walBatch.del(key);
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
      if (key === keys.meta()) continue;
      
      const parts = (key as string).split(':');
      if (parts.length !== 2 || key === keys.registry()) continue;
      
      const signerIdx = parseInt(parts[0]);
      const entityId = parts[1];
      
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
  
  // First replay registry updates (using a broader range to catch -1 signer)
  for await (const [key, value] of storage.wal.iterator({
    gte: `wal:${pad(server.height)}:`
  })) {
    try {
      const data = JSON.parse(value as string);
      if (data.type === 'registry_update') {
        server.registry = registerEntity(server.registry, data.id, data.quorum, data.proposer);
      }
    } catch {
      // Not a registry update, skip
    }
  }
  
  // Then replay regular WAL entries
  for await (const [, value] of storage.wal.iterator({
    gte: keys.wal(server.height, 0, '')
  })) {
    try {
      const tx = JSON.parse(value as string) as ServerTx;
      server = { ...server, mempool: [...server.mempool, tx] };
    } catch {
      // Not a ServerTx, skip
    }
  }
  
  // Process any pending transactions
  if (server.mempool.length > 0) {
    server = await processBlock(server);
  }
  
  return server;
};