import { encodeServerTx, hash, hashServerState } from './encoding';
import * as entity from './entity';
import * as t from './types';

const DEFAULT_CONFIG: t.ServerConfig = {
  tickInterval: 100,
  mempool: {
    maxAge: 3600000
  }
};

export function createServer(): t.ServerState {
  return {
    height: 0,
    mempool: new Map(),
    entities: new Map()
  };
}

export function receive(
  state: t.ServerState,
  tx: t.ServerTx
): t.Result<t.ServerState> {

  // TODO: Validate transaction

  // Add to mempool
  const txHash = hash(encodeServerTx(tx));
  const newMempool = new Map(state.mempool);
  newMempool.set(txHash, { tx, timestamp: Date.now() });
  
  return {
    ok: true,
    value: { ...state, mempool: newMempool }
  };
}

export function processMempool(
  state: t.ServerState
): t.Result<[t.ServerState, t.OutboxMessage[]]> {
  if (state.mempool.size === 0) {
    return { ok: true, value: [state, []] };
  }
  
  const outbox: t.OutboxMessage[] = [];
  const processedTxs: t.ServerTx[] = [];
  
  // Create mutable copy of entities map
  const newEntities = new Map<t.SignerId, Map<t.EntityId, t.EntityState>>();
  
  // Deep copy existing entities
  for (const [signerId, signerEntities] of state.entities) {
    const newSignerEntities = new Map<t.EntityId, t.EntityState>();
    for (const [entityId, entityState] of signerEntities) {
      newSignerEntities.set(entityId, entityState);
    }
    newEntities.set(signerId, newSignerEntities);
  }
  
  // Process each transaction
  for (const [txHash, entry] of state.mempool) {
    const { tx } = entry;
    
    // Get or create signer map
    let signerEntities = newEntities.get(tx.signerId);
    if (!signerEntities) {
      signerEntities = new Map<t.EntityId, t.EntityState>();
      newEntities.set(tx.signerId, signerEntities);
    }
    
    // Get or create entity
    let entityState = signerEntities.get(tx.entityId);
    if (!entityState) {
      entityState = entity.createEntity(tx.entityId);
    }
    
    // TODO: Validate and apply input

    const applyResult = entity.applyEntityInput(entityState, tx.input, outbox);
    if (applyResult.ok) {
      signerEntities.set(tx.entityId, applyResult.value);
      processedTxs.push(tx);
    }
  }
  
  const serverBlock: t.ServerBlock = {
    height: state.height + 1,
    timestamp: Date.now(),
    inputs: processedTxs,
    stateRoot: hashServerState({ ...state, entities: newEntities })
  };
  
  const newMempool = new Map(state.mempool);
  for (const tx of processedTxs) {
    const txHash = hash(encodeServerTx(tx));
    newMempool.delete(txHash);
  }
  
  return {
    ok: true,
    value: [
      {
        height: serverBlock.height,
        mempool: newMempool,
        entities: newEntities,
        lastBlock: serverBlock
      },
      outbox
    ]
  };
}

export function cleanupMempool(
  state: t.ServerState,
  maxAge: number = DEFAULT_CONFIG.mempool.maxAge
): t.ServerState {
  const now = Date.now();
  const newMempool = new Map<t.TxHash, t.MempoolEntry>();
  
  for (const [hash, entry] of state.mempool) {
    if (now - entry.timestamp < maxAge) {
      newMempool.set(hash, entry);
    }
  }
  
  return { ...state, mempool: newMempool };
}

export class DeterministicRandom {
  private seed: number;
  
  constructor(seed: number = 0) {
    this.seed = seed;
  }
  
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x80000000;
  }
  
  bytes(length: number): Buffer {
    const buf = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      buf[i] = Math.floor(this.next() * 256);
    }
    return buf;
  }
  
  hex(length: number): string {
    return this.bytes(length).toString('hex');
  }
}

export async function* serverLoop(
  initialState: t.ServerState,
  config: t.ServerConfig = DEFAULT_CONFIG
): AsyncGenerator<[t.ServerState, t.OutboxMessage[]], void, unknown> {
  let state = initialState;
  
  while (true) {
    state = cleanupMempool(state);

    const result = processMempool(state);
    if (!result.ok) {
      throw result.error;
    }
    
    const [newState, outbox] = result.value;
    state = newState;
    
    for (const msg of outbox) {
      const tx: t.ServerTx = {
        signerId: msg.signerId,
        entityId: msg.to,
        input: msg.payload,
        timestamp: Date.now()
      };
      
      const receiveResult = receive(state, tx);
      if (receiveResult.ok) {
        state = receiveResult.value;
      }
    }
    
    yield [state, outbox];
    
    // Wait for next tick
    await new Promise(resolve => setTimeout(resolve, config.tickInterval));
  }
}



