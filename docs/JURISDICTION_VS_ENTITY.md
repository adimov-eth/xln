# Jurisdiction vs Entity: The Two-Layer Architecture

## Fundamental Distinction

### Jurisdiction = Intrinsic Validator Set
- **Self-governing**: Validators determined by the system itself
- **Like Ethereum**: Nobody external controls who validates
- **Minimal functionality**: Only what MUST be at this layer
- **Broadcast channel**: All validators see all transactions

### Entity = Extrinsic Validator Set  
- **Externally governed**: Validator set comes from Ethereum contracts
- **Like a company**: Ownership can be bought/sold/transferred
- **Rich functionality**: Business logic, proposals, decisions
- **Unicast channels**: Point-to-point value transfer (later)

## Architecture Layers

```typescript
// Layer 1: Jurisdiction (Intrinsic)
type Jurisdiction = {
  validators: Signer[];  // Self-determined, like Ethereum validators
  
  // Minimal operations only
  operations: {
    registerEntity: (entity: Entity) => void;
    transferReserves: (from: Entity, to: Entity, amount: bigint) => void;
    // That's it! Keep it minimal
  }
}

// Layer 2: Entity (Extrinsic)  
type Entity = {
  validators: QuorumConfig;  // Determined by Ethereum contracts
  
  // Rich business logic
  operations: {
    createProposal: (proposal: Proposal) => void;
    voteOnProposal: (proposalId: string, vote: boolean) => void;
    executeProposal: (proposalId: string) => void;
    // Much more...
  }
}
```

## The Key Insight: External vs Internal Control

### Jurisdiction (Like a Country)
```typescript
// Nobody outside controls who runs Ethereum
// Validators emerge from staking/consensus rules
jurisdiction.validators = determineValidatorsInternally();
```

### Entity (Like a Company)
```typescript
// Ethereum smart contracts control who runs the entity
// Can be bought, sold, taken over
entity.validators = await entityProvider.getQuorum(entityId);

// Listen for Ethereum events
entityProvider.on('QuorumChanged', (entityId, newQuorum) => {
  // Entity MUST obey
  entity.updateValidators(newQuorum);
});
```

## Why This Separation Matters

### 1. Clean Architecture
- **Jurisdiction**: Infrastructure layer (roads)
- **Entity**: Application layer (cars)

### 2. Flexibility
- Entities can be bought/sold/merged
- Jurisdiction remains stable
- Different governance models coexist

### 3. Scalability  
- Jurisdiction handles only critical operations
- Entities handle all business logic
- Channels handle high-frequency transfers

## The Trading Scenario You Described

```typescript
// 1. Create a payment hub entity
const paymentHub = createEntity({
  name: "MegaHub",
  shares: 1_000_000,  // Auto-created shares
  quorum: founders
});

// 2. Hub starts operating, becomes valuable
// Processes payments, earns fees

// 3. Corporate raider sees opportunity
// Buys shares through the hub itself!
raider.buyShares(paymentHub, 510_000);  // 51%

// 4. Raider calls shareholder meeting
raider.proposeNewQuorum(paymentHub, raidersTeam);

// 5. Vote passes (51% ownership)
// Management replaced, hub taken over
// Just like buying a bank!
```

## Implementation Priorities

### Phase 1: Entity Core ✓
1. Proposal system
2. Voting mechanism  
3. Quorum changes
4. Share trading

### Phase 2: Jurisdiction Integration
1. Entity registration
2. Reserve transfers
3. Minimal operations only

### Phase 3: Channels (Later)
1. Point-to-point transfers
2. High-frequency operations
3. Dividend distributions
4. Complex financial logic

## Design Principles

### Keep Jurisdiction Minimal
```typescript
// ❌ BAD: Too much in jurisdiction
jurisdiction.operations.tradingEngine = ...;
jurisdiction.operations.dividendDistribution = ...;

// ✅ GOOD: Only essentials
jurisdiction.operations = {
  registerEntity,
  transferReserves
};
```

### Put Logic in Entities/Channels
```typescript
// Entity level: Governance, proposals, ownership
entity.operations.governanceLogic = ...;

// Channel level: Trading, dividends, swaps  
channel.operations.atomicSwap = ...;
channel.operations.dividendStream = ...;
```

## The Power of This Design

1. **Entities are tradeable companies** with real shares
2. **Hostile takeovers possible** (buy 51%, fire management)
3. **Financial primitives** at entity/channel level
4. **Jurisdiction stays simple** (like TCP/IP layer)

This creates the first true **digital corporations** that can be:
- Bought and sold atomically
- Managed by smart contracts
- Taken over through markets
- Run without human intervention

The key: **Get entities right first**, then everything else follows naturally!