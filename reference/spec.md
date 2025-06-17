# XLN Protocol Specification v2.2

## Table of Contents

1. [Overview](#1-overview)
2. [Core Architecture](#2-core-architecture)
3. [State Machine Hierarchy](#3-state-machine-hierarchy)
4. [Consensus Mechanisms](#4-consensus-mechanisms)
5. [Storage Architecture](#5-storage-architecture)
6. [Transaction Flow](#6-transaction-flow)
7. [Cross-Jurisdictional Operations](#7-cross-jurisdictional-operations)
8. [Protocol Implementation](#8-protocol-implementation)
9. [Network Communication](#9-network-communication)
10. [Security Model](#10-security-model)

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
2. **Hierarchical Trust**: Trust flows through Server → Signer → Entity → Channel layers
3. **Credit Over Collateral**: Uses credit lines instead of locked liquidity
4. **Local State Machines**: Each component is an isolated state machine with message passing
5. **100ms Block Time**: Fast local consensus without waiting for global agreement
6. **No Data Availability Layer**: Participants only store data they care about

### 1.3 Comparison to Traditional Systems

Unlike rollups that attempt to compress more data into L1, XLN takes a radically different approach:
- **No sequencers**: Each entity has its own consensus
- **No global state**: Only local state matters to participants
- **No forced data availability**: If no one cares about data, it doesn't need to exist
- **No bridges in traditional sense**: Direct jurisdiction connections via depositories

## 2. Core Architecture

### 2.1 Component Hierarchy

```
Server (Root Machine)
├── Signer[0]
│   ├── Entity[0] 
│   │   ├── Storage
│   │   └── Channels
│   └── Entity[1]
├── Signer[1]
    └── Entity[2]
```

### 2.2 Core Types

```typescript
// Branded primitive types for type safety
type EntityId = Brand<string, 'EntityId'>;
type SignerIdx = Brand<number, 'SignerIdx'>;
type BlockHeight = Brand<number, 'BlockHeight'>;
type BlockHash = Brand<string, 'BlockHash'>;

// Transaction types
type ServerTx = {
  signer: SignerIdx;
  entityId: EntityId;
  command: EntityCommand;
};

type EntityCommand = 
  | { type: 'addTx'; tx: EntityTx }
  | { type: 'proposeBlock' }
  | { type: 'approveBlock'; hash: BlockHash; from?: SignerIdx }
  | { type: 'commitBlock'; hash: BlockHash };

type EntityTx = {
  op: string;
  data: any;
  nonce?: number;
};
```

### 2.3 State Management

Each level maintains its own state:

```typescript
type ServerState = {
  height: BlockHeight;
  entities: ReadonlyMap<EntityId, EntityState>;
  registry: ReadonlyMap<EntityId, EntityMeta>;
  mempool: readonly ServerTx[];
};

type EntityState = {
  id: EntityId;
  height: BlockHeight;
  stage: 'idle' | 'proposed' | 'committing' | 'faulted';
  data: any; // Protocol-specific state
  mempool: readonly EntityTx[];
  proposal?: ProposedBlock;
  lastBlockHash?: BlockHash;
};
```

## 3. State Machine Hierarchy

### 3.1 Server Machine

The root machine that coordinates signers. It:
- Processes mempool every 100ms
- Routes messages to appropriate signers
- Maintains global state hash
- Has no business logic of its own

**Key Properties:**
- Pure router, no internal state
- Groups signers for simulation purposes
- Computes root hash of all entities

### 3.2 Signer Machine

Represents an external account or validator. It:
- Owns multiple entity replicas
- Signs blocks and transactions
- Participates in entity consensus
- Routes messages between entities

**Implementation Note**: Signers are thin layers merged with server logic in current code.

### 3.3 Entity Machine

The primary business logic container. It:
- Maintains application state (wallets, DAOs, hubs)
- Processes transactions through consensus
- Manages channels with other entities
- Can be single or multi-signer

**Entity Types:**
1. **Personal Entity**: Single signer, instant finality
2. **Multi-sig Entity**: Multiple signers, requires quorum
3. **Hub Entity**: Special entity with order books for routing

### 3.4 Channel Machine (Future)

Bilateral payment channels between entities:
- 2-of-2 consensus between entities
- Holds collateral and credit lines
- Processes off-chain payments
- Settles disputes on-chain if needed

## 4. Consensus Mechanisms

### 4.1 Entity Consensus

**Single-Signer**: Instant finality, no consensus needed

**Multi-Signer**: Simplified Tendermint-style consensus
1. **Proposer Selection**: Round-robin based on block height
   ```typescript
   proposer = quorum[height % quorum.length]
   ```
2. **Block Proposal**: Proposer creates block from mempool
3. **Approval Collection**: 2/3+ signatures required
4. **Finalization**: Block committed when quorum reached

**Quorum Structure**:
```
quorum = [(signer1, weight1), (signer2, weight2), ..., threshold]
```

### 4.2 Channel Consensus

Future 2-party consensus for channels:
- Both parties must sign state updates
- Hash-time locked contracts (HTLCs) for atomic swaps
- Dispute resolution through on-chain depositories

### 4.3 Timeout Handling

Entities have configurable timeouts (default 30s) to prevent stuck proposals:
```typescript
if (entity.stage === 'proposed' && isTimedOut(proposal.timestamp, timeoutMs)) {
  // Revert to idle, return transactions to mempool
}
```

## 5. Storage Architecture

### 5.1 Storage Layers

1. **In-Memory State**: Primary working state
2. **Write-Ahead Log (WAL)**: Transaction durability
3. **Snapshots**: Periodic state checkpoints
4. **Block History**: Optional historical data

### 5.2 LevelDB Structure

```
/entity_state/{entityId}      # Latest entity snapshots
/entity_blocks/{entityId}/    # Historical blocks
/server_blocks/{height}       # Server block history
/wal/{height}                # Write-ahead log entries
```

### 5.3 Persistence Strategy

**Every 100ms (configurable)**:
1. Process mempool
2. Create blocks for entities
3. Write to WAL
4. Update in-memory state
5. Periodically snapshot (every N blocks)

**Recovery Process**:
1. Load latest snapshot
2. Replay WAL entries since snapshot
3. Resume normal operation

### 5.4 State Hashing

Deterministic hashing ensures consensus:
```typescript
// Canonical form for consistent hashing
const toCanonical = (obj: any): any => {
  if (obj instanceof Set) return Array.from(obj).sort();
  if (obj instanceof Map) return sortedMapEntries(obj);
  if (typeof obj === 'bigint') return obj.toString();
  // ... handle all types deterministically
};
```

## 6. Transaction Flow

### 6.1 Transaction Lifecycle

1. **Submission**: Client submits ServerTx to server mempool
2. **Routing**: Server routes to appropriate signer/entity
3. **Validation**: Entity validates against current state
4. **Proposal**: Proposer includes in block
5. **Consensus**: Collect signatures (if multi-sig)
6. **Execution**: Apply state changes
7. **Finalization**: Update merkle root, persist

### 6.2 Transaction Types

**Wallet Protocol**:
- `transfer`: Move funds between entities
- `burn`: Destroy tokens
- `credit`: Internal operation from transfers

**Entity Operations**:
- `addTx`: Add transaction to mempool
- `proposeBlock`: Create new block
- `approveBlock`: Vote on proposed block
- `commitBlock`: Finalize approved block

### 6.3 Message Flow

Outbox pattern for inter-entity communication:
```typescript
// Entity generates outbox messages during tx processing
const messages: OutboxMsg[] = [];
if (op.type === 'transfer') {
  messages.push({
    from: entityId,
    to: op.to,
    command: {
      type: 'addTx',
      tx: { op: 'credit', data: { amount, from, _internal: true } }
    }
  });
}
```

## 7. Cross-Jurisdictional Operations

### 7.1 Architecture Overview

```
Jurisdiction-1                    Jurisdiction-2
┌─────────┐                      ┌─────────┐
│ Alice-1 │◄──── Channel ────►  │  Hub-2  │
└─────────┘                      └─────────┘
┌─────────┐                      ┌─────────┐
│  Hub-1  │◄──── Channel ────►  │ Alice-2 │
└─────────┘                      └─────────┘
```

### 7.2 HTLC-Based Swaps

**Binary Granularity System**:
- 8 independent hashlocks = 8 bits = 256 granules
- Each bit represents 2^n granules
- Allows partial execution with minimal on-chain data

**Swap Protocol**:
1. Hub creates recv-lock with 8 hashes in jurisdiction B
2. Alice creates mirror send-lock in jurisdiction A  
3. Hub reveals needed preimages for execution amount
4. Alice claims equivalent in other jurisdiction

**Timeout Structure**:
```
TA (Alice's lock) = now + 30 min
TB (Hub's lock) = TA + 30 min
```

### 7.3 Zero On-Chain Transactions

In happy path, swaps complete entirely off-chain:
1. Channels pre-funded with collateral/credit
2. Conditional payments added to channel state
3. Secrets revealed to claim payments
4. Only disputes go on-chain

## 8. Protocol Implementation

### 8.1 Wallet Protocol

Core protocol for value transfer:

```typescript
type WalletState = {
  balance: bigint;
  nonce: number;
};

type WalletOp = 
  | { type: 'credit'; amount: bigint; from: EntityId }
  | { type: 'burn'; amount: bigint }
  | { type: 'transfer'; amount: bigint; to: EntityId };
```

**Nonce Policy**: Credits increment receiver's nonce to prevent replay.

### 8.2 Protocol Registry

Extensible protocol system:
```typescript
type Protocol<TState, TOp> = {
  name: string;
  validateTx: (tx: EntityTx) => Result<TOp>;
  applyTx: (state: TState, op: TOp) => Result<TState>;
  generateMessages?: (from: EntityId, op: TOp) => OutboxMsg[];
};
```

### 8.3 Future Protocols

- **Channel Protocol**: Bilateral payment channels
- **Hub Protocol**: Order matching and routing
- **DAO Protocol**: Governance and proposals
- **Depository Protocol**: External chain bridges

## 9. Network Communication

### 9.1 Current Implementation

Single-process simulation where all entities exist in one server:
- Outbox messages loop back to inbox
- No actual networking required
- Pure functional message passing

### 9.2 Future Architecture

**P2P Layer** (libp2p or Signal Protocol):
- Encrypted entity-to-entity messaging
- Gossip protocol for entity directory
- Direct connections between signers

**Entity Directory**:
```typescript
type EntityInfo = {
  entityId: string;
  quorum: string[];
  proposer: SignerIdx;
  jurisdiction: string;
};
```

## 10. Security Model

### 10.1 Trust Assumptions

1. **Intra-Entity**: Trust quorum members (2/3+ honest)
2. **Inter-Entity**: No trust required (HTLCs)
3. **Jurisdictional**: Trust blockchain finality
4. **Channel**: Trust bilateral counterparty or dispute mechanism

### 10.2 Security Properties

- **No Double Spend**: Nonce-based replay protection
- **No Fund Loss**: Timeout-based recovery
- **Dispute Resolution**: On-chain depositories
- **Quorum Changes**: Grace period for transitions

### 10.3 Attack Vectors & Mitigations

1. **Proposer Censorship**: Timeout forces new round
2. **Partial Revelation**: Binary masks hide amounts
3. **Channel Griefing**: Credit limits cap exposure
4. **State Availability**: Each party keeps own data

## Appendix A: Implementation Status

### Implemented (v2.2)
- ✅ Core server/entity state machines
- ✅ Single-signer entity consensus  
- ✅ Multi-signer quorum consensus
- ✅ Wallet protocol with transfers
- ✅ WAL and snapshot persistence
- ✅ Nonce-based replay protection
- ✅ Memory storage with LevelDB interface

### Not Yet Implemented
- ❌ Channel state machines
- ❌ Cross-jurisdictional swaps
- ❌ Hub order matching
- ❌ Credit line system
- ❌ P2P networking
- ❌ On-chain depositories
- ❌ Merkle tree state proofs

## Appendix B: Design Decisions

### Why Not Classes?
Pure functional approach chosen for financial system reliability:
- Easier to test and verify
- No hidden state mutations
- Clear data flow
- Better for formal verification

### Why Local Consensus?
- Scales infinitely (no global bottleneck)
- Participants only process what they care about
- Natural sharding by entity
- No MEV or front-running

### Why 100ms Blocks?
- Human-perceivable as "instant"
- Allows batching for efficiency
- Provides regular checkpoints
- Matches modern exchange latencies