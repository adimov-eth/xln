import { createHash } from 'crypto';
import { Level } from 'level';
import RLP from 'rlp';

export type EntityMeta = {
  id: string;
  quorum: number[];  // Signer indices that participate
};

export type Registry = Map<string, EntityMeta>;  // entityId → metadata

export const createRegistry = (): Registry => new Map();

export const registerEntity = (
  registry: Registry, 
  id: string, 
  quorum: number[]
): Registry => {
  const newRegistry = new Map(registry);
  newRegistry.set(id, { id, quorum });
  return newRegistry;
};

export const isSignerAuthorized = (
  registry: Registry,
  entityId: string,
  signer: number
): boolean => {
  const meta = registry.get(entityId);
  return meta ? meta.quorum.includes(signer) : false;
};

export type EntityTx = {
  op: string;    
  data: any;
};

export type EntityInput = 
  | { type: 'add_tx'; tx: EntityTx }
  | { type: 'propose'; txs: EntityTx[]; hash: string }
  | { type: 'approve'; hash: string };

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
  registry: Registry;                               // NEW: Fast lookup index
  signers: Map<number, Map<string, EntityState>>;  // UNCHANGED: Keep signer views
  mempool: ServerTx[];
};

const keys = {
  state: (signer: number, entityId: string) => `${signer}:${entityId}`,
  registry: () => 'registry',  // NEW
  wal: (height: number, signer: number, entityId: string) => `${height}:${signer}:${entityId}`,
  block: (height: number) => `block:${height}`,
  meta: () => 'meta:height'
};

const toRlpData = (obj: any): any => {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string' || typeof obj === 'number') return obj;
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
        toSigner: 0, // Will be routed properly by server
        input: { 
          type: 'add_tx', 
          tx: { op: 'mint', data: { amount: tx.data.amount } } 
        }
      });
    }
  });
  
  return messages;
};

const processEntityInput = (entity: EntityState, input: EntityInput, signer: number, meta: EntityMeta): [EntityState, OutboxMsg[]] => {
  const outbox: OutboxMsg[] = [];

  switch (input.type) {
    case 'add_tx':
      if (entity.status === 'Idle') {
        return [{ ...entity, mempool: [...entity.mempool, input.tx] }, []];
      }
      return [entity, []];
    
    case 'propose':
      if (entity.status === 'Idle') {
        const newEntity = {
          ...entity,
          proposed: {
            txs: input.txs,
            hash: input.hash,
            approves: new Set([signer])
          },
          status: 'Proposed' as const
        };
        
        // For single-signer entities, immediately commit
        if (meta.quorum.length === 1) {
          const newState = input.txs.reduce(applyEntityTx, entity.state);
          
          return [{
            ...entity,
            height: entity.height + 1,
            state: newState,
            mempool: [],
            proposed: undefined,
            status: 'Idle'
          }, []];
        }
        
        // For multi-signer entities, broadcast approves
        for (const peer of meta.quorum) {
          if (peer !== signer) {
            outbox.push({
              from: meta.id,
              toEntity: meta.id,
              toSigner: peer,
              input: { type: 'approve', hash: input.hash }
            });
          }
        }
        
        return [newEntity, outbox];
      }
      return [entity, []];
    
    case 'approve':
      if (entity.status === 'Proposed' && 
          entity.proposed?.hash === input.hash && 
          meta.quorum.includes(signer)) {
        
        const newapproves = new Set(entity.proposed.approves);
        newapproves.add(signer);
        
        // Check if we have ≥ 2/3 of committee
        // TODO: consensus threshold might be configurable
        if (newapproves.size * 3 >= meta.quorum.length * 2) {
          // Commit the block
          const newState = entity.proposed.txs.reduce(applyEntityTx, entity.state);
          const transferMessages = generateTransferMessages(entity.proposed.txs, meta.id);
          
          return [{
            ...entity,
            height: entity.height + 1,
            state: newState,
            mempool: [],
            proposed: undefined,
            status: 'Idle'
          }, transferMessages];
        } else {
          // Just update approves
          return [{
            ...entity,
            proposed: {
              ...entity.proposed,
              approves: newapproves
            }
          }, []];
        }
      }
      return [entity, []];
    
    default:
      return [entity, []];
  }
};

const processServerTx = (server: ServerState, tx: ServerTx): [ServerState, OutboxMsg[]] => {
  // Use registry for fast authorization check
  if (!isSignerAuthorized(server.registry, tx.entityId, tx.signer)) {
    return [server, []];
  }
  
  const signerEntities = server.signers.get(tx.signer);
  if (!signerEntities) return [server, []];
  
  const entity = signerEntities.get(tx.entityId);
  if (!entity) return [server, []];
  
  const meta = server.registry.get(tx.entityId);
  if (!meta) return [server, []];
  
  const [newEntity, messages] = processEntityInput(entity, tx.input, tx.signer, meta);
  
  return [{
    ...server,
    signers: new Map(server.signers).set(
      tx.signer,
      new Map(signerEntities).set(tx.entityId, newEntity)
    )
  }, messages];
};

const processMempool = async (server: ServerState, storage?: Storage): Promise<[ServerState, OutboxMsg[]]> => {
  // Log transactions before processing if storage is provided
  if (storage && server.mempool.length > 0) {
    const walBatch = storage.wal.batch();
    server.mempool.forEach((tx) => {
      walBatch.put(keys.wal(server.height, tx.signer, tx.entityId), JSON.stringify(tx));
    });
    await walBatch.write();
  }

  let currentServer = server;
  const allMessages: OutboxMsg[] = [];
  
  for (const tx of server.mempool) {
    const [newServer, messages] = processServerTx(currentServer, tx);
    currentServer = newServer;
    allMessages.push(...messages);
  }
  
  return [{ ...currentServer, mempool: [] }, allMessages];
};

const routeMessages = (server: ServerState, messages: OutboxMsg[]): ServerState => {
  const newMempool: ServerTx[] = [];
  
  for (const msg of messages) {
    // Use registry for fast lookup
    const meta = server.registry.get(msg.toEntity);
    if (!meta) continue;
    
    const targetSigner = msg.toSigner && meta.quorum.includes(msg.toSigner) 
      ? msg.toSigner 
      : meta.quorum[0];
    
    newMempool.push({
      signer: targetSigner,
      entityId: msg.toEntity,
      input: msg.input
    });
  }
  
  return { ...server, mempool: [...server.mempool, ...newMempool] };
};

export const processBlock = async (server: ServerState, storage?: Storage): Promise<ServerState> => {
  // Process current mempool
  const [afterMempool, messages] = await processMempool(server, storage);
  
  // Route generated messages back to mempool
  const newServerState = routeMessages(afterMempool, messages);

  
  return { ...newServerState, height: server.height + 1 };
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
  
  // Save registry
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
    
    // Load registry
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
  
  // Register all entities
  registry = registerEntity(registry, 'alice', [0]);
  registry = registerEntity(registry, 'bob', [1]);
  registry = registerEntity(registry, 'carol', [2]);
  registry = registerEntity(registry, 'hub', [1]);
  registry = registerEntity(registry, 'dao', [0, 1, 2]);
  
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
  
  // Replay WAL entries after snapshot
  for await (const [, value] of storage.wal.iterator({
    gte: keys.wal(server.height, 0, '')
  })) {
    const tx = JSON.parse(value as string) as ServerTx;
    server = { ...server, mempool: [...server.mempool, tx] };
  }
  
  // Process any pending transactions
  if (server.mempool.length > 0) {
    server = await processBlock(server);
  }
  
  return server;
};