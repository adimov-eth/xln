# XLN (Extended Lightning Network) v1

A revolutionary platform for creating tradeable digital corporations with built-in governance, inheritance, and payment channels. XLN solves both organizational governance and payment scalability in one unified system.

## Overview

XLN v1 implements a pure functional, deterministic state machine architecture inspired by the "Kalashnikov Principle" - ultimate reliability through simplicity. Every component in the system is a tradeable entity with shares, creating the first truly composable digital economy.

### Key Innovations

1. **Tradeable Digital Corporations**: Every entity has shares that can be bought, sold, or inherited
2. **Dual Governance Modes**: ShareholderPriority (capital rules) or QuorumPriority (protocol rules)
3. **Inheritance Tokens**: The first cryptocurrency that can be inherited without trust
4. **Universal Entity Model**: Everything is an entity - protocols, contracts, wallets, extensions
5. **Reserve-Credit System**: Flexible payment channels without pre-funding requirements

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

#### Entity (Digital Corporation)
- Tradeable with automatic share issuance
- Flexible governance (ShareholderPriority or QuorumPriority)
- Can be bought via hostile takeover (51% shares)
- Supports inheritance through inactivity detection
- Seamless ownership transitions via handover protocol

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

## Governance Features

### ShareholderPriority Mode
- Shareholders can vote to replace management (quorum)
- Enables hostile takeovers via 51% ownership
- Traditional corporate governance model
- Market dynamics determine control

### QuorumPriority Mode
- Quorum is sovereign, cannot be replaced by shareholders
- Enables inheritance tokens (trustless crypto inheritance)
- Creates uncapturable infrastructure
- Perfect for protocols and foundations

### Entity Handover Protocol
- Seamless ownership transitions with 2-week grace period
- Observer pattern for hot standby (new owners ready to take over)
- Incentive alignment: cooperate or lose reserve access
- Zero downtime during transitions

### Universal Entity Model
Everything in XLN is a tradeable entity:
- **XLN Foundation**: Can be forked like any entity
- **Smart Contracts**: EntityProvider.sol has shares
- **Wallet Software**: Updates controlled by wallet entity
- **Extensions**: Can be acquired via hostile takeover
- **Audit Firms**: Reputation reflected in share value

## Development Status

### Implemented ✅
- Core server tick loop
- Entity state machines
- Multi-signer consensus simulation
- WAL and snapshot persistence
- Recursive message passing

### Priority Development 🚧
- Entity governance modes (ShareholderPriority/QuorumPriority)
- Share issuance and trading
- Inheritance token functionality
- Entity handover protocol
- Universal entity registration

### Future Work 📋
- Payment channels with reserve-credit
- Multi-hop routing
- Smart contract integration
- Performance optimizations
- Production deployment

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
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) - Phased development roadmap
- [CLAUDE.md](CLAUDE.md) - AI assistant configuration

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with the Kalashnikov Principle: Like the AK-47 rifle, XLN prioritizes absolute reliability, simplicity of operation, and fault tolerance above all else.

---

**Status**: Alpha - Not ready for production use