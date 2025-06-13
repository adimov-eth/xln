# Minimalist Actor Model Blockchain

A clean, functional implementation of an actor-based blockchain framework with hierarchical distributed state machines.

## Architecture

This project implements a blockchain using the actor model with:
- **Pure functional core** - Side-effect free state transitions
- **Type-safe design** - Branded types and discriminated unions
- **Modular structure** - Clean separation of concerns
- **WAL atomicity** - Proper crash recovery with write-ahead logging

## Project Structure

```
├── core/
│   ├── types/         # Core type definitions with branded types
│   ├── entity/        # Pure entity state machine (FSM)
│   └── server/        # Block processing pipeline
├── storage/
│   ├── interfaces.ts  # Storage abstractions
│   ├── implementations.ts # Storage adapters
│   └── kvMemory.ts    # In-memory KV store for testing
├── utils/
│   └── pipeline.ts    # Pipeline composition utilities
└── tests/
    └── singleSigner.test.ts # Test suite
```

## Key Features

### Type Safety
- Branded types prevent mixing up IDs and indices
- Discriminated unions for entity states (Idle, Proposed, Committing, Faulted)
- Result types for explicit error handling

### Pure Functional Core
- Entity state transitions are pure functions
- No side effects in core logic
- Easy to test and reason about

### Pipeline Architecture
- Block processing uses composable pipeline steps
- Proper error handling with severity levels
- Critical errors abort the block, warnings are logged

### WAL Atomicity
- Transactions validated before WAL write
- WAL written atomically before state changes
- Block aborted if WAL write fails
- Ensures consistency on crashes

## Usage

### Running Tests
```bash
bun test                 # Run all tests
bun test --watch        # Run tests in watch mode
bun clean               # Clean data directory
```

### Example
```typescript
import { createStorage, processBlock } from './index';
import { MemoryKV } from './storage/kvMemory';

// Create storage
const kv = new MemoryKV();
const storage = createStorage(kv);

// Process a block
const result = await processBlock(server, storage);
if (!result.ok) {
  console.error('Block failed:', result.error);
} else {
  server = result.value;
}
```

## Entity State Machine

The entity FSM has four states:
- **Idle** - Ready to accept transactions
- **Proposed** - Block proposal in progress
- **Committing** - Quorum reached, committing block
- **Faulted** - Terminal error state

State transitions are handled by the pure `transitionEntity` function.

## Storage Abstraction

The storage layer uses a simple KV interface:
```typescript
interface KV {
  get(key: string): Promise<string | undefined>;
  put(key: string, val: string): Promise<void>;
  del(key: string): Promise<void>;
  batch(ops: BatchOp[]): Promise<void>;
}
```

This allows swapping between in-memory storage for tests and LevelDB for production.

## Development

The codebase follows functional programming principles:
- Immutable data structures
- Pure functions where possible
- Explicit error handling
- Type-driven design

## License

MIT