# XLN (Extended Lightning Network) v1

A hierarchical blockchain architecture that revolutionizes payment channel networks by solving the "inbound capacity problem" through a novel reserve-credit mechanism.

## Overview

XLN v1 implements a pure functional, deterministic state machine architecture inspired by the "Kalashnikov Principle" - ultimate reliability through simplicity. The system simulates a distributed consensus environment using a Post Office metaphor for clarity.

### Key Innovation: Reserve-Credit System

Unlike traditional payment channels that require pre-funding, XLN introduces a dual mechanism:
- **Reserve**: Collateral locked in channels
- **Credit**: Spending power that can exceed reserves
- **Solution**: Eliminates the need for inbound capacity pre-allocation

## Architecture

### Hierarchical Actor Model (5 Layers)

```
1. Server     - Post Office (message router, block producer)
2. Signer     - Board Members (BLS signers managing entities)  
3. Entity     - Companies (state machines with governance)
4. Channel    - Payment channels between entities (future)
5. Depositary - Token storage linked to entities (future)
```

### Core Components

#### Server (Post Office)
- Routes messages between signers
- Maintains global block height
- Processes transactions in 100ms ticks
- Pure functional state transitions

#### Signer (Board Member)
- Manages replicas of multiple entities
- Participates in entity consensus
- Signs blocks with BLS signatures (future)

#### Entity (Company)
- Self-contained state machine
- Multi-sig governance via quorum
- Proposer-based block production
- Deterministic state transitions

## Quick Start

### Prerequisites
- [Bun](https://bun.sh) runtime (v1.0+)
- Node.js 18+ (for TypeScript tooling)

### Installation

```bash
# Clone the repository
git clone https://github.com/adimov-eth/xln.git
cd xln/v1

# Install dependencies
bun install
```

### Running the Server

```bash
# Start the XLN server
bun run start

# Run in development mode with auto-reload
bun run dev

# Type check the code
bun run typecheck

# Clean data directory
bun run clean
```

## Implementation Details

### Pure Functional Design
- No classes or mutable state
- All state transitions are pure functions
- Immutable data structures throughout
- Deterministic execution guarantees

### Fault Tolerance
- Write-Ahead Log (WAL) for all server blocks
- Periodic state snapshots (every 100 blocks)
- Automatic recovery from crashes
- LevelDB for persistent storage

### Performance Targets
- Block time: 100ms
- Transaction latency: <10ms  
- Merkle proof generation: <1ms
- Support for 10M+ channels

### Message Flow

```
1. External transaction → Server mempool
2. Server tick → Process mempool → Apply to entities
3. Entity state changes → Outbox messages
4. Outbox → New server transactions
5. Recursive loop continues
```

## Project Structure

```
/src/
├── types.ts         # Core type definitions
├── index.ts         # Server entry point
└── core/
    ├── server.ts    # Server state machine
    ├── entity.ts    # Entity state machine
    └── persistence.ts # LevelDB integration

/data/
├── history/
│   ├── server_blocks/  # WAL entries
│   └── entity_blocks/  # Entity history
└── state/
    ├── server/         # Server snapshots
    └── entities/       # Entity states
```

## Development Status

### Implemented ✅
- Core server tick loop
- Entity state machines
- Multi-signer consensus simulation
- WAL and snapshot persistence
- Recursive message passing

### In Progress 🚧
- BLS signature aggregation
- Merkle tree state commitments
- Network layer (WebSocket/REST)
- Channel implementation
- Depositary system

### Future Work 📋
- Production-grade consensus
- Horizontal scaling
- Cross-entity channels
- Smart contract integration
- Performance optimizations

## Contributing

We welcome contributions! Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting PRs.

### Development Guidelines
1. Maintain pure functional style
2. Ensure deterministic execution
3. Write comprehensive tests
4. Follow the Kalashnikov Principle

## Documentation

- [Technical Specification](docs/XLN_SPECIFICATION.md) - Detailed architecture
- [Product Requirements](docs/XLN_PRD.md) - Product vision and metrics
- [CLAUDE.md](CLAUDE.md) - AI assistant configuration

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with the Kalashnikov Principle: Like the AK-47 rifle, XLN prioritizes absolute reliability, simplicity of operation, and fault tolerance above all else.

---

**Status**: Alpha - Not ready for production use