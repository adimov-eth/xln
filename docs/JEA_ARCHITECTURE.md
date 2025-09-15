# XLN J/E/A Architecture: The Complete Guide

## Executive Summary

XLN implements a **trilayer financial architecture** that separates jurisdictional collateral (J), entity governance (E), and account-level bilateral channels (A). This separation enables:

- **Billion TPS locally** with on-chain finality when needed
- **Zero-cost DAO creation** with infinite organizational complexity
- **Bilateral sovereignty** - no global consensus required
- **Cryptographic exit rights** with collateral guarantees

## The Three Layers

### J-Machine (Jurisdiction Layer)
**Purpose**: Objective collateral enforcement and dispute resolution

**Components**:
- `EntityProvider.sol` - Entity registration and control shares
- `Depository.sol` - Collateral management and slashing
- `NameProvider.sol` - Name resolution and assignment

**Key Functions**:
- Holds collateral that backs bilateral agreements
- Enforces slashing for equivocation (double-signing)
- Provides cryptographic exit through `close()` function
- No promises, only math - collateral × haircut = max loss

**Implementation**: `/contracts/ethereum/`

### E-Machine (Entity Layer)
**Purpose**: Organizational sovereignty and governance

**Components**:
- `EntityReplica` - Local consensus among entity signers
- `Hanko` - Hierarchical signature aggregation
- `BFT Consensus` - Byzantine fault tolerant voting

**Key Functions**:
- Quorum-based decision making (3f+1 validators)
- Hierarchical delegation chains
- Single-signer optimization for efficiency
- View changes on timeout/failure

**Implementation**: `/src/entity-consensus.ts`

### A-Machine (Account Layer)
**Purpose**: Bilateral payment channels at internet scale

**Components**:
- `Channel` - Bilateral state machine
- `Transition` - State change primitives (AddPayment, SettlePayment, etc.)
- `Subchannel` - Multi-token/multi-chain support

**Key Functions**:
- **ondelta**: On-chain settled amount (slow, final)
- **offdelta**: Off-chain instant amount (fast, bilateral)
- Three-zone capacity model: `[credit | collateral | credit]`
- Dry-run validation before state changes

**Implementation**: `/old_src/app/Channel.ts`

## The Bridge: RealEntityChannelBridge

The bridge connects consensus decisions (E-layer) to channel operations (A-layer):

```typescript
// src/RealEntityChannelBridge.ts
bridgeConsensusToChannel(entityState, tx) {
  switch(tx.type) {
    case 'payment_add':
      // Creates Transition.AddPayment
      // Applies to Channel state
      // Updates block history
  }
}
```

## Key Innovations

### 1. Bilateral Sovereignty
Each pair maintains their own reality. No global consensus needed.

```
Alice <-> Bob: State X
Alice <-> Carol: State Y
Bob <-> Carol: State Z
```

All three states can differ. Truth is bilateral.

### 2. Three-Zone Capacity Model

```
[← left credit | collateral | right credit →]
                      ↑
                    delta
```

- **Collateral Zone**: Backed by J-machine deposits
- **Credit Zones**: Extend beyond collateral based on trust
- **Delta Position**: Can move into credit zones

Capacity calculation:
```typescript
inCapacity = inOwnCredit + inCollateral + inPeerCredit - inAllowence
outCapacity = outPeerCredit + outCollateral + outOwnCredit - outAllowence
```

### 3. ASSUME YES with Safety Gates

The intentional "flashloan governance" design allows circular validation but is protected by:

- Minimum EOA signatures required
- Circular delegation detection (DFS traversal)
- Maximum delegation depth
- Audit trail for all validations

See: `/src/hanko-production.ts`

### 4. Fee Market Without Explosions

Safe congestion pricing using bounded curves:

```typescript
// Sigmoid curve - naturally plateaus
fee = 1 + tanh(excess * aggressiveness) * (maxMultiplier - 1)

// Logarithmic curve - gradual increase
fee = 1 + log(1 + excess * aggressiveness) * scale
```

No more `Math.pow(excess * 10, 2)` explosions.

See: `/src/fee/FeeMarketCurves.ts`

## State Flow

```
1. User Action
     ↓
2. Entity Consensus (E-layer)
     ↓
3. RealEntityChannelBridge
     ↓
4. Channel Transition (A-layer)
     ↓
5. State Update
     ↓
6. (Optional) On-chain Settlement (J-layer)
```

## Production Requirements

### What Works
- ✅ Bilateral channels with transitions
- ✅ Entity consensus with BFT
- ✅ Hanko signatures with production gates
- ✅ Safe fee market curves
- ✅ Merkle proofs for state verification

### What's Needed
- ⚠️ P2P message relay between entities
- ⚠️ L1 reorg recovery (WAL + replay)
- ⚠️ Production key management
- ⚠️ Monitoring and alerting
- ⚠️ Rate limiting and DoS protection

## Trade Credit: The Real Vision

XLN isn't competing with Lightning Network for payments. It's digitizing the **$10 trillion B2B trade credit market**.

### Why Trade Credit?
- Businesses need Net 30/60/90 terms, not instant settlement
- Credit beyond collateral based on reputation
- Bilateral sovereignty matches business relationships
- Only go on-chain for disputes (rare)

### Implementation Path
1. Invoice creation and acceptance
2. Credit limit management
3. Progressive collateralization
4. Reputation aggregation
5. Supply chain integration

See: `/examples/demos/trade-credit-demo.ts`

## Directory Structure

```
xln/
├── old_src/app/        # CORE: Channel implementation
├── src/
│   ├── entity-consensus.ts   # BFT consensus
│   ├── RealEntityChannelBridge.ts  # Integration
│   ├── hanko-production.ts   # Safe signatures
│   └── fee/FeeMarketCurves.ts  # Congestion pricing
├── contracts/          # Solidity (J-layer)
└── examples/demos/     # Trade credit vision
```

## Key Insights

1. **old_src is the foundation** - Contains the real Channel.ts, not "old" code
2. **Bilateral sovereignty works** - No global consensus needed
3. **Trade credit > payments** - Focus on B2B credit, not retail
4. **Theater vs Reality** - Much code was removed as theatrical
5. **Integration exists** - RealEntityChannelBridge actually works

## Testing

```bash
# Core channel tests
bun test test/channel-reality.test.ts

# Integration tests
bun test test/integration/full-stack.test.ts

# Production readiness
bun test test/integration/production-ready.test.ts
```

## Conclusion

XLN's J/E/A architecture isn't just another L2. It's organizational physics for the internet age. The trilayer separation enables:

- **J**: Cryptographic guarantees without global consensus
- **E**: Organizational complexity without gas costs
- **A**: Internet-scale bilateral agreements

The code exists. The tests pass. The vision is trade credit, not payments.

Build on this foundation.