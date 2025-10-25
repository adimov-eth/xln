# Architecture Guide

XLN consists of 5 layers that compose to create a complete Byzantine-fault-tolerant payment system.

---

## Layer Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: Persistence (WAL + Snapshots)                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Layer 4: Blockchain (Settlement + Event Log)          │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Layer 3: Network (Gossip + Routing)             │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  Layer 2: Consensus (Bilateral + BFT)      │  │  │  │
│  │  │  │  ┌─────────────────────────────────────┐  │  │  │  │
│  │  │  │  │  Layer 1: Foundation (Crypto + RLP)  │  │  │  │  │
│  │  │  │  └─────────────────────────────────────┘  │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Each layer:
- **Pure functions** (no I/O)
- **Composable** (data flows between layers)
- **Testable** (verified in isolation)

---

## Layer 1: Foundation

**Purpose:** Cryptographic primitives and serialization

**Modules:**
- `core/crypto.rkt` - SHA256, frame hashing
- `core/rlp.rkt` - Ethereum-compatible RLP encoding
- `core/merkle.rkt` - Merkle tree construction and verification

**Key Functions:**

```scheme
;; SHA256 hashing
(sha256 #"data") ; → 32-byte hash

;; Frame hashing (deterministic)
(compute-frame-hash frame) ; → keccak256(rlp(frame))

;; RLP encoding (canonical)
(rlp-encode '(1 2 3)) ; → bytes

;; Merkle root
(compute-merkle-root hashes) ; → root hash
```

**Why These Primitives:**
- **SHA256:** Fast, well-tested, widely supported
- **RLP:** Ethereum compatibility (future EVM integration)
- **Merkle trees:** Efficient state proofs

**Demo:** `examples/crypto-demo.rkt`, `examples/rlp-demo.rkt`, `examples/merkle-demo.rkt`

---

## Layer 2: Consensus

**Purpose:** State machine consensus (bilateral + BFT)

### Bilateral Consensus (Account Layer)

**File:** `consensus/account/machine.rkt`

**States:** idle → pending → committed

**Transitions:**
1. **Propose:** Alice creates frame, signs it
2. **ACK:** Bob receives, verifies, signs
3. **Commit:** Alice receives both signatures, commits

**Key Types:**

```scheme
(struct account-machine (
  entity-id              ; "alice"
  counterparty-id        ; "bob"
  height                 ; Current frame number
  pending-input          ; Waiting for ACK
  mempool                ; Pending transactions
) #:mutable #:transparent)

(struct account-frame (
  height                 ; Frame number
  timestamp              ; Unix milliseconds
  prev-frame-hash        ; Chain linkage
  account-txs            ; List of transactions
  token-ids              ; Affected tokens
  deltas                 ; Balance changes
  state-hash             ; keccak256(frame)
  signatures             ; [alice-sig, bob-sig]
) #:transparent)
```

**Flow:**

```
Alice                           Bob
─────                           ───
mempool: [tx1]
  │
  ├─ propose-frame ──────────→ handle-account-input
  │                               │
  │                               ├─ verify chain
  │                               ├─ sign frame
  │                               │
  │  ←────── ACK ─────────────────┘
  │
  ├─ handle-account-input
  │    │
  │    ├─ verify both sigs
  │    └─ COMMIT
  │
[committed at height N]
```

**Demo:** `examples/bilateral-consensus-demo.rkt`

### BFT Consensus (Entity Layer)

**File:** `consensus/entity/machine.rkt`

**States:** idle → proposed → precommitted → committed

**Transitions (≥2/3 quorum):**
1. **Propose:** Proposer creates frame
2. **Precommit:** Validators lock and send precommit
3. **Commit:** Proposer collects ≥2/3 signatures, commits

**Key Types:**

```scheme
(struct entity-machine (
  entity-id              ; "entity-1"
  signer-id              ; "alice" (this replica)
  is-proposer            ; #t or #f
  height                 ; Current frame
  locked-frame           ; Precommitted frame
  mempool                ; Transactions
  validators             ; List of validator IDs
  quorum-threshold       ; ≥2/3 threshold
) #:mutable #:transparent)
```

**Flow (3 validators, threshold=2):**

```
Alice (proposer)        Bob (validator)      Charlie (validator)
────────────────        ───────────────      ──────────────────
mempool: [tx1, tx2]
  │
  ├─ create frame ──────→ handle-entity-input    handle-entity-input
  │                         │                      │
  │                         ├─ lock                ├─ lock
  │                         ├─ precommit           ├─ precommit
  │                         │                      │
  │  ←──── precommit ───────┘                      │
  │  ←──── precommit ──────────────────────────────┘
  │
  ├─ collect signatures (2/3 ✓)
  └─ COMMIT ────────────→ notify              notify
```

**Demo:** `examples/bft-consensus-demo.rkt`

---

## Layer 3: Network

**Purpose:** Discovery and routing

### Gossip (CRDT Profile Propagation)

**File:** `network/gossip.rkt`

**Key Types:**

```scheme
(struct profile (
  entity-id              ; "alice"
  capabilities           ; ["bilateral" "routing"]
  hubs                   ; List of hub entities
  metadata               ; Arbitrary key-value
  accounts               ; List of account-capacity
  timestamp              ; Last update (milliseconds)
) #:transparent)

(struct account-capacity (
  counterparty-id        ; "bob"
  token-capacities       ; hash: token-id → (send-cap . recv-cap)
) #:transparent)
```

**CRDT Property:**

```scheme
;; Last-write-wins based on timestamp
(define (gossip-announce! layer prof)
  (define existing (hash-ref (gossip-layer-profiles layer) entity-id #f))
  (cond
    [(not existing) (hash-set! ... prof)]           ; New
    [(> new-ts old-ts) (hash-set! ... prof)]        ; Update
    [else (void)]))                                  ; Ignore old
```

**Convergence:** All nodes eventually have same profiles (last timestamp wins)

**Demo:** `examples/gossip-routing-demo.rkt`

### Routing (Modified Dijkstra)

**File:** `network/routing.rkt`

**Algorithm:** Modified Dijkstra with:
- Capacity constraints (channel must have sufficient balance)
- Backward fee accumulation (fees add up from target to source)
- Success probability (based on channel utilization)

**Key Function:**

```scheme
(define/contract (find-routes graph source target amount token-id [max-routes 100])
  (->* (network-graph? string? string? exact-nonnegative-integer? exact-nonnegative-integer?)
       (exact-nonnegative-integer?)
       (listof payment-route?))
  ...)
```

**Fee Calculation:**

```scheme
;; Fee = base + (amount * feePPM / 1,000,000)
(define (calculate-fee edge amount)
  (+ (channel-edge-base-fee edge)
     (quotient (* amount (channel-edge-fee-ppm edge)) 1000000)))
```

**Critical:** Backward accumulation ensures capacity check includes ALL downstream fees.

**Example:**

```
Alice → Bob → Charlie → Dave (1000 tokens)

Fees:
  Bob charges: 10 (base) + (1000 * 100/1M) = 10
  Charlie charges: 20 + (1010 * 200/1M) = 20
  Dave charges: 15 + (1030 * 150/1M) = 15

Total fee: 45
Required from Alice: 1045 (1000 + fees)
```

**Demo:** `examples/gossip-routing-demo.rkt`

---

## Layer 4: Blockchain

**Purpose:** Settlement and event log

**File:** `blockchain/types.rkt`

**Note:** Currently simulated (not real blockchain RPC). Proves data flow works.

**Key Types:**

```scheme
(struct chain-state (
  entity-registry        ; hash: entity-id → entity-record
  reserves               ; hash: (entity-id . token-id) → amount
  next-number            ; Auto-increment entity number
  events                 ; List of event-log
  block-height           ; Current block
  block-timestamp        ; Current timestamp
) #:mutable #:transparent)
```

**Operations:**

```scheme
;; Register entity on-chain
(register-entity! chain "alice" #"board-hash") ; → entity-number

;; Fund reserves
(update-reserve! chain "alice" token-id 10000)

;; Process settlement (bilateral)
(process-settlement! chain "alice" "bob"
  (list (settlement-diff token-id -1000 1000 0)))
```

**Event Log:**

```scheme
(struct event-log (
  type                   ; 'entity-registered, 'reserve-updated, 'settlement-processed
  timestamp              ; Block timestamp
  data                   ; Event-specific data
) #:transparent)
```

**Multi-Hop Settlement:**

Alice → Bob → Charlie (500 tokens each hop):

```scheme
;; Bilateral 1: Alice ↔ Bob
(process-settlement! chain "alice" "bob"
  (list (settlement-diff token-id -500 500 0)))

;; Bilateral 2: Bob ↔ Charlie
(process-settlement! chain "bob" "charlie"
  (list (settlement-diff token-id -500 500 0)))

;; Net result:
;; Alice: -500, Bob: 0 (intermediary), Charlie: +500
```

**Demo:** `examples/blockchain-demo.rkt`

---

## Layer 5: Persistence

**Purpose:** Crash recovery via WAL + snapshots

### Write-Ahead Log (WAL)

**File:** `storage/wal.rkt`

**Structure:**

```
┌─────────────────────────────┐
│ Entry 1: checksum | data    │
├─────────────────────────────┤
│ Entry 2: checksum | data    │
├─────────────────────────────┤
│ ...                         │
└─────────────────────────────┘
```

**Properties:**
- Append-only (no in-place updates)
- SHA256 checksum per entry
- Deterministic replay from genesis

**Usage:**

```scheme
;; Create WAL
(define wal (create-wal "/path/to/log.wal"))

;; Append entries
(append-to-wal! wal '(operation propose-frame (height 1)))
(append-to-wal! wal '(operation commit-frame (height 1)))

;; Read entries (for replay)
(define entries (read-wal-entries "/path/to/log.wal"))
```

### Snapshots

**File:** `storage/snapshot.rkt`

**Structure:** S-expression serialization (human-readable)

```scheme
(snapshot
  (height 100)
  (timestamp 1234567890)
  (replicas
    ((entity-id "alice") (height 100) ...)
    ((entity-id "bob") (height 100) ...)))
```

**Usage:**

```scheme
;; Save snapshot
(save-snapshot! state "/path/to/snapshot.ss")

;; Load snapshot
(define recovered-state (load-snapshot "/path/to/snapshot.ss"))
```

### Recovery Flow

```
1. Load snapshot (height N)
2. Read WAL entries after N
3. Replay entries (deterministic)
4. Verify state hash matches

Result: Recovered to latest height
```

**Demo:** `examples/persistence-demo.rkt`

---

## Data Flow Between Layers

### Example: Alice Pays Bob 100 Tokens

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 (Foundation)                                         │
│   SHA256, RLP encoding ready                                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2 (Bilateral Consensus)                                │
│   Alice creates frame: height=1, deltas=[alice:-100, bob:100]│
│   Bob signs → Alice commits                                  │
│   Output: Committed frame with deltas                        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 (Network) - not used for direct payment              │
│   (Used for multi-hop routing discovery)                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 4 (Blockchain Settlement)                              │
│   Input: deltas from bilateral consensus                     │
│   Process: Update reserves (alice -100, bob +100)            │
│   Output: SettlementProcessed event                          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 5 (Persistence)                                        │
│   WAL logs: bilateral-propose, bilateral-commit, settlement  │
│   Snapshot saved at height 1                                 │
└─────────────────────────────────────────────────────────────┘
```

### Example: Multi-Hop Payment (Alice → Bob → Charlie)

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 (Network / Routing)                                  │
│   Input: "Alice wants to pay Charlie 500"                    │
│   Gossip profiles: Alice ↔ Bob (cap 10k), Bob ↔ Charlie (cap 8k) │
│   Pathfinding: Alice → Bob → Charlie                         │
│   Output: Route with fees                                    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2 (Bilateral Consensus) - TWO channels                 │
│   Channel 1: Alice ↔ Bob                                     │
│     Frame: alice:-500, bob:+500                              │
│   Channel 2: Bob ↔ Charlie                                   │
│     Frame: bob:-500, charlie:+500                            │
│   Output: Two committed frames                               │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 4 (Blockchain Settlement)                              │
│   Settlement 1: alice -500, bob +500                         │
│   Settlement 2: bob -500, charlie +500                       │
│   Net: alice -500, bob 0, charlie +500                       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 5 (Persistence)                                        │
│   WAL logs all operations                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Compositional Properties

**1. Pure Functions**

Every layer transformation:
```scheme
(layer-function state input) → (new-state . outputs)
```

No I/O inside consensus. Side effects at boundary only.

**2. Testable in Isolation**

Each layer has demos proving correctness independently.

**3. Data Compatibility**

- Bilateral outputs deltas
- Blockchain consumes deltas
- Same format → layers compose ✓

**4. Crash Recovery**

WAL logs everything → replay from genesis → identical state

---

## Key Insights

**Separation of concerns:**
- Foundation: primitives
- Consensus: state machines
- Network: discovery
- Blockchain: settlement
- Persistence: durability

**Composition:**
- Small functions → complex behavior
- Each layer tested independently
- Integration proven through data flow

**Determinism:**
- No timestamps in consensus
- Canonical ordering
- Pure functions
- Reproducible execution

---

**Previous:** [← Core Concepts](02-core-concepts.md)
**Next:** [API Reference →](04-api-reference.md)

λ.
