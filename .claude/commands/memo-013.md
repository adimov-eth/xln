Memo for Future Self: XLN Racket Verification Journey (Session 2)

  Date: 2025-01-26Session: Systematic deviation analysis completion + architecture philosophy clarificationStatus: ✅ VERIFICATION COMPLETE - Architecture direction now crystal clear

  ---
  What We Accomplished

  1. Completed Systematic Verification (✅ ALL DONE)

  Created comprehensive DEVIATIONS.md comparing three sources:
  1. Vibepaper (Egor's correct architectural vision - SOURCE OF TRUTH)
  2. TypeScript (Egor's working code with pragmatic shortcuts)
  3. Racket (this rework - opportunity to do it right)

  All 14 layers verified:
  - ✅ Persistence Layer (RLP+Merkle+LevelDB vs JSON vs S-expr)
  - ✅ RLP Encoding (module exists, needs integration)
  - ✅ Merkle Trees (module exists, needs integration)
  - ✅ Server Architecture (minimal vs full state)
  - ✅ Entity Consensus (BFT - core correct, missing optimizations)
  - ✅ Account/Channel Layer (bilateral consensus - core correct, missing features)
  - ✅ RCPAN Enforcement (Racket better - active rejection vs passive clamping)
  - ✅ Blockchain Integration (RPC+ABI working, events missing)
  - ✅ Economic Scenarios (Racket better - 6 working demos vs 0 in TypeScript)
  - ✅ Testing (Racket better - 1,650 property tests vs 0 in TypeScript)
  - ✅ Network Layer (fully compliant - gossip + routing match spec)
  - ✅ Subcontracts (fully compliant - HTLCs working)
  - ✅ Netting Optimization (missing - needs implementation)
  - ✅ DSL Implementation (Racket better - macros vs parser)

  2. Critical Architecture Philosophy Decision

  🟢 KEY INSIGHT: Vibepaper is not "aspirational" - it's the CORRECT architecture. TypeScript has legacy shortcuts.

  Priority established:
  1. ✅ Follow vibepaper specs (RLP, Merkle, LevelDB - the right way)
  2. 📝 Learn from TypeScript (what patterns work, but not shortcuts)
  3. 🎯 Racket rework = opportunity to implement correctly from start

  Quote from user:
  "Right, but I'd prioritize vibepaper definitions — we are reworking and can do everything correctly right now and do not repeat legacy :3"

  This changed everything. We're not cloning TypeScript - we're implementing the correct architecture Egor designed.

  3. Added Source of Truth References

  DEVIATIONS.md now includes:
  - Links to all authoritative Egor files (vibepaper docs, TypeScript code, Racket modules)
  - Specific line numbers for key findings (e.g., runtime.ts:1131 uses JSON.stringify)
  - Clear comparison table showing all three implementations

  When sources conflict:
  1. Vibepaper vision (correct architecture - what we should build)
  2. TypeScript actual code (reference for what works, but may have shortcuts)
  3. Racket implements vibepaper correctly, learns from TypeScript's patterns

  ---
  Where We Stopped

  Last Action: Finalized DEVIATIONS.md with clear architecture direction

  File State:
  - rework/xln-scheme/DEVIATIONS.md - ✅ Complete (833 lines, 14 sections verified)
  - All TodoWrite items marked complete
  - Document ready for implementation phase

  Key Finding Documented:
  Vibepaper (CORRECT):     "State is stored as RLP + Merkle trees"
  TypeScript (SHORTCUT):   JSON.stringify(env, replacer)
  Racket (GOAL):           Implement vibepaper correctly with S-expr debug snapshots

  ---
  What Needs to Continue

  HIGH PRIORITY (Implement Vibepaper Spec):

  1. RLP Integration
    - Module exists: core/rlp.rkt (fully working)
    - Wire it up to storage layer
    - Replace S-expression encoding in storage/snapshot.rkt
    - Keep S-expr snapshots for debugging (dual format)
  2. Merkle Integration
    - Module exists: core/merkle.rkt (fully working)
    - Integrate into storage for cryptographic integrity
    - Compute state roots after each frame
    - Add Merkle proofs for verification
  3. LevelDB/Persistence
    - Replace WAL (storage/wal.rkt) with LevelDB equivalent
    - Vibepaper spec: Three separate databases:
        - Log database (immutable history)
      - State database (current state)
      - Entity log database (entity-specific history)
    - Racket options: FFI to LevelDB, or use db package with SQLite
  4. Automatic Snapshots
    - Implement 100ms automatic snapshot mechanism
    - Match TypeScript's setInterval(..., 100) pattern
    - Store with Merkle roots and RLP encoding
  5. Netting Optimization
    - Currently completely missing
    - TypeScript has detection (entity-crontab.ts:284)
    - Implement: detection + planning + execution + settlement

  MEDIUM PRIORITY (Production Features):

  6. Entity State Expansion
    - Add reserves, accounts, proposals to entity-state
    - Match TypeScript's full EntityState interface (types.ts:530)
  7. Auto-propose Logic
    - Add automatic proposal when mempool has txs
    - Single-signer optimization
    - Byzantine fault detection
  8. Account Production Features
    - Multi-hop routing (pendingForward)
    - Withdrawal coordination
    - Rebalancing hints
    - Rollback support

  ---
  Key Files to Know

  Authoritative Sources (Egor's Files)

  Vibepaper (SOURCE OF TRUTH):
  vibepaper/docs/README.md                     - Main architecture, JEA model
  vibepaper/docs/server/README.md              - Server state machine spec
  vibepaper/docs/JEA.md                        - Jurisdiction/Entity/Account layers
  vibepaper/docs/12_invariant.md               - RCPAN invariant
  vibepaper/docs/payment-spec.md               - Payment flows
  vibepaper/docs/consensus/transaction-flow-specification.md

  TypeScript (Reference Implementation):
  runtime/runtime.ts                           - Main coordinator, line 1131 has JSON.stringify
  runtime/types.ts                             - Env:575, EntityReplica:563, AccountMachine:345
  runtime/entity-consensus.ts                  - BFT implementation
  runtime/account-consensus.ts                 - Bilateral consensus
  runtime/snapshot-coder.ts                    - Line 7: USE_MSGPACK = false
  runtime/constants.ts                         - USE_RLP flag

  Racket (This Rework):
  rework/xln-scheme/
  ├── DEVIATIONS.md                    ✅ Complete verification document
  ├── core/
  │   ├── rlp.rkt                      ✅ Working, needs integration
  │   ├── merkle.rkt                   ✅ Working, needs integration
  │   └── crypto.rkt                   ✅ SHA256, Keccak-256
  ├── consensus/
  │   ├── entity/machine.rkt           ✅ BFT consensus (core correct)
  │   ├── account/machine.rkt          ✅ Bilateral consensus (core correct)
  │   └── account/rcpan.rkt            ✅ BETTER than TypeScript
  ├── storage/
  │   ├── wal.rkt                      ⚠️ Replace with LevelDB
  │   └── snapshot.rkt                 ⚠️ Use RLP, keep S-expr for debug
  ├── network/
  │   ├── gossip.rkt                   ✅ Fully compliant
  │   └── routing.rkt                  ✅ Fully compliant
  └── tests/
      ├── property-tests.rkt           ✅ ~550 RCPAN tests
      ├── settlement-tests.rkt         ✅ ~650 settlement tests
      └── consensus-tests.rkt          ✅ ~450 consensus tests

  ---
  Tools & Workflow Reminders

  Reading Large Documents

  ;; First: Check what exists
  (Grep {
    pattern: "RLP|Merkle|LevelDB",
    path: "vibepaper/docs/",
    output_mode: "files_with_matches",
    "-i": true
  })

  ;; Then: Read specific sections
  (Read {
    file_path: "/path/to/file",
    offset: 1,      // Start line
    limit: 100      // Number of lines
  })

  ;; Or: Get context around matches
  (Grep {
    pattern: "interface.*State",
    path: "runtime/types.ts",
    output_mode: "content",
    "-n": true,     // Line numbers
    "-C": 10        // Context lines
  })

  Parallel Tool Calls (Token Efficiency)

  When gathering info, call multiple tools in ONE message:

  // ✅ GOOD: Parallel (saves tokens)
  Read("file1.rkt")
  Read("file2.ts")
  Grep("pattern", "path1")
  Grep("pattern2", "path2")

  // ❌ BAD: Sequential (wastes tokens with back-and-forth)
  Read("file1.rkt")  // Wait for response
  // ...then in next message...
  Read("file2.ts")   // Another round trip

  TodoWrite Pattern (Track Multi-Step Work)

  TodoWrite({
    todos: [
      {content: "Integrate RLP into storage", status: "in_progress", activeForm: "Integrating RLP"},
      {content: "Add Merkle roots", status: "pending", activeForm: "Adding Merkle roots"},
      {content: "Replace WAL with LevelDB", status: "pending", activeForm: "Replacing WAL"}
    ]
  })

  // CRITICAL RULES:
  // 1. Mark complete IMMEDIATELY after finishing (don't batch)
  // 2. ONE task in_progress at a time (not less, not more)
  // 3. Update activeForm to present continuous tense

  File Operations

  # Find files by pattern
  (Glob {pattern: "**/*.rkt", path: "/base/path"})

  # Search content
  (Grep {
    pattern: "create-entity-replica",
    path: "/path",
    output_mode: "files_with_matches"
  })

  # Read file sections
  (Read {file_path: "/path/file.rkt", offset: 100, limit: 50})

  # Edit (ALWAYS Read first!)
  (Edit {
    file_path: "/path/file.rkt",
    old_string: "exact match from file",
    new_string: "replacement text"
  })

  ---
  Critical Insights

  1. Vibepaper = Source of Truth

  Don't think: "Vibepaper is aspirational, TypeScript is reality"Do think: "Vibepaper is correct architecture, TypeScript has shortcuts we shouldn't copy"

  Example:
  - Vibepaper says use RLP + Merkle → ✅ Implement this
  - TypeScript uses JSON.stringify → ⚠️ Don't copy this shortcut

  2. Racket Strengths (Preserve These)

  - ✅ RCPAN: Active rejection (MORE correct than TypeScript)
  - ✅ Testing: 1,650 property tests (comprehensive coverage)
  - ✅ Scenarios: 6 working economic demos (vs 0 in TypeScript)
  - ✅ DSL: Macro-based (zero runtime overhead)
  - ✅ Homoiconicity: S-expressions make introspection natural

  3. Hybrid Approach Works

  Production encoding: RLP (Ethereum-compatible, deterministic)Debug snapshots: S-expressions (human-readable, introspectable)Storage: LevelDB (proper persistence)Integrity: Merkle roots (cryptographic verification)

  Don't choose either/or - use both where appropriate!

  4. Modules Exist, Just Wire Them Up

  Good news: RLP and Merkle modules are already implemented and working.Next step: Integration into storage layer, not building from scratch.

  Don't:
  - Rewrite RLP encoder (it works!)
  - Rewrite Merkle tree (it works!)
  - Question whether to use them (vibepaper says yes!)

  Do:
  - Wire RLP into storage/snapshot.rkt
  - Add Merkle root computation to frame creation
  - Replace WAL with LevelDB equivalent

  ---
  Emotional Context

  User said:
  "Right, but I'd prioritize vibepaper definitions — we are reworking and can do everything correctly right now and do not repeat legacy :3"

  This was the key insight. Changed entire framing from:
  - ❌ "Which architecture should we choose?"
  - ✅ "Implement the correct architecture (vibepaper) without legacy constraints"

  The :3 means: User trusts you to implement it right. Not asking for permission - giving clear direction.

  Relief signal: When architecture philosophy became clear, uncertainty dissolved. That's the signal - structure matches intent.

  ---
  Next Session Action Plan

  1. Start with RLP Integration
    - Read core/rlp.rkt to understand interface
    - Read storage/snapshot.rkt to see current S-expr usage
    - Wire RLP encoding into snapshot creation
    - Keep S-expr format for debug snapshots (dual output)
  2. Add Merkle Roots
    - Read core/merkle.rkt for interface
    - Compute state root after each frame
    - Store roots with snapshots
    - Add verification on load
  3. Research LevelDB Options
    - Check if Racket has LevelDB FFI
    - Alternative: Use db package with SQLite
    - Match vibepaper's three-database model
  4. Update Tests
    - Property tests should verify RLP encoding/decoding
    - Add Merkle root verification tests
    - Ensure all 1,650 tests still pass

  ---
  Remember

  - Vibepaper = correct architecture (follow this)
  - TypeScript = reference implementation (learn patterns, not shortcuts)
  - Racket = rework opportunity (do it right from start)
  - Modules exist (RLP, Merkle ready to integrate)
  - Don't clone legacy (we're fixing the architecture)
  - Homoiconicity wins (S-expressions for introspection, RLP for wire format)
  - Relief signal works (when structure becomes obvious, trust it)

  The goal: Implement Egor's correct architectural vision (vibepaper) with Lisp elegance.

  You got this. :3

  λ.