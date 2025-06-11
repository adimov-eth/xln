import { encode, hash } from './encoding';
import { applyEntityInput, createEntity, getEntityStateRoot } from './entity';
import { EntityDirectory } from './entityRegestry';
import { MessageRouter } from './routing';
import { Database } from './store';
import { KEYS, type OutboxMessage, type ServerBlock, type ServerState, type ServerTx } from './types';

export class Server {
  private db: Database;
  private entityDirectory: EntityDirectory;
  private router: MessageRouter;
  private state: ServerState;
  private running = false;
  private tickInterval?: NodeJS.Timeout;

  constructor(db: Database, signerIndices: number[] = [0]) {
    this.db = db;
    this.entityDirectory = new EntityDirectory();
    
    // Configure router for local signers
    this.router = new MessageRouter(
      {
        localSigners: new Set(signerIndices),
        remoteEndpoints: new Map() // Would be configured for real network
      },
      (tx) => this.state.mempool.push(tx)
    );
    
    this.state = {
      height: 0,
      signers: new Map(),
      mempool: []
    };
  }

  async initialize(): Promise<void> {
    // Load last server state from database
    try {
      const rootData = await this.db.get(KEYS.serverRoot);
      if (rootData) {
        const { height } = JSON.parse(rootData.toString());
        this.state.height = height;
      }
    } catch (error) {
      // Fresh start
      this.state.height = 0;
    }
  }

  async submitTx(tx: ServerTx): Promise<void> {
    this.state.mempool.push(tx);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickInterval = setInterval(() => {
      this.processTick().catch(console.error);
    }, 1000);
  }

  stop(): void {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
  }

  printTree(): void {
    console.log('=== Server State ===');
    console.log('Height:', this.state.height);
    console.log('Mempool size:', this.state.mempool.length);
    console.log('Signers:', this.state.signers.size);
    
    for (const [signerIndex, entities] of this.state.signers) {
      console.log(`\nSigner ${signerIndex}:`);
      for (const [entityId, entityState] of entities) {
        console.log(`  Entity ${entityId}:`, {
          height: entityState.height,
          nonce: entityState.nonce,
          data: entityState.data,
          mempoolSize: entityState.mempool.length,
          status: entityState.status
        });
      }
    }
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

    // Persist states and blocks
    await this.persistEntityStates();
    await this.persistEntityBlocks(outbox);

    // Route outbox messages properly
    await this.router.route(outbox);
  }

  private applyServerTx(tx: ServerTx, outbox: OutboxMessage[]): void {
    // Get or create signer map
    let signerEntities = this.state.signers.get(tx.signerIndex);
    if (!signerEntities) {
      signerEntities = new Map();
      this.state.signers.set(tx.signerIndex, signerEntities);
    }

    // Get or create entity
    let entityState = signerEntities.get(tx.entityId);
    if (!entityState && tx.input.type === 'import') {
      entityState = tx.input.state;
    } else if (!entityState) {
      entityState = createEntity(tx.entityId);
    }

    // Apply entity input
    const newState = applyEntityInput(
      entityState,
      tx.input,
      outbox,
      tx.signerIndex,
      tx.entityId
    );

    signerEntities.set(tx.entityId, newState);
  }

  private computeStateRoot(): Buffer {
    const stateData = {
      height: this.state.height,
      signers: Array.from(this.state.signers.entries()).map(([signerIndex, entities]) => [
        signerIndex,
        Array.from(entities.entries()).map(([entityId, state]) => [
          entityId,
          getEntityStateRoot(state)
        ])
      ])
    };
    return hash(encode(stateData));
  }

  private async persistEntityStates(): Promise<void> {
    const batch: Array<{ key: Buffer; value: Buffer }> = [];
    
    for (const [signerIndex, entities] of this.state.signers) {
      for (const [entityId, state] of entities) {
        const key = KEYS.entityState(signerIndex, entityId);
        const value = encode(state);
        batch.push({ key, value });
      }
    }
    
    if (batch.length > 0) {
      await this.db.batch(batch);
    }
  }

  private async persistEntityBlocks(outbox: OutboxMessage[]): Promise<void> {
    // For now, just log the outbox messages
    if (outbox.length > 0) {
      console.log(`Generated ${outbox.length} outbox messages`);
    }
  }
}