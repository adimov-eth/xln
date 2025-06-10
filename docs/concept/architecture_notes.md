# XLN Architecture Documentation - Updated Architecture

## 1. Simplified 3-Layer Architecture

### Current Architecture: Server → Entity → Account

XLN now uses a simplified 3-layer architecture:

```
Server (routing + state management)
  └── Entity (consensus + business logic)
        └── Account (channel operations)
```

**Key Change**: Signer is NOT a machine layer - it's an organizational grouping concept.

### What "Signer" Actually Means

```typescript
// Signer = organizational grouping + cryptographic identity
type ServerState = {
  height: number;
  signers: EntityState[][];  // signers[signerIndex][entityIndex]
  mempool: ServerTx[];
};

type ServerTx = {
  signerIndex: number;  // which "account/group" 
  entityIndex: number;  // which entity in that group
  input: EntityInput;
};
```

**Signer Characteristics:**
- **Cryptographic identity**: Derives private key from server's master secret using index
- **Organizational grouping**: Groups entities by ownership
- **Key derivation index**: signer[0], signer[1], signer[2]... generate different keys
- **Signing authority**: Provides cryptographic signatures for entity operations

**Example:**
```
Signer[0] = "Alice's signing key" → owns entities A, B, C
Signer[1] = "Bob's signing key" → owns entities D, E  
Signer[2] = "DAO's signing key" → owns entity F
```

## 2. Core Architecture & Entity Management

### Entity-Signer Relationship

```
Entity is static and bound to jurisdiction1.entityprovider1.123id
like a domain name
while quorum is the current manager, like an IP address in DNS
tells where to write regarding this entity
one quorum can control many entities
quorum is not bound to jurisdiction
and signer already controls many quorums
```

### Entity Hierarchy

```
The golden mean is to do only quorum to quorum
but here it's important to think through upgrades
when entity changed the owning quorum
either transplant entity to new quorum
or change quorum composition - but only if all entities on all jurisdictions changed simultaneously
quorum is specifically the hash of public keys. if even one changes then the hash is new
```

## 3. Cross-Jurisdictional Swaps

### HTLC Implementation

```
**How to ensure that Hub under no circumstances can take A-tokens without locking B-tokens for Alice**

1. Order of actions — who sends what to whom
   - Hub invents secret S and hash H = keccak(S). This is done before any lock.
   - Hub-2 → channel B (jurisdiction 2). Creates recv-lock on B-tokens
   - Hub → Alice (off-chain, one packet). Sends proof-object
   - Alice-1 checks that recv-lock is really in channel B journal
   - Hub sees that mirror send-lock really lies in channel A
   - Hub reveals secret S in send-lock (channel A)
   - Alice-2 takes public S and immediately calls claim(S) in recv-lock

2. What guarantees each side has
   - Alice's guarantees: Until step 2 is completed, Hub cannot lock A-tokens in any way
   - Hub's guarantees: He locks B-tokens first, but A are still free
```

## 4. Database Architecture

### LevelDB Strategy

```
I think another option is to do it like this
each entity has its own separate leveldb
then it's easier to make a snapshot of a specific entity
without extracting from the common server database
and server database is just like a tree of entity hashes and their progression - for simulations
the difference is that entities sometimes need to start from snapshot
i.e. I'm joining RogaKopyta
I need their current state not 10 years of history
and if their state is stored inside server lvl
then it will have to be extracted from there quite awkwardly
but if you just copy paste lvl db folders
it will be fast
```

## 5. XLN Vision & Manifesto

### XLN Definition

```
**XLN** — is a programmable trust network built on a hierarchy of autonomous machines.
It replaces rollups, banks and channels with a new model: **Jurisdiction → Entities → Accounts**,
each — a separate state-time machine with cryptographic trail.
Instead of liquidity — credit lines.
Instead of data storage — local states.
Each transaction — is an agreed state change inside a trust capsule.
No shards. No DA. No intermediaries. Only consensus.
**XLN** — is not Layer 2. This is Layer 8: financial internet, where scale is not limited by blocks,
and security — doesn't require a sequencer.
```

### Technical Overview

```
**1. Radical simplification of Layer 2.**
XLN abandons rollups, sequencers, calldata compression and proof schemes.
Instead of trying to "stuff more data into L1", XLN says: "Let's not store other people's data at all."

**2. JEA-model: Jurisdiction → Entity → Account.**
• **Jurisdiction** — is a set of rules (consensus, tokenomics, dispute mechanism)
• **Entity** — programmable capsule: bank, DAO, corporation or any institution
• **Account** — final agent: human, bot, contract

**3. Principled rejection of depositing.**
Instead of "locking funds" for Layer 2 participation, participant opens a **credit line**

**4. Blocks every 100 ms. No consensus — no conflict.**
Each server aggregates state changes, collects signatures from quorum, and fixes new checkpoint.
```

## 6. Entity Types & Management

### Quorum vs Shareholder Priority

```
When creating an entity, it gets shares and add a flag.
Priority either of quorum or shareholders.
If shareholders are more important, as actually in all companies in the world, then they can choose new quorum,
new board of directors.
When priority is with quorum, not shareholders, then it becomes like inheritance token.
That is, how inheritance works now. You write a document where you write Vasya 20, Petya 30, Alena 50%.
And they can't trade with this. Now imagine that I could issue my tokens and sell them for some price.
```

### Entity vs Jurisdiction

```
So the difference between Entity and jurisdiction, jurisdiction is like super-entity, which has a set of signer-validators,
they are decided by intrinsic, that is, the system itself. Ethereum itself decides what validators it has,
no external system manages them.
And Entity, they are already tied to ether, and what events happen in ether, either Quorum changed itself,
or Shareholder Emergency Meeting and changed Quorum, it reads this and is obliged to obey.
```

## 7. Updated Architecture Benefits

### Why This Simplification?

**Removed Complexity:**
- Signer machines as separate state machines
- Three-layer hierarchy (Server → Signer → Entity)  
- Intermediate consensus layer

**Achieved:**
- Cleaner architecture with fewer layers to manage
- Better performance without intermediate state management
- Simpler reasoning with direct server-to-entity communication
- Maintained functionality for entity grouping and key management

### Alternative Naming Considerations

The founder mentioned potential alternative names:
- **Sigil** - emphasizing the symbolic/identifier aspect
- **Clavis** - emphasizing the key/access aspect

Current preference remains **Signer** for clarity and simplicity.

