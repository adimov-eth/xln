# Contributing Guide

How to extend XLN, code conventions, testing patterns, and contribution workflow.

---

## Development Setup

**Prerequisites:**
- Racket 8.0+ installed
- Git configured
- Text editor with Racket support (DrRacket, VS Code + Magic Racket, Emacs + Racket mode)

**Clone and verify:**

```bash
git clone https://github.com/yourusername/xln-scheme
cd xln-scheme
racket examples/bilateral-consensus-demo.rkt
```

If all demos pass, setup is complete.

---

## Code Style Guide

### Pattern Matching Over If-Else

**❌ Avoid:**
```scheme
(if (eq? state 'idle)
    (if (propose? input)
        ...
        (error "invalid"))
    (if (eq? state 'pending)
        ...
        (error "invalid")))
```

**✓ Prefer:**
```scheme
(match (cons state input)
  [(cons 'idle (propose-input ...)) ...]
  [(cons 'pending (sign-input ...)) ...]
  [_ (error "Invalid transition")])
```

**Why:** Exhaustiveness, clarity, matches problem structure.

---

### Pure Functions for Consensus

**All consensus logic must be pure:**

```scheme
;; ✓ Good - pure function
(define/contract (bilateral-transition state input)
  (-> bilateral-state? bilateral-input? (values bilateral-state? (listof output?)))
  (define new-state (struct-copy bilateral-state state ...))
  (values new-state outputs))

;; ❌ Bad - side effects
(define (bilateral-transition state input)
  (log-info "Processing input")  ; I/O!
  (set! global-counter (+ global-counter 1))  ; Mutation!
  ...)
```

**Rules:**
- No I/O (no `displayln`, `write`, `current-milliseconds`)
- No mutation of external state (no `set!` on globals)
- Return new state, don't modify input
- Deterministic (same inputs → same outputs)

---

### Contracts for Safety

**All public functions must have contracts:**

```scheme
(define/contract (compute-merkle-root hashes)
  (-> (listof bytes?) bytes?)
  ...)
```

**Contract patterns:**

```scheme
;; Simple predicates
(-> exact-nonnegative-integer? string? boolean?)

;; Struct predicates
(-> account-machine? account-input? account-frame?)

;; Multiple return values
(-> state? input? (values state? (listof output?)))

;; Optional parameters
(->* (graph? string? string? exact-nonnegative-integer? exact-nonnegative-integer?)
     (exact-nonnegative-integer?)  ; optional max-routes
     (listof payment-route?))
```

---

### Naming Conventions

**Predicates:** End with `?`
```scheme
(define (valid-signature? sig) ...)
(account-machine? obj)
```

**Mutators:** End with `!`
```scheme
(set-account-machine-mempool! machine txs)
(gossip-announce! layer prof)
```

**Conversion:** Use `->` separator
```scheme
(bytes->hex bytes)
(string->number str)
```

**Internal helpers:** Prefix with `_`
```scheme
(define (_compute-fee-internal edge amount) ...)
```

---

### Struct Definitions

**Transparent for debugging:**
```scheme
(struct account-frame (
  height
  timestamp
  prev-frame-hash
  account-txs
  token-ids
  deltas
  state-hash
  signatures
) #:transparent)
```

**Mutable only for caches:**
```scheme
;; Consensus state - immutable
(struct bilateral-state (phase height pending-frame) #:transparent)

;; Cache/mempool - mutable
(struct account-machine (...mempool...) #:mutable #:transparent)
```

---

## How to Extend XLN

### Add New Consensus Mechanism

**Example:** Add atomic swap consensus between two entities.

**1. Create module:**
```bash
mkdir consensus/swap
touch consensus/swap/machine.rkt
```

**2. Define state machine:**

```scheme
#lang racket
(require "../../core/crypto.rkt")
(provide (all-defined-out))

;; States: offer → locked → completed
(struct swap-machine (
  entity-id
  counterparty-id
  height
  locked-asset      ; What I'm offering
  expected-asset    ; What I expect
  phase             ; 'offer, 'locked, 'completed
) #:mutable #:transparent)

(struct swap-input (
  type              ; 'offer, 'lock, 'complete
  asset-offered
  asset-expected
  signature
) #:transparent)

(define/contract (swap-transition state input)
  (-> swap-machine? swap-input? (values swap-machine? (listof swap-output?)))
  (match (cons (swap-machine-phase state) (swap-input-type input))
    [(cons 'offer 'lock)
     ;; Transition offer → locked
     (define new-state (struct-copy swap-machine state (phase 'locked)))
     (values new-state (list (lock-confirmation ...)))]
    [(cons 'locked 'complete)
     ;; Transition locked → completed
     ...]
    [_ (error "Invalid swap transition")]))
```

**3. Add demo:**

```scheme
;; examples/swap-demo.rkt
#lang racket
(require "../consensus/swap/machine.rkt")

(define alice (create-swap-machine "alice" "bob"))
(define bob (create-swap-machine "bob" "alice"))

;; Alice offers 100 token-1 for 200 token-2
(define offer (swap-input 'offer (asset 1 100) (asset 2 200) sig-alice))
(define-values (alice-locked outputs-1) (swap-transition alice offer))

;; Bob locks
(define lock (swap-input 'lock (asset 2 200) (asset 1 100) sig-bob))
(define-values (bob-locked outputs-2) (swap-transition bob lock))

;; Complete swap
...

(displayln "✓ Atomic swap complete")
```

**4. Update ARCHITECTURE.scm:**

```scheme
(layer consensus
  (machine bilateral (states (idle pending committed)))
  (machine bft (states (idle proposed precommitted committed)))
  (machine swap (states (offer locked completed))))  ; NEW
```

**5. Add tests:**

```scheme
;; tests/swap-test.rkt
(require rackunit "../consensus/swap/machine.rkt")

(test-case "swap offer → lock"
  (define alice (create-swap-machine "alice" "bob"))
  (define offer (swap-input 'offer ...))
  (define-values (new-state outputs) (swap-transition alice offer))
  (check-equal? (swap-machine-phase new-state) 'locked))
```

---

### Add New Token Type

**Example:** Add NFT support (non-fungible tokens).

**1. Extend deltas structure:**

```scheme
;; consensus/account/types.rkt
(struct delta (
  token-id          ; Existing
  amount            ; Existing
  nft-id            ; NEW - optional NFT identifier
) #:transparent)
```

**2. Update apply logic:**

```scheme
;; consensus/account/apply.rkt
(define (apply-delta! balances delta)
  (cond
    [(delta-nft-id delta)
     ;; NFT transfer - ownership change
     (hash-set! balances (delta-nft-id delta) (delta-recipient delta))]
    [else
     ;; Fungible token - amount change
     (hash-update! balances (delta-token-id delta) (λ (bal) (+ bal (delta-amount delta))) 0)]))
```

**3. Add NFT-specific validation:**

```scheme
(define (validate-nft-transfer delta balances)
  (cond
    [(not (delta-nft-id delta)) #t]  ; Not NFT, skip
    [(not (hash-ref balances (delta-nft-id delta) #f))
     (error "NFT doesn't exist")]
    [(not (equal? (hash-ref balances (delta-nft-id delta)) sender))
     (error "NFT not owned by sender")]
    [else #t]))
```

**4. Update demos:**

```scheme
;; examples/nft-transfer-demo.rkt
(define alice-tx (account-tx "transfer-nft" (list (delta 0 0 "nft-123"))))
```

---

### Add New Layer

**Example:** Add reputation layer (track entity reliability).

**1. Create layer module:**

```bash
mkdir reputation
touch reputation/tracker.rkt
```

**2. Define layer structure:**

```scheme
#lang racket
(provide (all-defined-out))

(struct reputation-layer (
  scores            ; hash: entity-id → reputation-score
  history           ; list of reputation-event
) #:mutable #:transparent)

(struct reputation-score (
  entity-id
  score             ; 0-100
  successful-ops
  failed-ops
  last-updated
) #:transparent)

(define (create-reputation-layer)
  (reputation-layer (make-hash) '()))

(define (update-reputation! layer entity-id success?)
  (define current (hash-ref (reputation-layer-scores layer) entity-id
                            (reputation-score entity-id 50 0 0 0)))
  (define new-score
    (if success?
        (min 100 (+ (reputation-score-score current) 1))
        (max 0 (- (reputation-score-score current) 5))))
  (hash-set! (reputation-layer-scores layer) entity-id
             (struct-copy reputation-score current
                          (score new-score)
                          (successful-ops (if success? (+ 1 (reputation-score-successful-ops current))
                                              (reputation-score-successful-ops current)))
                          (failed-ops (if success? (reputation-score-failed-ops current)
                                          (+ 1 (reputation-score-failed-ops current)))))))
```

**3. Integrate with existing layers:**

```scheme
;; After successful consensus
(update-reputation! reputation-layer "alice" #t)

;; After Byzantine fault detected
(update-reputation! reputation-layer "eve" #f)
```

**4. Add queries:**

```scheme
(define (get-trusted-entities layer [threshold 80])
  (filter (lambda (score) (>= (reputation-score-score score) threshold))
          (hash-values (reputation-layer-scores layer))))
```

---

## Testing Conventions

### Unit Tests with rackunit

**Structure:**

```scheme
#lang racket
(require rackunit "path/to/module.rkt")

(test-case "describe what you're testing"
  (define input ...)
  (define expected ...)
  (check-equal? (function-under-test input) expected))
```

**Example:**

```scheme
;; tests/merkle-test.rkt
(require rackunit "../core/merkle.rkt")

(test-case "merkle root of empty list"
  (check-equal? (compute-merkle-root '()) #"empty-tree-hash"))

(test-case "merkle root of single hash"
  (define hash #"aaaa")
  (check-equal? (compute-merkle-root (list hash)) hash))

(test-case "merkle root of two hashes"
  (define hash1 #"aaaa")
  (define hash2 #"bbbb")
  (define root (compute-merkle-root (list hash1 hash2)))
  (check-equal? (bytes-length root) 32))  ; SHA256 output
```

**Run tests:**

```bash
racket tests/merkle-test.rkt
```

---

### Property-Based Testing

**For complex invariants:**

```scheme
(require rackcheck)

(test-case "transaction ordering is deterministic"
  (check-property
    (property ([txs (gen:list gen:transaction)])
      (define sorted1 (sort-transactions txs))
      (define sorted2 (sort-transactions txs))
      (equal? sorted1 sorted2))))
```

---

### Testing Determinism

**Critical for consensus:**

```scheme
(test-case "state transitions are deterministic"
  (define state (create-initial-state))
  (define input (create-test-input))

  ;; Run 100 times
  (define results
    (for/list ([i (in-range 100)])
      (bilateral-transition state input)))

  ;; All results identical
  (check-equal? (length (remove-duplicates results)) 1))
```

---

### Testing Byzantine Scenarios

**Invalid inputs should be rejected:**

```scheme
(test-case "reject frame with invalid signature"
  (define frame (create-frame ...))
  (set-account-frame-signatures! frame (list #"invalid-sig"))

  (check-exn exn:fail?
    (lambda () (validate-frame frame))))

(test-case "reject double-spend attempt"
  (define alice (create-account-machine "alice" "bob"))
  (define tx1 (account-tx "payment" (list (delta 1 -100))))
  (define tx2 (account-tx "payment" (list (delta 1 -100))))

  ;; First tx succeeds
  (add-transaction! alice tx1)
  (define frame1 (propose-frame alice 1000))

  ;; Second tx with same nonce should fail
  (check-exn exn:fail?
    (lambda () (add-transaction! alice tx2))))
```

---

## REPL-Driven Development

**XLN is designed for interactive exploration.**

**Launch REPL:**

```bash
racket
```

**Load modules interactively:**

```scheme
> (require "core/crypto.rkt")
> (sha256 #"hello")
#"\x2c\xf2..."

> (require "consensus/account/machine.rkt")
> (define alice (create-account-machine "alice" "bob"))
> alice
(account-machine "alice" "bob" 0 #f '())
```

**Iterate on functions:**

```scheme
;; Edit machine.rkt, then reload
> (enter! "consensus/account/machine.rkt")
> (create-account-machine "test" "test2")
```

**Test transitions live:**

```scheme
> (define state (create-bilateral-state))
> (define input (propose-input ...))
> (bilateral-transition state input)
(values (bilateral-state 'pending ...) (list ...))
```

**Inspect structures:**

```scheme
> (require "network/gossip.rkt")
> (define layer (create-gossip-layer))
> (gossip-announce! layer (profile "alice" ...))
> (gossip-layer-profiles layer)
#hash(("alice" . (profile "alice" ...)))
```

---

## Adding Demos

**Demos serve as:**
- Integration tests
- Documentation
- Usage examples

**Structure:**

```scheme
#lang racket
(require "path/to/modules.rkt")

;; 1. Create initial state
(displayln "=== Demo: Feature Name ===\n")
(define alice ...)
(define bob ...)

;; 2. Execute scenario
(displayln "Step 1: Alice does X")
(define result1 ...)
(displayln (format "  Result: ~a" result1))

(displayln "\nStep 2: Bob does Y")
(define result2 ...)

;; 3. Verify outcomes
(displayln "\n✓ Demo complete")
(displayln (format "  Alice height: ~a" (account-machine-height alice)))
(displayln (format "  Bob height: ~a" (account-machine-height bob)))
```

**Example: Payment channel demo**

```scheme
;; examples/payment-channel-demo.rkt
#lang racket
(require "../consensus/account/machine.rkt"
         "../consensus/account/apply.rkt")

(displayln "=== Payment Channel Demo ===\n")

;; Setup
(define alice (create-account-machine "alice" "bob"))
(define bob (create-account-machine "bob" "alice"))

;; Alice funds channel
(displayln "Alice deposits 1000 tokens")
(add-transaction! alice (account-tx "deposit" (list (delta 1 1000))))

;; Alice pays Bob
(displayln "\nAlice pays Bob 100 tokens")
(add-transaction! alice (account-tx "payment" (list (delta 1 -100) (delta 1 100))))
(define proposal (propose-frame alice 1000000))

;; Bob ACKs
(displayln "Bob receives and signs")
(define ack (handle-account-input bob proposal 1000000))

;; Alice commits
(displayln "Alice commits with both signatures")
(handle-account-input alice ack 1000000)

;; Verify
(displayln "\n✓ Payment complete")
(displayln (format "  Alice height: ~a" (account-machine-height alice)))
(displayln (format "  Bob height: ~a" (account-machine-height bob)))
```

**Add to ARCHITECTURE.scm:**

```scheme
(demos
  (demo bilateral-consensus "examples/bilateral-consensus-demo.rkt")
  (demo payment-channel "examples/payment-channel-demo.rkt"))  ; NEW
```

---

## Updating Documentation

### When to Update Docs

**Always update docs when:**
- Adding new module
- Changing function signatures
- Adding new layer/component
- Modifying data flow
- Changing architectural decisions

### Which Files to Update

**New feature added:**
1. **ARCHITECTURE.scm** - Add to S-expression structure
2. **docs/03-architecture.md** - Document layer integration
3. **docs/04-api-reference.md** - Add function documentation
4. **examples/** - Create demo showing usage

**Bug fix:**
1. **docs/05-design-decisions.md** - Document why fix was needed (if architectural)
2. **tests/** - Add regression test

**Performance improvement:**
1. **docs/05-design-decisions.md** - Document optimization rationale

### Documentation Style

**Be specific:**

❌ "This function processes data"
✓ "This function sorts transactions by nonce → from → kind for deterministic ordering"

**Include examples:**

```scheme
;; Good documentation
;; Computes Merkle root from list of hashes using SHA256
;;
;; Example:
;;   (compute-merkle-root (list #"aaaa" #"bbbb"))
;;   ; => #"\x12\x34..."
;;
;; Empty list returns hash of empty string
(define (compute-merkle-root hashes) ...)
```

**Explain why, not just what:**

```scheme
;; Why we sort by nonce → from → kind:
;; - Nonce ensures ordering within single signer
;; - From breaks ties between different signers
;; - Kind ensures determinism for same nonce+from
;; - Insertion index as final tiebreaker
```

---

## Pull Request Process

### Before Submitting

**1. All demos pass:**
```bash
./run-all-demos.sh
```

**2. Code follows style guide:**
- Pattern matching (not if-else chains)
- Contracts on public functions
- Pure functions for consensus
- Transparent structs

**3. Tests added:**
- Unit tests for new functions
- Integration test (demo) for new features
- Byzantine scenario tests for consensus changes

**4. Documentation updated:**
- ARCHITECTURE.scm
- API reference (if new public functions)
- Architecture docs (if new layer/component)
- Design decisions (if architectural choice)

### PR Template

```markdown
## Summary
Brief description of changes (1-2 sentences)

## Motivation
Why this change is needed

## Changes
- Added X module
- Modified Y function to handle Z
- Updated documentation

## Testing
- [ ] All existing demos pass
- [ ] Added new demo: examples/new-feature-demo.rkt
- [ ] Added unit tests: tests/new-feature-test.rkt
- [ ] Tested Byzantine scenarios (if consensus change)

## Documentation
- [ ] Updated ARCHITECTURE.scm
- [ ] Updated API reference
- [ ] Updated architecture docs (if applicable)

## Checklist
- [ ] Code follows style guide
- [ ] All functions have contracts
- [ ] Consensus functions are pure (no I/O)
- [ ] Structs are transparent
- [ ] No macros added (unless discussed)
```

---

## Common Patterns

### Error Handling

**Use contracts for type safety:**
```scheme
(define/contract (process-frame frame)
  (-> account-frame? (listof delta?))
  ...)
```

**Explicit errors for invalid states:**
```scheme
(match state
  ['idle ...]
  ['pending ...]
  [_ (error 'process-frame "Invalid state: ~a" state)])
```

---

### State Updates

**Immutable consensus state:**
```scheme
;; ✓ Return new state
(define new-state (struct-copy bilateral-state state
                               (height (+ 1 (bilateral-state-height state)))))

;; ❌ Don't mutate
(set-bilateral-state-height! state (+ 1 (bilateral-state-height state)))
```

**Mutable caches:**
```scheme
;; ✓ OK for mempool/gossip
(set-account-machine-mempool! machine (cons tx (account-machine-mempool machine)))
```

---

### Serialization

**S-expressions for snapshots:**
```scheme
(define (serialize-state state)
  `(bilateral-state
    (phase ,(bilateral-state-phase state))
    (height ,(bilateral-state-height state))
    (pending ,(bilateral-state-pending-frame state))))

(define (deserialize-state sexp)
  (match sexp
    [`(bilateral-state (phase ,p) (height ,h) (pending ,pf))
     (bilateral-state p h pf)]))
```

**RLP for hashing:**
```scheme
(require "core/rlp.rkt")
(define hash (sha256 (rlp-encode frame)))
```

---

## Getting Help

**Resources:**
- **Documentation:** Read `docs/` directory
- **Examples:** Study `examples/` demos
- **Tests:** Check `tests/` for patterns
- **Architecture:** Query `ARCHITECTURE.scm`

**Questions:**
- Open GitHub issue with `question` label
- Include: what you're trying to do, what you've tried, error messages

**Bugs:**
- Open GitHub issue with `bug` label
- Include: minimal reproduction, expected vs actual behavior
- Run with `racket -l errortrace -t your-file.rkt` for stack traces

---

**Previous:** [← TypeScript Comparison](06-typescript-comparison.md)
**Next:** [Production Deployment →](08-production.md)

λ.
