# Edge Cases & Known Limitations

This document covers edge cases, known limitations, and their workarounds in the current XLN implementation.

## Implementation Edge Cases

### Binary Map Keys in JavaScript

**Issue**: JavaScript Maps use object identity for non-primitive keys.

```typescript
// WRONG - different objects
const key1 = Buffer.from([1, 2, 3])
const key2 = Buffer.from([1, 2, 3])
map.set(key1, 'value')
map.get(key2) // undefined!

// CORRECT - use hex strings
const key1 = '0x010203'
const key2 = '0x010203'
map.set(key1, 'value')
map.get(key2) // 'value'
```

**Solution**: Always convert binary keys to lowercase hex strings.

**Tracking**: [Issue #23](https://github.com/xln/xln/issues/23)

### Single-Signer Optimization

**Issue**: Single-signer entities don't need consensus but must maintain compatible history.

**Solution**: Still create frames for consistency:

```typescript
if (entity.quorum.members.length === 1) {
  // Still create frame for history
  const frame = createFrame(entity)
  // But skip signature collection
  return commitFrame(entity, frame, SELF_SIGNATURE)
}
```

**Tracking**: [Issue #45](https://github.com/xln/xln/issues/45)

### Message Mis-routing

**Issue**: Messages sent to outdated proposer are queued locally.

**Scenario**:

1. Alice is proposer at height 100
2. Bob sends message to Alice
3. Before delivery, height advances to 101
4. Carol is now proposer, message stuck at Alice

**Solution**: Include target height in routing:

```typescript
type RoutedInput = {
  input: Input
  targetHeight: bigint
  retryCount: number
}
```

**Tracking**: [Issue #67](https://github.com/xln/xln/issues/67)

### Dual Snapshot Integrity

**Issue**: Mismatch between snapshot hash and WAL replay hash.

**Causes**:

- Non-deterministic operations (timestamps, random)
- Floating point calculations
- Map iteration order

**Solution**: Strict determinism rules:

```typescript
// Always sort before iteration
const sortedEntries = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))

// Never use Date.now()
const timestamp = blockHeight * 100n // Deterministic

// Avoid floating point
const fee = (amount * 3n) / 1000n // Integer math only
```

**Tracking**: [Issue #89](https://github.com/xln/xln/issues/89)

## Protocol Limitations

### Unbounded Mempool

**Current State**: No limit on pending transactions.

**Risk**: Memory exhaustion attack.

**Workaround**: Manual monitoring and restart.

**Future Fix**: Implement configurable limits:

```typescript
if (entity.mempool.length >= MAX_MEMPOOL_SIZE) {
  throw new Error('Mempool full')
}
```

**Tracking**: [Issue #101](https://github.com/xln/xln/issues/101)

### No Cross-Entity Atomicity

**Current State**: Messages between entities are eventually consistent.

**Example**: Transfer A→B might succeed while B→C fails.

**Workaround**: Application-level compensation:

```typescript
// Two-phase commit pattern
await entityA.lock(amount)
await entityB.prepare(amount)
await entityA.commit()
await entityB.commit()
```

**Future**: HTLC in channels for atomic swaps.

**Tracking**: [Issue #124](https://github.com/xln/xln/issues/124)

### Fixed Frame Size

**Current State**: Frames have 1MB limit.

**Issue**: Large state updates may not fit.

**Workaround**: Split into multiple transactions:

```typescript
const chunks = splitLargeUpdate(update, MAX_TX_SIZE)
for (const chunk of chunks) {
  await submitTx(chunk)
}
```

**Tracking**: [Issue #156](https://github.com/xln/xln/issues/156)

## Security Limitations

### Mocked Signatures

**Current State**: Signatures are string placeholders.

**Risk**: No actual authentication.

```typescript
// Current (INSECURE)
sig: 'mocked_signature'

// Future
sig: await bls.sign(privateKey, message)
```

**Status**: Not suitable for production use.

**Tracking**: [Issue #1](https://github.com/xln/xln/issues/1) 🔴 Critical

### No Byzantine Detection

**Current State**: Server assumed honest.

**Risk**: Malicious server can censor or reorder.

**Future**: Multi-server consensus or TEE attestation.

**Tracking**: [Issue #178](https://github.com/xln/xln/issues/178)

## Performance Limitations

### Sequential Transaction Processing

**Current State**: Transactions processed one at a time.

**Impact**: CPU underutilization.

**Future**: Parallel verification where possible:

```typescript
// Analyze dependencies
const groups = groupIndependentTxs(frame.txs)
// Process groups in parallel
await Promise.all(groups.map(processGroup))
```

**Tracking**: [Issue #203](https://github.com/xln/xln/issues/203)

### No State Pruning

**Current State**: All historical state kept forever.

**Impact**: Unbounded storage growth.

**Workaround**: Manual cleanup of old snapshots.

**Future**: Configurable retention policy.

**Tracking**: [Issue #234](https://github.com/xln/xln/issues/234)

## Operational Limitations

### No Hot Reload

**Current State**: Configuration changes require restart.

**Impact**: Service interruption for updates.

**Workaround**: Blue-green deployment.

**Tracking**: [Issue #267](https://github.com/xln/xln/issues/267)

### Limited Monitoring

**Current State**: Basic console logging only.

**Workaround**: External log aggregation.

**Future**: OpenTelemetry integration.

**Tracking**: [Issue #289](https://github.com/xln/xln/issues/289)

## Known Incompatibilities

### Storage Format

**Issue**: Protocol changes break storage compatibility.

**Example**: Recent frame hash change.

**Solution**: Include version in storage:

```typescript
type StoredFrame = {
  version: number
  frame: Frame
}

function migrateFrame(stored: StoredFrame): Frame {
  if (stored.version < CURRENT_VERSION) {
    return migrate(stored.frame)
  }
  return stored.frame
}
```

### Network Protocol

**Issue**: No protocol version negotiation.

**Impact**: All nodes must upgrade simultaneously.

**Future**: Version negotiation in handshake.

## Workaround Patterns

### Handling Mempool Full

```typescript
async function submitWithRetry(tx: EntityTx, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.submitTx(tx)
    } catch (err) {
      if (err.code === -40004 && i < maxRetries - 1) {
        await sleep(1000 * Math.pow(2, i)) // Exponential backoff
        continue
      }
      throw err
    }
  }
}
```

### Detecting Stuck Proposer

```typescript
function monitorLiveness(entity: Entity) {
  let lastHeight = entity.state.height

  setInterval(() => {
    if (entity.state.height === lastHeight) {
      console.warn(`Entity ${entity.id} may be stuck`)
      // Trigger manual intervention
    }
    lastHeight = entity.state.height
  }, TIMEOUT_PROPOSAL_MS)
}
```

### Safe State Access

```typescript
function safeGetState(entity: Entity, key: string): any {
  try {
    return entity.state.domainState[key]
  } catch (err) {
    // Handle corruption gracefully
    console.error(`State corruption detected: ${err}`)
    return getDefaultValue(key)
  }
}
```

## Migration Guide

When encountering breaking changes:

1. **Export current state** before upgrade
2. **Run migration scripts** on exported data
3. **Import migrated state** to new version
4. **Verify integrity** with test transactions

## Future Improvements

Tracked in roadmap, these limitations will be addressed:

- **M2**: Real signatures, bounded mempool
- **M3**: State pruning, parallel execution
- **M4**: Protocol versioning, hot reload
- **M5**: Byzantine detection, monitoring

## Getting Help

If you encounter an edge case not listed here:

1. Check [GitHub Issues](https://github.com/xln/xln/issues)
2. Ask in [Discord #help](https://discord.gg/xln)
3. Submit detailed bug report with:
   - XLN version
   - Steps to reproduce
   - Expected vs actual behavior
   - Logs and state dumps

For implementation details, see [Development Guide](../CLAUDE.md).
