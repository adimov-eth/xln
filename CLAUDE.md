# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XLN v2 is a distributed ledger/blockchain system implementing a Byzantine Fault Tolerant (BFT) consensus protocol. The project is written in TypeScript and runs on Bun runtime, following functional programming principles with immutable data structures.

## Architecture

### Core Components

1. **Entity System** (`src/core/entity.ts`)
   - Implements a Finite State Machine (FSM) for entity lifecycle management
   - States: Initializing → Ready → Dead (with error state transitions)
   - Handles transaction processing with deterministic state updates
   - Uses Write-Ahead Log (WAL) for crash recovery

2. **Server System** (`src/core/server.ts`)
   - Pipeline-based architecture for block processing
   - Modular steps: validate, propose, apply
   - Supports both synchronous and asynchronous operations
   - Extensible through custom pipeline steps

3. **Protocol System** (`src/core/protocol.ts`)
   - Defines transaction types and validation rules
   - Each protocol has ValidatorId and implements validation/application logic
   - Current protocols: ProposeBlock, ApproveBlock
   - Extensible for custom transaction types

### Type System

The codebase uses branded types extensively for type safety:
- `EntityId`, `SignerIdx`, `BlockHeight`, `BlockHash` - Core identity types
- `EntityKind` - Discriminated union for entity types
- Result types for error handling (Ok/Err pattern)
- All types are immutable by design

### Storage System

Abstract storage layer with multiple implementations:
- **KVStore**: Generic key-value interface
- **State Store**: Entity state persistence
- **WAL Store**: Write-ahead logging
- **Block Store**: Approved blocks storage
- **Archive Store**: Transaction archive
- Current implementation: In-memory storage (easily replaceable)

## Key Design Principles

1. **Functional Programming**: Pure functions, immutable data, no side effects
2. **Type Safety**: Extensive use of TypeScript's type system for compile-time guarantees
3. **Determinism**: All operations must be deterministic for consensus
4. **Modularity**: Clear separation of concerns with well-defined interfaces
5. **Extensibility**: Protocol system allows adding new transaction types

## Consensus Protocol

- BFT consensus requiring 2/3 majority for block approval
- Block proposals include transactions and require approval from other entities
- Quorum calculation: `Math.floor((2 * totalSigners) / 3) + 1`
- All signers have unique indices for vote tracking

## Data Flow

1. Transaction created → Validated by protocol → Applied to entity state
2. Entity proposes block → Other entities validate → Approval transactions sent
3. Quorum reached → Block committed → State finalized
4. All state changes logged to WAL before application

## Security Considerations

- Signer validation on all transactions
- State transitions only through validated transactions
- Crash recovery through WAL replay
- Immutable data structures prevent accidental mutations

## Development Setup

```bash
# Install Bun runtime
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Run the application
bun run index.ts
```

## Key Extension Points

1. **New Transaction Types**: Add to `src/core/protocol.ts`
2. **Custom Pipeline Steps**: Extend server pipeline in `src/core/server.ts`
3. **Storage Backends**: Implement KVStore interface in `src/storage/`
4. **Entity Types**: Add new EntityKind variants in `src/types/`

## Development Best Practices

1. Always use Result types for operations that can fail
2. Keep functions pure - no side effects in core logic
3. Use branded types for domain concepts (don't use raw strings/numbers)
4. Validate all external inputs at system boundaries
5. Write deterministic code - same inputs must always produce same outputs

## Common Patterns

### Adding a New Transaction Type

1. Define the transaction data structure in `src/types/`
2. Create a protocol validator in `src/core/protocol.ts`
3. Implement validation logic (check permissions, data integrity)
4. Implement application logic (state mutations)
5. Register protocol in the protocol map

### Working with Storage

Storage operations follow a consistent pattern:
- All keys are prefixed by store type
- Use Result types for error handling
- Abstract over storage implementation details
- Keep storage logic separate from business logic

### Error Handling

The codebase uses a Result type pattern:
```typescript
const result = someOperation();
if (result.kind === 'Err') {
  // Handle error
  return result;
}
// Use result.value safely
```

## Testing Approach

While no tests exist yet, the architecture supports:
- Unit testing pure functions
- Integration testing with in-memory storage
- Protocol testing by simulating transactions
- Consensus testing with multiple entity instances

## Performance Considerations

- In-memory storage is fast but not persistent
- Pipeline steps can be async for I/O operations
- Consider batching for better throughput
- WAL writes are the main bottleneck for persistence