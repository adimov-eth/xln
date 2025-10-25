# Getting Started with XLN Racket Implementation

**Goal:** Get XLN running in 5 minutes.

---

## Prerequisites

**Required:**
- Racket (version 8.0+)

**Installation:**

```bash
# macOS
brew install racket

# Linux (Ubuntu/Debian)
apt-get install racket

# Other platforms
# Download from https://racket-lang.org/download/
```

**Verify installation:**
```bash
racket --version
# Should show: Welcome to Racket v8.x
```

---

## Quick Start (3 commands)

```bash
# 1. Navigate to XLN Racket implementation
cd /path/to/xln/rework/xln-scheme

# 2. Run your first demo
racket examples/bilateral-consensus-demo.rkt

# 3. Celebrate! You just ran Byzantine consensus in Racket.
```

**Expected output:**
```
=== Bilateral Consensus Demo ===

=== Demo 1: Account Machine Creation ===
Alice machine: entityId=alice, counterparty=bob, height=0
Bob machine: entityId=bob, counterparty=alice, height=0
...
✓ Alice proposed frame with transaction
✓ Bob received and signed (ACK)
✓ Alice committed frame
✓ Replay protection verified
```

---

## What Just Happened?

You ran a complete bilateral consensus flow:

1. **Alice and Bob** created account machines
2. **Alice proposed** a payment frame (100 tokens)
3. **Bob signed** (ACK) the frame
4. **Alice committed** the frame (both parties agree)
5. **Replay attack** blocked (old counter rejected)

This proves **2-of-2 consensus works** in ~100 lines of Racket code.

---

## Try More Demos

### BFT Consensus (3 validators, ≥2/3 quorum)
```bash
racket examples/bft-consensus-demo.rkt
```

**What it demonstrates:**
- 3 validators (Alice=proposer, Bob, Charlie)
- Alice proposes frame
- Bob and Charlie send precommits
- Quorum reached (2/3 signatures)
- Frame committed

### Multi-Hop Routing
```bash
racket examples/gossip-routing-demo.rkt
```

**What it demonstrates:**
- 4-node network (Alice, Bob, Charlie, Dave)
- Gossip profile propagation (CRDT)
- Pathfinding: Alice → Bob → Charlie → Dave
- Fee calculation (45 tokens total)
- Success probability (60.65%)

### Blockchain Settlement
```bash
racket examples/blockchain-demo.rkt
```

**What it demonstrates:**
- Entity registration on-chain
- Reserve funding (Alice 10000, Bob 5000)
- Bilateral settlement (Alice -1000, Bob +1000)
- Multi-hop settlement (Alice → Bob → Charlie)
- Event log tracking

### Crash Recovery
```bash
racket examples/persistence-demo.rkt
```

**What it demonstrates:**
- WAL append-only logging
- Snapshot at height 5
- Crash simulation
- Recovery from snapshot
- WAL replay (entries 6-8)
- State verification

---

## Run All Demos

```bash
# Run all 17 demos
for demo in examples/*.rkt; do
  echo "Running $(basename $demo)..."
  racket "$demo"
  echo ""
done
```

**All demos pass. 17/17. ✓**

---

## Project Structure

```
xln-scheme/
├── core/                      # Foundation
│   ├── crypto.rkt            # SHA256, frame hashing
│   ├── rlp.rkt               # Ethereum RLP encoding
│   └── merkle.rkt            # Merkle tree computation
│
├── consensus/                 # State machines
│   ├── account/machine.rkt   # Bilateral consensus
│   └── entity/machine.rkt    # BFT consensus
│
├── network/                   # Discovery & routing
│   ├── gossip.rkt            # CRDT profile propagation
│   └── routing.rkt           # Modified Dijkstra
│
├── blockchain/                # Settlement
│   └── types.rkt             # Simulated chain state
│
├── storage/                   # Persistence
│   ├── wal.rkt               # Write-Ahead Log
│   └── snapshot.rkt          # State snapshots
│
└── examples/                  # 17 demos
    ├── bilateral-consensus-demo.rkt
    ├── bft-consensus-demo.rkt
    ├── gossip-routing-demo.rkt
    ├── blockchain-demo.rkt
    ├── persistence-demo.rkt
    └── ... (12 more)
```

---

## Interactive REPL

```bash
# Start Racket REPL
racket

# Load a module
> (require "consensus/account/machine.rkt")

# Create account machines
> (define alice (create-account-machine "alice" "bob"))
> (define bob (create-account-machine "bob" "alice"))

# Check state
> (account-machine-entity-id alice)
"alice"

> (account-machine-height alice)
0

# Experiment!
```

---

## Next Steps

**Understand the concepts:**
- Read `docs/02-core-concepts.md` - Learn homoiconicity, coinduction, determinism

**Explore the architecture:**
- Read `docs/03-architecture.md` - Understand 5 layers and data flow

**Dive into the code:**
- Read `docs/04-api-reference.md` - Every module documented

**Compare to TypeScript:**
- Read `docs/06-typescript-comparison.md` - What changed and why

---

## Troubleshooting

### "racket: command not found"
**Solution:** Install Racket (see Prerequisites section)

### "cannot open module file"
**Solution:** Ensure you're in the `xln-scheme/` directory when running demos

### Demo output shows errors
**Solution:** Check you're using Racket 8.0+. Run `racket --version`

### Want to see less output?
**Solution:** Redirect to dev/null: `racket examples/demo.rkt > /dev/null`

### Want to see specific parts?
**Solution:** Use grep: `racket examples/demo.rkt | grep "OK"`

---

## What You've Learned

✓ How to install Racket
✓ How to run XLN demos
✓ What bilateral consensus looks like
✓ What BFT consensus accomplishes
✓ How multi-hop routing works
✓ How blockchain settlement integrates
✓ How crash recovery functions

**You're ready to explore the system!**

---

**Next:** [Core Concepts →](02-core-concepts.md)

λ.
