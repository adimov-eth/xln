# Consensus

XLN implements a simplified Tendermint-style consensus mechanism optimized for sub-second finality.

## Frame Lifecycle

The consensus process follows five distinct phases:

### 1. ADD_TX - Transaction Injection

Any signer can inject a signed transaction into the target entity's mempool:

```typescript
const input: Input = {
  from: signerAddress,
  to:   entityAddress,
  cmd:  { type: 'ADD_TX', addrKey: 'jurisdiction:entityId', tx: signedTx }
};
```

**Validation**:
- Signer must be in entity's quorum
- Transaction signature must be valid
- Nonce must be exactly `lastNonce + 1`

### 2. PROPOSE - Frame Creation

The current proposer packages queued transactions into a frame:

```typescript
const input: Input = {
  from: proposerAddress,
  to:   entityAddress,
  cmd:  { type: 'PROPOSE', addrKey: 'jurisdiction:entityId', ts: Date.now() }
};
```

**Proposer Selection**:
- Deterministic: `proposer = members[height % members.length]`
- Rotates each block for fairness
- No proposer election overhead

**Frame Construction**:
```typescript
const frame: Frame = {
  height: entity.height + 1n,
  ts:     BigInt(Date.now()),
  txs:    entity.mempool,
  state:  applyTxs(entity.state, entity.mempool)
};
```

### 3. SIGN - Validation

Other quorum members verify and sign the proposed frame:

```typescript
const input: Input = {
  from: signerAddress,
  to:   entityAddress,
  cmd:  { type: 'SIGN', addrKey: 'jurisdiction:entityId', frameHash: hash, sig: signature }
};
```

**Verification Steps**:
1. Proposer is correct for height
2. All transactions are valid
3. State transition is deterministic
4. Frame hash matches

**Dry-Run Execution**: Validators simulate the frame without committing.

### 4. COMMIT - Finalization

When collected signatures meet the threshold, the proposer aggregates them:

```typescript
const input: Input = {
  from: proposerAddress,
  to:   entityAddress,
  cmd:  { 
    type: 'COMMIT', 
    addrKey: 'jurisdiction:entityId',
    frame: frame,
    hanko: aggregateSignature
  }
};
```

**Finality**: Once committed, the frame cannot be reversed.

### 5. State Update

All replicas:
1. Verify `hash(frame) ⟂ hanko`
2. Adopt `state`
3. Clear mempool
4. Advance height

## Edge Cases

### Stuck Proposer

If the proposer fails to propose within `TIMEOUT_PROPOSAL_MS`:

```typescript
if (timeSinceLastBlock > TIMEOUT_PROPOSAL_MS) {
  // Any member can propose
  const emergencyProposer = members[
    (height + retryCount) % members.length
  ];
}
```

**Default**: 30 seconds timeout

### Duplicate Votes

Per-signer nonces prevent replay:

```typescript
if (cmd.nonce <= signerRecords[addr].lastNonce) {
  throw new Error('Duplicate or old vote');
}
```

### Quorum Rotation

When membership changes:

1. Old members' nonces are retained
2. Prevents replay if they rejoin
3. New members start at nonce 0

Example:
```typescript
// Before: Alice, Bob, Carol
// After: Alice, Bob, Dave
// Carol's nonce remains in signerRecords
```

### Dry-Run Execution

Validators compute state without side effects:

```typescript
function validateProposal(
  entity: EntityState,
  frame: Frame
): boolean {
  const simulated = applyTxs(entity.state, frame.txs);
  return deepEqual(simulated, frame.postState);
}
```

## Consensus Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `TIMEOUT_PROPOSAL_MS` | 30,000 | Proposer timeout |
| `MIN_SIGNATURES` | 67% | BFT threshold |
| `FRAME_SIZE_LIMIT` | 1 MB | Max frame size |
| `MEMPOOL_SIZE` | 10,000 | Max pending txs |

## Single vs Multi-Signer

### Single-Signer Entities

Instant finality, no consensus needed:

```typescript
if (quorum.members.length === 1) {
  // Proposer is always valid
  // No signatures needed
  // Immediate commit
}
```

Use cases: Personal wallets, oracles

### Multi-Signer Entities

Full BFT consensus:

```typescript
const votingPower = signatures
  .map(sig => getMemberShares(sig.address))
  .reduce((a, b) => a + b, 0n);

if (votingPower >= quorum.threshold) {
  // Commit frame
}
```

Use cases: DAOs, exchanges, bridges

## Security Properties

### Safety

- **No Forks**: Deterministic proposer prevents competing blocks
- **No Double-Spend**: Nonce tracking ensures exactly-once execution
- **BFT**: Tolerates up to ⅓ Byzantine weight

### Liveness

- **Proposer Rotation**: Failed proposer doesn't halt network
- **Timeout Recovery**: Any member can propose after timeout
- **No Locks**: Pure functions prevent deadlocks

## Performance Characteristics

| Metric | Single-Signer | Multi-Signer |
|--------|---------------|--------------|
| Latency | 100ms | 400ms |
| Throughput | 10,000+ TPS | 1,000+ TPS |
| Finality | Instant | 4 ticks |
| Messages | 0 | O(n²) |

## Implementation

Core consensus logic in [`src/core/entity.ts`](../src/core/entity.ts):

```typescript
export function applyCommand(
  entity: EntityState,
  cmd: Command
): { state: EntityState; outbox: Input[] } {
  switch (cmd.type) {
    case 'proposeFrame':
      return proposeFrame(entity);
    case 'signFrame':
      return signFrame(entity, cmd.sig);
    case 'commitFrame':
      return commitFrame(entity, cmd.frame, cmd.hanko);
    // ...
  }
}
```

## Future Enhancements

1. **Pipelined Consensus**: Propose height n+1 while n finalizes
2. **Optimistic Execution**: Apply transactions before full confirmation
3. **State Sync**: Fast-sync new replicas without full history
4. **Cross-Entity Atomicity**: Coordinate commits across entities

For storage of consensus data, see [Persistence](./persistence.md).