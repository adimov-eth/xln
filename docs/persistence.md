# Persistence

XLN implements a sophisticated storage architecture optimized for crash recovery, deterministic replay, and audit-grade history.

## Storage Architecture

### Three-Database Design

| Store | Purpose | Write Frequency | Retention |
|-------|---------|-----------------|-----------|
| **Write-Ahead Log** (`wal/`) | Crash consistency | Every input | Until snapshot |
| **Mutable Snapshots** (`state/`) | Fast cold-start | Every N frames | Latest only |
| **Immutable CAS** (`cas/`) | Audit history | Every commit | Forever |

### Additional Stores

| Store | Purpose | Content |
|-------|---------|---------|
| **Entity Frames** (`entity_blocks/<id>/`) | Entity-specific history | Committed frames |
| **Server Frames** (`server_blocks/`) | Global state timeline | Merkle roots |

## Dual Snapshot Model

The system maintains two complementary persistence mechanisms:

```
Replay = Latest Snapshot + WAL entries after snapshot
```

This enables:
- **Fast Recovery**: Start from snapshot, not genesis
- **Consistency**: WAL ensures no lost updates
- **Verification**: Replay produces identical state

> **Design Insight**: The debate between Merkle roots and snapshots was resolved by using both - snapshots for performance, Merkle roots for verification. This emerged from discussions about balancing auditability with practical recovery times.

## LevelDB Schema

### Key Design

A flat 96-byte prefix scheme aligns with in-memory structures:

```
Key = SignerID || EntityID || StoreType || Suffix
      (32 bytes)  (32 bytes)  (32 bytes)  (variable)
```

Benefits:
- Natural ordering matches Map iteration
- Range scans without index overhead
- Prefix compression in LevelDB

### Column Families

```typescript
const db = new Level('./data', {
  valueEncoding: 'buffer',
  keyEncoding: 'buffer'
});

// Logical column families via prefixes
const WAL_PREFIX = Buffer.from('wal:');
const STATE_PREFIX = Buffer.from('state:');
const CAS_PREFIX = Buffer.from('cas:');
```

## Write-Ahead Log (WAL)

Every input is logged before processing:

```typescript
async function logInput(input: Input, height: bigint) {
  const key = encodeWALKey(height, input);
  const value = RLP.encode(input);
  await wal.put(key, value);
}
```

### WAL Key Structure
```
wal:{height:08x}:{signerIdx:04x}:{entityId}:{sequence:04x}
```

### WAL Garbage Collection

> **Implementation Note**: WAL entries are pruned after successful snapshot, but retained for at least 100 blocks for debugging. This policy emerged from operational experience with recovery scenarios.

## Snapshot Management

### Snapshot Triggers

Snapshots are created when:
1. `height % SNAPSHOT_EVERY_N_FRAMES === 0` (default: 100)
2. State delta exceeds 20 MB
3. Manual checkpoint requested
4. Before risky operations

### Snapshot Format

```typescript
type Snapshot = {
  version: number;
  height: bigint;
  timestamp: bigint;
  serverState: ServerState;
  checksum: string;  // SHA256 of content
};
```

### Atomic Snapshots

Using LevelDB batch operations:

```typescript
async function saveSnapshot(state: ServerState) {
  const batch = db.batch();
  
  // Write all replicas atomically
  for (const [addr, replica] of state.replicas) {
    const key = `${STATE_PREFIX}${addr}`;
    const value = RLP.encode(replica);
    batch.put(key, value);
  }
  
  // Write metadata last
  batch.put(`${STATE_PREFIX}meta`, {
    height: state.height,
    hash: computeMerkleRoot(state)
  });
  
  await batch.write();
}
```

## Content-Addressed Storage (CAS)

Immutable frames stored by hash:

```typescript
async function storeFrame(frame: Frame) {
  const hash = hashFrame(frame);
  const key = `${CAS_PREFIX}${hash}`;
  const value = RLP.encode(frame);
  
  // Idempotent - safe to write multiple times
  await cas.put(key, value);
  
  // Index by entity and height
  await cas.put(
    `${CAS_PREFIX}idx:${frame.entityId}:${frame.height}`,
    hash
  );
}
```

Benefits:
- Deduplication
- Integrity verification
- Efficient proofs

## Recovery Process

### 1. Load Latest Snapshot

```typescript
async function loadSnapshot(): Promise<ServerState> {
  const meta = await db.get(`${STATE_PREFIX}meta`);
  const state = initServerState();
  
  // Load all replicas
  for await (const [key, value] of db.iterator({
    gte: STATE_PREFIX,
    lt: STATE_PREFIX + 'xFF'
  })) {
    if (!key.endsWith('meta')) {
      const addr = key.slice(STATE_PREFIX.length);
      state.replicas.set(addr, RLP.decode(value));
    }
  }
  
  state.height = meta.height;
  return state;
}
```

### 2. Replay WAL

```typescript
async function replayFromWAL(
  state: ServerState,
  fromHeight: bigint
): Promise<ServerState> {
  for await (const [key, value] of db.iterator({
    gte: `${WAL_PREFIX}${fromHeight}`,
    lt: `${WAL_PREFIX}${state.height + 1n}`
  })) {
    const input = RLP.decode(value) as Input;
    state = applyInput(state, input);
  }
  return state;
}
```

### 3. Verify Integrity

```typescript
function verifyRecovery(
  recovered: ServerState,
  expectedHash: string
): boolean {
  const actualHash = computeMerkleRoot(recovered);
  if (actualHash !== expectedHash) {
    throw new Error(`State corruption: ${actualHash} != ${expectedHash}`);
  }
  return true;
}
```

## Performance Optimizations

### Write Batching

Collect writes during block processing:

```typescript
class BatchedStorage {
  private pending = new Map();
  
  async flush() {
    const batch = db.batch();
    for (const [k, v] of this.pending) {
      batch.put(k, v);
    }
    await batch.write();
    this.pending.clear();
  }
}
```

### Compression

Large values are compressed:

```typescript
import { compress, decompress } from 'snappy';

async function putCompressed(key: string, value: Buffer) {
  if (value.length > 1024) {
    value = await compress(value);
    key = key + ':snappy';
  }
  await db.put(key, value);
}
```

### Cache Layer

Frequently accessed data cached in memory:

```typescript
class CachedStorage {
  private cache = new LRU<string, any>(1000);
  
  async get(key: string) {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const value = await db.get(key);
    this.cache.set(key, value);
    return value;
  }
}
```

## Backup Strategy

1. **Continuous**: WAL shipped to S3
2. **Daily**: Full snapshot backup
3. **Archive**: Monthly CAS export
4. **Geographic**: Multi-region replication

## Storage Sizing

| Component | Size Estimate | Growth Rate |
|-----------|---------------|-------------|
| WAL | 100 KB/block | Linear |
| Snapshots | 10 MB/entity | Step function |
| CAS | 50 KB/frame | Linear |
| Indexes | 10% overhead | Linear |

**Example**: 1000 entities × 1000 frames = ~50 GB CAS

## Future Enhancements

1. **Columnar Storage**: Apache Parquet for analytics
2. **Tiered Storage**: Hot/warm/cold data separation
3. **Incremental Snapshots**: Delta compression
4. **Distributed Storage**: IPFS for CAS layer

For the cryptographic primitives used, see [Hashing](./hashing.md).