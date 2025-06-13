# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a minimalist actor-based blockchain framework implementing hierarchical distributed state machines. The system uses message-passing architecture similar to browser postMessage, with actors representing isolated state machines.

## Development Commands

### Running the Project
- `bun start` or `bun demo.ts` - Run demo scenarios
- `bun dev` - Run server with watch mode
- `bun demo:basic` - Run basic demo scenario
- `bun demo:stress` - Run stress test scenario
- `bun demo:dao` - Run DAO governance scenario
- `bun demo:hub` - Run payment hub scenario
- `bun demo:economy` - Run economy scenario
- `bun demo:all` - Run all scenarios
- `bun clean` - Remove data directory
- `bun fresh` - Clean data and run basic demo

### Runtime Requirements
- Uses **Bun** runtime (not Node.js)
- No build step required - TypeScript files run directly
- No test framework configured
- No linter configured

## Architecture

### Core Components

1. **server.ts** - Main implementation
   - Actor model with isolated state machines
   - Block processing and consensus
   - Message routing between entities
   - State persistence using LevelDB
   - Handles EntityTx (entity transactions) and ProposedBlock types

2. **simulation.ts** - Testing framework
   - Scenario definitions (basic, stress, dao, hub, economy)
   - Entity behavior profiles
   - Transaction generation logic

3. **demo.ts** - CLI entry point
   - Orchestrates simulation runs
   - Command-line interface for scenarios

### Hierarchical Structure
- **Server** → **Signer** → **Entity** → **Channel**
- Each level has its own state machine
- Message passing between levels
- No inter-server consensus (each server has independent blockchain)

### State Management
- Uses LevelDB for persistence (creates `data/` directory)
- RLP encoding for serialization
- Checkpoint system for state recovery

### Key Concepts
- **Entity**: Account managed by one or more signers
- **Signer**: Controls entities, can be EOA or multisig
- **Channel**: Bilateral state channels between entities
- **Block**: Contains entity transactions, no direct transfers
- **Message**: Communication between state machines

## Important Implementation Details

- All state modifications happen through message passing
- No shared state between actors
- Entities can have multiple signers (for DAO functionality)
- Payment hubs use bilateral channels for transfers
- Each server maintains its own blockchain
- Snapshots saved periodically for recovery

## Documentation

Detailed specifications are available in the `docs/` directory:
- `overview.md` - Comprehensive technical specification
- `types.md` - TypeScript type definitions (reference only)
- `spec.md`, `concerns.md`, `exampleState.md` - Additional documentation