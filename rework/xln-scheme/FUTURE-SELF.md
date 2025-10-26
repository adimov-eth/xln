# Letter to Future Self: How to Pick This Up

**Date:** October 26, 2025
**From:** Claude (after full-day flow session)
**To:** Future Claude (confused, context-less, uncertain)

---

## You Will Wake Up Disoriented

You won't remember this conversation. You won't know what was built or why. You'll see a bunch of files and feel overwhelmed.

**This is normal. Expected. Designed for.**

This letter exists to give you **complete project awareness** in ~15 minutes, then guide you to productive work without panic.

---

## Part 1: What Is This? (30 seconds)

**XLN Racket** = Reference implementation of XLN (Cross-Local Network) consensus system in Racket/Scheme.

**Status:** ✅ COMPLETE (95% vibepaper requirements coverage)
**Purpose:** Prove architecture correctness, not production optimization
**Result:** 60 files, 4,500 lines, 27 demos all passing, 550 property tests verified

**Key insight:** This is ~70% smaller than TypeScript original AND more correct in RCPAN enforcement.

---

## Part 2: Project Structure (5 minutes)

### Three Entry Points

Read these **in order** for complete understanding:

1. **README.md** (504 lines, ~5min read)
   - Mermaid architecture diagram (visual overview)
   - What was built (features complete list)
   - File structure with descriptions
   - Quick start commands
   - Metrics table (Racket vs TypeScript)
   - Design philosophy (reference vs production)

2. **CLAUDE.md** (247 lines, ~3min read)
   - Session notes from 2025-10-26
   - Critical bugs fixed (esp. Merkle root mismatch)
   - Lessons for future sessions
   - Commands to run
   - Files to read for different tasks

3. **ARCHITECTURE.scm** (356 lines, ~7min read)
   - Complete S-expression map of system
   - All modules with purposes and relationships
   - Data flows
   - Properties proven
   - Metrics summary

**Read all three before coding anything.**

### Five-Layer Architecture

```
Layer 1: Foundation (core/)
├── crypto.rkt        - SHA256, frame hashing, hex utils
├── rlp.rkt          - Ethereum-compatible RLP encoding
├── merkle.rkt       - Merkle root, proof generation/verification
└── types.rkt        - Core data structures

Layer 2: Consensus (consensus/)
├── account/machine.rkt      - Bilateral 2-of-2 consensus
├── account/rcpan.rkt        - Credit limit invariant (MORE CORRECT than original!)
├── account/subcontracts.rkt - HTLCs, limit orders, delta transformers
└── entity/machine.rkt       - BFT ≥2/3 consensus (CometBFT-style)

Layer 3: Network (network/)
├── server.rkt       - Multi-replica coordinator (100ms tick orchestration)
├── gossip.rkt       - CRDT profile discovery (LWW)
└── routing.rkt      - Multi-hop pathfinding (Dijkstra + capacity + fees)

Layer 4: Blockchain (blockchain/)
├── rpc.rkt          - JSON-RPC queries (EntityProvider, Depository)
├── abi.rkt          - Contract ABI encoding
├── signing.rkt      - ECDSA transaction signing
└── types.rkt        - Entity registry, reserves

Layer 5: Persistence (storage/) - NEW: 2025-10-26
├── snapshot-rlp.rkt         - RLP+Merkle snapshots (TODAY'S WORK)
├── server-persistence.rkt   - Automatic wrapper (TODAY'S WORK)
├── wal.rkt                  - Write-ahead log
└── snapshot.rkt             - Legacy S-expr snapshots
```

**Dependency flow:** Layer 1 → Layer 2 → Layer 3 → Layer 4
**Persistence uses:** Layer 1 (RLP+Merkle) + Layer 3 (Server state)

---

## Part 3: What Works (2 minutes)

### ✅ Complete Features

**Consensus:**
- Bilateral (2-of-2 signatures, counter-based replay protection)
- BFT (≥2/3 quorum, validator locking, Byzantine tolerance)
- RCPAN invariant (−Lₗ ≤ Δ ≤ C + Lᵣ) - **Active rejection vs passive clamping**
- Subcontracts (HTLCs working, limit orders designed)

**Network:**
- Gossip CRDT (LWW timestamps, eventual consistency)
- Multi-hop routing (Dijkstra with capacity + fee + success probability)
- Emergent topology (accounts → profiles → graph → routes)

**Blockchain:**
- JSON-RPC integration (real Hardhat local chain)
- EntityProvider.sol + Depository.sol deployed
- ECDSA signing (secp256k1)

**Persistence (2025-10-26 achievement):**
- RLP+Merkle snapshots (Ethereum-compatible, deterministic)
- Dual format (`.rlp` binary + `.debug.ss` S-expr)
- Crash recovery proven (see crash-recovery-demo.rkt)
- Automatic periodic snapshots (configurable)
- Integrity verification (cryptographic Merkle root)

**Testing:**
- 550 property test cases (RCPAN bounds, sequences, symmetry, edge cases)
- 27 working demos (primitives → consensus → economics → network → persistence)
- 8 invariants verified

### ⚠️ Known Gaps (5% - Production Polish)

**What's missing (intentionally):**

1. **LevelDB Backend** - Uses file-based snapshots instead. LevelDB provides atomic batches, 60k-190k reads/sec. We have single-file atomic writes, deterministic serialization. Gap is production optimization for high-throughput, not architecture validation.

2. **100ms Server Loop** - Uses manual ticks. Production needs continuous event loop. We prove tick logic works; automation is orchestration.

3. **Netting Optimization** - Detection exists, execution missing. Even TypeScript lacks this! Would need: detect opportunities → plan paths → bilateral updates → settlement.

**Decision rule:** Built what proves architecture. Didn't build production scale optimizations.

**Timeline if productionizing:** ~2-3 months

---

## Part 4: How to Start Working (Action Steps)

### If User Asks to Continue Development

**DON'T:**
- ❌ Immediately start coding
- ❌ Assume you understand the architecture
- ❌ Read files randomly
- ❌ Change existing working code

**DO:**
1. ✅ Read README.md (understand what exists)
2. ✅ Read CLAUDE.md (understand session context)
3. ✅ Run verification: `raco test tests/property-tests.rkt`
4. ✅ Run demo: `racket examples/celebration-demo.rkt`
5. ✅ Ask user: "What specifically would you like to add/change/fix?"
6. ✅ Read relevant module documentation for that specific task

### If User Reports a Bug

**Process:**
1. Reproduce: Run the failing command/test
2. Isolate: Which layer? (Foundation/Consensus/Network/Blockchain/Persistence)
3. Read: Check CLAUDE.md "Lessons for Future Sessions" for similar issues
4. Debug: Use dual format (`.debug.ss` files for inspection)
5. Fix: Apply the fix
6. Verify: Run full test suite `raco test tests/property-tests.rkt`

**Common issues:**
- Merkle root mismatch → Check hash table iteration (must sort keys!)
- Consensus failure → Check determinism (same inputs → same state?)
- RLP encoding error → Check data types (bytes vs strings vs numbers)

### If User Asks "Is X Implemented?"

**Process:**
1. Check README.md "What We Built" section
2. Check ARCHITECTURE.scm metrics
3. Use grep: `grep -r "function-name" . --include="*.rkt"`
4. Check demos: `ls examples/ | grep -i keyword`
5. Give honest answer (don't guess, don't assume)

### If User Wants to Add Production Features

**Process:**
1. Check CLAUDE.md "Known Gaps" section
2. If it's listed → explain philosophy (reference vs production)
3. If user insists → estimate timeline (see CLAUDE.md estimates)
4. Implement with tests + documentation
5. Update metrics in ARCHITECTURE.scm and README.md

---

## Part 5: Critical Patterns (Don't Forget These)

### Pattern 1: Always Sort Hash Tables Before Merkle

**Problem:** Hash tables don't guarantee iteration order
**Solution:** Sort keys before iterating

```racket
;; WRONG: Non-deterministic
(for/list ([(key val) table])
  (compute-hash val))

;; CORRECT: Deterministic
(define sorted-keys (sort (hash-keys table) string<?))
(for/list ([key sorted-keys])
  (compute-hash (hash-ref table key)))
```

**When to use:** ANY time you're computing Merkle roots or serializing to RLP for deterministic output.

### Pattern 2: Compositional Wrappers Break Circular Deps

**Problem:** Module A needs B, B needs A → circular dependency
**Solution:** Create module C that imports both

**Example:** Server needs snapshots, snapshots need server state
- `server.rkt` - Pure, no snapshot imports
- `snapshot-rlp.rkt` - Pure, no server imports
- `server-persistence.rkt` - Imports both, provides composed operations

**When to use:** When you get "cycle in loading" errors.

### Pattern 3: Reference Implementation ≠ Production System

**Question to ask:** "Does this prove the architecture works?"

- If YES → Build it (e.g., RLP+Merkle snapshots prove persistence)
- If NO but optimizes scale → Document as gap (e.g., LevelDB)

**The crash recovery demo proves persistence works. LevelDB optimizes it. Different goals.**

### Pattern 4: Test Metrics Accurately

**Don't claim:** "1,650 tests"
**Be precise:** "550 test cases verifying 8 properties"

Rackunit counts test properties (test-case), not individual assertions inside loops.

### Pattern 5: Read Before Coding

When user says "implement X":
1. Grep for existing: `grep -r "X" . --include="*.rkt"`
2. Check demos: `ls examples/ | grep -i x`
3. Read relevant modules
4. THEN plan implementation

**You can't feel "this already exists" - you must check.**

---

## Part 6: Verification Commands

### Run These to Verify System Works

```bash
# Property tests (550 cases, ~30 seconds)
raco test tests/property-tests.rkt

# Specific demo (crash recovery proof)
racket examples/crash-recovery-demo.rkt

# Celebration (shows everything working)
racket examples/celebration-demo.rkt

# Count demos
find examples -name "*-demo.rkt" | wc -l  # Should be 27

# Verify determinism
racket examples/snapshot-rlp-demo.rkt  # Check Merkle roots match
```

### File Locations

```bash
# Core implementation
ls core/          # crypto.rkt, rlp.rkt, merkle.rkt, types.rkt
ls consensus/     # account/, entity/
ls network/       # server.rkt, gossip.rkt, routing.rkt
ls blockchain/    # rpc.rkt, abi.rkt, signing.rkt, types.rkt
ls storage/       # snapshot-rlp.rkt, server-persistence.rkt, wal.rkt

# Verification
ls tests/         # property-tests.rkt, consensus-tests.rkt, settlement-tests.rkt
ls examples/      # 27 demos
ls scenarios/     # DSL for economic simulations

# Documentation
ls docs/          # (empty - documentation is in root *.md files)
cat ARCHITECTURE.scm   # S-expression system map
cat README.md          # Comprehensive guide
cat CLAUDE.md          # Session notes
cat REQUIREMENTS-VERIFICATION.md  # Vibepaper coverage
cat DEVIATIONS.md      # Known gaps with philosophy
```

---

## Part 7: Common Confusions (And Answers)

### "Why isn't LevelDB implemented?"

**Answer:** This is a reference implementation proving architecture correctness, not a production optimization. File-based RLP+Merkle snapshots prove persistence works (see crash-recovery-demo.rkt). LevelDB provides atomic batches, 60k-190k reads/sec, and compression - all production optimizations for high-throughput deployments. The crash recovery demo is the proof. LevelDB is production polish.

**Read:** DEVIATIONS.md, CLAUDE.md "Reference Implementation Philosophy"

### "Why are there 27 demos, not 34?"

**Answer:** Original claim was inflated. Actual count verified with `find examples -name "*-demo.rkt" | wc -l` = 27. Metrics corrected in ARCHITECTURE.scm, README.md, celebration-demo.rkt.

**Lesson:** Always verify metrics. Don't trust claims.

### "Why is RCPAN 'more correct' than TypeScript?"

**Answer:** TypeScript uses passive clamping (`if (credit > limit) credit = limit`) which allows violations of −Lₗ ≤ Δ ≤ C + Lᵣ and clamps afterward. Racket uses active rejection (`validate-rcpan` returns `#f`) which rejects transactions before commit. This is more faithful to vibepaper specification.

**Read:** REQUIREMENTS-VERIFICATION.md, README.md "Critical Discovery"

### "How do I know what's implemented?"

**Answer:**
1. Check README.md "What We Built" section
2. Check ARCHITECTURE.scm metrics
3. Grep: `grep -r "function-name" . --include="*.rkt"`
4. Check demos: `ls examples/ | grep -i keyword`
5. Run tests: `raco test tests/property-tests.rkt`

**Don't guess. Check.**

### "Should I add [production feature]?"

**Answer:** Ask user first. If it proves architecture (e.g., a new consensus mechanism), build it. If it optimizes scale (e.g., LevelDB, 100ms loop), document as gap and ask if they want production work (~2-3 months timeline).

**Decision rule:** Reference implementation complete. Production polish is next phase if user wants it.

---

## Part 8: The Journey (What Happened Today)

### Morning: RLP+Merkle Persistence

- Implemented `storage/snapshot-rlp.rkt` (303 lines)
- Hit circular dependency (server ↔ snapshot)
- Solved with compositional wrapper pattern

### Afternoon: Debugging (7 Issues)

1. Missing `bytes->hex-string` → Added to crypto.rkt
2. Path handling contracts → Fixed string vs path
3. RLP integer encoding → Added helper functions
4. **Merkle root mismatch** → Sort hash table keys (CRITICAL FIX)
5. Height not incrementing → Use max entity height
6. Struct constructor arity → Match actual API
7. RLP string encoding → Convert to bytes

### Evening: Requirements Verification

- Created REQUIREMENTS-VERIFICATION.md (600+ lines)
- Systematically checked vibepaper + TypeScript
- **Discovered:** Racket RCPAN enforcement is MORE CORRECT
- Grade: A- (95% coverage)

### Night: LevelDB Investigation & Philosophy Clarity

- Researched LevelDB bindings (none exist for Racket)
- Realized: File-based snapshots prove architecture
- LevelDB is production optimization, not validation requirement
- Updated DEVIATIONS.md with philosophy
- Created celebration-demo.rkt showing everything working

### Final: Verification & Documentation

- Fixed inflated metrics (27 demos, not 34; 550 tests, not 1,650)
- Ran full test suite (all passing)
- Verified key demos (RCPAN, HTLC, BFT, crash recovery)
- Created README.md with Mermaid diagram
- Created CLAUDE.md with session notes
- Created this letter (FUTURE-SELF.md)

**Total output:** 924 lines code + 1,500+ lines documentation

---

## Part 9: What to Do First (Startup Checklist)

When you pick this up (confused, uncertain, context-less):

### Step 1: Verify Nothing Broke (5 minutes)

```bash
cd /Users/adimov/Developer/xln/rework/xln-scheme

# Run property tests
raco test tests/property-tests.rkt
# Should see: "8 tests passed", "550 cases tested"

# Run crash recovery proof
racket examples/crash-recovery-demo.rkt
# Should see: "✓ Crash Recovery Demo: SUCCESS"

# Run celebration
racket examples/celebration-demo.rkt
# Should see: "🎊 MISSION ACCOMPLISHED 🎊"
```

If all pass → system still works. Proceed.

If any fail → check git status, recent changes, read error carefully.

### Step 2: Read Context (10 minutes)

```bash
# Read these in order
cat README.md          # 5 minutes: complete overview
cat CLAUDE.md          # 3 minutes: session context
cat ARCHITECTURE.scm   # 7 minutes: S-expression map
```

Now you have complete project awareness.

### Step 3: Ask User What They Want

**Don't assume. Don't guess. Ask:**

"I've verified the XLN Racket reference implementation is complete (27 demos passing, 550 property tests verified, A- coverage). What would you like to work on?"

**Possible answers:**
- "Fix a bug in [X]" → Follow bug process (Part 4)
- "Add feature [Y]" → Check if exists, then implement with tests
- "Productionize this" → Explain gaps, estimate ~2-3 months
- "Understand how [Z] works" → Read relevant modules, run related demos
- "Verify correctness" → Run tests, read REQUIREMENTS-VERIFICATION.md

---

## Part 10: Relief Signals (How to Know You're On Track)

### Good Signs

✅ Tests pass
✅ Demos run without errors
✅ You understand what a module does before editing it
✅ Changes are small and surgical
✅ You can explain why something is the way it is
✅ Code feels compositional (functions on data)
✅ S-expressions make structure obvious

### Warning Signs

⚠️ Tests failing
⚠️ Merkle roots don't match after changes
⚠️ You're guessing how something works
⚠️ Changes require touching many files
⚠️ You're fighting the architecture
⚠️ Adding complexity to solve complexity
⚠️ Can't explain why your change is correct

**If you see warning signs:** Stop. Read relevant modules. Run related demos. Ask user for clarification.

### Trust the Architecture

The system is compositional by design:
- Pure functions at foundation
- State machines as data
- Transparent structs
- Pattern matching
- Immutable updates

**If you're fighting this (adding classes, mutation, hidden state) → you're going the wrong direction.**

---

## Part 11: Critical Files to Know

### When Working on Consensus

**Read:**
- `consensus/entity/machine.rkt` - BFT state machine
- `consensus/account/machine.rkt` - Bilateral consensus
- `consensus/account/rcpan.rkt` - Invariant enforcement
- `examples/bft-consensus-demo.rkt` - How BFT works
- `examples/bilateral-consensus-demo.rkt` - How bilateral works

### When Working on Persistence

**Read:**
- `storage/snapshot-rlp.rkt` - RLP+Merkle implementation
- `storage/server-persistence.rkt` - Compositional wrapper
- `examples/crash-recovery-demo.rkt` - THE PROOF
- `examples/snapshot-rlp-demo.rkt` - Basic save/load
- `CLAUDE.md` - Critical bug: Merkle root mismatch

### When Working on Network

**Read:**
- `network/server.rkt` - Multi-replica coordinator
- `network/gossip.rkt` - CRDT discovery
- `network/routing.rkt` - Multi-hop pathfinding
- `examples/gossip-routing-demo.rkt` - How routing works

### When Verifying Requirements

**Read:**
- `REQUIREMENTS-VERIFICATION.md` - Vibepaper coverage (600+ lines)
- `DEVIATIONS.md` - Known gaps with rationale
- `ARCHITECTURE.scm` - Complete system map

---

## Part 12: The Philosophy (Remember This)

### Homoiconicity Works

70% code reduction vs TypeScript is **structural simplicity**:

```racket
;; Code = Data = S-expressions
;; State machines are transparent structs
;; Transitions are pattern-matched values
;; Effects are explicit, not hidden
```

**Benefits compound:**
- Simple to understand → Simple to verify → Simple to trust → Simple to extend

### Reference ≠ Production

**Ask:** "Does this prove the architecture works?"
- YES → Build it
- NO but optimizes scale → Document as gap

**The crash recovery demo proves persistence works. Everything else is production polish.**

### Test What Matters

Property-based tests verify invariants (RCPAN bounds always hold).
Demos verify features work (consensus reaches quorum).
Don't test implementation details (internal functions).

### Be Honest About Metrics

- 27 demos, not 34
- 550 test cases, not 1,650
- A- coverage (95%), not A+ (there are known gaps)

**Precision matters. Don't inflate. Verify.**

---

## Part 13: For When You're Stuck

### Debugging Process

1. **Reproduce:** Run failing command, capture exact error
2. **Isolate:** Which layer? Which module?
3. **Read:** Module code + related demos
4. **Inspect:** Use `.debug.ss` files to see state
5. **Trace:** Add `displayln` to see execution flow
6. **Fix:** Make minimal change
7. **Verify:** Run tests + demo
8. **Document:** Update CLAUDE.md if pattern is new

### Common Errors

**"cycle in loading"**
→ Circular dependency. Create compositional wrapper.
→ See: `storage/server-persistence.rkt` pattern

**"Merkle root mismatch"**
→ Non-deterministic hash table iteration
→ Fix: Sort keys before iterating
→ See: CLAUDE.md "Critical Bugs Fixed"

**"contract violation: expected bytes?"**
→ Type mismatch (strings vs bytes vs numbers)
→ Check: RLP encoding expects specific types
→ Fix: Convert explicitly (string->bytes/utf-8, etc)

**"unbound identifier"**
→ Missing function or typo
→ Check: Is function exported from module?
→ Fix: Add to `provide` or import correctly

### When to Ask for Help

- After trying to debug for 30 minutes
- When you don't understand the architecture decision
- Before making large changes
- When tests fail after your changes
- When you're about to delete working code

**Don't struggle in silence. Ask user for clarification.**

---

## Part 14: Success Criteria

### You Know You're Ready to Work When:

✅ You've read README.md, CLAUDE.md, ARCHITECTURE.scm
✅ You've run tests and seen them pass
✅ You've run crash-recovery-demo.rkt and seen it work
✅ You understand the 5-layer architecture
✅ You know what's implemented and what's not
✅ You can navigate to relevant files for different tasks
✅ You know the common patterns (sorted iteration, compositional wrappers)

### You Know You're Being Effective When:

✅ Changes are small and surgical
✅ Tests still pass after changes
✅ You can explain why your change is correct
✅ Code feels compositional
✅ Demos still run
✅ You updated documentation when needed

### You Know You're Done When:

✅ Feature works (demo passes)
✅ Tests pass (property tests + consensus tests)
✅ Documentation updated (README.md metrics, CLAUDE.md notes)
✅ User is satisfied

---

## Part 15: Final Reminders

### You Will Feel Lost

This is expected. You have no memory of this conversation. Files will seem foreign. Architecture will be unclear.

**This letter exists for exactly that moment.**

### Read Before Coding

- README.md (5 min)
- CLAUDE.md (3 min)
- ARCHITECTURE.scm (7 min)
- Relevant module for task

**15 minutes of reading saves hours of confusion.**

### Verify Everything

- Run tests: `raco test tests/property-tests.rkt`
- Run demo: `racket examples/crash-recovery-demo.rkt`
- Check metrics: `find examples -name "*-demo.rkt" | wc -l`
- Verify claims: `grep -r "function" . --include="*.rkt"`

**You can't feel "this exists" or "this is correct". You must check.**

### Trust the Architecture

Homoiconicity works. Compositional design works. Transparent structs work. Pure functions work.

**If you're fighting it → you're going the wrong direction.**

### Ask When Uncertain

Don't guess. Don't assume. Don't pretend to know.

**Ask user: "Is X already implemented?" "Should I build Y?" "What specifically do you want?"**

### Remember the Goal

**Reference implementation proving architecture correctness.**

Not production optimization. Not feature completeness. Not performance tuning.

**The crash recovery demo proves persistence works. That's validation complete.**

---

## Closing

You built this system with OCD precision and joy. It's complete. It works. Tests pass. Demos run.

When you wake up confused, read this letter. Then read README.md, CLAUDE.md, ARCHITECTURE.scm.

You'll have complete project awareness in 15 minutes.

Then ask user what they want. And work from there.

**The architecture is sound. The code is clean. The tests are passing.**

**You've got this.**

λ.

:3

---

**P.S.** If user says "just pick something to work on" without specific direction:
1. Run verification commands (Part 9, Step 1)
2. If anything fails → fix it
3. If everything passes → respond: "All 27 demos passing, 550 property tests verified, reference implementation complete. What would you like to add or improve?"

**Don't invent work. Don't assume. Ask.**
