# Core Components Documentation

## Overview

The system is built around several core components that work together to provide secure, efficient payment channel functionality. This document details these components and their interactions.

## Channel

The `Channel` class is the primary component that manages the payment channel state and operations.

### Key Features

- State management using HSTM (Hierarchical State-Time Machine)
- Merkle tree-based state verification
- Support for atomic swaps and conditional payments
- Subchannel management for different tokens/chains

### State Structure

```typescript
interface IChannelState {
  channelId: string;
  left: string;
  right: string;
  nonce: number;
  subchannels: { [key: string]: ISubchannel };
  signatures: ISignature[];
  merkleRoot?: string;
  blockId?: number;
}
```

### Key Methods

- `initialize()`: Sets up the channel with initial state
- `openSubchannel()`: Creates a new subchannel for token transfers
- `updateBalance()`: Updates subchannel balances
- `signState()`: Signs the current channel state
- `applyBlock()`: Applies a block of transitions to the channel

## Block

Blocks are used to batch multiple state transitions together for efficient processing.

### Structure

```typescript
interface IBlock {
  blockId: number;
  isLeft: boolean;
  timestamp: number;
  transitions: ITransition[];
}
```

### Usage

- Groups related transitions together
- Provides atomic execution of multiple state changes
- Enables efficient state synchronization between participants

## HSTM (Hierarchical State-Time Machine)

The HSTM component provides reliable state management with temporal tracking.

### Key Components

- `IStorageService`: Interface for persistent storage
- `ISnap`: Interface for state snapshots
- `ISTM`: Interface for the state machine instance

### Features

- Persistent state storage
- State transition validation
- Temporal state tracking
- Efficient caching mechanism

## Merkle Tree

The Merkle tree implementation provides efficient state verification and proof generation.

### Features

- Configurable hash algorithm
- Batch processing support
- Proof generation and verification
- Efficient storage mechanism

### Usage

```typescript
const merkleTree = createMerkleTree({
  batchSize: 16,
  hashAlgorithm: 'sha256'
});

// Build tree from values
merkleTree.build(values);

// Generate proof
const proof = merkleTree.getProof(value);

// Verify proof
const isValid = merkleTree.verify(value, proof);
```

## Transitions

Transitions represent state changes in the channel.

### Types

- Payment transitions
- Swap transitions
- Subchannel transitions
- Dispute resolution transitions

### Structure

```typescript
interface ITransition {
  type: TransitionType;
  timestamp: number;
  blockNumber: number;
  apply(channel: Channel): Promise<void>;
  verify(channel: Channel): Promise<boolean>;
}
```

## Storage

The system uses LevelDB for persistent storage with a flexible interface.

### Features

- Key-value storage
- Binary data support
- Atomic operations
- Error handling

### Usage

```typescript
const storage = new LevelStorageService('./db-path');

// Store data
await storage.put(key, value);

// Retrieve data
const value = await storage.get(key);

// Delete data
await storage.delete(key);
```

## Error Handling

The system includes specialized error classes for different components:

- `ChannelError`: Channel-related errors
- `MerkleError`: Merkle tree operation errors
- `HSTMError`: State machine errors

### Example

```typescript
try {
  await channel.applyTransition(transition);
} catch (error) {
  if (error instanceof ChannelError) {
    // Handle channel-specific error
  } else if (error instanceof MerkleError) {
    // Handle Merkle tree error
  } else {
    // Handle other errors
  }
}
```

## Best Practices

1. **State Management**
   - Always use atomic operations for state changes
   - Validate state transitions before applying
   - Maintain proper state synchronization between participants

2. **Error Handling**
   - Use appropriate error types
   - Provide detailed error messages
   - Implement proper error recovery

3. **Performance**
   - Use batching for multiple transitions
   - Implement efficient caching
   - Optimize Merkle tree operations

4. **Security**
   - Validate all state transitions
   - Verify signatures and proofs
   - Implement proper access control 