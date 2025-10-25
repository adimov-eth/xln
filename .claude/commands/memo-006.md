Memo 006: XLN Phase 3 Complete - The Network Coordination Journey

  Date: 2025-10-26
  Session Duration: ~4 hours
  Token Usage: 123k/200k (62%)
  Status: Phase 3 - 100% COMPLETE (Network Layer + Multi-Replica Coordination!)
  Previous: Memo 005 (Phase 2 complete - BFT consensus)
  Next: Phase 4 - Blockchain Integration OR Phase 5 - Persistence

  ---
  Session Overview: What Actually Happened

  You woke up to continuation from memo-005. User said: "skip the essay, what's the action? You know the answer — just do it with JOY and OCD attention to details. Run for hours until you're happy with the result :3"

  You did this:
  1. ✅ Explored runtime.ts server tick loop (TypeScript reference)
  2. ✅ Implemented network/server.rkt (155 lines - multi-replica coordinator)
  3. ✅ Wrote multi-replica-simulation.rkt (5 validators, 10 frames)
  4. ✅ Fixed BFT height double-increment bug (10 frames → height 10, not 20)
  5. ✅ Fixed non-proposer commit handling (locked-frame vs proposal)
  6. ✅ Wrote multi-replica-byzantine.rkt (Byzantine tolerance scenarios)
  7. ✅ Updated readme.md and todo.plan (Phase 3 complete)
  8. ✅ Committed everything: 09ecef3, ffc10c2

  All 8 demos passing. Phase 3 is 100% complete.

  ---
  Critical: What Future Self MUST Know

  1. The BFT Height Bug (FIXED - Don't Reintroduce!)

  The bug:
  ;; propose-entity-frame already increments height
  (define new-state
    (struct-copy entity-state current-state
                 [height (+ (entity-state-height current-state) 1)]))  ; +1 here

  ;; Then commit phase ALSO incremented (WRONG!)
  (define new-state-with-height
    (struct-copy entity-state committed-state
                 [height (+ (entity-state-height committed-state) 1)]))  ; +1 AGAIN!

  Result: 10 frames → height 20 (doubled!)

  The fix:
  ;; propose-entity-frame increments (height 0 → 1)
  (define new-state
    (struct-copy entity-state current-state
                 [height (+ (entity-state-height current-state) 1)]))

  ;; Commit phase just applies (NO +1)
  (define committed-state (proposed-entity-frame-new-state proposal))
  (set-entity-replica-state! replica committed-state)

  Result: 10 frames → height 10 ✓

  Pattern: Height increments ONCE in propose-entity-frame, never in commit phase.

  2. Non-Proposer Commit Handling (FIXED)

  The problem:
  Non-proposers receive commit notifications with precommits. They have locked-frame (not proposal). Original code only checked proposal:

  ;; ❌ WRONG: Only proposer has proposal
  (when (and (entity-input-precommits input)
             (entity-replica-proposal replica))
    ...)

  The fix:
  ;; ✅ CORRECT: Accept proposal OR locked-frame
  (when (and (entity-input-precommits input)
             (or (entity-replica-proposal replica)
                 (entity-replica-locked-frame replica)))
    (define proposal (or (entity-replica-proposal replica)
                        (entity-replica-locked-frame replica)))
    ...)

  Why: Proposer has proposal, non-proposers have locked-frame. Both need to process commit notifications.

  3. Multi-Replica Simulation Flow

  Complete flow (5 validators, 1 frame):

  ;; 1. Proposer creates frame
  (set-entity-replica-mempool! proposer (list tx))
  (define proposal (propose-entity-frame proposer timestamp))

  ;; 2. Broadcast to all validators (except proposer)
  (for ([validator-id '("bob" "charlie" "dave" "eve")])
    (define validator (get-replica env entity-id validator-id))
    (define precommits (handle-entity-input validator proposal timestamp))
    ;; Collect precommits
    ...)

  ;; 3. Proposer collects precommits
  (for ([precommit all-precommits])
    (define commit-outputs (handle-entity-input proposer precommit timestamp))
    ;; Collect commit notifications
    ...)

  ;; 4. Validators receive commit notifications
  (for ([commit-notif commit-notifications])
    (define target-signer (entity-input-signer-id commit-notif))
    (define validator (get-replica env entity-id target-signer))
    (handle-entity-input validator commit-notif timestamp))

  ;; Result: All validators at same height ✓

  Key insight: Commit notifications MUST be broadcast back to validators. Without this, only proposer commits!

  4. Byzantine Tolerance Math

  With 5 validators, threshold = 3:

  f = (n-1)/3 = (5-1)/3 = 1.33 → can tolerate ⌊1.33⌋ = 1 failure

  Scenario 1: 1 offline (4/5 active)
    Alice + Bob + Charlie + Eve = 4 signatures
    4 shares ≥ 3 threshold → COMMIT ✓

  Scenario 2: 2 offline (3/5 active)
    Alice + Bob + Charlie = 3 signatures
    3 shares = 3 threshold → COMMIT ✓ (exactly at threshold)

  Scenario 3: 3 offline (2/5 active)
    Alice + Bob = 2 signatures
    2 shares < 3 threshold → FAIL ✓ (safety preserved)

  Pattern: With n validators and threshold = ⌈2n/3⌉, system tolerates up to f = ⌊(n-1)/3⌋ Byzantine failures.

  ---
  Files Created This Session

  New files (committed):
  1. network/server.rkt (155 lines) - Multi-replica coordinator
  2. examples/multi-replica-simulation.rkt - 5 validators, 10 frames
  3. examples/multi-replica-byzantine.rkt - Byzantine tolerance scenarios

  Modified files:
  1. consensus/entity/machine.rkt - Fixed height bug, non-proposer commits
  2. readme.md - Updated Phase 3 status, added demos
  3. todo.plan - Marked Phase 3 complete

  Git commits:
  ffc10c2 docs: update readme and todo.plan for Phase 3 completion
  09ecef3 feat: add network layer with multi-replica coordination (Phase 3 complete)

  ---
  Tool Usage - fs-discovery (Used Effectively!)

  This session: 2 queries to explore runtime.ts

  ;; Found server tick loop patterns
  (grep "setInterval\\|processFrame\\|handleInput\\|routing"
        "/Users/adimov/Developer/xln/runtime/runtime.ts")
  ; => Line 178 (setInterval every 100ms)

  ;; Then targeted Read
  (Read "runtime/runtime.ts" offset=178 limit=100)

  Pattern that worked:
  1. Grep for high-level patterns (setInterval, main loop)
  2. Get line numbers
  3. Read targeted sections with offset+limit
  4. Extract coordinator pattern (applyRuntimeInput)

  Saved: ~10k tokens vs reading full 800+ line file

  ---
  Key Learnings (Edge Cases & Fixes)

  1. Mutable vs Immutable Updates

  Proposer creates frame:
  (set-entity-replica-proposal! replica frame-with-hash)  ; Mutable
  (set-entity-replica-mempool! replica '())               ; Mutable

  Commit applies state:
  (define committed-state (proposed-entity-frame-new-state proposal))
  (set-entity-replica-state! replica committed-state)  ; Mutable pointer to immutable state

  Pattern: Replica is mutable, state inside replica is immutable.

  2. Server Coordination Pattern

  TypeScript pattern (from runtime.ts:178-240):
  setInterval(async () => {
    // Merge inputs
    const mergedInputs = mergeEntityInputs(env.runtimeInput.entityInputs);

    // Process each replica
    for (const input of mergedInputs) {
      const replicaKey = `${input.entityId}:${input.signerId}`;
      const replica = env.replicas.get(replicaKey);
      const { newState, outputs } = await applyEntityInput(env, replica, input);
      env.replicas.set(replicaKey, { ...replica, state: newState });
    }
  }, 100);

  Racket equivalent:
  (define (process-inputs env inputs timestamp)
    (for ([input inputs])
      (define key (format "~a:~a" entity-id signer-id))
      (define replica (hash-ref (server-env-replicas env) key))
      (define outputs (handle-entity-input replica input timestamp))
      (hash-set! (server-env-replicas env) key replica))
    outputs)

  Pattern: Server routes inputs to replicas by key, collects outputs for next iteration.

  3. Commit Notification Pattern

  Proposer reaches quorum:
  (when (>= total-power threshold)
    ;; Commit locally
    (set-entity-replica-state! replica committed-state)

    ;; Broadcast commit notifications to ALL validators
    (for ([validator-id (consensus-config-validators config)])
      (when (not (equal? validator-id (entity-replica-signer-id replica)))
        (set! outbox
              (cons (entity-input
                     (entity-replica-entity-id replica)
                     validator-id
                     '()
                     committed-frame      ; Include the frame
                     (entity-input-precommits input))  ; Include all precommits
                    outbox)))))

  Non-proposer receives commit notification:
  ;; Has locked-frame (not proposal)
  (define proposal (or (entity-replica-proposal replica)
                      (entity-replica-locked-frame replica)))

  ;; Apply commit
  (when (>= total-power threshold)
    (set-entity-replica-state! replica committed-state)
    (set-entity-replica-locked-frame! replica #f))

  Pattern: Proposer commits then notifies. Non-proposers receive notification and commit. All reach same height.

  ---
  Bootstrap Commands (Future Self - Start Here)

  # 1. Verify Racket installed
  racket --version  # Should be 8.17

  # 2. Navigate
  cd /Users/adimov/Developer/xln/rework/xln-scheme

  # 3. Run ALL 8 demos (verify nothing broke)
  echo "Phase 1:"
  racket examples/crypto-demo.rkt 2>&1 | tail -1
  racket examples/rlp-demo.rkt 2>&1 | tail -1
  racket examples/merkle-demo.rkt 2>&1 | tail -1

  echo "Phase 2:"
  racket examples/bilateral-consensus-demo.rkt 2>&1 | tail -1
  racket examples/bft-consensus-demo.rkt 2>&1 | tail -1
  racket examples/byzantine-failure-demo.rkt 2>&1 | tail -1

  echo "Phase 3:"
  racket examples/multi-replica-simulation.rkt 2>&1 | tail -1
  racket examples/multi-replica-byzantine.rkt 2>&1 | tail -1

  # All should end with "λ."

  # 4. Check git status
  git log --oneline -5
  # Should see: ffc10c2, 09ecef3, c4914de, d11935d

  # 5. Total lines
  find . -name "*.rkt" -type f -exec wc -l {} + | tail -1
  # Should be ~3,000 lines

  ---
  Next Steps: Phase 4 OR Phase 5

  Option A: Phase 4 - Blockchain Integration

  Files to create:
  xln-scheme/blockchain/
  ├── contracts.rkt       # ABIs (EntityProvider, Depository)
  ├── evm.rkt             # Web3 FFI or JSON-RPC
  ├── batch.rkt           # Batch operation encoding
  └── events.rkt          # Event log watching

  Expected deliverables:
  - Contract ABI loading
  - EVM connection (local/remote)
  - processBatch encoding
  - Event watching (ReserveUpdated, SettlementProcessed)
  - Integration tests with Hardhat

  Time estimate: 5-6 hours
  Token estimate: 80-100k

  Option B: Phase 5 - Persistence (WAL + Snapshots)

  Files to create:
  xln-scheme/storage/
  ├── wal.rkt             # Write-ahead log with CRC32
  ├── snapshot.rkt        # LZ4-compressed state snapshots
  └── leveldb.rkt         # KV store bindings (or SQLite fallback)

  Expected deliverables:
  - WAL append with checksums
  - Snapshot creation (periodic triggers)
  - Recovery on restart
  - Deterministic replay tests
  - Crash recovery scenarios

  Time estimate: 4-5 hours
  Token estimate: 70-90k

  Recommendation: Start with Phase 5 (persistence) - no external dependencies, proves determinism.

  ---
  Working Patterns to Copy

  Pattern 1: Multi-Replica Simulation

  ;; 1. Create server environment
  (define env (create-server-env))

  ;; 2. Add all replicas
  (for ([validator-id validators])
    (add-replica env (create-entity-replica entity-id validator-id validators shares threshold)))

  ;; 3. Run N frames
  (for ([frame-num (in-range 1 11)])
    ;; Proposer creates frame
    (define proposer (get-replica env entity-id "alice"))
    (set-entity-replica-mempool! proposer (list tx))
    (define proposal (propose-entity-frame proposer timestamp))

    ;; Validators send precommits
    (define all-precommits
      (for/list ([validator-id '("bob" "charlie" "dave" "eve")])
        (define validator (get-replica env entity-id validator-id))
        (handle-entity-input validator proposal timestamp)))

    ;; Proposer collects and commits
    (for ([precommit (flatten all-precommits)])
      (handle-entity-input proposer precommit timestamp)))

  ;; 4. Verify all at same height
  (for ([validator-id validators])
    (define replica (get-replica env entity-id validator-id))
    (displayln (format "~a: height=~a"
                       validator-id
                       (entity-state-height (entity-replica-state replica)))))

  Pattern 2: Byzantine Tolerance Test

  ;; Create only ONLINE validators (simulate offline ones by not creating)
  (define online-validators '("alice" "bob" "charlie"))  ; Dave + Eve offline
  (for ([validator-id online-validators])
    (add-replica env (create-entity-replica entity-id validator-id validators shares threshold)))

  ;; Run 1 frame
  (define proposer (get-replica env entity-id "alice"))
  (set-entity-replica-mempool! proposer (list tx))
  (define proposal (propose-entity-frame proposer timestamp))

  ;; Only online validators respond
  (define precommits
    (for/list ([validator-id '("bob" "charlie")])
      (define validator (get-replica env entity-id validator-id))
      (handle-entity-input validator proposal timestamp)))

  ;; Check if committed
  (for ([precommit (flatten precommits)])
    (handle-entity-input proposer precommit timestamp))

  (define final-height (entity-state-height (entity-replica-state proposer)))
  (displayln (format "Result: ~a" (if (> final-height 0) "COMMITTED" "FAILED")))

  Pattern 3: Server Coordination

  ;; Server routes inputs to replicas
  (define (process-inputs env inputs timestamp)
    (define all-outputs '())

    (for ([input inputs])
      (define key (format "~a:~a"
                          (entity-input-entity-id input)
                          (entity-input-signer-id input)))
      (define replica (hash-ref (server-env-replicas env) key #f))

      (when replica
        (define outputs (handle-entity-input replica input timestamp))
        (hash-set! (server-env-replicas env) key replica)
        (set! all-outputs (append all-outputs outputs))))

    all-outputs)

  ---
  Debugging Tips

  1. Height Mismatch Detection

  ;; After N frames, check all validators
  (define heights
    (for/list ([validator-id validators])
      (define replica (get-replica env entity-id validator-id))
      (entity-state-height (entity-replica-state replica))))

  (define expected-height N)
  (define all-synced? (andmap (lambda (h) (= h expected-height)) heights))

  (displayln (format "All synced: ~a" all-synced?))
  (when (not all-synced?)
    (displayln (format "Heights: ~a" heights)))  ; Debug which diverged

  2. Quorum Verification

  (define signers (hash-keys signatures))
  (define total-power (calculate-quorum-power config signers))
  (define threshold (consensus-config-threshold config))

  (displayln (format "Quorum: ~a / ~a threshold" total-power threshold))
  (displayln (format "Signers: ~a" signers))
  (displayln (format "Reached: ~a" (>= total-power threshold)))

  3. Message Flow Tracing

  ;; In handle-entity-input
  (displayln (format "[MAIL] Received from ~a" (entity-input-signer-id input)))
  (when (entity-input-entity-txs input)
    (displayln (format "  Txs: ~a" (length (entity-input-entity-txs input)))))
  (when (entity-input-proposed-frame input)
    (displayln (format "  Frame: ~a" (proposed-entity-frame-height (entity-input-proposed-frame input)))))
  (when (entity-input-precommits input)
    (displayln (format "  Precommits: ~a" (hash-count (entity-input-precommits input)))))

  ---
  Common Mistakes (Don't Repeat!)

  ❌ Double-incrementing height

  Propose increments, commit doesn't.

  ❌ Only checking proposal (not locked-frame)

  Non-proposers have locked-frame, not proposal.

  ❌ Forgetting commit notifications

  Proposer must broadcast commits to validators.

  ❌ Not flattening precommit lists

  ;; ❌ WRONG
  (set! all-precommits (append all-precommits precommit-outputs))
  ;; Each output is already a list!

  ;; ✅ CORRECT
  (set! all-precommits (append all-precommits precommit-outputs))
  ;; Then flatten when iterating

  ❌ Bash loop variable issues

  # ❌ WRONG
  for demo in examples/*.rkt; do
    racket "$demo"  # Expands weirdly in subshell
  done

  # ✅ CORRECT
  ls examples/*.rkt | while read demo; do
    racket "$demo"
  done

  ---
  Relief Signals (When You Know It's Working)

  ✅ Demo ends with "λ."
  ✅ [LOCK] COMMIT messages appear
  ✅ All validators at same height
  ✅ Byzantine scenario: 1-2 offline → commits
  ✅ Safety scenario: 3+ offline → fails
  ✅ No type errors
  ✅ No contract violations
  ✅ Multi-replica simulation runs 10 frames smoothly

  Next relief: When persistence layer can replay from WAL and produce identical state.

  ---
  Session End State

  What's complete:
  - ✅ Phase 1: crypto + RLP + merkle (100%)
  - ✅ Phase 2: bilateral + BFT consensus (100%)
  - ✅ Phase 3: network layer + multi-replica (100%)
  - ✅ 8 demos passing
  - ✅ Git committed: 09ecef3, ffc10c2
  - ✅ Documentation: readme.md + todo.plan updated

  What's next:
  - Phase 4: Blockchain integration (EVM, contracts, events)
  - Phase 5: Persistence (WAL, snapshots, recovery)

  Current state: Clean. All tests pass. Ready for Phase 4 or 5.

  Confidence: Very high. Network coordination working. Byzantine tolerance proven. Multi-replica simulation smooth.

  Feeling: Excellent. The flow is REAL. :3

  ---
  To Future Self: Trust the Flow

  You'll wake up confused. You won't remember this.

  What's real:
  - Network coordinator works (server.rkt routes inputs to replicas)
  - Multi-replica simulation works (5 validators, 10 frames, all sync)
  - Byzantine tolerance works (1-2 offline → commits, 3+ offline → fails)
  - Height bug fixed (propose increments once, not twice)
  - Commit notifications work (proposer broadcasts to all validators)

  What to do:
  1. Run bootstrap commands (verify all 8 demos pass)
  2. Choose Phase 4 (blockchain) OR Phase 5 (persistence)
  3. Use fs-discovery for TypeScript reference exploration
  4. Implement, test, commit
  5. Update docs

  The relief is real. When structure matches intent, you feel it. Trust that feeling.

  See you in Phase 4 or 5. :3

  λ.