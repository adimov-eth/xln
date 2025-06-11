import { decode, encode, hash } from './encoding';
import { applyEntityInput, createEntity, getEntityStateRoot } from './entity';
import { EntityDirectory } from './entityRegestry';
import { MessageRouter } from './routing';
import { Database } from './store';
import {
  Err,
  KEYS,
  Ok,
  type EntityState,
  type Hash,
  type MempoolConfig,
  type MempoolEntry,
  type OutboxMessage,
  type Result,
  type ServerBlock,
  type ServerState,
  type ServerTx
} from './types';

export class Server {
  private db: Database;
  private entityDirectory: EntityDirectory;
  private router: MessageRouter;
  private state: ServerState;
  private running = false;
  private tickInterval?: NodeJS.Timeout;

  constructor(db: Database, signerIndices: number[] = [0], config?: Partial<MempoolConfig>) {
    this.db = db;
    this.entityDirectory = new EntityDirectory();
    
    const defaultConfig: MempoolConfig = {
      maxSize: 10000,
      maxAge: 300000, // 5 minutes
      maxTxsPerEntity: 100,
      evictionBatchSize: 100
    };
    
    // Configure router for local signers
    this.router = new MessageRouter(
      {
        localSigners: new Set(signerIndices),
        remoteEndpoints: new Map() // Would be configured for real network
      },
      (tx) => {
        const result = this.addToMempool(tx);
        if (!result.ok) {
          console.error('Failed to add tx to mempool:', result.error);
        }
      }
    );
    
    this.state = {
      height: 0,
      signers: new Map(),
      mempool: new Map(),
      config: { ...defaultConfig, ...config }
    };
  }

  private addToMempool(tx: ServerTx): Result<void> {
    const txHash = hash(encode(tx));
    
    // Check if already exists
    if (this.state.mempool.has(txHash)) {
      return Err(new Error('Transaction already in mempool'));
    }
    
    // Check mempool size limit
    if (this.state.mempool.size >= this.state.config.maxSize) {
      this.evictOldTransactions();
      
      if (this.state.mempool.size >= this.state.config.maxSize) {
        return Err(new Error('Mempool is full'));
      }
    }
    
    // Check per-entity limit
    const entityTxCount = Array.from(this.state.mempool.values())
      .filter(entry => entry.entityId === tx.entityId && entry.signerIndex === tx.signerIndex)
      .length;
      
    if (entityTxCount >= this.state.config.maxTxsPerEntity) {
      return Err(new Error('Too many transactions for this entity'));
    }
    
    const entry: MempoolEntry = {
      tx,
      timestamp: Date.now(),
      entityId: tx.entityId,
      signerIndex: tx.signerIndex
    };
    
    this.state.mempool.set(txHash, entry);
    return Ok(undefined);
  }

  private evictOldTransactions(): void {
    const now = Date.now();
    const maxAge = this.state.config.maxAge;
    const toEvict: Hash[] = [];
    
    // First, evict expired transactions
    for (const [hash, entry] of this.state.mempool) {
      if (now - entry.timestamp > maxAge) {
        toEvict.push(hash);
      }
    }
    
    // If we need more space, evict oldest transactions
    if (toEvict.length < this.state.config.evictionBatchSize) {
      const sortedEntries = Array.from(this.state.mempool.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp);
        
      const needed = this.state.config.evictionBatchSize - toEvict.length;
      for (let i = 0; i < needed && i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        if (entry) {
          toEvict.push(entry[0]);
        }
      }
    }
    
    // Remove evicted transactions
    for (const hash of toEvict) {
      this.state.mempool.delete(hash);
    }
    
    if (toEvict.length > 0) {
      console.log(`Evicted ${toEvict.length} transactions from mempool`);
    }
  }

  async submitTx(tx: ServerTx): Promise<Result<void>> {
    return this.addToMempool(tx);
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
    console.log('Mempool size:', this.state.mempool.size);
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
    if (this.state.mempool.size === 0) return;

    const outbox: OutboxMessage[] = [];
    const inputs = Array.from(this.state.mempool.values()).map(entry => entry.tx);
    const processedHashes: Hash[] = [];

    // Apply all inputs
    for (const entry of this.state.mempool.values()) {
      const txHash = hash(encode(entry.tx));
      
      try {
        this.applyServerTx(entry.tx, outbox);
        processedHashes.push(txHash);
      } catch (error) {
        console.error('Error processing transaction:', error);
      }
    }

    // Remove processed transactions from mempool
    for (const txHash of processedHashes) {
      this.state.mempool.delete(txHash);
    }

    if (processedHashes.length > 0) {
      // Create server block
      const block: ServerBlock = {
        height: ++this.state.height,
        timestamp: Date.now(),
        inputs: inputs.slice(0, processedHashes.length),
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
      
      // Register entity in directory
      this.entityDirectory.register({
        entityId: tx.entityId,
        quorum: [[tx.signerIndex, 1]], // Single signer for now
        threshold: 0.67,
        proposer: tx.signerIndex
      });
    } else if (!entityState) {
      entityState = createEntity(tx.entityId);
      
      // Register new entity
      this.entityDirectory.register({
        entityId: tx.entityId,
        quorum: [[tx.signerIndex, 1]],
        threshold: 0.67,
        proposer: tx.signerIndex
      });
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
    const batch: Array<{ key: Buffer; value: Buffer }> = [];
    
    for (const [signerIndex, entities] of this.state.signers) {
      for (const [entityId, state] of entities) {
        if (state.consensusBlock) {
          const key = KEYS.entityBlock(entityId, state.consensusBlock.height);
          const value = encode(state.consensusBlock);
          batch.push({ key, value });
        }
      }
    }
    
    if (batch.length > 0) {
      await this.db.batch(batch);
    }
    
    // Log outbox messages for debugging
    if (outbox.length > 0) {
      console.log(`Generated ${outbox.length} outbox messages`);
    }
  }

  async initialize(): Promise<void> {
    // Load server state
    try {
      const rootData = await this.db.get(KEYS.serverRoot);
      if (rootData) {
        const decoded = decode(rootData);
        this.state.height = decoded.height;
        
        // Load entity states for all signers
        await this.loadEntityStates();
      }
    } catch (error) {
      // Fresh start
      this.state.height = 0;
    }
  }

  private async loadEntityStates(): Promise<void> {
    // For now, we'll need to iterate through known entity keys
    // In a full implementation, we'd maintain an index of entities
    // This is a simplified recovery that assumes we know our entities
    
    // Try to load common entity IDs (in real system, we'd have an index)
    const commonEntityIds = ['entity1', 'entity2', 'entity3']; // Expand as needed
    
    for (let signerIndex = 0; signerIndex < 10; signerIndex++) { // Check first 10 signers
      for (const entityId of commonEntityIds) {
        try {
          const key = KEYS.entityState(signerIndex, entityId);
          const stateData = await this.db.get(key);
          if (stateData) {
            const entityState = decode(stateData) as EntityState;
            
            let signerMap = this.state.signers.get(signerIndex);
            if (!signerMap) {
              signerMap = new Map();
              this.state.signers.set(signerIndex, signerMap);
            }
            signerMap.set(entityId, entityState);
          }
        } catch (error) {
          // Entity doesn't exist, continue
        }
      }
    }
  }
}