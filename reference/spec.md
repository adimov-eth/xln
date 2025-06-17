I understand the clarifications:

1. **DAO Architecture** - Yes, the terminology separation is perfect:
   - **Consensus Layer**: Proposal/Approve/Commit (for blocks)
   - **Governance Layer**: Initiative/Vote/Execute (for DAO decisions)
   - This avoids the overloaded "proposal" term and makes the architecture cleaner.

2. **GitHub Code** - I cannot directly access GitHub repositories. Could you paste the current implementation here so I can review it against the spec?

3. **Channels/Accounts** - Understood, these are future work and should be excluded from the current spec.

4. **Networking** - Will keep the single-server simulation approach but ensure message structures are network-ready.

Let me create the unified spec with these constraints:

# XLN Protocol Specification v3.2 (Unified)

## Table of Contents

1. [Overview](#1-overview)
2. [Core Architecture](#2-core-architecture)
3. [State Machine Hierarchy](#3-state-machine-hierarchy)
4. [Consensus Mechanisms](#4-consensus-mechanisms)
5. [DAO Architecture](#5-dao-architecture)
6. [Storage Architecture](#6-storage-architecture)
7. [Transaction Flow](#7-transaction-flow)
8. [Protocol Implementation](#8-protocol-implementation)
9. [Security Model](#9-security-model)
10. [Implementation Status](#10-implementation-status)
11. [Known Issues & Improvements](#11-known-issues-improvements)

## 1. Overview

### 1.1 What is XLN?

XLN (eXtensible Ledger Network) is a programmable trust network built on a hierarchy of autonomous state machines. It represents a fundamental reimagining of Layer 2 architecture, positioning itself as "Layer 8" - a financial internet where scale is not limited by blocks and security doesn't require sequencers.

**Core Philosophy:**
```
XLN — is not Layer 2. This is Layer 8: financial internet, where scale is not limited by blocks,
and security — doesn't require a sequencer.
```

### 1.2 Key Principles

1. **No Global Consensus**: Each server maintains its own state independently
2. **Hierarchical Trust**: Trust flows through Server → Signer → Entity layers
3. **Local State Machines**: Each component is an isolated state machine with message passing
4. **100ms Block Time**: Fast local consensus without waiting for global agreement
5. **No Data Availability Layer**: Participants only store data they care about
6. **Replication as Security**: Security derives from multiple replicas, not consensus algorithms
7. **Unified Flow**: Single-signer and multi-signer entities use the same transaction flow

### 1.3 Mental Model

Think of XLN as a postal system:
- **Server**: Postal station (routes mail, no decisions)
- **Entity**: Company with directors (signers)
- **Signer**: Board member with voting rights
- **EntityInput**: Letter to the company
- **EntityTx**: Specific action in the letter
- **EntityBlock**: Meeting minutes (signed, immutable)
- **ServerBlock**: Daily archive of all mail

For DAOs specifically:
- **Initiative**: A governance proposal (like a shareholder resolution)
- **Vote**: Individual board member's decision
- **Actions**: The actual operations to perform if initiative passes

## 2. Core Architecture

### 2.1 Component Hierarchy

```
Server (Root Machine)
├── Signer[0]
│   ├── Entity[alice] (personal wallet)
│   ├── Entity[dao] (DAO replica)
│   └── Entity[hub] (hub replica)
├── Signer[1]
│   ├── Entity[bob] (personal wallet)
│   └── Entity[dao] (DAO replica)
└── Signer[2]
    └── Entity[dao] (DAO replica)
```

### 2.2 Core Types

```typescript
// Branded primitive types for type safety
type EntityId = Brand<string, 'EntityId'>;
type SignerIdx = Brand<number, 'SignerIdx'>;
type BlockHeight = Brand<number, 'BlockHeight'>;
type BlockHash = Brand<string, 'BlockHash'>;

// Hierarchical state structure
type ServerState = {
  height: BlockHeight;
  signers: ReadonlyMap<SignerIdx, SignerEntities>;
  registry: ReadonlyMap<EntityId, EntityMeta>;
  mempool: readonly ServerTx[];
};

// Each signer maintains entity replicas
type SignerEntities = ReadonlyMap<EntityId, EntityState>;

// Entity state with consensus stages
type EntityState<T = any> = {
  id: EntityId;
  height: BlockHeight;
  stage: 'idle' | 'proposed' | 'committing' | 'faulted';
  data: T;
  mempool: readonly EntityTx[];
  proposal?: ProposedBlock;
  lastBlockHash?: BlockHash;
  faultReason?: string;
};

// Transaction types
type ServerTx = {
  signer: SignerIdx;
  entityId: EntityId;
  command: EntityCommand;
};

type EntityCommand = 
  | { type: 'addTx'; tx: EntityTx }
  | { type: 'proposeBlock' }
  | { type: 'shareProposal'; proposal: ProposedBlock }
  | { type: 'approveBlock'; hash: BlockHash; from?: SignerIdx }
  | { type: 'commitBlock'; hash: BlockHash };
```

### 2.3 Entity-Signer Relationship

- **Entity**: Static identifier (like a domain name)
- **Quorum**: Dynamic set of signers that control the entity (like IP addresses)
- **Replicas**: Each signer in the quorum maintains a full replica of the entity state
- **Registration vs Import**: Entities are registered globally but signers must explicitly import to create replicas

## 3. State Machine Hierarchy

### 3.1 Server Machine

The root machine that coordinates signers:
- Processes mempool every 100ms
- Routes messages to appropriate signer-entity pairs
- Maintains global state hash across all signers
- Pure router with no business logic

**Server Tick Model**:
```typescript
// Each 100ms tick:
// 1. Current inbox = mempool
const inbox = server.mempool;

// 2. Clear for next tick  
server.mempool = [];

// 3. Process all messages
for (const msg of inbox) {
  // Process generates outbox messages
}

// 4. Outbox messages go to NEXT tick's mempool
// No recursive processing in same tick
```

### 3.2 Signer Machine

Represents an external account or validator:
- Owns multiple entity replicas
- Participates in entity consensus
- Routes messages between its entities
- Thin abstraction layer (currently merged with server logic)

### 3.3 Entity Machine

The primary business logic container with three types:

#### Personal Entity
- Single signer, instant finality
- Auto-propose enabled
- Acts as personal wallet
- No consensus overhead

#### DAO Entity
- Multi-signer with governance
- Full state machine with blocks
- Executes transactions via consensus
- Supports Initiatives for governance

#### Hub Entity (Future)
- Order matching and routing
- Cross-jurisdictional liquidity
- Atomic swap coordination

## 4. Consensus Mechanisms

### 4.1 Unified Entity Model

**Key Insight**: All entities use the same flow:
```
Mempool → Block Creation → Consensus → Execution
```

The only difference is consensus requirements:
- **Single-signer**: Auto-approved blocks (instant)
- **Multi-signer**: Requires quorum approval (2/3+)

### 4.2 Multi-Signer Consensus (Simplified Tendermint)

1. **Proposer Selection**: 
   ```typescript
   proposer = quorum[height % quorum.length]
   ```

2. **Block Creation Flow**:
   - Any signer can add transactions to mempool
   - Proposer creates block when ready
   - Block contains ordered list of transactions
   - No pre-vote phase (unlike full Tendermint)

3. **Consensus States**:
   ```typescript
   'idle'       → Can add txs, can propose
   'proposed'   → Waiting for approvals
   'committing' → Have quorum, executing
   'faulted'    → Error state
   ```

4. **Message Flow**:
   ```
   Proposer: proposeBlock → shareProposal → [wait for approvals] → commitBlock
   Others:   [receive shareProposal] → approveBlock
   ```

### 4.3 Timeout Handling

- Default 30 second timeout for proposals
- On timeout: revert to idle, return txs to mempool
- Prevents stuck consensus states
- Future: Add heartbeat for liveness

### 4.4 Message Routing

Outbox messages are routed based on target:
- **Specific signer**: Route to that signer only
- **No signer specified**: Route to ALL quorum members
- Server doesn't distinguish self-routing (pure simulation)

## 5. DAO Architecture

### 5.1 Terminology Clarity

Clear separation between consensus and governance:

| Level | Term | Description |
|-------|------|-------------|
| **Consensus Layer** | Proposal | Block proposal containing transactions |
| | Approve | Vote to accept a block proposal |
| | Commit | Finalize block after quorum reached |
| | Proposer | Designated signer who creates blocks |
| **Governance Layer** | Initiative | Governance item that DAO members vote on |
| | Vote | Member's support or opposition to an initiative |
| | Execute | Apply passed initiative's transactions |
| **Data Flow** | Input | Command routed to entity (EntityCommand) |
| | Transaction | Atomic business operation (EntityTx) |
| | Block | Durable batch of transactions with consensus |
| | Action | Pure function that mutates state |

### 5.2 Initiative Structure

```typescript
type Initiative = {
  id: string;
  title: string;
  description: string;
  author: SignerIdx;
  actions: EntityTx[];        // Txs to execute if passed
  votes: Map<SignerIdx, boolean>;
  status: 'active' | 'passed' | 'rejected' | 'executed';
  createdAt: number;
  executedAt?: number;
}
```

### 5.3 DAO Governance Flow

```
1. Member creates initiative
   └─> { op: 'createInitiative', data: { initiative } }

2. Members vote on initiative  
   └─> { op: 'voteInitiative', data: { id, support } }

3. Initiative passes (threshold met)
   └─> Status changes to 'passed'

4. Execute initiative
   └─> { op: 'executeInitiative', data: { id } }
   └─> Adds initiative's transactions to mempool

5. Normal block consensus
   └─> Transactions execute through standard flow
```

### 5.4 Why This Architecture?

- **Simplicity**: Block consensus IS the approval mechanism
- **Flexibility**: Initiatives separate governance from execution
- **Auditability**: Complete history in blocks
- **Efficiency**: No duplicate voting mechanisms
- **Clarity**: Clean terminology separation

## 6. Storage Architecture

### 6.1 Storage Layers

1. **In-Memory State**: Primary working state
   - Full server state loaded on startup
   - All operations work on memory
   - Write-through to persistence

2. **Write-Ahead Log (WAL)**: Transaction durability
   - Append-only log of all server transactions
   - Enables crash recovery
   - Truncated after snapshots

3. **Snapshots**: Periodic state checkpoints
   - Full state serialization
   - Configurable interval (default: 100 blocks)
   - Enables fast recovery

4. **Block History**: Optional audit trail

### 6.2 Persistence Flow

**Every 100ms**:
```typescript
1. Process mempool
2. Create ServerBlock if non-empty
3. Write to WAL
4. Apply state changes
5. Persist block
6. Periodically snapshot (every N blocks)
```

**Recovery Process**:
```typescript
1. Load latest snapshot (or create initial state)
2. Read WAL entries since snapshot
3. Replay transactions with skipWal flag
4. Resume normal operation
```

### 6.3 State Hashing

```typescript
// Hierarchical deterministic hash
ServerHash = hash({
  height,
  signers: [
    [signer0, [[entity0, hash0], [entity1, hash1]]],
    [signer1, [...]]
  ],
  registry
})

// Weak cache optimization for unchanged entities
let stateHashCache = new WeakMap<EntityState, string>();
```

## 7. Transaction Flow

### 7.1 Standard Transaction Flow

```
1. User submits Input
   └─> ServerTx { signer, entityId, command }

2. Server routes to Entity
   └─> EntityCommand (addTx, proposeBlock, etc.)

3. Entity processes command
   └─> Transaction added to mempool

4. Block proposed (single or multi-sig)
   └─> ProposedBlock { txs, hash, approvals }

5. Consensus reached
   └─> Block committed

6. Transactions execute
   └─> Pure functions mutate state
```

### 7.2 DAO-Specific Flow

For governance decisions:
```
1. Create Initiative (with multiple actions)
2. Collect votes on Initiative
3. When passed, execute Initiative
4. Actions enter normal transaction flow
5. Standard consensus applies actions
```

### 7.3 Message Generation

Transactions can generate cross-entity messages:
```typescript
// Example: Transfer generating credit message
if (op.type === 'transfer') {
  return [{
    from: entityId,
    to: op.to,
    command: {
      type: 'addTx',
      tx: {
        op: 'credit',
        data: { amount: op.amount, from: entityId, _internal: true }
      }
    }
  }];
}
```

## 8. Protocol Implementation

### 8.1 Protocol System

```typescript
type Protocol<TState, TData> = {
  name: string;
  validateTx: (tx: EntityTx) => Result<TData>;
  applyTx: (state: TState, data: TData, tx?: EntityTx) => Result<TState>;
  generateMessages?: (entityId: EntityId, data: TData) => OutboxMsg[];
};
```

### 8.2 Wallet Protocol (Implemented)

```typescript
type WalletState = {
  balance: bigint;
  nonce: number;
};

type WalletOp = 
  | { type: 'credit'; amount: bigint; from: EntityId; _internal?: boolean }
  | { type: 'burn'; amount: bigint }
  | { type: 'transfer'; amount: bigint; to: EntityId };
```

**Key Design Decisions**:
- Credits increment receiver's nonce (prevents replay)
- Direct credit submissions rejected (must come via transfer)
- BigInt for all amounts
- Internal flag for system-generated credits

### 8.3 Future Protocols

- **DAO Protocol**: Extend wallet with initiatives
- **Hub Protocol**: Order matching and routing
- **Depository Protocol**: External chain bridges

## 9. Security Model

### 9.1 Trust Assumptions

- **Intra-Entity**: 2/3+ honest signers (Byzantine fault tolerance)
- **Inter-Entity**: No trust required (future: HTLC enforcement)
- **Server Level**: Currently trusted environment
- **Storage**: Crash-fault tolerant, not Byzantine-fault tolerant

### 9.2 Current Security Features

| Feature | Status | Description |
|---------|--------|-------------|
| Nonce Protection | ✅ | Prevents replay attacks |
| WAL Recovery | ✅ | Survives crashes |
| Snapshot Recovery | ✅ | Fast state restoration |
| Quorum Consensus | ✅ | 2/3+ required |
| State Hashing | ✅ | Deterministic verification |
| Timeout Recovery | ✅ | Prevents stuck states |

### 9.3 Security Gaps

| Gap | Impact | Mitigation (Future) |
|-----|--------|-------------------|
| No Signatures | High | Add Ed25519/BLS |
| No Byzantine Detection | Medium | Gossip protocol |
| Predictable Proposer | Low | VRF or hash-based |
| Unbounded Mempool | Low | Size limits + fees |
| No State Sync | Medium | Periodic reconciliation |

## 10. Implementation Status

### 10.1 Core Features ✅

**Architecture**:
- Hierarchical server-signer-entity structure
- Entity registration and import separation
- Message routing through outbox pattern
- Pure functional state transitions

**Consensus**:
- Single-signer auto-propose
- Multi-signer proposal/approval flow
- Timeout handling
- Proposer rotation

**Storage**:
- In-memory state management
- WAL for durability
- Snapshot persistence
- Recovery from crash

**Protocols**:
- Wallet protocol with transfers
- Nonce-based replay protection
- Internal credit mechanism

### 10.2 In Progress ⏳

- DAO Initiative system
- Vote tracking and thresholds
- Initiative execution flow
- Byzantine fault tolerance
- State divergence detection

### 10.3 Not Implemented ❌

- Signature verification
- P2P networking
- External blockchain integration
- Weighted voting
- Custom quorum thresholds
- Channel/account machines
- Cross-jurisdictional swaps
- Hub order matching
- Credit line system

## 11. Known Issues & Improvements

### 11.1 Critical Issues

1. **Stuck Proposal Recovery**
   ```typescript
   // If proposer crashes after sharing, consensus stalls
   // Need: Heartbeat mechanism or view change protocol
   ```

2. **Missing Proposal Validation**
   ```typescript
   // shareProposal doesn't validate proposal content
   // Need: Hash validation against expected state
   ```

3. **Race Condition in Proposal**
   ```typescript
   // Proposer advances to 'proposed' before others receive
   // Need: Two-phase proposal or delayed transition
   ```

4. **No Byzantine Fault Detection**
   ```typescript
   // Malicious proposer could send different proposals
   // Need: Gossip protocol for cross-validation
   ```

### 11.2 Quality Improvements

1. **State Divergence Monitoring**
   ```typescript
   interface DivergenceDetector {
     checkReplicas(entity: EntityId): DivergenceReport;
     alertThreshold: number; // blocks behind
   }
   ```

2. **Memory Management**
   ```typescript
   // Current: Cache clears after N hits
   // Better: Time-based eviction
   if (++cacheHits > 10_000 || Date.now() - lastClear > 60_000) {
     stateHashCache = new WeakMap();
   }
   ```

3. **Type Safety**
   ```typescript
   // Current: tx.op is string
   // Better: Discriminated union
   type EntityTx = 
     | { op: 'transfer'; data: TransferData }
     | { op: 'burn'; data: BurnData }
     | { op: 'createInitiative'; data: InitiativeData }
   ```

### 11.3 Testing Gaps

- Byzantine scenarios (conflicting proposals)
- Network partition simulation
- Concurrent proposal attempts
- Large-scale replica testing
- Initiative edge cases
- WAL corruption recovery

### 11.4 Architectural Enhancements

**Short Term**:
1. Add pull-based sync for missing blocks
2. Implement proposal gossip protocol
3. Add CLI for interactive testing
4. Switch to RLP for deterministic encoding

**Medium Term**:
1. Vector clocks for causality tracking
2. Transactional storage layer
3. Signature verification
4. State reconciliation protocol

**Long Term**:
1. Network layer (libp2p/WebSocket)
2. Channel state machines
3. Cross-jurisdictional operations
4. Hub entities with order books

## Appendix A: Command Reference

### Server Commands
```typescript
type ServerTx = {
  signer: SignerIdx;
  entityId: EntityId;
  command: EntityCommand;
}
```

### Entity Commands
```typescript
type EntityCommand = 
  | { type: 'addTx'; tx: EntityTx }              // Add to mempool
  | { type: 'proposeBlock' }                     // Create proposal
  | { type: 'shareProposal'; proposal: ProposedBlock } // Distribute
  | { type: 'approveBlock'; hash: BlockHash }    // Vote on block
  | { type: 'commitBlock'; hash: BlockHash }     // Finalize
```

### Entity Transactions (Wallet Protocol)
```typescript
type EntityTx = {
  op: 'transfer' | 'burn' | 'credit';
  data: any;
  nonce?: number;
}
```

### DAO Transactions (Future)
```typescript
type EntityTx = {
  op: 'createInitiative' | 'voteInitiative' | 'executeInitiative';
  data: any;
  nonce?: number;
}
```

## Appendix B: Design Rationale

**Why Unified Flow?**
- Simplicity: One mental model for all entities
- Consistency: Same code paths, easier to verify
- Flexibility: Consensus requirements are just parameters

**Why Separate Initiatives from Blocks?**
- Clarity: Block proposals ≠ governance proposals
- Flexibility: Can have long-running initiatives
- Auditability: Clear record of what was voted on

**Why 100ms Ticks?**
- Fast enough for responsive UX
- Slow enough to batch operations
- Matches human perception threshold

**Why No Signatures Yet?**
- Focus on core consensus logic first
- Signatures are well-understood, can add later
- Simplifies testing and debugging

---

This specification represents XLN v3.2 with focus on the implemented core and clear paths forward. The architecture elegantly unifies single and multi-signer entities while maintaining clean separation between consensus and governance layers.