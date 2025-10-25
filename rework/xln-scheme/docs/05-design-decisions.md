# Design Decisions

Why we built XLN in Racket, and the architectural choices that emerged.

---

## Why Racket?

### The Core Reason: Code = Data

**The problem with TypeScript XLN:**

```typescript
class BilateralConsensus {
  private state: AccountState;
  async transition(input: Input): Promise<Output> {
    if (this.state.phase === 'idle') {
      // Structure hidden, hard to introspect
    }
  }
}
```

You **cannot** query this structure:
- "What states exist?" → Need reflection + metadata
- "What transitions are valid?" → Hidden in if-else logic
- "Generate visualization?" → Parse AST or manual annotation

**The Racket equivalent:**

```scheme
(define bilateral-machine
  '(machine bilateral
    (states (idle pending committed))
    (transitions
      ((idle × propose) → pending)
      ((pending × sign) → committed))))
```

You **can** query this immediately:
- `(find-states machine)` → `'(idle pending committed)`
- `(find-transitions machine)` → list of valid transitions
- `(render-tree machine)` → visual representation

**No parsers. No reflection. No metadata. The structure IS data.**

This is homoiconicity, and it's not cosmetic - it enables meta-programming that's impossible in TypeScript.

---

## Architectural Decisions

### 1. Pure Functions for Consensus Logic

**Decision:** All consensus logic is pure functions. No I/O inside state machines.

**Why:**

**Determinism:** Same inputs → same state, always.

```scheme
;; Pure transition
(define/contract (bilateral-transition state input)
  (-> bilateral-state? bilateral-input? (values bilateral-state? (listof output?)))
  ...)
```

**Benefits:**
- Replay works (deterministic execution)
- Testing trivial (no mocks needed)
- Byzantine detection possible (state hash mismatch = fault)
- Parallelization safe (no shared state)

**Alternative considered:** Impure functions with I/O.

**Why rejected:** Non-determinism makes Byzantine consensus impossible. Can't detect divergence if randomness expected.

---

### 2. S-Expression Serialization

**Decision:** Use S-expressions for snapshots, not binary formats.

**Why:**

**Human-readable debugging:**

```scheme
(snapshot
  (height 100)
  (timestamp 1234567890)
  (replicas
    ((entity-id "alice") (height 100) ...)))
```

vs. binary blob: `\x89\x50\x4e\x47\x0d\x0a...`

**Benefits:**
- Inspect snapshots with `cat`
- Debug state manually
- Version control friendly (text diff)
- Native Racket support (built-in `read`/`write`)

**Alternative considered:** Protocol Buffers, MessagePack.

**Why rejected:** Binary formats require external tooling. S-expressions are native and transparent.

---

### 3. Simulated Blockchain (Not Real RPC)

**Decision:** Implement blockchain as simulated state, not JSON-RPC calls to real chain.

**Why:**

**Proof of data flow:** Demonstrates off-chain → on-chain integration works, without implementation complexity.

```scheme
(define chain (create-chain-state))
(register-entity! chain "alice" #"board-hash")
(process-settlement! chain "alice" "bob" diffs)
```

**Benefits:**
- Deterministic (no network calls)
- Fast tests (no blockchain sync)
- Pure (fits consensus determinism)
- Provable (all operations visible)

**Alternative considered:** Real Ethereum RPC via FFI.

**Why deferred:** JSON-RPC adds network non-determinism and implementation complexity. Simulate first, integrate later.

**Future:** Replace simulation with real RPC when needed. Data flow already proven.

---

### 4. Backward Fee Accumulation in Routing

**Decision:** Calculate fees backward from target to source.

**Why:**

**Capacity check must include ALL downstream fees:**

```
Alice → Bob → Charlie (1000 tokens)

Forward calculation (WRONG):
  Alice→Bob: need 1000 ✓
  Bob→Charlie: need 1000... but Bob charges 20 fee
  Charlie receives: 1000... but Charlie charges 15 fee
  PROBLEM: Not enough capacity!

Backward calculation (CORRECT):
  Charlie receives: 1000
  Charlie charges: 15 → Bob needs 1015
  Bob charges: 20 → Alice needs 1035
  Check: Alice has ≥1035? ✓
```

**Alternative considered:** Forward accumulation.

**Why rejected:** Capacity checks fail because fees aren't accounted for until too late.

**Lesson:** Multi-hop routing is non-trivial. Backward accumulation is correct.

---

### 5. CRDT Gossip (Last-Write-Wins)

**Decision:** Use timestamp-based last-write-wins for profile propagation.

**Why:**

**Eventual consistency without coordination:**

```scheme
(define (gossip-announce! layer prof)
  (cond
    [(not existing) (hash-set! ... prof)]        ; New
    [(> new-ts old-ts) (hash-set! ... prof)]     ; Update
    [else (void)]))                              ; Ignore old
```

**Benefits:**
- No central authority
- Partition-tolerant
- Converges eventually (all nodes see latest)
- Simple (just compare timestamps)

**Alternative considered:** Vector clocks, operational CRDTs.

**Why rejected:** Timestamp-based LWW sufficient for profile updates. Complexity not justified.

**Trade-off:** Clock skew can cause issues. Accepted for simplicity.

---

### 6. Separate Bilateral and Entity Layers

**Decision:** Two consensus layers - bilateral (account) and BFT (entity).

**Why:**

**Different trust models:**
- **Bilateral:** 2-of-2 (both parties must agree)
- **BFT:** ≥2/3 (Byzantine fault tolerance)

**Bilateral advantages:**
- Fast (2 signatures)
- Simple (no quorum logic)
- Private (only parties involved)

**BFT advantages:**
- Byzantine fault tolerant
- Censorship resistant
- Liveness (don't need all parties)

**Composition:**
Bilateral handles off-chain payments (fast, private).
BFT validates entity-level operations (secure, fault-tolerant).

**Alternative considered:** Single consensus layer.

**Why rejected:** Different trust assumptions. Bilateral for speed, BFT for security.

---

### 7. Pattern Matching Over If-Else

**Decision:** Use `match` for state transitions, not if-else chains.

**Why:**

**Clarity + exhaustiveness:**

```scheme
(match (cons state input)
  [(cons (account-state 'idle _ _) (propose-frame frame))
   ...]
  [(cons (account-state 'pending _ frame) (sign-frame sig))
   ...]
  [_ (error "Invalid transition")])
```

vs.

```scheme
(if (eq? (account-state-phase state) 'idle)
    (if (propose-frame? input)
        ...
        (error ...))
    (if (eq? (account-state-phase state) 'pending)
        ...
        (error ...)))
```

**Benefits:**
- All cases explicit (exhaustiveness check)
- Structure matches problem (state × input → next-state)
- Easy to see valid transitions
- No nested if-hell

**Alternative considered:** If-else chains, cond.

**Why rejected:** Pattern matching is clearer for state machines.

---

### 8. Timestamps Only in Gossip (Not Consensus)

**Decision:** Timestamps allowed in gossip, forbidden in consensus.

**Why:**

**Determinism requirement:**

Consensus must be deterministic (same inputs → same state).

Timestamps break determinism:
```scheme
;; BAD - non-deterministic
(define (process-frame frame)
  (if (> (current-milliseconds) deadline)
      ...
      ...))
```

Two replicas running at different times → different state → Byzantine fault detected.

**Gossip doesn't require determinism:**
```scheme
;; OK - gossip is eventually consistent
(define prof (profile "alice" caps hubs meta accounts (current-milliseconds)))
(gossip-announce! layer prof)
```

**Rule:** Timestamps OK for coordination (gossip). Forbidden for consensus.

---

### 9. Mutable Structs Only for Caches

**Decision:** Consensus state immutable. Only caches (mempool, gossip) mutable.

**Why:**

**Pure transitions require immutability:**

```scheme
;; Pure function - returns NEW state
(define (bilateral-transition state input)
  (define new-state (struct-copy bilateral-state state (height (+ 1 (bilateral-state-height state)))))
  (values new-state outputs))
```

**Mempool can be mutable:**
```scheme
;; Cache optimization - mutate for performance
(set-account-machine-mempool! machine (cons tx (account-machine-mempool machine)))
```

**Rule:**
- Consensus state: immutable (pure transitions)
- Caches (mempool, gossip): mutable (performance)

**Benefits:**
- Pure functions (testable, deterministic)
- Performance where needed (avoid copying large lists)

---

### 10. No Macros (Yet)

**Decision:** Don't use Racket macros for now.

**Why:**

**Simplicity first:**

Macros powerful but add complexity:
- Harder to debug (expansion errors)
- Harder to understand (meta-level code)
- Not needed yet (functions sufficient)

**When to add macros:**
- Pattern repetition (define-state-machine boilerplate)
- DSL needs (world scenarios)
- Performance critical paths

**Current status:** No need yet. Functions compose fine.

**Future:** May add macros for state machine definition boilerplate.

---

## What We Learned

### 1. Homoiconicity Enables Natural Meta-Programming

**Before:** "I should query the architecture"
**With homoiconicity:** Pattern match on S-expression, done.

No parsers, no reflection, no metadata. Structure IS data.

### 2. Determinism Is Hard But Essential

**Everything matters:**
- Transaction ordering (sort by nonce, from, kind)
- RLP encoding (canonical bytes)
- No timestamps in consensus
- No randomness

**One non-deterministic operation breaks Byzantine consensus.**

### 3. Pure Functions Scale Better

**Testing:**
```scheme
;; No mocks needed
(check-equal? (bilateral-transition state input)
              (values expected-state expected-outputs))
```

**Debugging:**
```scheme
;; Same input always produces same result
(bilateral-transition state input)  ; Run 100 times → identical
```

**Parallelization:**
```scheme
;; No shared state → safe to parallelize
(map (lambda (input) (bilateral-transition state input)) inputs)
```

### 4. Composition Over Abstraction

**Small functions:**
```scheme
(rlp-encode data)
(sha256 bytes)
(compute-frame-hash frame)
```

**Compose:**
```scheme
(sha256 (rlp-encode frame))
```

**No need for:**
- Abstract base classes
- Factory patterns
- Dependency injection frameworks

**Just compose functions.**

### 5. S-Expressions Make Everything Introspectable

**Architecture as data:**
```scheme
(find-layers xln-system)
(find-machines xln-system)
(validate-architecture xln-system)
```

**Code generation possible:**
```scheme
(generate-tests-from-architecture xln-system)
(generate-docs-from-architecture xln-system)
```

**TypeScript equivalent:** Requires parsers, AST tools, metadata.

### 6. Coinduction Models Long-Running Systems

**Channels don't terminate:**
```scheme
(define (channel-evolution state)
  (stream-cons state
    (channel-evolution (next-state state))))
```

**Safety = productive observation at each step**, not "eventually reaches safe state".

This matches reality: payment channels operate indefinitely.

---

## Mistakes We Avoided

### 1. Premature Abstraction

**Avoided:** Creating abstract state machine framework before having 3 concrete examples.

**Why:** Abstraction without examples = guessing. Let patterns emerge.

**Result:** Bilateral and BFT are separate (different enough to not force-fit single abstraction).

### 2. Over-Engineering Persistence

**Avoided:** Implementing full blockchain RPC integration immediately.

**Why:** Simulated chain proves data flow. Real integration can wait.

**Result:** Faster iteration, clearer data flow.

### 3. Mixing Determinism Levels

**Avoided:** Using timestamps inside consensus.

**Why:** Breaks determinism → Byzantine detection impossible.

**Result:** Timestamps only in gossip (coordination), forbidden in consensus (agreement).

### 4. Manual Serialization

**Avoided:** Writing custom binary encoding.

**Why:** S-expressions are built-in, human-readable, debuggable.

**Result:** `(write state)` / `(read)` just works. No custom codec needed.

---

## Future Decisions

### When to Add Real Blockchain RPC

**Trigger:** Production deployment needs on-chain settlement.

**Requirements:**
- Replace simulated chain-state with JSON-RPC calls
- Handle network non-determinism (retry logic, timeouts)
- Maintain determinism in consensus (blockchain state external)

**Design:** Blockchain layer becomes I/O boundary (like WAL). Consensus stays pure.

### When to Add WebSocket Server

**Trigger:** Multiple clients need to connect.

**Design:**
- Server layer (I/O boundary)
- Routes messages to consensus (pure)
- Broadcasts outputs (side effects)

**Pattern:** I/O shell around pure consensus core.

### When to Add Macros

**Trigger:** State machine boilerplate becomes repetitive (3+ machines).

**Design:**
```scheme
(define-state-machine bilateral
  (states idle pending committed)
  (transitions
    ((idle × propose) → pending)
    ((pending × sign) → committed)))
```

Expands to current struct definitions + transition function.

---

## Key Principles

**1. Homoiconicity First**

Code = Data enables meta-programming naturally. Don't fight this - embrace it.

**2. Determinism Non-Negotiable**

Byzantine consensus requires deterministic execution. No shortcuts.

**3. Pure Functions Scale**

Testing, debugging, parallelization all easier with pure functions.

**4. Composition Over Complexity**

Small functions → compose → complex behavior. No need for frameworks.

**5. S-Expressions Everywhere**

Architecture, state, snapshots all S-expressions. Introspectable, composable, transparent.

**6. Simplicity Until Pain**

Don't abstract until duplication emerges (3 examples). Don't optimize until slow.

---

**Previous:** [← API Reference](04-api-reference.md)
**Next:** [TypeScript Comparison →](06-typescript-comparison.md)

λ.
