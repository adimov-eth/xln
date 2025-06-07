# XLN Implementation: Jurisdiction-First Approach

## Core Insight
Channels come later. First, we need a working jurisdiction where entities (companies) can exist, issue shares, and transfer ownership. This is the foundation everything else builds on.

## The Mental Model

### What We're Building First
A **jurisdiction** (like a mini-blockchain) where:
- 3 signers form the initial jurisdiction (you, your teammate, and third person)
- Each can register entities (companies)
- Entities automatically get shares (tokens)
- Shares can be transferred between entities
- Multi-sig governance for companies (not just single-sig)

### Why This Order Matters
- **Without entities**, channels have no participants
- **Without share transfers**, there's no value to move
- **Without governance**, companies can't evolve
- Channels are just an optimization layer on top

## Phase 1: Jurisdiction & Entities (Week 1)

### Day 1-2: Jurisdiction Setup
```typescript
// A jurisdiction is just a set of signers
type Jurisdiction = {
  signers: Signer[];  // Initial: 3 people
  entities: Map<string, Entity>;
}

// Register entity in jurisdiction
function registerEntity(
  jurisdiction: Jurisdiction,
  name: string,
  quorum: QuorumConfig
): Entity {
  // Creates entity
  // Issues initial shares
  // Broadcasts to all signers
}
```

### Day 3-4: Entity Governance
```typescript
type Entity = {
  id: string;
  name: string;  // "ООО Адимовс", "ИП Хомяков"
  quorum: QuorumConfig;  // Who controls it
  shares: TokenInfo;  // Auto-created token
}

type QuorumConfig = {
  members: Array<{
    signer: SignerId;
    weight: number;
  }>;
  threshold: number;  // e.g., 67%
}

// Single-person company: [{signer: 0, weight: 1}], threshold: 1
// Multi-sig company: [{signer: 0, weight: 1}, {signer: 1, weight: 1}], threshold: 2
```

### Day 5: Share Transfers
```typescript
// Move shares between entities
function transferShares(
  from: Entity,
  to: Entity,
  amount: bigint
): Transaction {
  // Must be signed by 'from' entity's quorum
  // Updates balances
  // Broadcasts to jurisdiction
}
```

## Phase 2: Consensus & State Sync (Week 2)

### Day 6-7: Import/Export Entities
```typescript
// Import entity to all signers at once
function importEntity(
  signers: Signer[],
  entityData: EntityState
): void {
  // Each signer gets identical copy
  // No consensus needed for import
}
```

### Day 8-9: Quorum Changes
```typescript
// Change company ownership
function changeQuorum(
  entity: Entity,
  newQuorum: QuorumConfig
): ProposalTransaction {
  // Requires approval from current quorum
  // Grace period for transition
  // Critical for company governance
}
```

### Day 10: Mock Depositary
```typescript
// Simple token tracking
class Depositary {
  // entity.shares are tracked here
  balances: Map<EntityId, Map<TokenId, bigint>>;
  
  // Reserve shares (lock them)
  reserve(entity: EntityId, token: TokenId, amount: bigint): void;
  
  // Later: this enables channels
  // For now: just tracks ownership
}
```

## Phase 3: Real Usage Testing (Week 3)

### Test Scenarios
1. **Create Companies**
   - ИП Хомяков (single-sig)
   - ООО Адимовс (multi-sig: you + teammate)
   - Test Corp (all 3 signers)

2. **Share Trading**
   - ИП Хомяков buys shares in ООО Адимовс
   - Test ownership transfers
   - Test multi-sig approvals

3. **Governance Changes**
   - Add/remove signers from companies
   - Change voting thresholds
   - Test grace periods

## What This Enables (Future)

Once we have working entities and share transfers:

1. **Channels** become simple:
   - Two entities lock shares in a channel
   - Move shares off-chain quickly
   - Settle back to jurisdiction

2. **Complex Interactions**:
   - Companies can own other companies
   - Hierarchical structures
   - DAO-like governance

3. **Real Value**:
   - Shares represent real ownership
   - Not just payment tokens
   - Governance rights included

## Key Differences from Previous Plans

### What We're NOT Doing Yet
- ❌ Payment channels
- ❌ Network layer (can use direct function calls)
- ❌ Complex signatures (simple multi-sig is enough)
- ❌ Performance optimization

### What We ARE Doing
- ✅ Multi-entity governance
- ✅ Share issuance and transfers
- ✅ Quorum management
- ✅ State synchronization across signers

## Implementation Priorities

1. **Core State Machine** (Must Have)
   - Entity creation with quorum
   - Share transfers with multi-sig
   - Quorum changes

2. **Persistence** (Must Have)
   - Save/load jurisdiction state
   - Transaction history
   - Replay capability

3. **Testing Tools** (Should Have)
   - Create test jurisdiction
   - Simulate transactions
   - Verify state consistency

4. **UI** (Nice to Have)
   - View entities and ownership
   - Create transactions
   - Sign with multiple signers

## Success Criteria

After 3 weeks:
- [ ] 3-person jurisdiction running
- [ ] Multiple entities created (single & multi-sig)
- [ ] Share transfers working with approvals
- [ ] Quorum changes implemented
- [ ] State stays synchronized
- [ ] Can replay from genesis

## Why This Is Better

1. **Correct Foundation**: Entities and governance first
2. **Real Use Case**: Company shares, not just payments
3. **Channels Make Sense**: Once you have value to move
4. **No Rework**: Everything extends naturally

The key insight: **Channels are just an optimization for moving shares quickly between entities. But first, you need entities that own shares worth moving.**