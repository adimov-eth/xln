
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