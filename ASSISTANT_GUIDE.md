# Assistant Guide - XLN Minimalist Actor Model

## Overview
This is a minimalist actor-based blockchain framework implementing hierarchical distributed state machines. The system uses message-passing architecture with actors representing isolated state machines.

## Recent Major Changes

### 1. Branded Types Implementation
- Added branded types in `types.ts` for type safety:
  - `EntityId`, `SignerIdx`, `BlockHeight`, `BlockHash`, `TxHash`
  - Type constructors: `toEntityId()`, `toSignerIdx()`, etc.
  - Type guards: `isEntityId()`, `isSignerIdx()`, etc.
- Result type for error handling: `Result<T, E>`
- Error types: `ValidationError`, `NotFoundError`, `UnauthorizedError`

### 2. Architectural Improvements
- **Entity Isolation**: Entities no longer need registry access
  - `generateTransferMessages()` only specifies target entity ID
  - `routeMessages()` handles signer lookup server-side
  - `OutboxMsg.toSigner` is now optional
- **Chain Integrity**: Added `lastBlockHash` to `EntityState` and `ServerState`
- **Replay Protection**: 
  - `lastProcessedHeight` tracks processed blocks per entity
  - WAL entries use target height, not current height
  - Recovery filters based on processed heights

### 3. Content-Addressed Storage
- Git-like immutable archive system:
  - `ArchiveEntry` type with parent hash chains
  - `archiveSnapshot()` creates content-addressed snapshots
  - `recoverFromArchive()` loads from hash or ref
  - `getHistory()` traverses chain history
  - `getStateAtHeight()` enables time-travel queries
- Storage now includes `archive` and `refs` levels

### 4. Error Handling
- `processEntityInput()` returns `Result<[EntityState, OutboxMsg[]], ProcessingError>`
- `processServerTx()` returns `Result<[ServerState, OutboxMsg[]], ProcessingError>`
- Errors are logged but processing continues for other transactions

## Current Architecture

### Core Flow
1. **ServerTx** → **processServerTx** → **processEntityInput** → **EntityState** + **OutboxMsg[]**
2. **OutboxMsg[]** → **routeMessages** → **ServerTx[]** (added to mempool)
3. **processBlock** orchestrates the full cycle:
   - Process mempool transactions
   - Update lastProcessedHeight for touched entities
   - Save block and optional archive snapshot
   - Route messages and auto-propose for single-signers

### Key Components
- **Entity**: Account with isolated state machine
- **Signer**: Controls entities (identified by SignerIdx)
- **Registry**: Maps EntityId → EntityMeta (quorum, proposer)
- **Block**: Contains ServerTx[], processed sequentially
- **WAL**: Write-ahead log for crash recovery
- **Archive**: Immutable snapshots with parent hash chains

### Consensus Flow
1. **add_tx**: Add transaction to entity mempool
2. **propose_block**: Create block proposal (single-signer: immediate commit)
3. **approve_block**: Vote on proposal (multi-signer only)
4. **commit_block**: Finalize when quorum reached

## Known Issues & TODOs

### ✅ 1. DAO Governance in Simulation (FIXED)
The DAO voting simulation was getting stuck with only 1 approval.
**Solution**: Modified message flow to broadcast propose_block to ALL signers, who then send approve_block messages to everyone. The consensus flow now works correctly.

### ✅ 2. Type Conversions (COMPLETED)
Manual type conversions have been cleaned up.
**Solution**: Created `typeHelpers.ts` with validated conversion functions:
- `parseSignerIdx()`, `parseBlockHeight()`, `parseEntityId()`
- `incrementBlockHeight()`, `nextBlockHeight()`
- `mapToSignerIdx()`, `signerIdxFromAny()`

### ✅ 3. Error Recovery (COMPLETED)
Improved error handling with collection and severity system.
**Solution**: Created `errorHandling.ts` with:
- `ErrorCollector` class for aggregating errors
- Severity levels: DEBUG, WARNING, ERROR, CRITICAL
- Context tracking (entity, signer, operation, height)
- `CollectedResult` type for batch operations
- Critical errors stop processing, others allow continuation

### 4. Performance Considerations
- The current functional approach in `processMempool` processes transactions sequentially
- Could parallelize read operations while keeping writes sequential
- Archive snapshots could be done asynchronously

## Testing Guidelines

### Running Tests
```bash
bun clean           # Remove data directory
bun demo.ts basic   # Run basic simulation
bun demo.ts dao     # Test DAO governance
bun demo.ts all     # Run all scenarios
```

### What to Test
1. **Replay Protection**: Kill process mid-block, restart, ensure no double processing
2. **Archive Recovery**: Create snapshots, recover from old heights
3. **Multi-signer Flow**: Ensure proposals → approvals → commits work
4. **Transfer Messages**: Verify cross-entity transfers via message routing

## Code Style Guidelines

1. **Use Branded Types**: Always use `EntityId`, `SignerIdx`, etc., not raw strings/numbers
2. **Return Results**: Use `Result<T, E>` for operations that can fail
3. **Pure Functions**: Keep entity logic pure, side effects only in server layer
4. **Explicit Errors**: Don't silently ignore errors, at least log them
5. **Type Assertions**: Avoid `as` casts, use type guards and constructors

## Common Patterns

### Adding a New Entity Operation
1. Add to `EntityTx` type
2. Handle in `applyEntityTx()`
3. Update `generateTransferMessages()` if needed
4. Add validation in `processEntityInput()`

### Adding Storage Migration
1. Update serialization/deserialization functions
2. Add compatibility handling in `loadSnapshot()`
3. Consider archive format compatibility

### Debugging Tips
- Enable debug logging by checking console.debug calls
- Use `getStateAtHeight()` to inspect historical states
- Check WAL entries for replay issues
- Verify registry state for routing problems

## Architecture Principles

1. **Actor Isolation**: Entities don't know about each other's internals
2. **Message Passing**: All communication via messages
3. **Deterministic Replay**: Same inputs → same outputs
4. **Crash Recovery**: WAL ensures no lost transactions
5. **Type Safety**: Branded types prevent silly mistakes

## Next Steps

1. ~~**Fix DAO Simulation**~~ ✅ Already fixed (see TODO #1)
2. **Add Metrics**: Transaction throughput, block times, message routing stats
3. **Optimize Storage**: Consider compression for archive entries
4. **Network Layer**: Add P2P message routing between servers
5. **Better CLI**: Interactive commands for debugging and inspection

Remember: This is a minimalist implementation. Keep it simple and correct before optimizing.