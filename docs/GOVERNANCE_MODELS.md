# XLN Governance Models: ShareholderPriority vs QuorumPriority

## The Fundamental Innovation

When creating an entity, we set a flag that determines the **source of authority**:

```typescript
type Entity = {
  id: string;
  name: string;
  shares: TokenInfo;
  quorum: QuorumConfig;
  governanceMode: 'ShareholderPriority' | 'QuorumPriority';
}
```

## ShareholderPriority Mode (Traditional Companies)

**Power flows from capital ownership**

```typescript
// Shareholders can vote to replace the board
function replaceQuorum(entity: Entity, newQuorum: QuorumConfig) {
  // Requires approval from shareholders weighted by shares
  const votingPower = calculateShareholderVotes();
  if (votingPower >= entity.shareVotingThreshold) {
    entity.quorum = newQuorum; // Board replaced!
  }
}
```

### Use Cases
- Traditional corporations (ООО, Inc.)
- Investment vehicles
- DAOs where token = power
- Liquid democracy

### Characteristics
- Board serves at shareholders' pleasure
- Hostile takeovers possible
- Market dynamics apply
- Capital accumulation = control

## QuorumPriority Mode (Protocol Organizations)

**Power flows from protocol-defined positions**

```typescript
// Quorum members cannot be replaced by shareholders
function replaceQuorum(entity: Entity, newQuorum: QuorumConfig) {
  // ONLY the current quorum can change itself
  const quorumApproval = getQuorumSignatures();
  if (quorumApproval >= entity.quorumThreshold) {
    entity.quorum = newQuorum; // Self-modification only
  }
}
```

### Use Cases
- Infrastructure protocols
- Public utilities
- Foundation governance
- Immutable smart contracts

### Characteristics
- Board is sovereign
- No hostile takeovers
- Predictable governance
- Protocol stability

## The Deep Insight

This creates two fundamentally different types of organizations:

### 1. Capital-Driven (ShareholderPriority)
- **Philosophy**: Money talks
- **Evolution**: Market forces shape governance
- **Risk**: Plutocracy, short-term thinking
- **Benefit**: Efficient capital allocation

### 2. Protocol-Driven (QuorumPriority)
- **Philosophy**: Code is law
- **Evolution**: Deliberate, careful changes
- **Risk**: Ossification, insider control
- **Benefit**: Long-term stability

## Implementation Example

```typescript
// Creating a traditional company
const traditionalCorp = createEntity({
  name: "Adimov Corp",
  governanceMode: 'ShareholderPriority',
  quorum: [
    { signer: alice, weight: 1 },
    { signer: bob, weight: 1 }
  ],
  shareVotingThreshold: 51 // 51% of shares can replace board
});

// Creating a protocol foundation
const protocolFoundation = createEntity({
  name: "XLN Foundation",
  governanceMode: 'QuorumPriority',
  quorum: [
    { signer: alice, weight: 1 },
    { signer: bob, weight: 1 },
    { signer: charlie, weight: 1 }
  ],
  quorumThreshold: 2 // 2/3 board members must agree to changes
});
```

## Critical Implications

### For ShareholderPriority Entities
- Shares are true ownership
- Board is just management
- Accumulate 51% shares = control company
- Natural market dynamics

### For QuorumPriority Entities
- Shares are economic rights only
- Board is true sovereignty
- Accumulate 100% shares = still no governance control
- Stable infrastructure

## Why This Matters

This single flag creates a spectrum of organizational possibilities:

1. **Pure Capital** (100% ShareholderPriority)
   - Like traditional public companies
   
2. **Hybrid Models** (Mixed rights)
   - Some decisions by shareholders
   - Some decisions by quorum only
   
3. **Pure Protocol** (100% QuorumPriority)
   - Like Bitcoin Core development

## The "Digital DNA" Metaphor

QuorumPriority entities have **immutable governance DNA**:
- Can't be changed by external capital pressure
- Evolution only through internal consensus
- Creates truly autonomous organizations
- Perfect for critical infrastructure

This is revolutionary because it allows creating organizations that are:
- Resistant to capture
- Predictable in governance
- Stable for decades
- True digital organisms

---

# Entity Registration Models

## Two Approaches to Entity Identity

### Model 1: Quorum-as-ID (Virtual Registration)

```typescript
// Entity ID is derived from quorum hash
entityId = keccak256(rlpEncode(quorum));

// No on-chain transaction needed
// Pure deterministic computation
// ID changes when quorum changes
```

**Advantages**:
- No gas costs
- Instant registration
- Pure computation
- Privacy preserving

**Challenges**:
- ID changes with governance
- Historical tracking harder
- No human-readable names

### Model 2: Named Registration (On-Chain Anchor)

```typescript
// Entity registers with chosen name
contract EntityRegistry {
  mapping(string => bytes32) public names;      // "adimov.eth" => quorumHash
  mapping(bytes32 => string) public reverse;     // quorumHash => "adimov.eth"
  
  function registerEntity(string name, bytes32 quorumHash) {
    require(!names[name], "Name taken");
    names[name] = quorumHash;
    reverse[quorumHash] = name;
    emit EntityRegistered(name, quorumHash);
  }
}
```

**Advantages**:
- Human-readable names
- Permanent identity
- ENS-like discovery
- Brand building

**Challenges**:
- Gas costs
- Name squatting
- Requires on-chain TX

## Hybrid Approach (Best of Both)

```typescript
type EntityID = {
  // Always have deterministic ID
  quorumId: Buffer;  // keccak256(quorum)
  
  // Optionally add named registration
  name?: string;     // "adimov.eth"
  nameProof?: TxHash; // Proof of on-chain registration
}

// Start virtual, upgrade to named later
async function upgradeToNamed(entity: Entity, desiredName: string) {
  const tx = await entityRegistry.registerEntity(
    desiredName,
    entity.quorumId
  );
  entity.nameProof = tx.hash;
  entity.name = desiredName;
}
```

## Implementation Phases

### Phase 1: Virtual Only
- Quick testing
- No blockchain needed
- Pure computation

### Phase 2: Optional Names
- Deploy EntityRegistry.sol
- Allow name registration
- Keep virtual as option

### Phase 3: Admin Curation
- Add name approval process
- Prevent spam/abuse
- Premium namespace

This gives maximum flexibility while building on solid foundations.