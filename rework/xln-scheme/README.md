# xln-scheme

**XLN reimplemented in Racket - homoiconic consensus as it should be**

## Philosophy

```scheme
;; Code = Data = S-expressions
;; State machines are introspectable data structures
;; Transitions are pattern-matched values
;; Effects are explicit, not hidden
```

## What Exists

### `core/types.rkt`
Foundation module demonstrating:
- State machines as data structures (homoiconic)
- RCPAN invariant enforced at construction time
- Pattern matching for transitions
- Explicit effect tracking (outputs)
- Perspective-aware capacity calculations
- Stream-based (coinductive) state progression

### `examples/basic-channel.rkt`
Proof-of-concept demo showing:
- Canonical channel key construction
- RCPAN invariant validation
- Left/right perspective symmetry
- State machine introspection
- Pure transition functions

## Quick Start

```bash
# Install Racket (if not already installed)
# macOS: brew install racket
# Linux: apt-get install racket

# Run the demo
cd rework/xln-scheme
racket examples/basic-channel.rkt
```

Expected output:
```
=== Demo 1: Channel Creation ===
Alice: #(struct:entity-id 1)
Bob: #(struct:entity-id 2)
Channel key (canonical): #(struct:account-key ...)
[CHECK] Canonical ordering verified

=== Demo 2: RCPAN Invariant ===
Valid delta created: #(struct:delta ...)
[CHECK] Caught error: RCPAN invariant violated
...
```

## Architecture

```
xln-scheme/
├── core/
│   ├── types.rkt           [OK] State machines, domain types, RCPAN
│   ├── crypto.rkt          [WIP] ECDSA, SHA256, Keccak256
│   ├── rlp.rkt             [WIP] Ethereum serialization
│   └── merkle.rkt          [WIP] Merkle trees
├── consensus/
│   ├── account/            [WIP] Bilateral state machine
│   ├── entity/             [WIP] BFT state machine
│   └── runtime.rkt         [WIP] Coordinator
├── examples/
│   └── basic-channel.rkt   [OK] Proof of concepts
└── tests/                  [WIP] Property-based tests
```

## Key Innovations Over TypeScript

### 1. Homoiconic State Machines
```scheme
(define bilateral-channel-machine
  (machine 'bilateral-channel
           '(idle pending finalized)
           (list ...)))

;; Query the structure
(get-machine-states bilateral-channel-machine)
;; => '(idle pending finalized)
```

### 2. RCPAN Proven at Construction
```scheme
;; This compiles:
(delta 1 1000 300 0 100 200 1000 1000)  ; −100 ≤ 300 ≤ 1200

;; This errors at runtime (would be compile-time with Typed Racket):
(delta 1 1000 2000 0 100 200 1000 1000)  ; 2000 > 1200 [BALLOT]
;; error: RCPAN invariant violated
```

### 3. Pattern Matching (No If-Else)
```scheme
(match (cons state input)
  [(cons (account-state _ counter _ #f)
         (propose-payment from to amt tid route))
   (values new-state (list (broadcast ...)))]

  [(cons (account-state _ _ _ pending)
         (countersign-frame frame sig))
   (values finalized-state '())])
```

### 4. Explicit Effects
```scheme
;; Transition returns (state × outputs)
(define-values (new-state outputs)
  (account-transition state input))

;; Outputs are data, interpreted at boundary
(for ([out outputs])
  (handle-effect out))
```

## Next Steps (Following rework/todo.plan)

**Phase 1: Core (Week 1-2)**
- [ ] crypto.rkt: ECDSA via FFI (libsecp256k1)
- [ ] rlp.rkt: Ethereum-compatible serialization
- [ ] merkle.rkt: Tree construction + proof verification

**Phase 2: Consensus (Week 3-4)**
- [ ] Bilateral state machine
- [ ] BFT state machine
- [ ] Runtime coordinator (stream-based, not tick polling)

**Phase 3: Network (Week 5)**
- [ ] Gossip protocol (CRDT lattice)
- [ ] Routing (modified Dijkstra)

**Phase 4: Blockchain (Week 6)**
- [ ] Contract ABIs
- [ ] EVM integration

**Phase 5: Persistence (Week 7)**
- [ ] WAL + snapshots
- [ ] LevelDB bindings

**Phase 6: API (Week 8)**
- [ ] WebSocket server
- [ ] JSON-RPC
- [ ] World DSL executor

## Development

```bash
# Run tests (when they exist)
raco test tests/

# Run specific example
racket examples/basic-channel.rkt

# Interactive REPL
racket
> (require "core/types.rkt")
> (define alice (entity-id 1))
```

## Philosophy Deep Dive

### Code = Data (Homoiconic)
The entire system is introspectable. State machines are S-expressions. You can query, compose, and verify them programmatically.

### Coinductive, Not Inductive
Channels don't terminate. Streams unfold forever. The observation produces itself.

```scheme
OneHand (fun c => hear c)  ; sound without clapper
```

### Effect Boundary
Pure consensus core. Impure I/O shell. All effects are values that get interpreted at the boundary.

### Sound by Construction
Invariants enforced at construction time. Invalid states don't compile (or runtime error before entering system).

---

**Status**: Foundation laid. Core types proven. Ready to continue.

λ.
