# XLN: The Real Specification

## What XLN Actually Is

XLN is a trilayer architecture for programmable value movement:
- **J-layer**: Jurisdictional collateral (on-chain enforcement)
- **E-layer**: Entity consensus (organizational sovereignty)
- **A-layer**: Account channels (bilateral sovereignty)

The core insight: **No global consensus required**. Each pair maintains their own reality. Truth is bilateral.

## The Only Thing That Matters: Order Books

90% of the importance lies in the order book. Everything else is decoration.

### Core Order Book Requirements

1. **Sub-second execution** - Actually fast, not "we'll optimize later"
2. **Tight spreads** - <5 bps on majors at $1M depth
3. **Deep liquidity** - Real market makers, not theoretical vaults
4. **Deterministic matching** - Price-time priority, no games

### The Real Business Model

**Zero commissions, spread capture**:
- Balanced trades (100 USDT ↔ 100 USDC): Actually free
- Imbalanced trades: Capture the spread
- Don't advertise this. Users see "0% fees forever"

That's it. No complex tokenomics. No PIAs. No commit-reveal auctions.

## The Architecture That Works

### Bilateral Channels (A-layer)

```typescript
interface Channel {
  ondelta: bigint;   // On-chain settled (slow, final)
  offdelta: bigint;  // Off-chain instant (fast, bilateral)
  capacity: bigint;  // credit + collateral + peer_credit
}
```

**Three-zone capacity model**:
```
[← left credit | collateral | right credit →]
                     ↑
                   delta
```

This is the actual innovation. Not another perps exchange.

### Entity Consensus (E-layer)

BFT consensus among entity signers:
- Small quorums (3-5) for speed
- Hierarchical delegation via Hanko
- View changes on timeout
- Single-signer optimization when possible

### Jurisdiction Layer (J-layer)

Smart contracts for collateral and disputes:
- `Depository.sol` - Collateral management
- `EntityProvider.sol` - Entity registration
- Cryptographic exit via `close()`
- Slashing for equivocation

## Inter-Hub Congestion: The Only Complex Part

### AMM-Based Rebalancing

For hub-to-hub links with credit limit `C` and imbalance `I`:

```
utilization u = |I| / C
toll(u) = α / (1 - u)²
```

- **Balanced (u ≈ 0)**: Free or cheap
- **Imbalanced (u → 1)**: Exponentially expensive
- **Opposite direction**: Gets cheaper/rebated

This naturally rebalances the network. No oracle needed.

### HTLC Slot Management

- Max `S` concurrent hashlocks per link
- Slot rental: `fee(s) = β · s²`
- Refundable deposits that increase with usage
- Slash on timeout

## What's Real vs Theater

### Real (Keep)
- `old_src/app/Channel.ts` - The actual channel implementation
- `src/RealEntityChannelBridge.ts` - Actually connects consensus to channels
- `src/hanko-production.ts` - Production gates against circular delegation
- `src/fee/FeeMarketCurves.ts` - Safe sigmoid/log curves (no explosions)

### Theater (Already Removed)
- EntityChannelBridge/Enhanced - Fake abstractions
- Complex PIAs - Overengineered bullshit
- Token flywheels - Demand comes first, tokens later
- Most "strategies" - Hopium, not engineering

## Trade Credit: The Actual Vision

XLN isn't competing with Lightning Network for payments. It's digitizing the **$10 trillion B2B trade credit market**.

### Key Mechanics
- **Net 30/60/90 terms** - What businesses actually need
- **Credit beyond collateral** - Based on reputation
- **Invoice factoring** - 97% immediate cash for 3% fee
- **Purchase order financing** - 60-90% advance based on credit score
- **Early payment discounts** - 2/10 Net 30 style

### Dynamic Credit Scoring
```
Score = 0.35 * payment_history
      + 0.30 * credit_utilization
      + 0.20 * trade_volume
      + 0.10 * relationship_age
      + 0.05 * (1 - dispute_rate)
```

Collateral requirements adjust automatically:
- Excellent (800+): 5% collateral
- Good (700-799): 10% collateral
- Fair (600-699): 20% collateral
- Poor (<500): 50% collateral

## Implementation Priority

### Phase 1: Order Book (With Yura)
1. Build the matching engine
2. Get one pair liquid (USDC/USDT)
3. Sub-second execution
4. Spread capture for revenue

### Phase 2: Credit Channels
1. Bilateral state machines
2. Three-zone capacity model
3. Trade credit primitives
4. USDC token support

### Phase 3: Network Effects
1. Inter-hub routing with AMM congestion
2. Multi-chain bridges
3. Merchant SDKs
4. Referral system (if it matters)

## What Not to Build

### Don't Copy Hyperliquid Blindly
- Their moat was speed + liquidity, not mechanism design
- HYPE token worked because they had volume first
- Don't build a token until you have demand

### Don't Overengineer
- No Price-Improvement Auctions
- No complex commit-reveal schemes
- No 45/45/10 split theater
- No "flywheel" fantasies

### Don't Pretend
- You need real market makers
- You need actual traders
- Mechanisms don't create demand

## Technical Constraints

### Performance Requirements
- Order book: <50ms latency
- Consensus: 100ms ticks
- Channel updates: Instant (no consensus)
- Settlement: 1-5 min macroframes

### Security Model
- Minimum 1 EOA signature (no pure delegation loops)
- Maximum 3 delegation levels
- Circular delegation detection via DFS
- Deterministic replay from WAL

### Economics
- Spread capture: Primary revenue
- Congestion tolls: Inter-hub only
- Slot rental: For HTLC parallelism
- No explicit user fees

## The Hard Truth

Success requires:
1. **Market makers providing liquidity**
2. **Traders providing volume**
3. **Fast execution**
4. **Tight spreads**

Everything else is details.

## Production Readiness Checklist

### What Works
✅ Bilateral channels with transitions
✅ Entity consensus with BFT
✅ Hanko signatures with production gates
✅ Safe fee curves
✅ Trade credit mechanics

### What's Needed
⚠️ Order book matching engine
⚠️ Real market maker integration
⚠️ P2P message relay
⚠️ L1 reorg recovery
⚠️ Production key management

## Summary

XLN has two possible futures:

1. **Trading Venue**: Build order books, get liquidity, compete on execution
2. **Trade Credit Network**: B2B Net 30/60/90 with cryptographic guarantees

Pick one. Execute. Stop theorizing.

The bilateral sovereignty model is the innovation. The three-zone capacity is elegant. The trade credit vision makes sense.

Everything else is noise.

---

*"The evidence is built. XLN is real. Now ship the order book."*