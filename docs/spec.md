# XLN Complete Specification and Documentation

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Type Definitions](#type-definitions)
5. [Consensus Mechanism](#consensus-mechanism)
6. [Storage Architecture](#storage-architecture)
7. [Implementation Guide](#implementation-guide)
8. [Network Communication](#network-communication)
9. [Security Model](#security-model)
10. [Development Roadmap](#development-roadmap)
11. [API Reference](#api-reference)
12. [Testing Strategy](#testing-strategy)

## Executive Summary

XLN is a functional-style distributed ledger system designed for high-performance financial applications. It implements a hierarchical architecture with deterministic execution, enabling scalable consensus and bilateral state channels between entities.

### Key Features

- **Hierarchical Structure**: Server → Signers → Entities → Accounts
- **Deterministic Execution**: Pure functional approach ensuring reproducibility
- **RAM-First Design**: All hot data in memory with periodic persistence
- **100ms Block Time**: Sub-second finality for transactions
- **Bilateral Consensus**: Two-party state channels for scalability

### Design Principles

1. **Functional Programming**: No classes, pure functions, immutable state
2. **Fault Tolerance**: Automatic recovery from crashes via snapshots + WAL
3. **Minimal On-Chain**: Only essential components on external blockchains
4. **Isolated Execution**: Entities cannot directly access each other's state
5. **Single-Server Simulation**: Network behavior simulated locally during development

## System Architecture

### Three-Level Hierarchy

```
Server (Root Environment)
├── Signers (0..n) - Private/public key pairs
│   └── Entities (0..n per signer) - Autonomous units
│       └── Accounts (0..n per entity) - Bilateral channels
└── Global Mempool - Pending transactions
```

### Component Responsibilities

#### Server
- Root environment managing all operations
- Processes blocks every 100ms
- Maintains global transaction mempool
- Computes root hash of entire system state
- Routes messages between entities

#### Signers
- Ethereum-compatible private/public key pairs
- Can participate in multiple entities
- Maintain replicas of their entities
- Identified by index (0, 1, 2...) in server

#### Entities
- Autonomous units with independent state
- Single-signer (personal wallet) or multi-signer (DAO)
- Connected to one jurisdiction (external blockchain)
- Has quorum structure defining consensus rules
- Cannot directly access other entities' state

#### Accounts (Future Implementation)
- Bilateral state channels between two entities
- Store balance deltas for multiple assets
- Require signatures from both parties
- Enable high-frequency transactions

## Core Components

### Transaction Types

```typescript
// Server-level transaction
export type ServerTx = {
  signer: number;      // Signer index in server
  entityId: string;    // Target entity identifier
  input: EntityInput;  // Command to execute
};

// Entity-level commands
export type EntityInput = 
  | { type: 'add_tx'; tx: EntityTx }
  | { type: 'propose_block' }
  | { type: 'commit_block'; blockHash: string };

// Entity transaction (business logic)
export type EntityTx = {
  op: string;    // Operation type: 'mint', 'transfer', etc.
  data: any;     // Operation-specific payload
};
```

### State Structures

```typescript
// Entity state
export type EntityState = {
  height: number;                    // Current block height
  state: any;                        // Application-specific state
  mempool: EntityTx[];               // Pending transactions
  proposed?: {                       // Current block proposal
    txs: EntityTx[];
    hash: string;
    status: 'pending' | 'committed';
  };
  quorum: number[];                  // Participating signer indices
  status: 'idle' | 'proposed';       // Entity consensus status
};

// Server state
export type ServerState = {
  height: number;                    // Global block height
  signers: Map<number, Map<string, EntityState>>;  // Signer → Entity mapping
  mempool: ServerTx[];               // Global pending transactions
};

// Inter-entity messaging
export type OutboxMsg = {
  from: string;         // Source entity ID
  toEntity: string;     // Destination entity ID
  toSigner: number;     // Destination signer index
  input: EntityInput;   // Command to send
};
```

## Type Definitions

### Complete Type System

```typescript
// Core Types
export type ServerTx = {
  signer: number;
  entityId: string;
  input: EntityInput;
};

export type EntityInput = 
  | { type: 'add_tx'; tx: EntityTx }
  | { type: 'propose_block' }
  | { type: 'commit_block'; blockHash: string };

export type EntityTx = {
  op: string;
  data: any;
};

export type EntityState = {
  height: number;
  state: any;
  mempool: EntityTx[];
  proposed?: {
    txs: EntityTx[];
    hash: string;
    status: 'pending' | 'committed';
  };
  quorum: number[];
  status: 'idle' | 'proposed';
};

export type OutboxMsg = {
  from: string;
  toEntity: string;
  toSigner: number;
  input: EntityInput;
};

export type ServerState = {
  height: number;
  signers: Map<number, Map<string, EntityState>>;
  mempool: ServerTx[];
};

// Quorum Definition (conceptual)
export type Quorum = {
  signers: Array<[address: string, weight: number]>;
  threshold: number;  // Percentage required (e.g., 67)
};
```

## Consensus Mechanism

### Entity-Level Consensus

XLN implements a simplified Tendermint-style consensus without pre-vote phase:

1. **Proposer Selection**: First signer in quorum acts as proposer
2. **Block Creation**: Proposer creates block from mempool transactions
3. **Signature Collection**: Block sent to validators for signatures
4. **Finalization**: Block committed when threshold reached (default 67%)

### Consensus Rules

- **Single-signer entities**: Instant finalization (100% threshold)
- **Multi-signer entities**: Require threshold percentage of signatures
- **Deterministic execution**: Same inputs always produce same state hash
- **No forks**: Deterministic proposer selection prevents competing blocks

### Quorum Structure

```typescript
// Single-signer entity (personal wallet)
const personalEntity = {
  quorum: [0],  // Only signer 0
  threshold: 100
};

// Multi-signer entity (DAO)
const daoEntity = {
  quorum: [0, 1, 2],  // Signers 0, 1, and 2
  threshold: 67       // Need 2 out of 3 signatures
};
```

## Storage Architecture

### Three-Database Design

```typescript
import { Level } from 'level';

// State snapshots
const stateDB = new Level('./state', { valueEncoding: 'json' });

// Write-ahead log for recovery
const walDB = new Level('./wal', { valueEncoding: 'json' });

// Historical blocks
const blockDB = new Level('./blocks', { valueEncoding: 'binary' });
```

### Storage Patterns

#### State Database
- Key: `{signerIndex}:{entityId}`
- Value: Complete EntityState object
- Updated every 100 blocks (configurable)

#### WAL Database
- Key: `{blockHeight}:{signerIndex}:{entityId}`
- Value: ServerTx object
- Used for crash recovery

#### Block Database
- Key: `{blockHeight}`
- Value: RLP-encoded block data
- Contains all transactions for that height

### Persistence Strategy

1. **RAM-First**: All active data kept in memory
2. **WAL Logging**: Every transaction logged before execution
3. **Periodic Snapshots**: Full state saved every N blocks
4. **Crash Recovery**: Restore from snapshot + replay WAL

## Implementation Guide

### Core Functions

#### 1. Initialize Server

```typescript
export const initServer = (signerCount: number): ServerState => {
  const signers = new Map();
  for (let i = 0; i < signerCount; i++) {
    signers.set(i, new Map());
  }
  return { height: 0, signers, mempool: [] };
};
```

#### 2. Import Entity

```typescript
export const importEntity = (
  server: ServerState, 
  signerIdx: number,
  entityId: string,
  initialState: any,
  height: number = 0,
  quorum: number[] = []
): ServerState => {
  const signerEntities = server.signers.get(signerIdx);
  if (!signerEntities) return server;
  
  signerEntities.set(entityId, {
    height,
    state: initialState,
    mempool: [],
    quorum: quorum.length ? quorum : [signerIdx],
    status: 'idle'
  });
  
  return server;
};
```

#### 3. Process Entity Input

```typescript
export const applyEntityInput = (
  entity: EntityState, 
  input: EntityInput,
  outbox: OutboxMsg[],
  entityId: string
): EntityState => {
  switch (input.type) {
    case 'add_tx':
      if (entity.status !== 'idle') return entity;
      return { ...entity, mempool: [...entity.mempool, input.tx] };
    
    case 'propose_block': {
      if (entity.status !== 'idle' || entity.mempool.length === 0) {
        return entity;
      }
      const txs = entity.mempool;
      const hash = hashBlock(txs);
      return {
        ...entity,
        proposed: { txs, hash, status: 'pending' },
        status: 'proposed'
      };
    }
    
    case 'commit_block': {
      if (entity.status !== 'proposed' || 
          entity.proposed?.hash !== input.blockHash) {
        return entity;
      }
      
      const newState = applyTxs(entity.state, entity.proposed.txs);
      
      // Example outbox message
      if (newState.balance > 1000) {
        outbox.push({
          from: entityId,
          toEntity: 'hub',
          toSigner: 0,
          input: { 
            type: 'add_tx', 
            tx: { 
              op: 'notify', 
              data: { balance: newState.balance } 
            } 
          }
        });
      }
      
      return {
        ...entity,
        height: entity.height + 1,
        state: newState,
        mempool: [],
        proposed: undefined,
        status: 'idle'
      };
    }
    
    default:
      return entity;
  }
};
```

#### 4. Process Server Block

```typescript
export const applyServerBlock = async (
  server: ServerState
): Promise<ServerState> => {
  const outbox: OutboxMsg[] = [];
  
  // Process all mempool transactions
  for (const tx of server.mempool) {
    const signerEntities = server.signers.get(tx.signer);
    if (!signerEntities) continue;
    
    const entity = signerEntities.get(tx.entityId);
    if (!entity) continue;
    
    // Verify signer is in quorum
    if (!entity.quorum.includes(tx.signer)) continue;
    
    // Apply input to entity
    const newEntity = applyEntityInput(
      entity, 
      tx.input, 
      outbox, 
      tx.entityId
    );
    signerEntities.set(tx.entityId, newEntity);
    
    // Log to WAL
    await walDB.put(
      `${server.height}:${tx.signer}:${tx.entityId}`, 
      tx
    );
  }
  
  // Record server block
  const blockData = RLP.encode([
    server.height,
    Date.now(),
    server.mempool.map(tx => [tx.signer, tx.entityId, tx.input])
  ]);
  await blockDB.put(server.height.toString(), blockData);
  
  // Convert outbox to new mempool
  const newMempool = outbox.map(msg => ({
    signer: msg.toSigner,
    entityId: msg.toEntity,
    input: msg.input
  }));
  
  const newServer = {
    height: server.height + 1,
    signers: server.signers,
    mempool: newMempool
  };
  
  // Periodic snapshots
  if (newServer.height % 100 === 0) {
    await saveSnapshot(newServer);
  }
  
  return newServer;
};
```

#### 5. Compute Server Hash

```typescript
export const computeServerHash = (server: ServerState): string => {
  const tree: any[] = [];
  
  for (let i = 0; i < server.signers.size; i++) {
    const entities = server.signers.get(i);
    const signerData: string[] = [];
    
    if (entities) {
      for (const [entityId, state] of entities) {
        signerData.push(`${entityId}:${state.height}`);
      }
    }
    tree.push(signerData);
  }
  
  return crypto.createHash('sha256')
    .update(RLP.encode(tree))
    .digest('hex');
};
```

#### 6. Main Server Loop

```typescript
export const runServer = async (server: ServerState) => {
  while (true) {
    // 100ms tick
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (server.mempool.length > 0) {
      server = await applyServerBlock(server);
      console.log(
        `Block ${server.height}, hash: ${computeServerHash(server)}`
      );
    }
  }
};
```

### Transaction Processing

```typescript
const applyTxs = (state: any, txs: EntityTx[]): any => {
  let newState = { ...state };
  for (const tx of txs) {
    switch (tx.op) {
      case 'mint':
        newState.balance = (newState.balance || 0) + tx.data.amount;
        break;
      case 'transfer':
        // Implement transfer logic
        break;
      default:
        // Unknown operation
    }
  }
  return newState;
};
```

### Persistence Functions

```typescript
const saveSnapshot = async (server: ServerState) => {
  const rootHash = crypto.createHash('sha256');
  
  for (const [signerIdx, entities] of server.signers) {
    for (const [entityId, state] of entities) {
      await stateDB.put(`${signerIdx}:${entityId}`, state);
      rootHash.update(`${signerIdx}:${entityId}:${state.height}`);
    }
  }
  
  await stateDB.put('root', {
    height: server.height,
    hash: rootHash.digest('hex')
  });
};

export const restoreServer = async (): Promise<ServerState> => {
  const root = await stateDB.get('root').catch(() => null);
  const signers = new Map<number, Map<string, EntityState>>();
  
  if (root) {
    // Restore entities from snapshot
    for await (const [key, value] of stateDB.iterator()) {
      if (key === 'root') continue;
      const [signerIdx, entityId] = key.split(':');
      const idx = parseInt(signerIdx);
      
      if (!signers.has(idx)) {
        signers.set(idx, new Map());
      }
      signers.get(idx)!.set(entityId, value as EntityState);
    }
  }
  
  // Replay WAL from snapshot height
  let height = root?.height || 0;
  const mempool: ServerTx[] = [];
  
  for await (const [key, tx] of walDB.iterator()) {
    const [blockHeight] = key.split(':');
    if (parseInt(blockHeight) >= height) {
      mempool.push(tx as ServerTx);
    }
  }
  
  return { height, signers, mempool };
};
```

## Network Communication

### Outbox Pattern

During single-server development, network communication is simulated through an outbox pattern:

1. **Message Generation**: Entities create OutboxMsg during processing
2. **Collection**: Server collects all outbox messages during block
3. **Routing**: Messages converted to ServerTx in next mempool
4. **Delivery**: Target entity receives message in next block

### Message Flow Example

```
Entity A (Sender)
    ↓ [OutboxMsg]
Server Outbox Collection
    ↓ [Convert to ServerTx]
Server Mempool
    ↓ [Next Block]
Entity B (Receiver)
```

### Future Networking

- **libp2p Integration**: For peer-to-peer entity communication
- **Signal Protocol**: For encrypted bilateral channels
- **Gossip Protocol**: For entity directory synchronization

## Security Model

### Current Implementation (MVP)

- **No cryptographic signatures**: Trust-based during development
- **No access control**: Any signer can send to any entity
- **No network security**: Single-server simulation

### Future Security Features

1. **Cryptographic Signatures**
   - All ServerTx signed by signer's private key
   - Block proposals include aggregated signatures
   - Merkle proofs for state verification

2. **Access Control**
   - Entities validate sender permissions
   - Quorum membership verification
   - Rate limiting per signer

3. **Network Security**
   - TLS for all connections
   - Peer authentication
   - DDoS protection

### Smart Contract Integration

Two core contracts for external blockchain interaction:

1. **EntityProvider.sol**
   - Maps EntityID → Quorum Hash
   - Manages quorum transitions
   - Grace period for updates (1 week)

2. **Depositary.sol**
   - Manages collateral and reserves
   - Handles inter-entity disputes
   - Settlement layer for accounts

## Development Roadmap

### Phase 1: Core Implementation (Week 1) ✓
- [x] Basic server loop with 100ms ticks
- [x] Entity state management
- [x] Transaction processing
- [x] LevelDB persistence
- [x] Single-signer entities

### Phase 2: Consensus Layer (Week 2)
- [ ] Multi-signer entities
- [ ] Quorum voting mechanics
- [ ] Block proposal/commit flow
- [ ] Signature aggregation
- [ ] Entity synchronization

### Phase 3: Account Channels (Week 3)
- [ ] Account state machines
- [ ] Bilateral consensus
- [ ] Delta management
- [ ] HTLC implementation
- [ ] Routing logic

### Phase 4: External Integration (Week 4)
- [ ] Ethereum contract deployment
- [ ] Jurisdiction interface
- [ ] Reserve management
- [ ] Dispute resolution
- [ ] Token support

### Phase 5: Production Features (Month 2)
- [ ] Cryptographic signatures
- [ ] Network protocol (libp2p)
- [ ] Monitoring and metrics
- [ ] DevTools and debugging
- [ ] Performance optimization

## API Reference

### Server Management

```typescript
// Initialize new server
initServer(signerCount: number): ServerState

// Import entity to server
importEntity(
  server: ServerState,
  signerIdx: number,
  entityId: string,
  initialState: any,
  height?: number,
  quorum?: number[]
): ServerState

// Run server main loop
runServer(server: ServerState): Promise<void>

// Restore server from disk
restoreServer(): Promise<ServerState>
```

### Entity Operations

```typescript
// Apply input to entity
applyEntityInput(
  entity: EntityState,
  input: EntityInput,
  outbox: OutboxMsg[],
  entityId: string
): EntityState

// Hash block of transactions
hashBlock(txs: EntityTx[]): string

// Apply transactions to state
applyTxs(state: any, txs: EntityTx[]): any
```

### Server Operations

```typescript
// Process server block
applyServerBlock(server: ServerState): Promise<ServerState>

// Compute server state hash
computeServerHash(server: ServerState): string

// Save state snapshot
saveSnapshot(server: ServerState): Promise<void>
```

## Testing Strategy

### Deterministic Testing

All operations must be deterministic for reliable testing:

```typescript
// Generate deterministic test data
const generateDeterministicTx = (seed: number, index: number): EntityTx => {
  const hash = crypto.createHash('sha256')
    .update(`${seed}:${index}`)
    .digest('hex');
  
  return {
    op: 'mint',
    data: {
      amount: parseInt(hash.substring(0, 8), 16) % 1000
    }
  };
};

// Verify deterministic execution
const verifyDeterminism = async (seed: number) => {
  const server1 = await runSimulation(seed);
  const server2 = await runSimulation(seed);
  
  assert(computeServerHash(server1) === computeServerHash(server2));
};
```

### Test Categories

1. **Unit Tests**
   - Pure function behavior
   - State transitions
   - Hash computation

2. **Integration Tests**
   - Multi-entity interaction
   - Persistence and recovery
   - Consensus scenarios

3. **Stress Tests**
   - High transaction volume
   - Large entity count
   - Recovery performance

4. **Determinism Tests**
   - Reproducible execution
   - Hash verification
   - State consistency

### Testing Checklist

- [ ] No `Math.random()` usage
- [ ] Fixed timestamps for tests
- [ ] Reproducible transaction generation
- [ ] State verification at checkpoints
- [ ] Single-signer entities first
- [ ] Multi-signer complexity gradually
- [ ] Crash recovery scenarios
- [ ] Performance benchmarks

## Debugging Guide

### Logging Strategy

```typescript
// Structured logging with prefixes
const log = (level: string, component: string, message: string) => {
  console.log(`[${level}] [${component}] ${message}`);
};

// Usage examples
log('INFO', 'Server', `Processing block ${height}`);
log('DEBUG', `Entity:${entityId}`, `Adding tx to mempool`);
log('ERROR', `Signer:${signerIdx}`, `Invalid signature`);
```

### State Inspection

```typescript
// Dump entity state
const dumpEntityState = (entity: EntityState) => {
  console.log(JSON.stringify({
    height: entity.height,
    status: entity.status,
    mempoolSize: entity.mempool.length,
    hasProposal: !!entity.proposed,
    stateHash: crypto.createHash('sha256')
      .update(JSON.stringify(entity.state))
      .digest('hex')
  }, null, 2));
};

// Verify server integrity
const verifyServerIntegrity = (server: ServerState) => {
  const computed = computeServerHash(server);
  console.log(`Server integrity check:
    Height: ${server.height}
    Signers: ${server.signers.size}
    Mempool: ${server.mempool.length}
    Hash: ${computed}
  `);
};
```

### Common Issues

1. **Entity stuck in proposed state**
   - Check if commit message has correct hash
   - Verify quorum participation

2. **Messages not delivered**
   - Check outbox collection
   - Verify signer indices

3. **State divergence**
   - Ensure deterministic operations
   - Check for timestamp usage

4. **Recovery failures**
   - Verify snapshot consistency
   - Check WAL replay order

## Performance Optimization

### Target Metrics

- **Block Time**: 100ms (fixed)
- **Entities per Server**: 1,000+
- **Accounts per Entity**: 10,000+
- **TPS**: 10,000+ transactions/second
- **Finality**: <1 second for multi-signer

### Optimization Strategies

1. **Memory Management**
   - Pre-allocate maps for known entities
   - Reuse objects where possible
   - Batch LevelDB operations

2. **Computation**
   - Cache frequently computed hashes
   - Parallelize independent operations
   - Use efficient data structures

3. **Storage**
   - Compress snapshots
   - Prune old WAL entries
   - Use bloom filters for lookups

## Glossary

- **Block Height**: Sequential counter for blocks in a chain
- **Consensus**: Agreement mechanism between multiple parties
- **Delta**: Signed integer representing balance change
- **Deterministic**: Same input always produces same output
- **Entity**: Autonomous unit with state and consensus rules
- **Finality**: Point when transaction cannot be reversed
- **Mempool**: Pool of pending transactions
- **Outbox**: Queue of messages to send to other entities
- **Proposer**: Signer responsible for creating blocks
- **Quorum**: Set of signers required for consensus
- **Signer**: Private/public key pair participant
- **Snapshot**: Complete state saved to disk
- **WAL**: Write-Ahead Log for crash recovery

## Conclusion

XLN represents a novel approach to distributed ledger technology, combining:

- **Simplicity**: Minimal abstractions, pure functions
- **Performance**: Sub-second finality, high throughput
- **Reliability**: Automatic recovery, deterministic execution
- **Scalability**: Hierarchical structure, bilateral channels

The system is designed to evolve from a single-server simulation to a full distributed network while maintaining the same core abstractions and guarantees.