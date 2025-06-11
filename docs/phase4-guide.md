# XLN Phase 4: Server Architecture Guide

## Overview

Phase 4 transforms XLN from a basic prototype into a production-ready system with enterprise-grade observability, configuration management, and operational capabilities.

## Quick Start

### Basic Usage

```typescript
import { startServer } from './src/index.ts';

// Start with defaults
await startServer();

// Or with custom configuration
await startServer({
  server: { tickMs: 50, snapshotInterval: 100 },
  storage: { type: 'memory', path: './data' },
  logging: { level: 'debug' },
  features: { metrics: true, events: true }
});
```

### Environment Configuration

Configure server behavior via environment variables:

```bash
# Server settings
export XLN_TICK_MS=50              # Block processing interval (default: 100ms)
export XLN_SNAPSHOT_INTERVAL=200   # Snapshot every N blocks (default: 100)

# Storage configuration
export XLN_STORAGE_TYPE=memory      # Backend: 'leveldb' | 'memory' (default: leveldb)
export XLN_STORAGE_PATH=./custom    # Storage path (default: ./data)

# Logging
export XLN_LOG_LEVEL=debug          # Level: 'debug' | 'info' | 'warn' | 'error'

# Features
export XLN_ENABLE_METRICS=true      # Enable HTTP metrics endpoint (default: false)
export XLN_ENABLE_EVENTS=true       # Enable event system (default: true)
```

## Event System

### Core Events

XLN emits the following events during operation:

- **`block:processed`** `(height: number, txCount: number, hash: string)` - Successful block processing
- **`block:failed`** `(height: number, error: Error)` - Block processing failure
- **`entity:updated`** `(signerIdx: number, entityId: string, height: number)` - Entity state change
- **`shutdown`** `()` - Graceful shutdown initiated

### Event Subscription

```typescript
import { events } from './src/index.ts';

// Monitor block processing
events.on('block:processed', (height, txCount, hash) => {
  console.log(`✅ Block ${height}: ${txCount} txs, hash: ${hash.slice(0,8)}...`);
});

// Handle failures
events.on('block:failed', (height, error) => {
  console.error(`❌ Block ${height} failed:`, error.message);
  // Alert monitoring system
  sendAlert('block_processing_failed', { height, error: error.message });
});

// Track entity activity
events.on('entity:updated', (signerIdx, entityId, height) => {
  console.log(`🔄 Entity ${entityId} (signer ${signerIdx}) updated at height ${height}`);
});

// Cleanup on shutdown
events.on('shutdown', () => {
  console.log('🛑 Server shutting down, cleaning up resources...');
  cleanup();
});
```

### Custom Event Handlers

```typescript
// Business logic hooks
events.on('block:processed', (height, txCount, hash) => {
  // Milestone notifications
  if (height % 1000 === 0) {
    notifyMilestone(height);
  }
  
  // Performance monitoring
  if (txCount > 100) {
    trackHighVolumeBlock(height, txCount);
  }
});

// Real-time updates
events.on('entity:updated', (signerIdx, entityId, height) => {
  // Update dashboards
  updateEntityDashboard(entityId, height);
  
  // WebSocket broadcast
  broadcastEntityUpdate({ signerIdx, entityId, height });
});
```

## Structured Logging

### Logger Usage

Replace all `console.log` calls with structured logging:

```typescript
import { logger } from './src/index.ts';

// Different log levels with scope and context
logger.debug('Database', 'Connection pool status', { active: 5, idle: 3 });
logger.info('Server', 'Processing block', { height: 1234, txCount: 15 });
logger.warn('Entity', 'High mempool size', { entityId: 'wallet-1', size: 100 });
logger.error('Consensus', 'Quorum not reached', { signers: [0, 1], required: 2 });
```

### Log Output Format

```
[2024-01-15T10:30:45.123Z] INFO [Server] Processing block { height: 1234, txCount: 15 }
[2024-01-15T10:30:45.125Z] WARN [Entity] High mempool size { entityId: 'wallet-1', size: 100 }
[2024-01-15T10:30:45.127Z] ERROR [Consensus] Quorum not reached { signers: [0, 1], required: 2 }
```

### Log Level Configuration

```bash
# Show only warnings and errors
export XLN_LOG_LEVEL=warn

# Show all logs including debug
export XLN_LOG_LEVEL=debug
```

## Configuration Management

### Configuration Structure

```typescript
interface ServerConfig {
  server: {
    tickMs: number;              // Block processing interval
    snapshotInterval: number;    // Snapshot frequency
  };
  storage: {
    type: 'leveldb' | 'memory';  // Storage backend
    path: string;                // Storage location
  };
  logging: {
    level: LogLevel;             // Minimum log level
  };
  features: {
    metrics: boolean;            // Enable HTTP metrics
    events: boolean;             // Enable event system
  };
}
```

### Configuration Layers

1. **Defaults** - Sensible production defaults
2. **Environment Variables** - Override via `XLN_*` env vars
3. **Runtime Config** - Override via `startServer(config)`

```typescript
// Environment takes precedence
process.env.XLN_TICK_MS = '50';

// Runtime config overrides environment
await startServer({
  server: { tickMs: 25 }  // This wins: 25ms
});
```

### Development vs Production

```typescript
// Development configuration
const devConfig = {
  server: { tickMs: 10, snapshotInterval: 10 },
  storage: { type: 'memory' as const, path: '' },
  logging: { level: 'debug' as const },
  features: { metrics: true, events: true }
};

// Production configuration
const prodConfig = {
  server: { tickMs: 100, snapshotInterval: 1000 },
  storage: { type: 'leveldb' as const, path: '/var/lib/xln' },
  logging: { level: 'info' as const },
  features: { metrics: true, events: true }
};
```

## Metrics & Monitoring

### HTTP Endpoints

When metrics are enabled (`XLN_ENABLE_METRICS=true`), XLN starts an HTTP server on port 3001:

```bash
# Prometheus-compatible metrics
curl http://localhost:3001/metrics

# JSON health check with metrics
curl http://localhost:3001/health
```

### Metrics Output

**Prometheus format** (`/metrics`):
```
# HELP xln_blocks_processed_total Total blocks processed
# TYPE xln_blocks_processed_total counter
xln_blocks_processed_total 1234

# HELP xln_blocks_failed_total Total blocks that failed processing
# TYPE xln_blocks_failed_total counter
xln_blocks_failed_total 5

# HELP xln_uptime_seconds Server uptime in seconds
# TYPE xln_uptime_seconds gauge
xln_uptime_seconds 3600
```

**JSON format** (`/health`):
```json
{
  "status": "ok",
  "blocksProcessed": 1234,
  "blocksFailed": 5,
  "entitiesUpdated": 567,
  "uptime": 3600000,
  "startTime": 1705312245123
}
```

### Custom Metrics

```typescript
import { metricsCollector } from './src/index.ts';

// Access current metrics
const metrics = metricsCollector.getMetrics();
console.log(`Processed ${metrics.blocksProcessed} blocks`);

// Custom metric tracking
let walletTransactions = 0;
events.on('entity:updated', (signerIdx, entityId) => {
  if (entityId.startsWith('wallet-')) {
    walletTransactions++;
  }
});
```

## Storage Backends

### LevelDB (Production)

Default persistent storage using LevelDB:

```typescript
await startServer({
  storage: { 
    type: 'leveldb', 
    path: './production-data' 
  }
});
```

Features:
- ✅ Persistent across restarts
- ✅ ACID transactions
- ✅ Compression support
- ✅ Write-ahead logging

### Memory (Testing)

Fast in-memory storage for tests and development:

```typescript
await startServer({
  storage: { 
    type: 'memory', 
    path: '' 
  }
});
```

Features:
- ✅ Zero disk I/O
- ✅ Fast test execution
- ✅ Automatic cleanup
- ❌ Data lost on restart

### Custom Storage

Implement the `Storage` interface for custom backends:

```typescript
import { type Storage } from './src/index.ts';

class RedisStorage implements Storage {
  async saveState(key: string, state: any) { /* Redis logic */ }
  async loadState(key: string) { /* Redis logic */ }
  // ... implement other methods
}

const dbManager = new DatabaseManager(new RedisStorage());
```

## Deployment Patterns

### Development

```bash
# Fast iteration with memory storage
XLN_STORAGE_TYPE=memory \
XLN_LOG_LEVEL=debug \
XLN_TICK_MS=10 \
bun run index.ts
```

### Staging

```bash
# Production-like with metrics
XLN_STORAGE_TYPE=leveldb \
XLN_STORAGE_PATH=./staging-data \
XLN_LOG_LEVEL=info \
XLN_ENABLE_METRICS=true \
bun run index.ts
```

### Production

```bash
# Full production setup
XLN_STORAGE_TYPE=leveldb \
XLN_STORAGE_PATH=/var/lib/xln \
XLN_LOG_LEVEL=info \
XLN_ENABLE_METRICS=true \
XLN_TICK_MS=100 \
XLN_SNAPSHOT_INTERVAL=1000 \
bun run index.ts
```

### Docker

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY . .
RUN bun install

ENV XLN_STORAGE_TYPE=leveldb
ENV XLN_STORAGE_PATH=/data
ENV XLN_LOG_LEVEL=info
ENV XLN_ENABLE_METRICS=true

VOLUME ["/data"]
EXPOSE 3001

CMD ["bun", "run", "index.ts"]
```

## Testing Integration

### Event-Driven Tests

```typescript
import { events, startServer } from './src/index.ts';

describe('XLN Server', () => {
  test('processes blocks and emits events', async () => {
    const processedBlocks: number[] = [];
    
    // Listen for events
    events.on('block:processed', (height) => {
      processedBlocks.push(height);
    });
    
    // Run server with test config
    await startServer({
      storage: { type: 'memory', path: '' },
      server: { tickMs: 10, snapshotInterval: 5 }
    });
    
    // Add test transactions
    const server = await restoreServer();
    const testServer = addMessage(server, testMessage);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Assert events were emitted
    expect(processedBlocks).toContain(1);
  });
});
```

### Metrics Assertions

```typescript
import { metricsCollector } from './src/index.ts';

test('tracks metrics correctly', async () => {
  const initialMetrics = metricsCollector.getMetrics();
  
  // Trigger some operations
  await processTestBlocks();
  
  const finalMetrics = metricsCollector.getMetrics();
  expect(finalMetrics.blocksProcessed).toBeGreaterThan(initialMetrics.blocksProcessed);
});
```

## Migration Guide

### From Phase 3 to Phase 4

1. **Replace console calls**:
   ```typescript
   // Old
   console.log('Processing block', height);
   
   // New
   logger.info('Server', 'Processing block', { height });
   ```

2. **Add configuration**:
   ```typescript
   // Old
   await runServer();
   
   // New
   await startServer({ 
     server: { tickMs: 100 },
     storage: { type: 'leveldb', path: './data' }
   });
   ```

3. **Subscribe to events**:
   ```typescript
   import { events } from './src/index.ts';
   
   events.on('block:processed', (height, txCount, hash) => {
     // Your custom logic
   });
   ```

### Breaking Changes

- **Server startup**: `runServer()` now requires config parameters
- **Console output**: All logs now use structured format
- **Event emission**: New events are emitted during processing
- **Storage selection**: Storage backend must be explicitly configured

## Troubleshooting

### Common Issues

**Events not firing**: Check `XLN_ENABLE_EVENTS=true`

**Metrics endpoint not available**: Ensure `XLN_ENABLE_METRICS=true`

**Storage permission errors**: Check write permissions for `XLN_STORAGE_PATH`

**High memory usage**: Consider reducing `XLN_SNAPSHOT_INTERVAL`

### Debug Mode

```bash
# Enable verbose logging
XLN_LOG_LEVEL=debug bun run index.ts

# Monitor all events
events.on('*', (eventName, ...args) => {
  console.log('Event:', eventName, args);
});
```

## Best Practices

1. **Use structured logging** - Always include context data
2. **Monitor metrics** - Set up Prometheus scraping
3. **Handle events** - Don't let events go unhandled
4. **Configure for environment** - Different configs for dev/prod
5. **Test with memory storage** - Fast test execution
6. **Use feature flags** - Gradual rollout of new features

## Performance Tips

- **Memory storage** for tests: 10x faster than LevelDB
- **Adjust tick interval**: Lower for high-throughput, higher for efficiency
- **Snapshot frequency**: Balance recovery time vs disk usage
- **Log level**: Use `info` in production, `debug` only when needed
- **Metrics overhead**: Disable if not needed for maximum performance 