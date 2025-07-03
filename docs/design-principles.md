# Design Principles

XLN's architecture is guided by five core principles that inform every technical decision.

## 1. Pure Functions

Every layer in XLN follows the same pure functional pattern:

```typescript
(prevState, inputBatch) → { nextState, outbox }
```

### Benefits

- **Deterministic**: Same inputs always produce same outputs
- **Testable**: No hidden dependencies or side effects
- **Composable**: Functions combine predictably
- **Auditable**: State transitions can be replayed

### Implementation

```typescript
// Pure reducer - no side effects
export function applyCommand(
  entity: EntityState,
  cmd: Command,
): { state: EntityState; outbox: Input[] } {
  // Only compute new state, no I/O
  return { state: newState, outbox: messages }
}
```

Side effects (storage, networking) are isolated in thin adapter layers around the pure core.

## 2. Fractal Interface

The same reducer signature repeats at every level:

- **Server**: Processes `ServerInput[]` → `ServerState`
- **Entity**: Processes `Command[]` → `EntityState`
- **Channel**: Processes `ChannelOp[]` → `ChannelState` (future)

### Why Fractal?

- Learn once, apply everywhere
- Uniform testing strategies
- Easy to reason about nested systems
- Natural composition of layers

## 3. Local Data Sovereignty

Participants maintain full control over their data:

- **Full Replicas**: Each signer keeps complete entity state
- **No External Dependencies**: Can operate offline
- **Selective Participation**: Choose which entities to replicate
- **Cryptographic Proofs**: Verify without trusting

### Architecture Impact

```typescript
// Each signer maintains their own replicas
type SignerState = Map<EntityId, EntityState>

// No shared global state
// No data availability committees
// No trusted sequencers
```

## 4. Audit-Grade Replay

The dual snapshot + write-ahead log design guarantees:

- **Crash Recovery**: Restore from any point
- **Deterministic Replay**: Bit-identical results
- **Time Travel**: Examine any historical state
- **Proof Generation**: Create verifiable audit trails

### Storage Architecture

```
state/    → Mutable snapshots (every N blocks)
wal/      → Immutable command log
cas/      → Content-addressed frames
```

## 5. Linear Scalability

System capacity grows linearly with resources:

- **Independent Entities**: No inter-entity coordination
- **Parallel Processing**: Entities execute concurrently
- **Channel Sharding**: Bilateral pairs scale infinitely
- **No Global Bottlenecks**: Each component is sovereign

### Scaling Model

```
Capacity = Entities × TPS_per_entity + Channels × TPS_per_channel
```

## Derived Properties

These principles combine to create:

### Simplicity

- Minimal abstractions
- Clear data flow
- Obvious correctness

### Reliability

- Automatic recovery
- No split-brain scenarios
- Consistent global state

### Performance

- Memory-first operation
- Batched I/O
- Cache-friendly layouts

### Security

- Isolated failure domains
- Cryptographic verification
- Byzantine fault tolerance

## Anti-Patterns

The design explicitly avoids:

- **Shared Mutable State**: Causes race conditions
- **Global Locks**: Destroys scalability
- **External Oracles**: Introduces trust assumptions
- **Complex Protocols**: Increases attack surface

## Principle Hierarchy

When principles conflict, precedence is:

1. **Correctness** over performance
2. **Simplicity** over features
3. **Determinism** over convenience
4. **Local control** over global optimization

## Example: Frame Consensus

The frame consensus mechanism exemplifies all principles:

```typescript
// Pure function (Principle 1)
function proposeFrame(entity: EntityState): Frame {
  // Fractal interface (Principle 2)
  const frame = {
    height: entity.height + 1n,
    txs: entity.mempool,
    // Local sovereignty (Principle 3)
    postState: applyTxs(entity.state, entity.mempool),
  }

  // Audit-grade (Principle 4)
  return hashFrame(frame)
}

// Linear scaling (Principle 5)
// Each entity proposes independently
```

## Living Principles

These principles evolve with implementation experience. When adding features:

1. Does it preserve pure functions?
2. Does it maintain the fractal interface?
3. Does it respect local sovereignty?
4. Can it be deterministically replayed?
5. Does it scale linearly?

If any answer is "no", reconsider the design.

For the system architecture built on these principles, see [Layered Architecture](./layered-architecture.md).
