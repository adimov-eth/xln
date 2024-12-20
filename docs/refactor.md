# XLN Payment Channel Network - Refactored

## Overview

This is a refactored implementation of the XLN Payment Channel Network, focusing on improved modularity, type safety, and maintainability. The system provides secure, efficient payment channels with support for multi-token transfers, atomic swaps, and conditional payments.

## Key Improvements

### Architecture
- Modular, layered architecture with clear separation of concerns
- Improved type definitions and interfaces
- Enhanced error handling and recovery mechanisms
- Better state management using HSTM (Hierarchical State-Time Machine)

### Core Components
- `Channel`: Robust payment channel implementation
- `Block`: Efficient batched state transitions
- `HSTM`: Advanced state management
- `MerkleTree`: Optimized state verification
- `Transition`: Type-safe state transitions

### API & Communication
- RESTful API for channel management
- WebSocket support for real-time updates
- Improved message handling and validation
- Enhanced security measures

## Getting Started

### Prerequisites
- Node.js 16+
- TypeScript 4.5+
- LevelDB

### Installation
```bash
# Clone the repository
git clone [repository-url]

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration
Create a `.env` file in the project root:
```env
PORT=8080
NODE_ENV=development
DB_PATH=./channel-db
LOG_LEVEL=info
```

## Usage

### Starting the Server
```bash
# Development mode
npm run dev

# Production mode
npm run start
```

### Creating a Channel
```typescript
import { Channel } from './core/Channel';

const channel = new Channel(userAddress, peerAddress, {
  dbPath: './channel-db',
  merkleConfig: {
    batchSize: 16,
    hashAlgorithm: 'sha256'
  }
});

await channel.initialize();
```

### Making a Payment
```typescript
// Create and apply a payment transition
const payment = await channel.storePaymentHashlock({
  subchannelId: 'subchannel-id',
  amount: '100',
  hashlock: 'hashlock',
  timelock: 3600
});

// Apply the transition
await channel.applyTransition({
  type: 'PAYMENT_CREATE',
  payment
});
```

## Architecture

The system is organized into three main layers:

### 1. Core Layer
- Channel state management
- State transitions
- Merkle tree verification
- Persistent storage

### 2. Protocol Layer
- Message handling
- State synchronization
- Block processing
- Signature verification

### 3. API Layer
- REST endpoints
- WebSocket communication
- Blockchain interaction

## Documentation

Detailed documentation is available in the `/docs` directory:
- [Core Components](./docs/core.md)
- [Architecture](./docs/architecture.md)
- [Security](./docs/security.md)
- [API Reference](./docs/api.md)
- [WebSocket Protocol](./docs/websocket.md)
- [Transport Layer](./docs/transport.md)

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- channel.test.ts

# Run with coverage
npm run test:coverage
```

## Security

The system implements multiple security measures:
- Cryptographic signatures
- State verification
- Double-spend prevention
- Secure key management
- Attack prevention

For detailed security information, see [Security Documentation](./docs/security.md).

## Performance

Optimizations include:
- Batched state transitions
- Efficient Merkle tree operations
- State caching
- Optimized storage operations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Original XLN implementation team
- Open-source payment channel implementations
- Ethereum community
- LevelDB contributors 