# API Reference

Complete reference for all XLN Racket modules.

---

## Table of Contents

**Foundation (Layer 1):**
- [crypto.rkt](#cryptorkt) - Cryptographic primitives
- [rlp.rkt](#rlprkt) - RLP encoding
- [merkle.rkt](#merklerkt) - Merkle trees

**Consensus (Layer 2):**
- [consensus/account/machine.rkt](#consensusaccountmachinerkt) - Bilateral consensus
- [consensus/entity/machine.rkt](#consensusentitymachinerkt) - BFT consensus

**Network (Layer 3):**
- [network/gossip.rkt](#networkgossiprkt) - CRDT profile propagation
- [network/routing.rkt](#networkroutingrkt) - Multi-hop pathfinding

**Blockchain (Layer 4):**
- [blockchain/types.rkt](#blockchaintypesrkt) - Settlement and event log

**Persistence (Layer 5):**
- [storage/wal.rkt](#storagewalrkt) - Write-Ahead Log
- [storage/snapshot.rkt](#storagesnapshotrkt) - State snapshots

---

## crypto.rkt

**Path:** `core/crypto.rkt`

**Purpose:** Cryptographic hashing primitives

### Functions

#### `(sha256 data)` → bytes?

Compute SHA256 hash of data.

**Parameters:**
- `data`: bytes? - Input data to hash

**Returns:** 32-byte SHA256 hash

**Example:**
```scheme
(sha256 #"hello world")
; → #"\262\224\026\372\342\317\250\301\364..."
```

---

#### `(compute-frame-hash frame)` → bytes?

Compute deterministic hash of a frame using Keccak256(RLP(frame)).

**Parameters:**
- `frame`: any/c - Frame struct to hash

**Returns:** 32-byte hash

**Example:**
```scheme
(define frame (account-frame 1 1234567 #"genesis" '() '() '() #"" '()))
(compute-frame-hash frame)
; → #"<32-byte hash>"
```

**Note:** Uses RLP encoding for canonical representation, then Keccak256 for Ethereum compatibility.

---

## rlp.rkt

**Path:** `core/rlp.rkt`

**Purpose:** Recursive Length Prefix encoding (Ethereum-compatible)

### Functions

#### `(rlp-encode value)` → bytes?

Encode value to RLP bytes.

**Parameters:**
- `value`: (or/c bytes? exact-nonnegative-integer? list?) - Value to encode

**Returns:** RLP-encoded bytes

**Supported types:**
- Bytes: `#"hello"` → encoded as byte string
- Integers: `123` → encoded as big-endian bytes
- Lists: `'(1 2 3)` → recursively encoded

**Examples:**
```scheme
;; Empty string
(rlp-encode #"")
; → #"\200"

;; Single byte (0-127)
(rlp-encode #"A")
; → #"A"

;; Short string
(rlp-encode #"hello")
; → #"\205hello"

;; Integer
(rlp-encode 1024)
; → #"\202\004\000"

;; List
(rlp-encode '(1 2 3))
; → #"\303\001\002\003"
```

---

#### `(rlp-decode bytes)` → any/c

Decode RLP bytes to Racket value.

**Parameters:**
- `bytes`: bytes? - RLP-encoded data

**Returns:** Decoded value (bytes, integer, or list)

**Example:**
```scheme
(rlp-decode #"\205hello")
; → #"hello"

(rlp-decode #"\303\001\002\003")
; → '(#"\001" #"\002" #"\003")
```

---

## merkle.rkt

**Path:** `core/merkle.rkt`

**Purpose:** Merkle tree construction and verification

### Functions

#### `(compute-merkle-root hashes)` → bytes?

Compute Merkle root from list of hashes.

**Parameters:**
- `hashes`: (listof bytes?) - Leaf hashes (must be power of 2 length)

**Returns:** 32-byte Merkle root

**Algorithm:** Binary tree, concatenate pairs, hash, repeat until single root.

**Example:**
```scheme
(define h1 (sha256 #"leaf1"))
(define h2 (sha256 #"leaf2"))
(define h3 (sha256 #"leaf3"))
(define h4 (sha256 #"leaf4"))

(compute-merkle-root (list h1 h2 h3 h4))
; → #"<merkle root>"
```

---

#### `(generate-merkle-proof hashes index)` → (listof bytes?)

Generate Merkle proof for element at index.

**Parameters:**
- `hashes`: (listof bytes?) - All leaf hashes
- `index`: exact-nonnegative-integer? - Index of element to prove

**Returns:** List of sibling hashes forming proof path

**Example:**
```scheme
(define proof (generate-merkle-proof (list h1 h2 h3 h4) 0))
; → '(#"<sibling1>" #"<sibling2>")
```

---

#### `(verify-merkle-proof root leaf index proof)` → boolean?

Verify Merkle proof.

**Parameters:**
- `root`: bytes? - Expected Merkle root
- `leaf`: bytes? - Leaf hash to verify
- `index`: exact-nonnegative-integer? - Index of leaf
- `proof`: (listof bytes?) - Proof path

**Returns:** #t if proof valid, #f otherwise

**Example:**
```scheme
(verify-merkle-proof root h1 0 proof)
; → #t
```

---

## consensus/account/machine.rkt

**Path:** `consensus/account/machine.rkt`

**Purpose:** Bilateral (2-of-2) account consensus

### Data Types

#### `(struct account-machine ...)`

Account state machine.

**Fields:**
- `entity-id`: string? - This entity's ID
- `counterparty-id`: string? - Other party's ID
- `height`: exact-nonnegative-integer? - Current frame number
- `pending-input`: (or/c account-input? #f) - Waiting for ACK
- `mempool`: (listof account-tx?) - Pending transactions

**Mutable:** Yes (mempool can be updated)

---

#### `(struct account-frame ...)`

Consensus frame (signed by both parties).

**Fields:**
- `height`: exact-nonnegative-integer? - Frame number
- `timestamp`: exact-nonnegative-integer? - Unix milliseconds
- `prev-frame-hash`: bytes? - Previous frame hash (or #"genesis")
- `account-txs`: (listof account-tx?) - Transactions in this frame
- `token-ids`: (listof exact-nonnegative-integer?) - Affected tokens
- `deltas`: (listof any/c) - Balance changes
- `state-hash`: bytes? - Hash of frame
- `signatures`: (listof bytes?) - [alice-sig, bob-sig]

---

#### `(struct account-input ...)`

Message between account machines.

**Fields:**
- `from-entity-id`: string? - Sender
- `to-entity-id`: string? - Recipient
- `height`: exact-nonnegative-integer? - Frame height
- `counter`: exact-nonnegative-integer? - Replay protection counter
- `new-account-frame`: (or/c account-frame? #f) - Proposed frame
- `prev-signatures`: (listof bytes?) - Previous signatures

---

### Functions

#### `(create-account-machine entity-id counterparty-id)` → account-machine?

Create new account machine.

**Parameters:**
- `entity-id`: string? - This entity's ID
- `counterparty-id`: string? - Other party's ID

**Returns:** Initialized account-machine at height 0

**Example:**
```scheme
(define alice (create-account-machine "alice" "bob"))
(account-machine-height alice)  ; → 0
```

---

#### `(propose-frame machine timestamp)` → (or/c account-input? #f)

Propose new frame from mempool transactions.

**Parameters:**
- `machine`: account-machine? - Account machine
- `timestamp`: exact-nonnegative-integer? - Current time (milliseconds)

**Returns:**
- `account-input?` if transactions in mempool
- `#f` if mempool empty

**Side effects:** Clears mempool, sets pending-input

**Example:**
```scheme
(set-account-machine-mempool! alice (list (account-tx "payment" '(100 1))))
(define proposal (propose-frame alice (current-seconds)))
```

---

#### `(handle-account-input machine input timestamp)` → (or/c account-input? #f)

Process incoming account input.

**Parameters:**
- `machine`: account-machine? - Account machine
- `input`: account-input? - Incoming message
- `timestamp`: exact-nonnegative-integer? - Current time

**Returns:**
- `account-input?` if response needed (ACK)
- `#f` if no response (committed or error)

**Side effects:** May update height, pending-input, clear mempool

**Example:**
```scheme
;; Bob receives Alice's proposal
(define bob-ack (handle-account-input bob alice-proposal timestamp))

;; Alice receives Bob's ACK
(handle-account-input alice bob-ack timestamp)  ; → #f (committed)
```

---

#### `(is-left? entity-id counterparty-id)` → boolean?

Check if entity is LEFT in canonical ordering.

**Parameters:**
- `entity-id`: string? - This entity
- `counterparty-id`: string? - Other entity

**Returns:** #t if entity-id < counterparty-id (lexicographic)

**Example:**
```scheme
(is-left? "alice" "bob")  ; → #t
(is-left? "bob" "alice")  ; → #f
```

**Purpose:** Deterministic ordering for bilateral consensus (left entity wins ties).

---

#### `(derive-channel-key left-id right-id)` → bytes?

Derive canonical channel key from entity IDs.

**Parameters:**
- `left-id`: bytes? - Left entity ID
- `right-id`: bytes? - Right entity ID

**Returns:** Keccak256(left-id || right-id)

**Example:**
```scheme
(derive-channel-key #"alice" #"bob")
; → #"<32-byte channel key>"

;; Same regardless of order
(equal? (derive-channel-key #"alice" #"bob")
        (derive-channel-key #"bob" #"alice"))
; → #t
```

---

## consensus/entity/machine.rkt

**Path:** `consensus/entity/machine.rkt`

**Purpose:** BFT (≥2/3 quorum) entity consensus

### Data Types

#### `(struct entity-machine ...)`

BFT state machine.

**Fields:**
- `entity-id`: string? - Entity ID
- `signer-id`: string? - This replica's ID
- `is-proposer`: boolean? - Is this replica the proposer?
- `height`: exact-nonnegative-integer? - Current height
- `locked-frame`: (or/c entity-frame? #f) - Precommitted frame
- `mempool`: (listof entity-tx?) - Pending transactions
- `validators`: (listof string?) - Validator IDs
- `quorum-threshold`: exact-nonnegative-integer? - ≥2/3 threshold

**Mutable:** Yes (mempool, locked-frame)

---

#### `(struct entity-frame ...)`

BFT consensus frame.

**Fields:**
- `height`: exact-nonnegative-integer? - Frame number
- `prev-frame-hash`: bytes? - Previous frame hash
- `transactions`: (listof entity-tx?) - Transactions
- `timestamp`: exact-nonnegative-integer? - Unix milliseconds
- `signatures`: (listof bytes?) - Validator signatures

---

### Functions

#### `(create-bft-entity entity-id validators quorum-threshold)` → entity-machine?

Create BFT entity machine.

**Parameters:**
- `entity-id`: string? - Entity ID
- `validators`: (listof string?) - List of validator IDs
- `quorum-threshold`: exact-nonnegative-integer? - ≥2/3 threshold

**Returns:** entity-machine with first validator as proposer

**Example:**
```scheme
(define entity (create-bft-entity "entity-1" '("alice" "bob" "charlie") 2))
(entity-machine-quorum-threshold entity)  ; → 2
```

---

#### `(bft-transition state input)` → (values entity-machine? (listof any/c))

Process BFT input (pure state transition).

**Parameters:**
- `state`: entity-machine? - Current state
- `input`: entity-input? - Incoming message

**Returns:** (values new-state outputs)

**Outputs:** List of messages to send

**Example:**
```scheme
(define-values (new-state outputs)
  (bft-transition entity (bft-propose frame "alice" sig)))
```

---

#### `(bft-propose frame signer-id signature)` → entity-input?

Create proposal input.

**Parameters:**
- `frame`: entity-frame? - Proposed frame
- `signer-id`: string? - Proposer ID
- `signature`: bytes? - Proposer's signature

**Returns:** entity-input for proposal

---

#### `(bft-sign signer-id signature)` → entity-input?

Create precommit input.

**Parameters:**
- `signer-id`: string? - Validator ID
- `signature`: bytes? - Validator's signature

**Returns:** entity-input for precommit

---

## network/gossip.rkt

**Path:** `network/gossip.rkt`

**Purpose:** CRDT profile propagation

### Data Types

#### `(struct profile ...)`

Entity profile (capabilities + account capacities).

**Fields:**
- `entity-id`: string? - Entity ID
- `capabilities`: (listof string?) - ["bilateral", "routing", ...]
- `hubs`: (listof string?) - Hub entity IDs
- `metadata`: hash? - Arbitrary key-value data
- `accounts`: (listof account-capacity?) - Account capacities
- `timestamp`: exact-nonnegative-integer? - Last update (milliseconds)

---

#### `(struct account-capacity ...)`

Capacity announcement for one account.

**Fields:**
- `counterparty-id`: string? - Other party ID
- `token-capacities`: hash? - token-id → (cons send-cap recv-cap)

---

#### `(struct gossip-layer ...)`

CRDT gossip state.

**Fields:**
- `profiles`: hash? - entity-id → profile

**Mutable:** Yes (profiles updated via gossip)

---

### Functions

#### `(create-gossip-layer)` → gossip-layer?

Create empty gossip layer.

**Returns:** gossip-layer with empty profiles hash

---

#### `(gossip-announce! layer prof)` → void?

Announce or update profile (CRDT last-write-wins).

**Parameters:**
- `layer`: gossip-layer? - Gossip state
- `prof`: profile? - Profile to announce

**Side effects:** Updates profiles hash if timestamp newer

**Logic:**
- If no existing profile → add
- If timestamp > existing → update
- Otherwise → ignore (stale)

**Example:**
```scheme
(define gossip (create-gossip-layer))
(define alice-prof (profile "alice" '("bilateral") '() (hash) '() 1000))
(gossip-announce! gossip alice-prof)
```

---

#### `(gossip-get-profile layer entity-id)` → (or/c profile? #f)

Get profile by entity ID.

**Parameters:**
- `layer`: gossip-layer? - Gossip state
- `entity-id`: string? - Entity to look up

**Returns:** profile? if found, #f otherwise

---

#### `(gossip-get-profiles layer)` → (listof profile?)

Get all profiles.

**Parameters:**
- `layer`: gossip-layer? - Gossip state

**Returns:** List of all profiles

---

## network/routing.rkt

**Path:** `network/routing.rkt`

**Purpose:** Multi-hop pathfinding with capacity constraints

### Data Types

#### `(struct network-graph ...)`

Network graph built from gossip.

**Fields:**
- `nodes`: set? - Set of entity IDs
- `edges`: hash? - (source . target) → channel-edge

---

#### `(struct channel-edge ...)`

Directed edge (one direction of bilateral channel).

**Fields:**
- `from-entity`: string? - Source entity
- `to-entity`: string? - Target entity
- `token-id`: exact-nonnegative-integer? - Token
- `capacity`: exact-nonnegative-integer? - Available balance
- `base-fee`: exact-nonnegative-integer? - Fixed fee
- `fee-ppm`: exact-nonnegative-integer? - Proportional fee (parts per million)

---

#### `(struct payment-route ...)`

Found payment route.

**Fields:**
- `path`: (listof string?) - Entity IDs (source → ... → target)
- `hops`: (listof hop-info?) - Detailed hop information
- `total-fee`: exact-nonnegative-integer? - Total fees
- `success-probability`: (and/c real? (between/c 0.0 1.0)) - Estimated success

---

### Functions

#### `(build-network-graph-from-gossip gossip token-id)` → network-graph?

Build routing graph from gossip profiles.

**Parameters:**
- `gossip`: gossip-layer? - Gossip state
- `token-id`: exact-nonnegative-integer? - Token to route

**Returns:** network-graph with bidirectional edges

**Example:**
```scheme
(define graph (build-network-graph-from-gossip gossip 1))
```

---

#### `(find-routes graph source target amount token-id [max-routes 100])` → (listof payment-route?)

Find payment routes using modified Dijkstra.

**Parameters:**
- `graph`: network-graph? - Routing graph
- `source`: string? - Source entity ID
- `target`: string? - Target entity ID
- `amount`: exact-nonnegative-integer? - Payment amount
- `token-id`: exact-nonnegative-integer? - Token ID
- `max-routes`: exact-nonnegative-integer? - Maximum routes to return (optional, default 100)

**Returns:** List of routes sorted by total fee (ascending)

**Algorithm:**
- Modified Dijkstra with capacity constraints
- Backward fee accumulation (fees computed from target to source)
- Success probability based on channel utilization

**Example:**
```scheme
(define routes (find-routes graph "alice" "dave" 1000 1 10))
(define best-route (car routes))
(payment-route-path best-route)       ; → '("alice" "bob" "charlie" "dave")
(payment-route-total-fee best-route)  ; → 45
```

---

## blockchain/types.rkt

**Path:** `blockchain/types.rkt`

**Purpose:** Simulated blockchain settlement and event log

**Note:** This is a simulation. Production would use real blockchain RPC.

### Data Types

#### `(struct chain-state ...)`

Blockchain state.

**Fields:**
- `entity-registry`: hash? - entity-id → entity-record
- `reserves`: hash? - (entity-id . token-id) → amount
- `next-number`: exact-nonnegative-integer? - Auto-increment entity number
- `events`: (listof event-log?) - Event log
- `block-height`: exact-nonnegative-integer? - Current block
- `block-timestamp`: exact-nonnegative-integer? - Block timestamp

**Mutable:** Yes (state updates)

---

#### `(struct settlement-diff ...)`

Settlement delta for one token.

**Fields:**
- `token-id`: exact-nonnegative-integer? - Token ID
- `left-diff`: integer? - Left entity delta (can be negative)
- `right-diff`: integer? - Right entity delta
- `collateral-diff`: integer? - Collateral change

---

### Functions

#### `(create-chain-state)` → chain-state?

Create new chain state (genesis).

**Returns:** Initialized chain-state at block 0

---

#### `(register-entity! chain entity-id board-hash)` → exact-nonnegative-integer?

Register entity on-chain.

**Parameters:**
- `chain`: chain-state? - Chain state
- `entity-id`: string? - Entity ID
- `board-hash`: bytes? - Board commitment hash

**Returns:** Assigned entity number

**Side effects:**
- Updates entity-registry
- Logs EntityRegistered event
- Increments next-number

**Example:**
```scheme
(define alice-num (register-entity! chain "alice" #"board-hash"))
; → 0 (first entity)
```

---

#### `(update-reserve! chain entity-id token-id amount)` → void?

Update entity reserve.

**Parameters:**
- `chain`: chain-state? - Chain state
- `entity-id`: string? - Entity ID
- `token-id`: exact-nonnegative-integer? - Token ID
- `amount`: exact-nonnegative-integer? - New reserve amount

**Side effects:**
- Updates reserves hash
- Logs ReserveUpdated event

---

#### `(get-reserve chain entity-id token-id)` → exact-nonnegative-integer?

Get entity reserve.

**Parameters:**
- `chain`: chain-state? - Chain state
- `entity-id`: string? - Entity ID
- `token-id`: exact-nonnegative-integer? - Token ID

**Returns:** Reserve amount (0 if not found)

---

#### `(process-settlement! chain left-entity right-entity diffs)` → void?

Process bilateral settlement.

**Parameters:**
- `chain`: chain-state? - Chain state
- `left-entity`: string? - Left entity ID
- `right-entity`: string? - Right entity ID
- `diffs`: (listof settlement-diff?) - Settlement deltas

**Side effects:**
- Updates reserves for both entities
- Logs SettlementProcessed event

**Example:**
```scheme
(process-settlement! chain "alice" "bob"
  (list (settlement-diff 1 -1000 1000 0)))
```

---

#### `(get-events chain [event-type #f])` → (listof event-log?)

Get event log.

**Parameters:**
- `chain`: chain-state? - Chain state
- `event-type`: (or/c symbol? #f) - Filter by type (optional)

**Returns:** List of events (filtered if type specified)

**Example:**
```scheme
;; Get all events
(get-events chain)

;; Get only settlements
(get-events chain 'settlement-processed)
```

---

## storage/wal.rkt

**Path:** `storage/wal.rkt`

**Purpose:** Write-Ahead Log for crash recovery

### Data Types

#### `(struct wal ...)`

Write-Ahead Log.

**Fields:**
- `path`: path-string? - File path
- `next-entry-index`: exact-nonnegative-integer? - Next entry number
- `entries`: (listof wal-entry?) - In-memory entries

**Mutable:** Yes (entries appended)

---

#### `(struct wal-entry ...)`

Single WAL entry.

**Fields:**
- `index`: exact-nonnegative-integer? - Entry number
- `checksum`: bytes? - SHA256 checksum
- `data`: any/c - S-expression data

---

### Functions

#### `(create-wal path)` → wal?

Create or open WAL file.

**Parameters:**
- `path`: path-string? - WAL file path

**Returns:** wal struct

**Side effects:** Creates file if doesn't exist

---

#### `(append-to-wal! wal data)` → void?

Append entry to WAL.

**Parameters:**
- `wal`: wal? - WAL instance
- `data`: any/c - Data to log (S-expression)

**Side effects:**
- Computes SHA256 checksum
- Appends to file
- Updates in-memory entries

**Example:**
```scheme
(append-to-wal! wal '(operation propose-frame (height 1)))
```

---

#### `(read-wal-entries path)` → (listof wal-entry?)

Read all entries from WAL file.

**Parameters:**
- `path`: path-string? - WAL file path

**Returns:** List of entries

**Example:**
```scheme
(define entries (read-wal-entries "/path/to/log.wal"))
```

---

#### `(verify-wal-integrity path)` → boolean?

Verify all checksums in WAL.

**Parameters:**
- `path`: path-string? - WAL file path

**Returns:** #t if all checksums valid, #f otherwise

---

## storage/snapshot.rkt

**Path:** `storage/snapshot.rkt`

**Purpose:** State snapshots for fast recovery

### Functions

#### `(save-snapshot! state path)` → void?

Save state snapshot.

**Parameters:**
- `state`: any/c - State to snapshot (S-expression serializable)
- `path`: path-string? - Snapshot file path

**Side effects:** Writes S-expression to file

**Example:**
```scheme
(save-snapshot! replicas "/tmp/snapshot.ss")
```

---

#### `(load-snapshot path)` → any/c

Load state snapshot.

**Parameters:**
- `path`: path-string? - Snapshot file path

**Returns:** Restored state

**Example:**
```scheme
(define recovered-state (load-snapshot "/tmp/snapshot.ss"))
```

---

## Usage Examples

### Example 1: Bilateral Payment

```scheme
(require "consensus/account/machine.rkt")

;; Create machines
(define alice (create-account-machine "alice" "bob"))
(define bob (create-account-machine "bob" "alice"))

;; Alice adds transaction
(define tx (account-tx "payment" '(100 1)))
(set-account-machine-mempool! alice (list tx))

;; Alice proposes
(define proposal (propose-frame alice (current-seconds)))

;; Bob receives and ACKs
(define ack (handle-account-input bob proposal (current-seconds)))

;; Alice receives ACK and commits
(handle-account-input alice ack (current-seconds))

;; Both at height 1 now
(account-machine-height alice)  ; → 1
(account-machine-height bob)    ; → 1
```

### Example 2: Multi-Hop Routing

```scheme
(require "network/gossip.rkt" "network/routing.rkt")

;; Create gossip layer
(define gossip (create-gossip-layer))

;; Announce profiles
(gossip-announce! gossip alice-profile)
(gossip-announce! gossip bob-profile)
(gossip-announce! gossip charlie-profile)

;; Build graph
(define graph (build-network-graph-from-gossip gossip 1))

;; Find routes
(define routes (find-routes graph "alice" "charlie" 1000 1))
(define best (car routes))

(payment-route-path best)       ; → '("alice" "bob" "charlie")
(payment-route-total-fee best)  ; → 35
```

### Example 3: Blockchain Settlement

```scheme
(require "blockchain/types.rkt")

;; Create chain
(define chain (create-chain-state))

;; Register entities
(register-entity! chain "alice" #"hash1")
(register-entity! chain "bob" #"hash2")

;; Fund reserves
(update-reserve! chain "alice" 1 10000)
(update-reserve! chain "bob" 1 5000)

;; Process settlement
(process-settlement! chain "alice" "bob"
  (list (settlement-diff 1 -1000 1000 0)))

;; Verify
(get-reserve chain "alice" 1)  ; → 9000
(get-reserve chain "bob" 1)    ; → 6000
```

### Example 4: Crash Recovery

```scheme
(require "storage/wal.rkt" "storage/snapshot.rkt")

;; Create WAL
(define wal (create-wal "/tmp/consensus.wal"))

;; Log operations
(append-to-wal! wal '(propose 1))
(append-to-wal! wal '(commit 1))

;; Save snapshot
(save-snapshot! state "/tmp/snapshot.ss")

;; ... crash ...

;; Recover
(define recovered (load-snapshot "/tmp/snapshot.ss"))
(define entries (read-wal-entries "/tmp/consensus.wal"))

;; Replay entries after snapshot
```

---

**Previous:** [← Architecture](03-architecture.md)
**Next:** [Design Decisions →](05-design-decisions.md)

λ.
