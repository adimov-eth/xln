import { createHash } from 'crypto';
import { Level } from 'level';
import RLP from 'rlp';


export type EntityTx = {
  op: string;    
  data: any;
};

export type EntityInput = 
  | { type: 'add_tx'; tx: EntityTx }
  | { type: 'propose_block' }
  | { type: 'commit_block'; blockHash: string };

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

export type ProposedBlock = {
  txs: EntityTx[];
  hash: string;
  status: 'pending' | 'committed';
  votes?: number[]; 
};

export type EntityState = {
  height: number;
  state: any;                    
  mempool: EntityTx[];
  proposed?: ProposedBlock;
  quorum: number[];              
  status: 'idle' | 'proposed';
};

export type ServerState = {
  height: number;
  signers: Map<number, Map<string, EntityState>>;
  mempool: ServerTx[];
};


const keys = {
  state: (signer: number, entityId: string) => `${signer}:${entityId}`,
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

const createEntity = (id: string, quorum: number[]): EntityState => ({
  height: 0,
  state: { balance: 0n },
  mempool: [],
  quorum,
  status: 'idle'
});

const applyEntityTx = (state: any, tx: EntityTx): any => {
  switch (tx.op) {
    case 'mint': return { ...state, balance: state.balance + BigInt(tx.data.amount) };
    case 'burn': return { ...state, balance: state.balance - BigInt(tx.data.amount) };
    default: return state;
  }
};

const proposeBlock = (entity: EntityState): EntityState => {
  if (entity.status !== 'idle' || entity.mempool.length === 0) return entity;
  
  return {
    ...entity,
    status: 'proposed',
    proposed: {
      txs: entity.mempool,
      hash: hash([entity.height + 1, entity.mempool]),
      status: 'pending',
      votes: []
    }
  };
};

const commitBlock = (entity: EntityState, blockHash: string, signerIdx: number): [EntityState, OutboxMsg[]] => {
  if (entity.status !== 'proposed' || entity.proposed?.hash !== blockHash) {
    return [entity, []];
  }
  

  if (entity.quorum.length === 1) {
    const newState = entity.proposed.txs.reduce(
      (state, tx) => applyEntityTx(state, tx),
      entity.state
    );
    
    const messages: OutboxMsg[] = [];
    
    entity.proposed.txs.forEach(tx => {
      if (tx.op === 'transfer') {
        messages.push({
          from: entity.quorum[0] + ':' + blockHash.slice(0, 8), 
          toEntity: tx.data.to,
          toSigner: 0, 
          input: { type: 'add_tx', tx: { op: 'mint', data: { amount: tx.data.amount } } }
        });
      }
    });
    
    return [{
      ...entity,
      height: entity.height + 1,
      state: newState,
      mempool: [],
      proposed: undefined,
      status: 'idle'
    }, messages];
  }
  

  const currentVotes = entity.proposed.votes || [];
  

  if (!currentVotes.includes(signerIdx)) {
    const newVotes = [...currentVotes, signerIdx];
    
  
    const requiredVotes = Math.ceil(entity.quorum.length * 2 / 3);
    
    if (newVotes.length >= requiredVotes) {
    
      const newState = entity.proposed.txs.reduce(
        (state, tx) => applyEntityTx(state, tx),
        entity.state
      );
      
      const messages: OutboxMsg[] = [];
      
      entity.proposed.txs.forEach(tx => {
        if (tx.op === 'transfer') {
          messages.push({
            from: entity.quorum[0] + ':' + blockHash.slice(0, 8), 
            toEntity: tx.data.to,
            toSigner: 0, 
            input: { type: 'add_tx', tx: { op: 'mint', data: { amount: tx.data.amount } } }
          });
        }
      });
      
      return [{
        ...entity,
        height: entity.height + 1,
        state: newState,
        mempool: [],
        proposed: undefined,
        status: 'idle'
      }, messages];
    } else {
    
      return [{
        ...entity,
        proposed: {
          ...entity.proposed,
          votes: newVotes
        }
      }, []];
    }
  }
  

  return [entity, []];
};

const processEntityInput = (entity: EntityState, input: EntityInput, signerIdx: number): [EntityState, OutboxMsg[]] => {
  switch (input.type) {
    case 'add_tx':
      return [{ ...entity, mempool: [...entity.mempool, input.tx] }, []];
    
    case 'propose_block':
      return [proposeBlock(entity), []];
    
    case 'commit_block':
      return commitBlock(entity, input.blockHash, signerIdx);
    
    default:
      return [entity, []];
  }
};

const processServerTx = (server: ServerState, tx: ServerTx): [ServerState, OutboxMsg[]] => {
  const signerEntities = server.signers.get(tx.signer);
  if (!signerEntities) return [server, []];
  
  const entity = signerEntities.get(tx.entityId);
  if (!entity || !entity.quorum.includes(tx.signer)) return [server, []];
  
  const [newEntity, messages] = processEntityInput(entity, tx.input, tx.signer);
  
  return [{
    ...server,
    signers: new Map(server.signers).set(
      tx.signer,
      new Map(signerEntities).set(tx.entityId, newEntity)
    )
  }, messages];
};

const processMempool = (server: ServerState): [ServerState, OutboxMsg[]] => {
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
    newMempool.push({
      signer: msg.toSigner,
      entityId: msg.toEntity,
      input: msg.input
    });
  }
  
  return { ...server, mempool: [...server.mempool, ...newMempool] };
};

export const processBlock = (server: ServerState): ServerState => {
  
  const [afterMempool, messages] = processMempool(server);
  
  const afterRouting = routeMessages(afterMempool, messages);
  
  let finalServer = afterRouting;
  for (const [signerIdx, entities] of finalServer.signers) {
    for (const [entityId, entity] of entities) {
      if (entity.quorum.length === 1 && entity.mempool.length > 0) {
        const [proposed] = processEntityInput(entity, { type: 'propose_block' }, signerIdx);
        if (proposed.proposed) {
          const [committed] = processEntityInput(proposed, { 
            type: 'commit_block', 
            blockHash: proposed.proposed.hash 
          }, signerIdx);
          
          finalServer = {
            ...finalServer,
            signers: new Map(finalServer.signers).set(
              signerIdx,
              new Map(entities).set(entityId, committed)
            )
          };
        }
      }
    }
  }
  
  return { ...finalServer, height: server.height + 1 };
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
  state: { ...entity.state, balance: entity.state.balance.toString() }
});

const deserializeEntity = (data: string): EntityState => {
  const parsed = JSON.parse(data);
  return {
    ...parsed,
    state: { ...parsed.state, balance: BigInt(parsed.state.balance) }
  };
};

export const saveSnapshot = async (server: ServerState, storage: Storage) => {
  const batch = storage.state.batch();
  
  for (const [signerIdx, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      batch.put(keys.state(signerIdx, entityId), serializeEntity(entity));
    }
  }
  
  batch.put(keys.meta(), server.height.toString());
  await batch.write();
};

export const loadSnapshot = async (storage: Storage): Promise<ServerState | null> => {
  try {
    const height = parseInt(await storage.state.get(keys.meta()) as string);
    const signers = new Map<number, Map<string, EntityState>>();
    
    
    for await (const [key, value] of storage.state.iterator()) {
      if (key === keys.meta()) continue;
      
      
      const parts = (key as string).split(':');
      if (parts.length !== 2) continue;
      
      const signerIdx = parseInt(parts[0]);
      const entityId = parts[1];
      
      if (!signers.has(signerIdx)) {
        signers.set(signerIdx, new Map());
      }
      
      const entity = deserializeEntity(value as string);
      signers.get(signerIdx)!.set(entityId, entity);
    }
    
    console.log(`Recovered state at height ${height} with ${signers.size} signers`);
    return { height, signers, mempool: [] };
  } catch (err) {
    
    return null;
  }
};



export const initializeServer = (): ServerState => ({
  height: 0,
  mempool: [],
  signers: new Map([
    [0, new Map([
      ['alice', createEntity('alice', [0])],           
      ['dao', createEntity('dao', [0, 1, 2])]         
    ])],
    [1, new Map([
      ['bob', createEntity('bob', [1])],               
      ['hub', createEntity('hub', [1])],               
      ['dao', createEntity('dao', [0, 1, 2])]         
    ])],
    [2, new Map([
      ['carol', createEntity('carol', [2])],           
      ['dao', createEntity('dao', [0, 1, 2])]         
    ])]
  ])
});

