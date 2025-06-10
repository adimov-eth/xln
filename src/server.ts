import { encodeServerTx, hash, hashServerState } from './encoding';
import * as entity from './entity';
import { type StorageConfig, StorageManager } from './store';
import * as t from './types';

// ============================================================================
// Server Configuration
// ============================================================================

export interface ServerConfig extends t.ServerConfig {
  storage?: Partial<StorageConfig>;
}

const DEFAULT_CONFIG: ServerConfig = {
  tickInterval: 100,
  mempool: {
    maxAge: 3600000,
  },
  storage: {
    snapshotInterval: 100
  }
};

export class Server {
  private state: t.ServerState;
  private storage: StorageManager;
  private config: ServerConfig;
  private running: boolean = false;
  private processLoop?: Promise<void>;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = createServer();
    this.storage = new StorageManager(this.config.storage);
  }

  async initialize(): Promise<void> {
    await this.storage.open();
    
    // Load latest state
    const stateResult = await this.storage.loadServerState();
    if (stateResult.ok) {
      this.state = stateResult.value;
      console.log(`Loaded state at height ${this.state.height}`);
      
      // Replay blocks since last snapshot
      await this.replayBlocks();
    } else {
      console.log('Starting with fresh state');
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    
    this.running = true;
    this.processLoop = this.runProcessingLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.processLoop) {
      await this.processLoop;
    }
    await this.storage.saveServerState(this.state);
    await this.storage.close();
  }

  async receive(tx: t.ServerTx): Promise<t.Result<void>> {
    const result = receive(this.state, tx);
    if (result.ok) {
      this.state = result.value;
      return { ok: true, value: undefined };
    }
    return result;
  }

  getState(): Readonly<t.ServerState> {
    return this.state;
  }

  private async runProcessingLoop(): Promise<void> {
    while (this.running) {
      try {
        this.state = cleanupMempool(this.state);
        
        if (this.state.mempool.size > 0) {
          await this.processTick();
        }
        
        await new Promise(resolve => setTimeout(resolve, this.config.tickInterval));
      } catch (error) {
        console.error('Processing error:', error);
      }
    }
  }

  private async processTick(): Promise<void> {
    const result = processMempool(this.state);
    if (!result.ok) {
      throw result.error;
    }
    
    const [newState, outbox] = result.value;
    
    if (newState.lastBlock) {
      await this.storage.saveServerBlock(newState.lastBlock);
      
      await this.saveEntityBlocks(newState);
      
      if (newState.height % (this.config.storage?.snapshotInterval || 100) === 0) {
        await this.storage.saveServerState(newState);
        console.log(`Saved snapshot at height ${newState.height}`);
      }
    }
    
    this.state = newState;
    
    // Process outbox messages
    for (const msg of outbox) {
      const tx: t.ServerTx = {
        signerId: msg.signerId,
        entityId: msg.to,
        input: msg.payload,
        timestamp: Date.now()
      };
      
      const receiveResult = receive(this.state, tx);
      if (receiveResult.ok) {
        this.state = receiveResult.value;
      }
    }
  }

  private async saveEntityBlocks(state: t.ServerState): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [signerId, entities] of state.entities) {
      for (const [entityId, entityState] of entities) {
        if (entityState.lastBlock) {
          promises.push(
            this.storage.saveEntityBlock(signerId, entityId, entityState.lastBlock)
          );
        }
      }
    }
    
    await Promise.all(promises);
  }

  private async replayBlocks(): Promise<void> {
    const fromHeight = this.state.height + 1;
    console.log(`Replaying blocks from height ${fromHeight}`);
    
    let count = 0;
    for await (const block of this.storage.iterateServerBlocks(fromHeight)) {
      for (const input of block.inputs) {
        const entityResult = this.applyServerTx(input);
        if (!entityResult.ok) {
          console.error(`Failed to replay tx: ${entityResult.error}`);
        }
      }
      
      this.state = { ...this.state, height: block.height };
      count++;
    }
    
    console.log(`Replayed ${count} blocks`);
  }

  private applyServerTx(tx: t.ServerTx): t.Result<void> {
    const entities = new Map(this.state.entities);
    const signerEntities = new Map(entities.get(tx.signerId));
    entities.set(tx.signerId, signerEntities);
    
    let entityState = signerEntities.get(tx.entityId);
    if (!entityState) {
      entityState = entity.createEntity(tx.entityId);
    }
    
    // Apply input
    const result = entity.applyEntityInput(entityState, tx.input);
    if (!result.ok) {
      return result;
    }
    
    signerEntities.set(tx.entityId, result.value);
    this.state = { ...this.state, entities };
    
    return { ok: true, value: undefined };
  }


  async exportEntityBlocks( 
    signerId: t.SignerId,
    entityId: t.EntityId,
    fromHeight: number = 0
  ): Promise<t.EntityBlock[]> {
    const blocks: t.EntityBlock[] = [];
    
    for await (const block of this.storage.iterateEntityBlocks(signerId, entityId, fromHeight)) {
      blocks.push(block);
    }
    
    return blocks;
  }

  async clearStorage(): Promise<void> {
    await this.storage.clearAll();
    this.state = createServer();
    console.log('Cleared all storage');
  }
}

function createServer(): t.ServerState {
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

