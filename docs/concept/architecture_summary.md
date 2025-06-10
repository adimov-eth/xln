# XLN Architecture Summary - Current Design

## Overview

XLN is a programmable trust network built on a **simplified 3-layer hierarchy** of autonomous state machines. This document describes the current architecture after recent simplifications.

## Core Architecture

### 3-Layer Hierarchy

```
Server (routing + state management)
  └── Entity (consensus + business logic)  
        └── Account (channel operations)
```

**Key Principle**: Each layer is a separate state machine with its own consensus rules and data structures.

## Understanding "Signer"

### What Signer IS:
- **Organizational grouping concept** - groups entities by ownership
- **Cryptographic identity** - derives private keys from server master secret
- **Key derivation index** - signer[0], signer[1], signer[2]... generate different keys
- **Signing authority** - provides cryptographic signatures for entity operations

### What Signer IS NOT:
- ❌ **Not a separate machine layer**
- ❌ **Not a processing unit**  
- ❌ **Not a consensus mechanism**

### Data Structure

```typescript
type ServerState = {
  height: number;
  signers: EntityState[][];  // signers[signerIndex][entityIndex]
  mempool: ServerTx[];
};

type ServerTx = {
  signerIndex: number;  // which cryptographic identity
  entityIndex: number;  // which entity in that signer's group
  input: EntityInput;   // what to do with that entity
};
```

### Example Organization

```
Signer[0] = "Alice's signing key" → owns entities [PersonalWallet, TradingBot]
Signer[1] = "Bob's signing key" → owns entities [Company, Savings]  
Signer[2] = "DAO's signing key" → owns entities [Treasury, Governance]
```

## Processing Flow

### 1. Transaction Routing

```typescript
function applyServerTx(state: ServerState, tx: ServerTx): ServerState {
  // Direct access via signer organizational grouping
  const entity = state.signers[tx.signerIndex]?.[tx.entityIndex];
  if (!entity) return state;
  
  // Apply entity logic directly - no intermediate layer
  const updated = applyEntityInput(entity, tx.input);
  state.signers[tx.signerIndex][tx.entityIndex] = updated;
  
  return state;
}
```

### 2. Entity Processing

```typescript
function applyEntityInput(entity: EntityState, input: EntityInput): EntityState {
  if (input.kind === 'add_tx') {
    return { ...entity, mempool: [...entity.mempool, input.tx] };
  }
  
  if (input.kind === 'propose_block') {
    return { 
      ...entity, 
      proposedBlock: { txs: entity.mempool, hash: hashBlock(entity.mempool) }
    };
  }
  
  // Other input types...
  return entity;
}
```

## Key Benefits of Simplified Architecture

### Removed Complexity
- ❌ Signer machines as separate state machines
- ❌ Four-layer hierarchy (Server → Signer → Entity → Account)
- ❌ Intermediate consensus layer
- ❌ Complex routing between machine layers

### Achieved Improvements  
- ✅ **Cleaner conceptual model**: Direct Server → Entity communication
- ✅ **Better performance**: No intermediate state management overhead
- ✅ **Simpler reasoning**: Fewer layers to understand and debug
- ✅ **Maintained functionality**: Entity grouping and cryptographic signing preserved
- ✅ **Easier testing**: Fewer integration points between layers

## Transaction Types

### Server Level
```typescript
type ServerTx = {
  signerIndex: number;
  entityIndex: number;  
  input: EntityInput;
};
```

### Entity Level
```typescript
type EntityInput =
  | { kind: 'add_tx'; tx: EntityTx }
  | { kind: 'propose_block' }
  | { kind: 'commit_block'; blockHash: string };

type EntityTx = {
  op: string;
  data: any;
};
```

### Account Level
```typescript
type AccountInput =
  | { kind: 'transfer'; amount: number; to: string }
  | { kind: 'credit_limit'; limit: number }
  | { kind: 'dispute'; evidence: any };
```

## State Management

### Storage Strategy
- **Entity State**: `signers[i][j]` where i=signerIndex, j=entityIndex
- **Persistence**: LevelDB with periodic snapshots + write-ahead log
- **Recovery**: Load last snapshot + replay remaining history
- **Integrity**: Server hash = RLP(all entity states grouped by signer)

### Memory vs Disk
- **Memory**: All active state, mempool, processing
- **LevelDB**: Snapshots, history log, entity blocks  
- **Flush Frequency**: Every 100ms server processing cycle

## Consensus Model

### Entity Consensus
- **Proposer**: First signer in entity quorum
- **Quorum**: Array of [signer, weight] pairs + threshold (e.g., 67%)
- **Process**: Propose → Sign → Finalize (simplified Tendermint)
- **No prevote**: Direct signature collection

### Signature Verification
- **Entity blocks**: Signed by proposer, countersigned by quorum
- **Automatic signing**: If hash matches expected result
- **Finalization**: When threshold reached (e.g., 67% of weights)

## Alternative Naming

The founder has mentioned potential alternative names for "Signer":
- **Sigil** - emphasizing the symbolic/identifier aspect
- **Clavis** - emphasizing the key/access aspect

Current preference remains **Signer** for clarity and developer familiarity.

## Migration from Previous Architecture

### What Changed
- Removed `SignerState` and `SignerMachine` concepts
- Flattened `Server → Signer → Entity` to `Server → Entity`
- Simplified `ServerInput` to `ServerTx` with direct entity addressing
- Updated processing pipeline to eliminate intermediate layer

### What Stayed the Same
- Entity and Account machine concepts unchanged
- Business logic and consensus rules preserved  
- Storage and persistence strategy maintained
- Core functional programming approach retained

## Next Steps

This simplified architecture provides a solid foundation for:
1. **Core implementation** - basic server, entity, and account machines
2. **Consensus layer** - proposal/voting mechanisms within entities  
3. **Channel operations** - bilateral account state management
4. **Network layer** - when ready to scale beyond single-server simulation
5. **Security layer** - signatures, access control, dispute resolution

The architecture is now "Kalashnikov-reliable" - simple, robust, and easy to understand and maintain. 