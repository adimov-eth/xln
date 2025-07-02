# Configuration

XLN provides configuration options to tune system behavior for different deployment scenarios.

## Configuration Knobs

| Key | Default | Description | Valid Range |
|-----|---------|-------------|-------------|
| `FRAME_INTERVAL_MS` | 100 | Server tick cadence | 50-1000 |
| `SNAPSHOT_EVERY_N_FRAMES` | 100 | Snapshot frequency | 10-10000 |
| `TIMEOUT_PROPOSAL_MS` | 30,000 | Liveness guard | 5000-300000 |
| `OUTBOX_DEPTH_LIMIT` | ∞ | Recursion guard | 1-1000 |

## Configuration Sources

Configuration can be provided through (in order of precedence):

1. **Environment Variables**
```bash
export XLN_FRAME_INTERVAL_MS=50
export XLN_SNAPSHOT_EVERY_N_FRAMES=1000
```

2. **Configuration File** (`xln.config.json`)
```json
{
  "server": {
    "frameIntervalMs": 50,
    "snapshotEveryNFrames": 1000
  },
  "entity": {
    "timeoutProposalMs": 60000,
    "mempoolLimit": 10000
  }
}
```

3. **Command Line Arguments**
```bash
xln server --frame-interval-ms=50 --snapshot-every-n-frames=1000
```

4. **Default Values** (from `src/config.ts`)
```typescript
export const DEFAULT_CONFIG = {
  server: {
    frameIntervalMs: 100,
    snapshotEveryNFrames: 100
  },
  entity: {
    timeoutProposalMs: 30000,
    mempoolLimit: 10000
  }
};
```

## Server Configuration

### Performance Tuning

```typescript
export interface ServerConfig {
  // Core timing
  frameIntervalMs: number;      // How often to process blocks
  
  // Persistence
  snapshotEveryNFrames: number; // Snapshot frequency
  walBatchSize: number;         // WAL write batching
  
  // Resources
  maxMempool: number;           // Global mempool limit
  maxReplicas: number;          // Max entities per server
  
  // Networking (future)
  listenPort: number;           // RPC server port
  maxConnections: number;       // Connection limit
}
```

### Example: High-Throughput Configuration

```json
{
  "server": {
    "frameIntervalMs": 50,
    "snapshotEveryNFrames": 1000,
    "walBatchSize": 1000,
    "maxMempool": 100000,
    "maxReplicas": 10000
  }
}
```

### Example: Low-Latency Configuration

```json
{
  "server": {
    "frameIntervalMs": 10,
    "snapshotEveryNFrames": 100,
    "walBatchSize": 1,
    "maxMempool": 1000,
    "maxReplicas": 100
  }
}
```

## Entity Configuration

### Consensus Parameters

```typescript
export interface EntityConfig {
  // Consensus timing
  timeoutProposalMs: number;    // Proposer timeout
  maxFrameSize: number;         // Max bytes per frame
  
  // Mempool
  mempoolLimit: number;         // Max pending txs
  mempoolTTL: number;          // TX expiration time
  
  // State management
  stateHistoryLimit: number;    // Keep N historical states
  pruneAfterDays: number;      // Prune old data
}
```

### Example: DAO Configuration

```json
{
  "entity": {
    "timeoutProposalMs": 60000,
    "maxFrameSize": 5000000,
    "mempoolLimit": 50000,
    "stateHistoryLimit": 1000
  }
}
```

## Storage Configuration

### LevelDB Tuning

```typescript
export interface StorageConfig {
  // LevelDB options
  cacheSize: number;            // LRU cache in bytes
  writeBufferSize: number;      // Write buffer size
  maxOpenFiles: number;         // File descriptor limit
  compression: boolean;         // Enable compression
  
  // Paths
  dataDir: string;              // Base data directory
  walDir: string;              // WAL directory
  stateDir: string;            // Snapshot directory
  casDir: string;              // CAS directory
}
```

### Example: SSD Optimized

```json
{
  "storage": {
    "cacheSize": 1073741824,
    "writeBufferSize": 67108864,
    "maxOpenFiles": 5000,
    "compression": false,
    "dataDir": "/nvme/xln"
  }
}
```

## Security Configuration

### Access Control

```typescript
export interface SecurityConfig {
  // Authentication
  requireAuth: boolean;         // Enable authentication
  authMethod: 'jwt' | 'mtls';  // Auth mechanism
  
  // Rate limiting
  rateLimitEnabled: boolean;    // Enable rate limiting
  rateLimitPerSigner: number;   // Requests per second
  
  // Monitoring
  auditLogging: boolean;        // Log all operations
  metricsEnabled: boolean;      // Expose metrics
}
```

## Runtime Configuration

### Dynamic Updates

Some parameters can be updated at runtime:

```typescript
// Via admin API
POST /admin/config
{
  "server.maxMempool": 50000,
  "entity.mempoolLimit": 25000
}

// Via CLI
xln admin set-config server.maxMempool=50000
```

### Configuration Validation

```typescript
export function validateConfig(config: Config): void {
  // Frame interval bounds
  if (config.server.frameIntervalMs < 10) {
    throw new Error('Frame interval too low, minimum 10ms');
  }
  
  // Snapshot frequency
  if (config.server.snapshotEveryNFrames < 1) {
    throw new Error('Must snapshot at least every frame');
  }
  
  // Mempool limits
  if (config.entity.mempoolLimit > config.server.maxMempool) {
    throw new Error('Entity mempool cannot exceed server mempool');
  }
}
```

## Environment-Specific Configs

### Development

```json
{
  "server": {
    "frameIntervalMs": 1000,
    "snapshotEveryNFrames": 10
  },
  "storage": {
    "dataDir": "./data-dev"
  },
  "security": {
    "requireAuth": false
  }
}
```

### Staging

```json
{
  "server": {
    "frameIntervalMs": 100,
    "snapshotEveryNFrames": 100
  },
  "storage": {
    "dataDir": "/var/xln-staging"
  },
  "security": {
    "requireAuth": true,
    "rateLimitEnabled": true
  }
}
```

### Production

```json
{
  "server": {
    "frameIntervalMs": 100,
    "snapshotEveryNFrames": 1000
  },
  "storage": {
    "dataDir": "/mnt/xln-prod",
    "cacheSize": 8589934592
  },
  "security": {
    "requireAuth": true,
    "rateLimitEnabled": true,
    "auditLogging": true
  }
}
```

## Configuration Best Practices

1. **Start Conservative**: Use defaults, then tune based on metrics
2. **Monitor Impact**: Watch latency/throughput when changing
3. **Test Changes**: Validate in staging before production
4. **Document Rationale**: Comment why values were chosen
5. **Version Control**: Track configuration in git

## Troubleshooting

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| High latency | Frame interval too high | Reduce `frameIntervalMs` |
| Memory growth | Snapshots too infrequent | Reduce `snapshotEveryNFrames` |
| Disk I/O spikes | WAL not batched | Increase `walBatchSize` |
| Proposal timeouts | Timeout too low | Increase `timeoutProposalMs` |

For performance impact of settings, see [Performance](./performance.md).