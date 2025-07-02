# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XLN (Cross-Ledger Network) is a programmable trust network that reimagines blockchain architecture through hierarchical autonomous state machines. It replaces traditional Layer 2 solutions with a Jurisdiction → Entity → Account model.

## Architecture

### Hierarchical State Machines
```
Server (Pure Router)
  └── Signer (Key Management) 
      └── Entity (Business Logic)
          └── Account/Channel (Bilateral State)
```

### Key Design Principles
- **Pure Functional**: No classes, only pure functions and interfaces
- **Machine Isolation**: Each machine has inbox/outbox, no shared state
- **Deterministic Execution**: Same inputs always produce same outputs
- **Local State**: Each entity manages its own LevelDB instance

### Core Components

1. **Server Machine** (`src/core/server.ts`)
   - Routes messages to entities
   - No business logic, pure routing
   - Manages entity registry

2. **Entity Machine** (`src/core/entity.ts`)
   - Business logic container
   - Quorum-based consensus (proposer + validators)
   - Generates outbox messages for inter-entity communication

3. **Storage Layer**
   - LevelDB for persistence
   - RLP encoding throughout
   - Separate state snapshots and block history
   - Write-ahead log for crash recovery

### Transaction Flow
1. `Input` → routes to entity via server
2. `Command` → processed by entity machine
3. `Frame` → consensus on transaction batch
4. `Hanko` → BLS aggregate signature finalizes block
5. Outbox messages → routed after block finalization

## Project Structure

XLN uses a strict core ⇄ effects layering architecture where all protocol rules are isolated in pure modules, and all I/O operations are handled by outer effects layers.

### Pure Core
- `src/protocols.ts` - Registry of all entity types
- `src/core/server.ts` - Server state machine (reducers)
- `src/core/entity.ts` - Entity state machine (proposer/validator)
- `src/types.ts` - Core type definitions

### Shared Utilities (Pure)
- `src/crypto.ts` - BLS signatures, hashing
- `src/codec/*.ts` - RLP encoding/decoding
- `src/fp.ts` - Functional programming utilities
- `src/validation/*.ts` - Input validation

### Effects Layer
- `src/effects/*.ts` - Persistence modules
- `src/runtime.ts` - Server runtime with I/O

### Entry Points
- `src/index.ts` - Library exports
- `src/bin/xln.ts` - Executable entry

**Key Rule**: All pure/core business logic must have no side-effects. I/O operations (database, network, logging) must be isolated in effects modules.

## Development Commands

```bash
# Install dependencies (using Bun)
bun install

# Run the project
bun run src/index.ts

# Run tests
bun test
# or
npm test

# Watch tests during development
npm run test:watch

# Run with coverage
npm run test:coverage

# Type checking
npm run typecheck

# Linting (when configured)
npm run lint
```

## Development Guidelines

### Code Style
- Use pure functions exclusively
- RLP encoding for all data structures
- TypeScript with strict typing
- 100ms processing cycles for machines

### Testing Approach
- Vitest for unit tests
- Property-based testing with fast-check
- Test files in `/tests/` directory
- Use REPL interface for debugging: `runtime.injectClientTx()`, `runtime.tick()`
- Focus on deterministic execution property

### Important Concepts
- **Credit Lines**: Replace liquidity pools, start at zero capacity
- **No Global Consensus**: Only entity-level and channel-level consensus
- **Outbox Pattern**: Fire-and-forget message delivery between entities
- **Simplified Tendermint**: No prevote stage, just propose → vote → execute

## Documentation Structure
- `/docs/spec.md` - XLN v1.3 Unified Technical Specification
- `/docs/index.md` - Documentation hub with navigation
- `/docs/architecture.md` - Layered architecture overview
- `/docs/data-model.md` - TypeScript types and encoding
- `/docs/consensus.md` - Frame/Hanko consensus mechanism
- `/docs/walkthrough.md` - Step-by-step chat example
- See `/docs/` for complete v1.3 documentation set