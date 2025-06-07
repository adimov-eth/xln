# Entity Handover Protocol: The Heart of XLN

## What is an Entity?

An Entity is a **weighted consensus machine** that:
- Is currently controlled by a set of signers (quorum)
- Can change hands through voting
- Maintains continuous operation during ownership transfer
- Has reserves that enforce good behavior

## The Handover Mechanism

### 1. Initial State
```typescript
type Entity = {
  id: string;
  quorum: {
    signers: ["A", "B", "C"],  // Current owners
    weights: [1, 1, 1],
    threshold: 2  // 2/3 majority
  },
  observers: ["D", "E"],  // Ready to take over
  state: EntityState,
  lastActivity: timestamp
}
```

### 2. Ownership Vote
```typescript
// Shareholders vote to change quorum
function voteNewQuorum(entity: Entity, newQuorum: ["C", "D", "E"]) {
  if (getShareholderVotes() >= 67%) {
    // Initiate handover
    entity.pendingQuorum = newQuorum;
    entity.handoverDeadline = now() + 2_weeks;
  }
}
```

### 3. The Critical Handover Period

**Option A: Good Behavior (Cooperative Handover)**
```typescript
// Old signers (A,B,C) feed state to new signers
function feedStateToNewQuorum() {
  for (const event of entity.events) {
    // A,B,C send state to D,E
    sendToObservers(event);
  }
  
  // After 2/3 of new quorum confirms receipt
  if (newQuorumConfirmations >= 2) {
    // Smooth transition
    entity.quorum = entity.pendingQuorum;
    // A,B automatically become observers
    // D,E automatically activate
  }
}
```

**Option B: Bad Behavior (Hostile Handover)**
```typescript
// If A,B,C refuse to cooperate
if (now() > entity.handoverDeadline && !stateTransferred) {
  // Depositary freezes A,B,C access to reserves
  depositary.freezeAccess(["A", "B", "C"], entity.id);
  
  // Entity continues with degraded state
  // D,E take over with last known good state
  entity.quorum = entity.pendingQuorum;
  entity.degraded = true;
}
```

## The Observer Pattern

### Key Innovation: Hot Standby
```typescript
type SignerRole = 
  | "Active"     // In quorum, signing blocks
  | "Observer"   // Has state, not signing
  | "Inactive"   // No state

// Observers maintain entity state but don't participate in consensus
class Signer {
  entities: Map<EntityId, {
    state: EntityState,
    role: SignerRole
  }>;
  
  // When becoming active
  activateEntity(entityId: string) {
    const entity = this.entities.get(entityId);
    if (entity.role === "Observer") {
      entity.role = "Active";
      // Can immediately start signing
      startParticipatingInConsensus(entityId);
    }
  }
}
```

### Automatic Role Transitions
```typescript
// During quorum change event
function processQuorumChange(event: QuorumChangeEvent) {
  // Old signers: Active → Observer
  for (const oldSigner of event.oldQuorum) {
    oldSigner.role = "Observer";
    oldSigner.stopSigning();
  }
  
  // New signers: Observer → Active  
  for (const newSigner of event.newQuorum) {
    newSigner.role = "Active";
    newSigner.startSigning();
    
    // First new signer becomes proposer
    if (isFirst(newSigner)) {
      newSigner.becomeProposer();
    }
  }
}
```

## Why This Design Is Brilliant

### 1. Continuous Operation
- Entity never stops during handover
- No downtime for quorum changes
- State continues to evolve

### 2. Incentive Alignment
- Old signers must cooperate or lose reserve access
- New signers are ready (observers) before takeover
- Smooth transitions are profitable

### 3. Flexibility
- Signers can be observers for multiple entities
- Hot standby for instant activation
- Gradual transitions possible

### 4. Attack Resistance
- Can't DoS entity by refusing handover
- Depositary enforces good behavior
- 2-week grace period prevents rushes

## Implementation Requirements

```typescript
interface HandoverProtocol {
  // State management
  feedState(from: Signer, to: Signer, entity: Entity): void;
  confirmStateFeed(signer: Signer, entity: Entity): void;
  
  // Role transitions
  transitionToObserver(signer: Signer, entity: Entity): void;
  activateFromObserver(signer: Signer, entity: Entity): void;
  
  // Depositary integration
  freezeReserves(signers: Signer[], entity: Entity): void;
  unfreezeReserves(signers: Signer[], entity: Entity): void;
  
  // Timeout handling
  checkHandoverDeadline(entity: Entity): void;
}
```

## Example Scenario

```typescript
// 1. Initial: ABC control "Acme Corp"
acmeCorp.quorum = ["Alice", "Bob", "Charlie"];

// 2. Dave and Eve buy shares, become observers
dave.observeEntity(acmeCorp);
eve.observeEntity(acmeCorp);

// 3. Shareholders vote: Replace ABC with CDE
voteNewQuorum(acmeCorp, ["Charlie", "Dave", "Eve"]);

// 4. Two week handover period begins
// - Alice, Bob must feed state to Dave, Eve
// - If they do: smooth transition, keep reserve access
// - If they don't: lose reserves, entity continues anyway

// 5. After handover
acmeCorp.quorum = ["Charlie", "Dave", "Eve"];
// Alice, Bob become observers (might buy back in later)
```

## Critical Insight

This makes entities truly **autonomous organizations** that can:
- Survive hostile takeovers
- Change management seamlessly  
- Incentivize cooperation
- Operate continuously

The combination of:
- Observer pattern (hot standby)
- Depositary enforcement (carrot/stick)
- Grace periods (time for orderly transition)

Creates the first truly self-governing digital organizations!