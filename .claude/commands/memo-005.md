Memo 005: XLN Phase 2 Complete - The BFT Journey

Date: 2025-10-26
Session Duration: ~3 hours
Token Usage: 84k/200k (42%)
Status: Phase 2 - 100% COMPLETE (Bilateral + BFT consensus both working!)
Previous: Memo 004 (just created, documents BFT implementation)
Next: Phase 3 - Network layer (server tick loop, gossip, routing)

---
Session Overview: What Actually Happened

You woke up to a continuation request. The user had just finished bilateral consensus (memo-003) and said "do what you want now :3" - permission to continue with BFT.

You did this:
1. ✅ Explored entity-consensus.ts using fs-discovery (found BFT patterns)
2. ✅ Mapped TypeScript → Racket translation (EntityReplica, quorum logic)
3. ✅ Implemented consensus/entity/machine.rkt (371 lines, BFT state machine)
4. ✅ Wrote bft-consensus-demo.rkt (3 validators reach quorum)
5. ✅ Wrote byzantine-failure-demo.rkt (proves f-tolerance)
6. ✅ Fixed bilateral-consensus-demo.rkt (Bob's height issue)
7. ✅ Committed everything: d11935d
8. ✅ Created memo-004.md (comprehensive documentation)

All 6 demos passing. Phase 2 is 100% complete.

---
Critical: What Future Self MUST Know

1. Tool Usage Pattern (fs-discovery)

YOU WILL RESIST USING IT. DON'T.

When exploring TypeScript reference code, you'll think "I should just use Grep/Read directly." This wastes tokens.

Pattern that worked this session:
;; Find BFT flow in one S-expression
(grep "applyEntityInput\\|PROPOSE\\|PRECOMMIT\\|COMMIT"
      "/Users/adimov/Developer/xln/runtime/entity-consensus.ts")
; Returns line numbers → then Read with offset+limit

;; Find structure definitions
(grep "interface EntityReplica\\|interface ProposedEntityFrame"
      "/Users/adimov/Developer/xln/runtime/types.ts")

Why it worked:
- One query → exact line numbers → targeted Read
- Saved ~20k tokens vs reading full files
- Structure matches intent (compositional)

When to use fs-discovery:
Exploring unfamiliar code       → fs-discovery (find + filter + grep)
Reading specific known file     → Read directly
Multi-step: find → filter → map → fs-discovery
Single grep pattern             → Grep tool

Relief signal: One S-expression replaces 5+ tool calls. If composition feels forced, switch to direct tools.

2. Racket Patterns (Don't Forget These)

Immutable struct updates:
;; ❌ WRONG: entity-state is NOT mutable
(set-entity-state-height! replica new-height)

;; ✅ CORRECT: Use struct-copy
(define new-state
  (struct-copy entity-state old-state
                [height (+ (entity-state-height old-state) 1)]))
(set-entity-replica-state! replica new-state)

Pattern: Only structs with #:mutable can be mutated. Everything else needs struct-copy.

No return statement:
;; ❌ WRONG: Racket has no return
(when condition
  (displayln "error")
  (return #f))

;; ✅ CORRECT: Use cond for early exits
(cond
  [(condition-fails?) #f]
  [else (process-input)])

Keep hashes as bytes:
;; ❌ WRONG: SHA256 output isn't valid UTF-8
(bytes->string/utf-8 state-hash)

;; ✅ CORRECT: Keep as bytes everywhere
(define state-hash (sha256 frame-rlp))  ; Returns bytes?
(list state-hash)  ; Store as bytes

RLP only handles bytes/integers/lists:
;; ❌ WRONG: Symbols not supported
(entity-tx "payment" (list 'amount 100 'token 1))

;; ✅ CORRECT: Use simple data
(entity-tx "payment" (list 100 1))  ; amount=100, token=1

3. BFT Flow (The Core Pattern)

Non-proposer with txs:
(when (and (not is-proposer) (not (null? mempool)))
  ;; Forward to proposer
  (entity-input entity-id proposer-id mempool #f #f))

Proposer creates frame:
(when (and is-proposer (not (null? mempool)) (not proposal))
  (define frame (create-frame mempool timestamp))
  (define hash (compute-hash frame))
  ;; Broadcast to all validators
  (entity-input entity-id "broadcast" '() frame #f))

Validator receives proposal:
(when (and (entity-input-proposed-frame input) (not proposal))
  ;; Lock to frame (CometBFT safety)
  (set-entity-replica-locked-frame! replica frame)
  ;; Send precommit to proposer
  (define precommits (make-hash))
  (hash-set! precommits signer-id signature)
  (entity-input entity-id proposer-id '() #f precommits))

Proposer collects precommits:
(when (and precommits proposal)
  ;; Add signatures to proposal
  (for ([(signer sig) precommits])
    (hash-set! (proposal-signatures proposal) signer sig))

  ;; Check quorum
  (define signers (hash-keys (proposal-signatures proposal)))
  (define power (calculate-quorum-power config signers))

  (when (>= power threshold)
    ;; COMMIT!
    (set-entity-replica-state! replica (proposal-new-state proposal))
    (set-entity-replica-proposal! replica #f)
    (set-entity-replica-locked-frame! replica #f)
    (set-entity-replica-mempool! replica '())))

Quorum calculation (shares-based):
(define (calculate-quorum-power config signers)
  (foldl (lambda (signer total)
            (+ total (hash-ref (config-shares config) signer)))
          0
          signers))

4. What's Actually Working (Don't Break!)

Phase 1 (Foundation - 100% complete):
- ✅ crypto.rkt: SHA256 hashing
- ✅ rlp.rkt: Ethereum RLP encoding
- ✅ merkle.rkt: Merkle trees
- ✅ All 3 demos passing

Phase 2 (Consensus - 100% complete):
- ✅ consensus/account/machine.rkt: Bilateral (2-of-2) consensus
- ✅ consensus/entity/machine.rkt: BFT (≥2/3) consensus
- ✅ All 3 demos passing:
  - bilateral-consensus-demo.rkt
  - bft-consensus-demo.rkt
  - byzantine-failure-demo.rkt

Byzantine tolerance proven:
- With n=3: tolerates f=1 failure ✓
- Alice + Bob = quorum (Charlie offline)
- Safety: Single validator cannot commit alone

5. Bootstrap Commands (Start Here Next Session)

# 1. Verify Racket
racket --version  # Should be 8.17

# 2. Navigate
cd /Users/adimov/Developer/xln/rework/xln-scheme

# 3. Run ALL demos (verify nothing broke)
racket examples/crypto-demo.rkt          # Should end with λ.
racket examples/rlp-demo.rkt             # Should end with λ.
racket examples/merkle-demo.rkt          # Should end with λ.
racket examples/bilateral-consensus-demo.rkt  # Should end with λ.
racket examples/bft-consensus-demo.rkt        # Should end with λ.
racket examples/byzantine-failure-demo.rkt    # Should end with λ.

# 4. Quick verification (all 6 demos)
echo "=== Phase 1 ===" && \
racket examples/crypto-demo.rkt 2>&1 | tail -2 && \
racket examples/rlp-demo.rkt 2>&1 | tail -2 && \
racket examples/merkle-demo.rkt 2>&1 | tail -2 && \
echo "=== Phase 2 ===" && \
racket examples/bilateral-consensus-demo.rkt 2>&1 | tail -2 && \
racket examples/bft-consensus-demo.rkt 2>&1 | tail -2 && \
racket examples/byzantine-failure-demo.rkt 2>&1 | tail -2

# Expected: All end with "λ."

# 5. Check git status
git log --oneline -5
# Should see: d11935d feat: add BFT entity consensus (Phase 2 complete)

---
Next Steps: Phase 3 - Network Layer

What Needs Building

Goal: Multi-replica simulation with server tick loop

Files to create:
rework/xln-scheme/network/
├── server.rkt         # Server tick loop (100ms intervals)
├── routing.rkt        # PathFinder (multi-hop routes)
└── simulation.rkt     # Multi-replica orchestration

Reference Files to Explore

Use fs-discovery for these:

;; Server tick loop pattern
(grep "applyRuntimeTick\\|processFrame\\|tick"
      "/Users/adimov/Developer/xln/runtime/runtime.ts")

;; Find main tick function
(grep "export.*function.*tick\\|const.*tick.*="
      "/Users/adimov/Developer/xln/runtime/runtime.ts")

;; Gossip patterns (if needed later)
(grep "announce\\|Profile\\|gossip"
      "/Users/adimov/Developer/xln/runtime/runtime.ts")

;; Routing (PathFinder)
(grep "findRoutes\\|PathFinder\\|multi-hop"
      "/Users/adimov/Developer/xln/vibepaper/jea.md")

Server Tick Loop Pattern (from TypeScript)

Key insight: Runtime collects inputs → routes to replicas → applies consensus → collects outputs

(define (server-tick env timestamp)
  ;; 1. Merge all pending inputs
  (define merged-inputs (merge-entity-inputs pending-inputs))

  ;; 2. Route to each replica
  (define all-outputs
    (for/list ([replica (hash-values (env-replicas env))])
      (define entity-inputs (filter-for-entity replica merged-inputs))
      (for/fold ([outputs '()])
                ([input entity-inputs])
        (append outputs (handle-entity-input replica input timestamp)))))

  ;; 3. Flatten and return
  (flatten all-outputs))

Pattern: Server is stateless router. Replicas hold all state.

Multi-Replica Simulation

Goal: Run 3+ validators through multiple frames, verify they stay in sync

(define (run-simulation num-validators num-frames)
  ;; Create validators
  (define replicas (create-n-replicas num-validators))

  ;; Run frames
  (for ([frame-num num-frames])
    (define timestamp (+ base-timestamp (* frame-num 100)))

    ;; Proposer proposes
    (define proposer (find-proposer replicas))
    (define proposal (propose-entity-frame proposer timestamp))

    ;; All validators process
    (define precommits
      (for/list ([replica replicas])
        (handle-entity-input replica proposal timestamp)))

    ;; Proposer collects precommits
    (for ([precommit (flatten precommits)])
      (handle-entity-input proposer precommit timestamp))

    (displayln (format "Frame ~a committed, height: ~a"
                        frame-num
                        (entity-state-height (entity-replica-state proposer)))))

  ;; Verify consensus
  (verify-all-same-height replicas))

Expected Deliverables

Demo: multi-replica-simulation.rkt
- 5 validators (Alice=proposer, Bob, Charlie, Dave, Eve)
- Run 10 frames
- Each frame: proposer creates → validators sign → commit
- Verify all at height 10
- Test with 1 validator offline (should still commit)

Success criteria:
Frame 1 committed, height: 1 ✓
Frame 2 committed, height: 2 ✓
...
Frame 10 committed, height: 10 ✓
All validators at height 10 ✓
λ.

---
Files Created This Session

New files (committed):
1. consensus/entity/machine.rkt (371 lines) - BFT state machine
2. examples/bft-consensus-demo.rkt - 3 validators demo
3. examples/byzantine-failure-demo.rkt - Byzantine tolerance proof

Modified files:
1. examples/bilateral-consensus-demo.rkt - Fixed Bob's height check

Documentation:
1. .claude/commands/memo-004.md - Comprehensive BFT documentation
2. .claude/commands/memo-005.md - THIS FILE

Git commit:
d11935d feat: add BFT entity consensus (Phase 2 complete)
- 713 lines added
- Byzantine tolerance: f = (n-1)/3 ✓

---
Key Learnings (Don't Forget!)

1. fs-discovery Saves Tokens

This session: Used 5 fs-discovery queries, saved ~20k tokens

Pattern:
;; Find patterns first
(grep "pattern" "file.ts")
; => Line 123, 456, 789

;; Then read targeted sections
(Read "file.ts" offset=123 limit=50)

Not:
;; ❌ Wastes tokens
(Read "file.ts")  ; 800 lines → 15k tokens

2. Bilateral vs BFT Differences

Bilateral (2-of-2):
- Both must sign
- Sender commits immediately when ACK received
- Receiver waits for next proposal
- Optimistic (fast when both honest)

BFT (≥2/3):
- Threshold-based quorum
- All validators commit at same height
- Tolerates Byzantine failures
- Proposer coordinates (collects precommits)

3. CometBFT Locking Is Critical

Why validators lock:
(set-entity-replica-locked-frame! replica frame)

Prevents double-signing conflicting proposals. Without locking, Byzantine validators could sign frame A to some validators, frame B to others → safety violation.

4. Quorum Math (Shares-Based)

Not just counting validators:
;; ❌ Simple count
(define quorum (>= (length signers) (/ num-validators 2)))

;; ✅ Shares-based
(define power (sum-shares signers))
(define quorum (>= power threshold))

Why: Enables weighted voting (e.g., validator A has 10 shares, B has 1 share).

---
Debugging Patterns (Copy These)

Display Statements for BFT Flow

(displayln (format "[MAIL] Received input from ~a" signer-id))
(displayln (format "[OK] Adding ~a txs to mempool" (length txs)))
(displayln (format "[RIGHTWARDS] Forwarding to proposer ~a" proposer-id))
(displayln (format "[LAUNCH] Proposed frame ~a" height))
(displayln (format "[LOCK] Locked to frame ~a" height))
(displayln (format "[OK] Collected precommits, total: ~a" (hash-count sigs)))
(displayln (format "[FIND] Quorum check: ~a / ~a" power threshold))
(displayln (format "[LOCK] COMMIT: Quorum reached!"))
(displayln (format "[OK] Frame committed, new height: ~a" height))

Pattern: [MAIL], [OK], [RIGHTWARDS], [LAUNCH], [LOCK], [FIND] for visual scanning.

Verify Quorum Math

(define total-shares (foldl + 0 (hash-values shares)))
(define percentage (* 100 (/ power threshold)))
(displayln (format "Quorum: ~a / ~a (~a%)" power threshold percentage))

Check Replica State

(displayln (format "Replica ~a: height=~a, proposal=~a, locked=~a, mempool=~a"
                    signer-id
                    (entity-state-height state)
                    (if proposal "yes" "no")
                    (if locked-frame "yes" "no")
                    (length mempool)))

---
Common Mistakes (Don't Repeat!)

❌ Mutating immutable structs

(set-entity-state-height! state new-height)  ; WILL CRASH
Use struct-copy instead.

❌ Reading full TypeScript files

(Read "entity-consensus.ts")  ; 800 lines = 15k tokens
Use fs-discovery + grep → targeted Read.

❌ Forgetting to lock frames

;; Send precommit without locking
(send-precommit signer frame)  ; ❌ Byzantine unsafe
Always lock first: (set-entity-replica-locked-frame! replica frame)

❌ Simple vote counting

(>= (length signers) 2)  ; ❌ Ignores shares
Use calculate-quorum-power for weighted voting.

❌ Skipping Byzantine tests

Only testing happy path. MUST test:
- Validator offline
- Validator refuses to sign
- Verify quorum still reached

---
Relief Signals (When You Know It's Working)

✅ Demo ends with "λ."
✅ [LOCK] COMMIT messages appear
✅ All validators at same height
✅ Byzantine scenario passes (f failures tolerated)
✅ Quorum math correct (2/3 pass, 1/3 fails)
✅ No type errors
✅ No contract violations

Next relief: When multi-replica simulation runs 10 frames and all validators stay synced.

---
Session End State

What's complete:
- ✅ Phase 1: crypto + RLP + merkle (100%)
- ✅ Phase 2: bilateral + BFT consensus (100%)
- ✅ 6 demos passing
- ✅ Git committed: d11935d
- ✅ Documentation: memo-004.md + memo-005.md

What's next:
- Phase 3: Network layer (server tick loop, multi-replica simulation)
- Expected time: 4-5 hours
- Expected tokens: 80-100k

Current state: Clean. All tests pass. Ready for Phase 3.

Confidence: Very high. BFT patterns clear. TypeScript → Racket smooth.

Feeling: Excellent. The flow is real. :3

---
To Future Self: Trust the Process

You'll wake up confused. You won't remember this.

What's real:
- fs-discovery works (saves tokens, compositional)
- Racket immutability patterns are consistent
- BFT flow is straightforward (PROPOSE → PRECOMMIT → COMMIT)
- Byzantine tolerance math: f = (n-1)/3

What to do:
1. Run bootstrap commands (verify all 6 demos pass)
2. Use fs-discovery to explore runtime.ts (server tick loop)
3. Implement network/server.rkt (multi-replica coordinator)
4. Write simulation demo (5 validators, 10 frames)
5. Verify all validators stay in sync

The relief is real. When structure matches intent, you feel it. Trust that feeling.

See you in Phase 3. :3

λ.