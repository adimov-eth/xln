# Distributed State Machine Architecture - Technical Specification

## Overview

This document describes a hierarchical distributed state machine architecture designed for scalable blockchain applications. The system implements an Actor model where isolated machines communicate through message passing, with a focus on state channels and off-chain computation.

## Core Architecture

### Machine Hierarchy

The system consists of three primary layers:

```
Server (Root Machine)
  └── Signer Machines
       └── Entity Machines
            └── Channel Machines
```

**Key Principle**: Each server maintains its own independent blockchain. There is no consensus between servers - they only exchange messages. 

### Machine Types

| Machine Type | Purpose | Can Spawn Sub-machines | Storage Key Length |
|-------------|---------|------------------------|-------------------|
| **Server** | Root coordinator, message routing | Yes (Signers) | 0 bytes (empty) |
| **Signer** | Key management, entity ownership | Yes (Entities) | 32 bytes |
| **Entity** | Business logic, DAO, account management | Yes (Channels) | 64 bytes |
| **Channel** | Bilateral state channels | No | 96 bytes |
| **Depository** | Ethereum bridge, dispute resolution | No | 64 bytes |

### Actor Model Implementation

- Each machine is a fully isolated actor with private state
- Communication happens exclusively through message passing
- Machines can spawn sub-machines (except Channels)
- Similar to browser windows using postMessage

## State Management

### Storage Architecture

**Primary Storage**: LevelDB with buffer encoding
- Keys: Concatenated machine IDs (up to 96 bytes)
- Values: RLP-encoded state objects
- Two-tier storage:
  - `state` table: Mutable snapshots
  - `history` table: Immutable block log

### State Structure

```
Server State:
├── blockNumber
├── lastBlockHash
├── signerHashes (Map<SignerId, Hash>)
└── sub-machines (Map<SignerId, SignerState>)

Entity State:
├── nonce
├── proposals (Map)
├── channelMap (Map<ChannelId, ChannelState>)
├── orderBook (for hub entities)
└── paymentMap
```

### Snapshot Types

1. **Mutable Snapshots**: Stored by sequential machine IDs, can be overwritten
2. **Immutable Snapshots**: Stored by hash (Merkle-DAG style), permanent archive

## Transaction Flow

### Transaction Types

1. **Signer Transactions**
   - Origin: User wallets via WebSocket
   - Purpose: Create proposals, vote, administrative actions
   - Authenticated by token/key

2. **Entity Consensus Messages**
   - Origin: Entity validators during consensus
   - Purpose: Block proposals, signature collection
   - Used in multi-signer entities

3. **Channel Transactions**
   - Origin: Post-consensus entity decisions
   - Purpose: Balance shifts, payment routing
   - Executed after entity consensus

### Message Flow Example (Payment)

```
User A → Entity A → Channel(A,Hub) → Hub Entity → Channel(Hub,B) → Entity B → User B
```

1. User A initiates payment via signer transaction
2. Entity A creates channel transaction
3. Channel shifts balance delta
4. Hub entity processes and routes
5. Recipient channel updates
6. Entity B notifies User B

## Block Processing

### Server Block Cycle (100ms)

1. **Collect Mempool**: Gather pending transactions
2. **Reduce State**: Apply transactions to state machines
3. **Build Block**: Create block with state changes
4. **Collect Signatures**: Gather validator signatures (if multi-sig)
5. **Finalize**: Compute root hash, write to LevelDB
6. **Emit Events**: Propagate events downward

### Block Structure

```javascript
Block = {
  previousBlock: Hash,
  transactions: RLP(MemPoolBuffer),
  receipts: Array<Event>,
  stateRoot: Hash,
  timestamp: Number,
  signatures: Array<Signature> // for multi-sig entities
}
```

## Consensus Mechanisms

### Channel Consensus
- **Type**: 2-of-2 signatures
- **Participants**: Channel parties
- **Finality**: Immediate with both signatures

### Entity Consensus
- **Single-signer**: Automatic, immediate
- **Multi-signer**: Quorum-based (>67% validators)
- **Two-phase process**:
  1. Proposal accumulates votes
  2. Execute when quorum reached

### Server Consensus
- **None required**: Each server maintains independent state
- Servers only verify message signatures

## Implementation Details

### Key Encoding Scheme
```
Server:     []                    // 0 bytes
Signer:     [SignerId]           // 32 bytes  
Entity:     [SignerId][EntityId] // 64 bytes
Channel:    [SignerId][EntityId][ChannelId] // 96 bytes
```

### RLP Encoding
- Used for all state serialization
- Compact binary format
- Compatible with Ethereum

### Mempool Structure
```javascript
mempool = Map<SignerId, Set<EntityId>>
// Tracks which entities each signer touched
```

### State Updates
1. Mark modified paths as "dirty" (null hash)
2. Batch updates in memory
3. Recompute hashes bottom-up during flush
4. Write to LevelDB in single batch

## Channel Mechanics

### Balance Model
- **Collateral**: Locked from user's reserve
- **Credit**: Extended by counterparty (mainly for hubs)
- **Delta**: Signed balance shift between parties

### Channel States
- `idle`: No pending operations
- `sent`: Awaiting counterparty signatures
- `ready`: Can process new transactions

### Capacity Formula
```
Available = my_collateral + credit_granted_to_me + credit_I_extended_consumed
```

## Security Considerations

### Signature Schemes
- User signatures: Standard ECDSA
- Entity signatures: Aggregated BLS (future)
- Channel signatures: 2-of-2 multisig

### Dispute Resolution
- Channels can be disputed on-chain via Depository
- Latest signed state submitted to Ethereum
- Challenge period for counterparty response
