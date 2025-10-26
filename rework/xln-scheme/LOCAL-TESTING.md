# Local Testing Guide

Quick guide to test XLN Racket implementation on your local device.

---

## Prerequisites

**Install Racket:**

```bash
# macOS
brew install racket

# Linux (Ubuntu/Debian)
sudo apt-get install racket

# Other platforms
# Download from https://racket-lang.org/download/
```

**Verify installation:**
```bash
racket --version
# Should show: Welcome to Racket v8.x
```

---

## Quick Test (One Command)

```bash
cd /Users/adimov/Developer/xln/rework/xln-scheme
./test-local.sh
```

**This will:**
1. ✓ Check Racket is installed
2. ✓ Test Foundation Layer (crypto, RLP, merkle)
3. ✓ Test Consensus Layer (bilateral, BFT)
4. ✓ Test Integration (network, blockchain, persistence)
5. ✓ Run all 12 demos with full output

**Expected output:**
```
═══════════════════════════════════════════════════════════
  XLN Racket - Local Testing Suite
═══════════════════════════════════════════════════════════

[1/4] Checking Racket installation...
✓ Welcome to Racket v8.17 [cs].

[2/4] Testing Foundation Layer...
  → Crypto primitives...
    ✓ Crypto works
  → RLP encoding...
    ✓ RLP works
  → Merkle trees...
    ✓ Merkle works

[3/4] Testing Consensus Layer...
  → Bilateral consensus (2-of-2)...
    ✓ Bilateral works
  → BFT consensus (≥2/3 quorum)...
    ✓ BFT works

[4/4] Testing Integration...
  → Gossip + Multi-hop routing...
    ✓ Network works
  → Blockchain settlement...
    ✓ Blockchain works
  → WAL + Crash recovery...
    ✓ Persistence works

═══════════════════════════════════════════════════════════
  Test Summary
═══════════════════════════════════════════════════════════
  Total demos: 12
  ✓ Passed: 12
  ✗ Failed: 0

🎉 All local tests passed! XLN is working correctly.
```

---

## Manual Testing (Individual Demos)

### Test Bilateral Consensus

```bash
racket examples/bilateral-consensus-demo.rkt
```

**What it tests:**
- Alice and Bob create account machines
- Alice proposes payment frame (100 tokens)
- Bob signs (ACK)
- Alice commits (2-of-2 consensus)
- Replay attack blocked

**Expected output:**
```
=== Bilateral Consensus Demo ===

=== Demo 1: Account Machine Creation ===
Alice machine: entityId=alice, counterparty=bob, height=0
Bob machine: entityId=bob, counterparty=alice, height=0

=== Demo 2: Propose Frame ===
✓ Alice proposed frame with transaction
✓ Bob received and signed (ACK)
✓ Alice committed frame

=== Demo 3: Replay Attack Prevention ===
✓ Replay protection verified
```

---

### Test BFT Consensus

```bash
racket examples/bft-consensus-demo.rkt
```

**What it tests:**
- 3 validators (Alice=proposer, Bob, Charlie)
- Quorum threshold: ≥2/3 (need 2 signatures)
- Alice proposes frame
- Bob and Charlie send precommits
- Frame committed with 2/3 quorum

---

### Test Multi-Hop Routing

```bash
racket examples/gossip-routing-demo.rkt
```

**What it tests:**
- 4-node network (Alice, Bob, Charlie, Dave)
- Gossip profile propagation (CRDT)
- Pathfinding: Alice → Bob → Charlie → Dave
- Fee calculation (backward accumulation)
- Success probability estimation

**Expected output:**
```
=== Finding Routes: Alice → Dave (1000 tokens, token 1) ===

Route found:
  Path: Alice → Bob → Charlie → Dave
  Hops: 3
  Total fee: 45
  Success probability: 60.65%
```

---

### Test Crash Recovery

```bash
racket examples/persistence-demo.rkt
```

**What it tests:**
- WAL (Write-Ahead Log) creation
- Process 8 frames, log to WAL
- Simulate crash (clear memory)
- Replay from WAL
- Verify state matches

**Expected output:**
```
=== Crash Recovery Demo ===

Initial processing: 8 frames...
✓ Processed 8 frames (height: 8)

Simulating crash... (clear memory)

Recovering from WAL...
✓ Recovered to height 8

State verification:
  Original height: 8
  Recovered height: 8
  ✓ States match
```

---

## Test Homoiconicity (Architecture Tools)

### Query Architecture

```bash
racket examples/architecture-query.rkt
```

**What it demonstrates:**
- Pattern matching on S-expression architecture
- Extract machines, modules, layers from data
- Metrics calculation

---

### Visualize Architecture

```bash
racket examples/architecture-tree.rkt
```

**Expected output:**
```
◉ XLN-SCHEME SYSTEM
├─ [LAYER] Foundation
│  ├─ [MODULE] crypto
│  ├─ [MODULE] rlp
│  └─ [MODULE] merkle
├─ [LAYER] Consensus
│  ├─ [MACHINE] bilateral (states: idle, pending, committed)
│  └─ [MACHINE] bft (states: idle, proposed, precommitted, committed)
...
```

---

### Validate Architecture

```bash
racket examples/architecture-validate.rkt
```

**What it tests:**
- Compositional validation rules
- 7 checks (system name, layers exist, machines have states, etc.)
- Returns list of violations (empty = all pass)

---

## Test Coinduction (Infinite Streams)

```bash
racket examples/coinductive-observation.rkt
```

**What it demonstrates:**
- Infinite Fibonacci sequence
- Infinite consensus evolution
- Productive observation (not termination-based)

---

## Interactive Testing (REPL)

### Launch REPL

```bash
racket
```

### Test Consensus Interactively

```scheme
> (require "consensus/account/machine.rkt")

> (define alice (create-account-machine "alice" "bob"))
> alice
(account-machine "alice" "bob" 0 #f '())

> (add-transaction! alice (account-tx "payment" (list (account-delta 1 100))))

> (account-machine-mempool alice)
'(#(struct:account-tx "payment" ((#(struct:account-delta 1 100)))))
```

### Test Crypto Interactively

```scheme
> (require "core/crypto.rkt")

> (sha256 #"hello")
#"\x2c\xf2..."

> (bytes->hex (sha256 #"hello"))
"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
```

### Test RLP Interactively

```scheme
> (require "core/rlp.rkt")

> (rlp-encode '(1 2 3))
#"\xc3\x01\x02\x03"

> (rlp-decode (rlp-encode '(1 2 3)))
'(1 2 3)
```

---

## Troubleshooting

### "racket: command not found"

**Solution:**
```bash
# macOS
brew install racket

# Linux
sudo apt-get install racket
```

---

### "sha256: unbound identifier"

**Solution:**
```bash
# Install crypto library
raco pkg install sha
```

---

### Demo fails with "contract violation"

**Check:**
1. Are you in the correct directory? (`xln-scheme/`)
2. Run test script: `./test-local.sh`
3. Check specific demo: `racket examples/bilateral-consensus-demo.rkt`

---

### Permission denied: ./test-local.sh

**Solution:**
```bash
chmod +x test-local.sh
./test-local.sh
```

---

## Next Steps

After local testing passes:

1. **Read Core Concepts:** `docs/02-core-concepts.md`
   - Understand homoiconicity, coinduction, determinism

2. **Explore Architecture:** `docs/03-architecture.md`
   - Learn 5-layer structure, data flow

3. **Try Modifying Demos:**
   - Change payment amounts in `bilateral-consensus-demo.rkt`
   - Add validators in `bft-consensus-demo.rkt`
   - Modify network topology in `gossip-routing-demo.rkt`

4. **Read API Reference:** `docs/04-api-reference.md`
   - All functions documented with examples

5. **Contribute:** `docs/07-contributing.md`
   - Add new consensus mechanisms
   - Add new token types
   - Extend layers

---

## Quick Reference

**Run all tests:**
```bash
./test-local.sh
```

**Single demo:**
```bash
racket examples/bilateral-consensus-demo.rkt
```

**Interactive REPL:**
```bash
racket
> (require "consensus/account/machine.rkt")
```

**Check installation:**
```bash
racket --version
```

**Documentation:**
- Quick start: `docs/01-getting-started.md`
- Concepts: `docs/02-core-concepts.md`
- API: `docs/04-api-reference.md`

---

λ.
