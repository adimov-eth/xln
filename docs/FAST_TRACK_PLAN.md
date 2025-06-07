# XLN Fast Track Implementation Plan

## Goal
Get a working payment channel system with single-signature entities operational ASAP for team testing, while maintaining compatibility with the full XLN vision.

## Core Principle
**Ship testable payment channels in 2-3 weeks**, then iterate based on real usage.

---

## Phase 0: Immediate Simplifications (Current State)
**What we have**: Server, Entity state machines, persistence
**What we simplify**: 
- Single-signature entities only (no multi-sig for now)
- Mock depositary (just track balances in memory)
- Skip BLS, use simple secp256k1 signatures

---

## Phase 1: Minimal Auth & Network (3 days)
**Goal**: Connect real clients to server

### Day 1: Basic Auth
```typescript
// Simplified entity creation
type CreateEntityRequest = {
  publicKey: string;  // secp256k1 public key
  metadata?: { name?: string };
}

// Entity is just publicKey -> entityId mapping
entityId = keccak256(publicKey).slice(0, 20); // Like Ethereum address
```

### Day 2: WebSocket Server
- Simple WebSocket on port 8080
- JSON-RPC messages
- Auth: Sign timestamp with private key
- Route: entityId → entity state machine

### Day 3: Minimal Client
```typescript
class XLNClient {
  constructor(privateKey: string, wsUrl: string);
  async connect(): Promise<void>;
  async createEntity(): Promise<string>;
  async openChannel(peer: string, amount: bigint): Promise<string>;
  async pay(channelId: string, amount: bigint): Promise<void>;
}
```

**Deliverable**: Two clients can connect and see each other

---

## Phase 2: Basic Payment Channels (4 days)
**Goal**: Open channels and make payments

### Day 4-5: Channel State Machine
```typescript
type Channel = {
  id: Buffer;
  participants: [string, string];  // Just two entity IDs
  balances: [bigint, bigint];      // Simple balance tracking
  nonce: bigint;
  status: 'open' | 'closed';
}

// Operations
function openChannel(from: Entity, to: Entity, deposit: bigint): Channel;
function updateChannel(channel: Channel, payment: Payment): Channel;
function closeChannel(channel: Channel): void;
```

### Day 6: Payment Flow
```typescript
type Payment = {
  channelId: string;
  amount: bigint;
  nonce: bigint;
  signature: string;  // secp256k1 signature
}

// Direct payment: A → B
// 1. A signs payment
// 2. A sends to server
// 3. Server validates & updates channel
// 4. Server notifies B
// 5. B acknowledges
```

### Day 7: Integration & Testing
- Open channel between two entities
- Send payments back and forth
- Close channel cooperatively
- Basic UI/CLI for testing

**Deliverable**: Working payment channels!

---

## Phase 3: Mock Depositary & Credits (3 days)
**Goal**: Add reserve/credit system (simplified)

### Day 8: Mock Depositary
```typescript
class MockDepositary {
  balances: Map<string, bigint> = new Map();
  
  // Fake deposit - just increases balance
  deposit(entity: string, amount: bigint): void {
    this.balances.set(entity, (this.balances.get(entity) ?? 0n) + amount);
  }
  
  withdraw(entity: string, amount: bigint): void {
    // Just decrease balance
  }
}
```

### Day 9: Credit System
```typescript
type ChannelWithCredit = Channel & {
  creditLimits: [bigint, bigint];  // A gives B credit, B gives A credit
  maxCapacity(): bigint {
    // capacity = balance + credit
  }
}
```

### Day 10: Testing Credits
- Open channel with asymmetric funding
- Use credits to enable bi-directional flow
- Test credit limits

**Deliverable**: Reserve-credit system working!

---

## Phase 4: Multi-Hop Payments (3 days)
**Goal**: Route payments through multiple channels

### Day 11: Path Finding
```typescript
function findPath(from: string, to: string, amount: bigint): Channel[] {
  // Simple BFS through channel graph
  // Check capacity along path
}
```

### Day 12: HTLC-like Routing
```typescript
type ConditionalPayment = Payment & {
  condition: Buffer;    // Hash for HTLC
  timeout: number;      // Block height
}
```

### Day 13: End-to-End Multi-Hop
- A → B → C payment flow
- Atomic success/failure
- Test with 3-4 nodes

**Deliverable**: Multi-hop payments working!

---

## What We Defer

1. **Multi-sig entities** - Add later when needed for companies
2. **Real depositary** - Keep mock until Ethereum integration needed  
3. **BLS signatures** - secp256k1 is fine for now
4. **Merkle trees** - Not needed until 1000+ channels
5. **Complex consensus** - Single server is fine for testing

---

## Success Criteria (2 weeks)

✅ **Week 1**:
- [ ] Clients can connect via WebSocket
- [ ] Single-sig entities can be created
- [ ] Direct payment channels work
- [ ] 10+ payments/second between two entities

✅ **Week 2**:
- [ ] Credit system enables bi-directional flow
- [ ] Multi-hop payments work (A → B → C)
- [ ] Basic UI for team testing
- [ ] 100+ concurrent channels

---

## Technical Decisions

### Why Single-Sig First?
- 10x simpler implementation
- Covers 90% of use cases (individual users)
- Multi-sig can be added without breaking changes

### Why Mock Depositary?
- Removes Ethereum dependency
- Allows testing pure channel logic
- Can add real depositary anytime

### Why secp256k1 over BLS?
- Already have libraries
- Ethereum compatible
- BLS only matters at scale

---

## Next Steps After MVP

1. **Based on Testing Feedback**:
   - Performance bottlenecks?
   - Missing features?
   - UX improvements?

2. **Then Add Complexity**:
   - Multi-sig entities (companies)
   - Real depositary (Ethereum bridge)
   - State optimization (Merkle trees)
   - Multiple servers (consensus)

---

## Implementation Checklist

### Week 1
- [ ] Monday: Basic auth system
- [ ] Tuesday: WebSocket server  
- [ ] Wednesday: Client SDK
- [ ] Thursday: Channel state machine
- [ ] Friday: Payment flow + testing

### Week 2  
- [ ] Monday: Mock depositary
- [ ] Tuesday: Credit system
- [ ] Wednesday: Path finding
- [ ] Thursday: Multi-hop payments
- [ ] Friday: Integration testing + UI

---

## Code Structure (Simplified)

```
src/
├── auth/
│   └── singleSig.ts      # Just secp256k1 auth
├── network/
│   └── websocket.ts      # Simple WS server
├── channels/
│   ├── state.ts          # Channel state machine
│   └── payments.ts       # Payment logic
├── mock/
│   └── depositary.ts     # Fake depositary
└── client/
    └── sdk.ts            # Client library
```

---

This plan gets you to **testable payment channels in 2 weeks** while keeping the door open for all future enhancements. The key is starting simple and iterating based on real usage.