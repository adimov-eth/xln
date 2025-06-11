import { decode, encode, hash } from './encoding';
import { applyEntityInput, createEntity, getEntityStateRoot } from './entity';
import { MessageRouter } from './routing';
import { Database } from './store';
import {
  Err,
  KEYS,
  Ok,
  type EntityState,
  type Hash,
  type OutboxMessage,
  type Result,
  type ServerBlock,
  type ServerState,
  type ServerTx
} from './types';

// Process a transaction (not pure - handles entity creation)
function processTransaction(
  state: ServerState,
  tx: ServerTx
): { 
  updatedState: ServerState;
  outbox: OutboxMessage[];
  error?: string;
} {
  const outbox: OutboxMessage[] = [];
  
  // Get or create signer map
  let signerEntities = state.signers.get(tx.signerIndex);
  if (!signerEntities) {
    signerEntities = new Map();
    state = {
      ...state,
      signers: new Map(state.signers).set(tx.signerIndex, signerEntities)
    };
  }

  // Get or create entity
  let entityState = signerEntities.get(tx.entityId);
  
  // Handle entity creation
  if (!entityState) {
    if (tx.input.type === 'import') {
      entityState = tx.input.state;
      // Ensure consensus config is set
      if (!entityState.quorum) {
        entityState.quorum = [[tx.signerIndex, 1]];
        entityState.threshold = 0.67;
        entityState.proposer = tx.signerIndex;
      }
    } else {
      // Create new entity with default consensus
      entityState = createEntity(tx.entityId);
      entityState.quorum = [[tx.signerIndex, 1]];
      entityState.threshold = 0.67;
      entityState.proposer = tx.signerIndex;
    }
    
    // Update entity index immutably
    const newEntityIndex = new Map(state.entityIndex);
    let entitySet = newEntityIndex.get(tx.signerIndex);
    if (!entitySet) {
      entitySet = new Set();
    } else {
      // Clone the set to avoid mutation
      entitySet = new Set(entitySet);
    }
    entitySet.add(tx.entityId);
    newEntityIndex.set(tx.signerIndex, entitySet);
    
    state = {
      ...state,
      entityIndex: newEntityIndex
    };
  }

  // Apply entity input (pure function)
  const newEntityState = applyEntityInput(
    entityState,
    tx.input,
    outbox,
    tx.signerIndex,
    tx.entityId
  );

  // Update state immutably
  const newSignerEntities = new Map(signerEntities);
  newSignerEntities.set(tx.entityId, newEntityState);
  
  const newSigners = new Map(state.signers);
  newSigners.set(tx.signerIndex, newSignerEntities);
  
  return {
    updatedState: {
      ...state,
      signers: newSigners
    },
    outbox
  };
}

// Pure function to collect all entity blocks into a server block
function createServerBlock(
  state: ServerState,
  height: number,
  inputs: ServerTx[]
): ServerBlock {
  return {
    height,
    timestamp: Date.now(),
    inputs,
    stateRoot: computeStateRoot(state)
  };
}

// Pure function to compute server state root
function computeStateRoot(state: ServerState): Buffer {
  const stateData = {
    height: state.height,
    signers: Array.from(state.signers.entries()).map(([signerIndex, entities]) => [
      signerIndex,
      Array.from(entities.entries()).map(([entityId, entityState]) => [
        entityId,
        getEntityStateRoot(entityState)
      ])
    ])
  };
  return hash(encode(stateData));
}

export class Server {
  private db: Database;
  private router: MessageRouter;
  private state: ServerState;
  private incomingQueue: ServerTx[] = [];  // External API calls and inter-entity messages
  private running = false;
  private tickInterval?: NodeJS.Timeout;

  constructor(db: Database) {
    this.db = db;
    this.router = new MessageRouter(
      {
        localSigners: new Set([0, 1, 2]), // Support first 3 signers locally
        remoteEndpoints: new Map()
      },
      (tx: ServerTx) => {
        // Queue for next tick
        this.incomingQueue.push(tx);
      }
    );
    
    this.state = {
      height: 0,
      signers: new Map(),
      entityIndex: new Map()
    };
  }

  async submitTx(tx: ServerTx): Promise<Result<void>> {
    // For entity creation, process immediately
    if (tx.input.type === 'import') {
      const result = processTransaction(this.state, tx);
      if (result.error) {
        return Err(new Error(result.error));
      }
      this.state = result.updatedState;
      
      // Route any outbox messages
      if (result.outbox.length > 0) {
        await this.router.route(result.outbox);
      }
      
      return Ok(undefined);
    }
    
    // For other transactions, check entity exists
    const signerEntities = this.state.signers.get(tx.signerIndex);
    const entity = signerEntities?.get(tx.entityId);
    if (!entity) {
      return Err(new Error(`Entity ${tx.entityId} not found for signer ${tx.signerIndex}`));
    }
    
    // Add to entity's mempool
    const result = processTransaction(this.state, tx);
    if (result.error) {
      return Err(new Error(result.error));
    }
    
    this.state = result.updatedState;
    
    // Route any outbox messages immediately
    if (result.outbox.length > 0) {
      await this.router.route(result.outbox);
    }
    
    return Ok(undefined);
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

  private async processTick(): Promise<void> {
    // Phase 1: Collect inputs for this block
    const blockInputs = [...this.incomingQueue];
    this.incomingQueue = [];
    
    if (blockInputs.length === 0) return;
    
    // Phase 2: Apply all inputs (pure computation)
    let currentState = this.state;
    const allOutbox: OutboxMessage[] = [];
    
    for (const tx of blockInputs) {
      const result = processTransaction(currentState, tx);
      if (!result.error) {
        currentState = result.updatedState;
        allOutbox.push(...result.outbox);
      }
    }
    
    // Phase 3: Create server block
    const newHeight = this.state.height + 1;
    const serverBlock = createServerBlock(currentState, newHeight, blockInputs);
    
    // Phase 4: Update state
    this.state = {
      ...currentState,
      height: newHeight
    };
    
    // Phase 5: Persist everything
    await this.persistState(serverBlock);
    
    // Phase 6: Route outbox messages
    for (const msg of allOutbox) {
      // In real system, this would go through network
      // For now, deliver locally if possible
      const targetSigner = this.state.signers.get(msg.toSigner);
      const targetEntity = targetSigner?.get(msg.toEntity);
      
      if (targetEntity) {
        const inboxTx: ServerTx = {
          signerIndex: msg.toSigner,
          entityId: msg.toEntity,
          input: msg.payload
        };
        this.incomingQueue.push(inboxTx);
      }
    }
  }

  private async persistState(block: ServerBlock): Promise<void> {
    const batch: Array<{ key: Buffer; value: Buffer }> = [];
    
    // Persist server block
    batch.push({
      key: KEYS.serverBlock(block.height),
      value: encode(block)
    });
    
    // Persist server root
    batch.push({
      key: KEYS.serverRoot,
      value: encode({ height: this.state.height })
    });
    
    // Persist all entity states
    for (const [signerIndex, entities] of this.state.signers) {
      for (const [entityId, state] of entities) {
        batch.push({
          key: KEYS.entityState(signerIndex, entityId),
          value: encode(state)
        });
      }
      
      // Persist entity index
      const entityIds = this.state.entityIndex.get(signerIndex);
      if (entityIds) {
        batch.push({
          key: KEYS.entityIndex(signerIndex),
          value: encode(Array.from(entityIds))
        });
      }
    }
    
    // Persist entity blocks
    for (const [_, entities] of this.state.signers) {
      for (const [entityId, state] of entities) {
        if (state.consensusBlock) {
          batch.push({
            key: KEYS.entityBlock(entityId, state.consensusBlock.height),
            value: encode(state.consensusBlock)
          });
        }
      }
    }
    
    await this.db.batch(batch);
  }

  async initialize(): Promise<void> {
    // Load server state
    try {
      const rootData = await this.db.get(KEYS.serverRoot);
      if (rootData) {
        const decoded = decode(rootData);
        this.state.height = decoded.height;
        
        // Load entity states using index
        await this.loadEntityStates();
      }
    } catch (error) {
      // Fresh start
      this.state.height = 0;
    }
  }

  private async loadEntityStates(): Promise<void> {
    // Load entity indices for each signer
    for (let signerIndex = 0; signerIndex < 10; signerIndex++) {
      try {
        const indexData = await this.db.get(KEYS.entityIndex(signerIndex));
        if (indexData) {
          const entityIds = decode(indexData) as string[];
          const entitySet = new Set(entityIds);
          this.state.entityIndex.set(signerIndex, entitySet);
          
          // Load each entity state
          const signerMap = new Map<string, EntityState>();
          for (const entityId of entityIds) {
            try {
              const stateData = await this.db.get(KEYS.entityState(signerIndex, entityId));
              if (stateData) {
                const entityState = decode(stateData) as EntityState;
                signerMap.set(entityId, entityState);
              }
            } catch (error) {
              // Entity state missing, skip
            }
          }
          
          if (signerMap.size > 0) {
            this.state.signers.set(signerIndex, signerMap);
          }
        }
      } catch (error) {
        // No index for this signer, continue
      }
    }
  }

  async getEntityState(entityId: string): Promise<EntityState | undefined> {
    // Check all signers for the entity
    for (const [_, entities] of this.state.signers) {
      const state = entities.get(entityId);
      if (state) {
        return state;
      }
    }
    return undefined;
  }

  printTree(): void {
    console.log('Server State Tree:');
    console.log(`├─ Height: ${this.state.height}`);
    console.log(`├─ Incoming Queue: ${this.incomingQueue.length} messages`);
    console.log(`└─ Signers:`);
    
    const signerEntries = Array.from(this.state.signers.entries());
    signerEntries.forEach(([signerIndex, entities], i) => {
      const isLast = i === signerEntries.length - 1;
      console.log(`   ${isLast ? '└─' : '├─'} Signer ${signerIndex}:`);
      
      const entityEntries = Array.from(entities.entries());
      entityEntries.forEach(([entityId, state], j) => {
        const isLastEntity = j === entityEntries.length - 1;
        const prefix = isLast ? '      ' : '   │  ';
        console.log(`   ${prefix}${isLastEntity ? '└─' : '├─'} ${entityId}: height=${state.height}, nonce=${state.nonce}, mempool=${state.mempool.length}, status=${state.status}`);
      });
    });
  }
}