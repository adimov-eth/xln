# Consensus

XLN implements a simplified Tendermint-style consensus mechanism optimized for sub-second finality.

## Frame Lifecycle

The consensus process follows five distinct phases:

### 1. ADD_TX - Transaction Injection

Any signer can inject a signed transaction into the target entity's mempool:

```typescript
const input: Input = [
  signerIdx,        // lexicographic index of signerId
  entityId,         // target entity
  { type: 'addTx', tx: signedTx }
]
```

**Validation** (A3: Nonce increment rule):

- Signer must be in entity's quorum
- Transaction signature must be valid
- Nonce must be exactly `signerRecords[signerId].nonce + 1n`
- Nonce is incremented before adding to mempool

### 2. PROPOSE - Frame Creation

The current proposer packages queued transactions into a frame:

```typescript
const input: Input = [
  signerIdx,
  entityId,
  { type: 'proposeFrame', header: frameHeader }
]
```

**Proposer Selection**:

- Deterministic: `proposer = members[height % members.length]`
- Rotates each block for fairness
- No proposer election overhead

**Frame Construction** (Y-2: Transaction sorting):

1. Sort mempool by: **nonce → from (signerId) → kind → insertion-index**
2. Pack first `MAX_TXS_PER_FRAME` transactions
3. Build FrameHeader with memRoot of sorted txs
4. Compute proposedBlock hash: `keccak256(rlp(header, txs))`

```typescript
const sortedTxs = sortTransactions(entity.mempool)
const header: FrameHeader = {
  entityId,
  height: entity.height + 1n,
  memRoot: computeMemRoot(sortedTxs),
  prevStateRoot: hashEntityState(entity.state),
  proposer: signerId
}
```

### 3. SIGN - Validation

Other quorum members verify and sign the proposed frame:

```typescript
const input: Input = [
  signerIdx,
  entityId,
  { type: 'signFrame', sig: signature }
]
```

**Verification Steps**:

1. Reconstruct identical sorted tx list from local mempool
2. Build header and compute proposedBlock hash
3. Verify hash matches the proposed frame
4. Sign the proposedBlock hash

**Deterministic Reconstruction**: Replicas must arrive at the exact same sorted transaction list and hash.

### 4. COMMIT - Finalization

When collected signatures meet the threshold, the proposer aggregates them:

```typescript
const input: Input = [
  signerIdx,
  entityId,
  {
    type: 'commitFrame',
    frame: fullFrame,
    hanko: aggregateSignature
  }
]
```

The frame now includes:
- `header`: The static fields that were signed
- `txs`: The sorted transaction list
- `postStateRoot`: keccak256 of final entity state (A4)

**Finality**: Once committed, the frame cannot be reversed.

### 5. VERIFY & APPLY - State Update

All replicas perform final verification (R-1):

```typescript
// Verify frame integrity
assert(keccak256(rlp(frame.header, frame.txs)) === proposedBlock)
// Verify aggregate signature
assert(verifyAggregate(hanko, proposedBlock, quorum) === true)
```

If both checks pass:
1. Apply transactions to state
2. Adopt the postStateRoot
3. Clear committed txs from mempool
4. Update height to frame.height

### 6. SEAL - Server Frame

The Server includes the new replica snapshot hash in its global Merkle tree and seals the ServerFrame for the tick.

## Additional Consensus Rules

**Quorum Validation**: Each EntityInput is accepted only if `quorumProof.quorumHash == keccak256(rlp(activeQuorum))`

**Signer Ordering** (A1): For every tick, the Server sorts present signerIds lexicographically (lower-case hex). The zero-based index becomes `signerIdx` in the wire envelope.

**Re-proposal Rule**: Any signer may re-propose an identical tx list in identical order after `TIMEOUT_PROPOSAL_MS` if the original proposer fails.

## Edge Cases

### Stuck Proposer

If the proposer fails to propose within `TIMEOUT_PROPOSAL_MS`:

```typescript
if (timeSinceLastBlock > TIMEOUT_PROPOSAL_MS) {
  // Any member can propose
  const emergencyProposer = members[(height + retryCount) % members.length]
}
```

**Default**: 30 seconds timeout

### Duplicate Votes

Per-signer nonces prevent replay:

```typescript
if (cmd.nonce <= signerRecords[addr].lastNonce) {
  throw new Error('Duplicate or old vote')
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
function validateProposal(entity: EntityState, frame: Frame): boolean {
  const simulated = applyTxs(entity.state, frame.txs)
  return deepEqual(simulated, frame.postState)
}
```

## Consensus Parameters

| Parameter             | Default | Description                   |
| --------------------- | ------- | ----------------------------- |
| `TIMEOUT_PROPOSAL_MS` | 30,000  | Proposer timeout              |
| `MIN_SIGNATURES`      | 67%     | BFT threshold                 |
| `MAX_TXS_PER_FRAME`   | 1,000   | Soft cap for proposer packing |
| `MEMPOOL_SIZE`        | 10,000  | Max pending txs               |

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
  .map((sig) => getMemberShares(sig.address))
  .reduce((a, b) => a + b, 0n)

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

| Metric     | Single-Signer | Multi-Signer |
| ---------- | ------------- | ------------ |
| Latency    | 100ms         | 400ms        |
| Throughput | 10,000+ TPS   | 1,000+ TPS   |
| Finality   | Instant       | 4 ticks      |
| Messages   | 0             | O(n²)        |

## Implementation

Core consensus logic in [`src/core/entity.ts`](../src/core/entity.ts):

```typescript
export function applyCommand(
  entity: EntityState,
  cmd: Command,
): { state: EntityState; outbox: Input[] } {
  switch (cmd.type) {
    case 'proposeFrame':
      return proposeFrame(entity)
    case 'signFrame':
      return signFrame(entity, cmd.sig)
    case 'commitFrame':
      return commitFrame(entity, cmd.frame, cmd.hanko)
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
