// server.ts
import { decode, encode, hash } from './encoding';
import { applyEntityInput, createEntity, getEntityStateRoot } from './entity';
import { Database } from './store';
import { type Hash, KEYS, type OutboxMessage, type ServerBlock, type ServerState, type ServerTx } from './types';

export class Server {
  private state: ServerState;
  private db: Database;
  private tickInterval: NodeJS.Timeout | null = null;

  constructor(db: Database) {
    this.db = db;
    this.state = {
      height: 0,
      signers: new Map(),
      mempool: []
    };
  }

  async initialize(): Promise<void> {
    // Load server root
    const rootData = await this.db.get(KEYS.serverRoot);
    if (rootData) {
      const root = decode(rootData) as { height: number };
      this.state.height = root.height;
      
      // Load entity states
      await this.loadEntityStates();
      
      // Replay blocks since last snapshot
      await this.replayBlocks(root.height);
    }
  }

  private async loadEntityStates(): Promise<void> {
    // In production, would scan all entity keys
    // For MVP, entities are created on-demand
  }

  private async replayBlocks(fromHeight: number): Promise<void> {
    let height = fromHeight;
    while (true) {
      const blockData = await this.db.get(KEYS.serverBlock(height + 1));
      if (!blockData) break;
      
      const block = decode(blockData) as ServerBlock;
      this.replayBlock(block);
      height++;
    }
  }

  private replayBlock(block: ServerBlock): void {
    const outbox: OutboxMessage[] = [];
    
    for (const tx of block.inputs) {
      this.applyServerTx(tx, outbox);
    }
    
    // Process outbox messages
    for (const msg of outbox) {
      this.state.mempool.push({
        signerIndex: msg.toSigner,
        entityId: msg.toEntity,
        input: msg.payload
      });
    }
    
    this.state.height = block.height;
  }

  start(): void {
    this.tickInterval = setInterval(() => {
      this.processTick();
    }, 100);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  async submitTx(tx: ServerTx): Promise<void> {
    this.state.mempool.push(tx);
  }

  private async processTick(): Promise<void> {
    if (this.state.mempool.length === 0) return;

    const outbox: OutboxMessage[] = [];
    const inputs = [...this.state.mempool];
    this.state.mempool = [];

    // Apply all inputs
    for (const tx of inputs) {
      this.applyServerTx(tx, outbox);
    }

    // Create server block
    const block: ServerBlock = {
      height: ++this.state.height,
      timestamp: Date.now(),
      inputs,
      stateRoot: this.computeStateRoot()
    };

    // Write block to WAL
    await this.db.put(KEYS.serverBlock(block.height), encode(block));

    // Write server root
    await this.db.put(KEYS.serverRoot, encode({
      height: this.state.height,
      stateRoot: block.stateRoot
    }));

    // Persist entity states
    await this.persistEntityStates();

    // Process outbox (simulated network delivery)
    for (const msg of outbox) {
      this.state.mempool.push({
        signerIndex: msg.toSigner,
        entityId: msg.toEntity,
        input: msg.payload
      });
    }
  }

  private applyServerTx(tx: ServerTx, outbox: OutboxMessage[]): void {
    // Get or create signer map
    let signerEntities = this.state.signers.get(tx.signerIndex);
    if (!signerEntities) {
      signerEntities = new Map();
      this.state.signers.set(tx.signerIndex, signerEntities);
    }

    // Get or create entity
    let entity = signerEntities.get(tx.entityId);
    if (!entity) {
      entity = createEntity(tx.entityId);
      signerEntities.set(tx.entityId, entity);
    }

    // Apply input
    const newEntity = applyEntityInput(entity, tx.input, outbox);
    signerEntities.set(tx.entityId, newEntity);
  }

  private computeStateRoot(): Hash {
    const signerHashes: Array<[number, Hash]> = [];
    
    for (const [signerIndex, entities] of this.state.signers) {
      const entityHashes: Array<[string, Hash]> = [];
      
      for (const [entityId, state] of entities) {
        entityHashes.push([entityId, getEntityStateRoot(state)]);
      }
      
      signerHashes.push([signerIndex, hash(encode(entityHashes))]);
    }
    
    return hash(encode({
      height: this.state.height,
      signers: signerHashes
    }));
  }

  private async persistEntityStates(): Promise<void> {
    const batch: Array<{ key: Buffer; value: Buffer }> = [];
    
    for (const [signerIndex, entities] of this.state.signers) {
      for (const [entityId, state] of entities) {
        batch.push({
          key: KEYS.entityState(signerIndex, entityId),
          value: encode(state)
        });
      }
    }
    
    await this.db.batch(batch);
  }

  // Debug helpers
  getState(): ServerState {
    return this.state;
  }

  printTree(): void {
    console.log(`Server (height: ${this.state.height})`);
    for (const [signerIndex, entities] of this.state.signers) {
      console.log(`  Signer[${signerIndex}]`);
      for (const [entityId, state] of entities) {
        console.log(`    Entity[${entityId}]: height=${state.height}, counter=${state.data.counter}`);
      }
    }
  }
}