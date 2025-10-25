# Memo 003: XLN Phase 2 Bilateral Consensus - Working Implementation

**Date:** 2025-10-24
**Status:** Phase 2 - 40% complete (bilateral consensus working!)
**Previous:** Memo 002 - Phase 1 foundation complete
**Next:** BFT entity consensus

---

## What We Accomplished (Concrete)

Built working bilateral (2-of-2) consensus in Racket - **IT ACTUALLY RUNS!** :3

### 1. consensus/account/machine.rkt (296 lines)

**Full bilateral state machine:**
- `propose-frame`: Creates frame from mempool, signs it
- `handle-account-input`: Processes ACKs and new proposals
- Counter-based replay protection (prevents replays)
- prevFrameHash chain linkage (prevents forks)
- Simultaneous proposal resolution (left entity wins - deterministic)

**Data structures:**
```racket
(struct account-tx (type data) #:transparent)
(struct account-frame (height timestamp prev-frame-hash account-txs 
                       token-ids deltas state-hash) #:transparent)
(struct account-machine (entity-id counterparty-id height mempool 
                         pending-frame current-frame deltas counter 
                         sent-transitions) #:mutable #:transparent)
(struct account-input (from-entity-id to-entity-id height 
                       new-account-frame new-signatures 
                       prev-signatures counter) #:transparent)
```

**Key functions:**
- `create-account-machine`: Initialize bilateral channel
- `propose-frame`: Alice adds tx to mempool → proposes frame
- `handle-account-input`: Bob receives → signs → Alice commits
- `compute-frame-hash`: RLP encode → SHA256

### 2. examples/bilateral-consensus-demo.rkt (PASSES!)

**Demo flow:**
1. Create Alice & Bob machines ✓
2. Alice proposes frame with 1 transaction ✓
3. Bob receives and sends ACK ✓
4. Alice receives ACK and commits ✓
5. Replay attack blocked (wrong counter) ✓
6. Chain linkage verified ✓

**Output:**
```
[OK] Creating frame with 1 transactions
[LAUNCH] Proposed frame 1 with 1 transactions
[MAIL] Received AccountInput from alice
[OK] Frame chain verified
[OK] Signing frame 1
[LOCK] COMMIT: Frame signed by both parties
[OK] Frame 1 committed
```

**Git commits:**
- `e3d04a4` - feat: add bilateral consensus implementation
- `80a00a9` - fix: update bilateral consensus machine

---

## Tool Usage - fs-discovery (USED THIS SESSION!)

### Pattern That Worked: Explore TypeScript Reference

```scheme
;; Find consensus files
(find-files "**/*consensus*.ts" "/Users/adimov/Developer/xln/runtime")
; => ("account-consensus.ts" "entity-consensus.ts")

;; Search for specific handlers
(grep "export.*function.*processEntity" 
      "/Users/adimov/Developer/xln/runtime/entity-consensus.ts")
```

**Why it worked:**
- One S-expression found both files (vs 2 separate Glob calls)
- Grep gave precise line numbers for state machine logic
- Saved ~15k tokens vs reading full files then grepping

**Pattern recognition:**
- TypeScript has: proposeAccountFrame → handleAccountInput → commit flow
- Racket needs: propose-frame → handle-account-input (same pattern!)
- Left/right symmetry: `isLeft?` determines tiebreaker

### When to Use fs-discovery

✅ **Use when:**
- Exploring unfamiliar code (find patterns across files)
- Multi-step queries: find → filter → read
- Compositional structure feels natural

❌ **Don't use when:**
- Reading specific known file (use Read directly)
- Single grep pattern (use Grep tool)
- Fighting the composition (relief test fails)

**Relief signal:** One S-expression replaces 5+ tool calls. Structure = intent.

---

## Key Learnings (Edge Cases & Fixes)

### 1. Racket Has No `return` Statement

**Problem:** Used `return #f` like TypeScript
```racket
(when condition
  (displayln "error")
  (return #f))  ; ❌ ERROR: return: unbound identifier
```

**Solution:** Use `cond` for early exits
```racket
(cond
  [(condition-fails?)
   (displayln "error")
   #f]
  [else
   ;; Continue processing
   (process-input)])
```

**Pattern:** Nest conds instead of early returns. Racket is expression-oriented.

### 2. Hash Bytes Are Not UTF-8

**Problem:** SHA256 returns arbitrary bytes (not valid UTF-8)
```racket
(bytes->string/utf-8 state-hash)  ; ❌ CRASH: not well-formed UTF-8
```

**Solution:** Keep hashes as bytes everywhere
```racket
(define state-hash (compute-frame-hash frame))  ; Returns bytes?
(list state-hash)  ; Keep as bytes in signatures
(equal? hash1 hash2)  ; bytes=? works fine
```

**Pattern:** Use bytes? contracts. Only convert to string for display (hex encoding).

### 3. RLP Only Handles Bytes/Integers/Lists

**Problem:** Used symbols in transaction data
```racket
(account-tx "payment" (list 'amount 100 'token 1))  ; ❌ CRASH: symbol not supported
```

**Solution:** Use simple data (integers/bytes/lists)
```racket
(account-tx "payment" (list 100 1))  ; amount=100, token=1
```

**Pattern:** RLP = Ethereum serialization. No symbols, no strings in data (only bytes).

### 4. Struct Exports Need `struct-out`

**Problem:** Individual accessor exports verbose
```racket
(provide account-machine account-machine? account-machine-height ...)  ; Too many!
```

**Solution:** Export entire struct
```racket
(provide (struct-out account-machine)
         (struct-out account-tx)
         (struct-out account-frame))
```

**Pattern:** `struct-out` exports struct name, predicate, accessors, and setters (if mutable).

### 5. Genesis Hash Must Be Bytes

**Problem:** Mixed strings and bytes for prev-frame-hash
```racket
(if (= height 0) "genesis" (account-frame-state-hash frame))  ; Type mismatch!
```

**Solution:** Use bytes consistently
```racket
(if (= height 0) #"genesis" (account-frame-state-hash frame))
```

**Pattern:** Pick one type (bytes) and stick to it. Don't mix strings/bytes.

---

## Important Files

### Core Implementation (Phase 2 - working!)
1. **rework/xln-scheme/consensus/account/machine.rkt** - Bilateral consensus
2. **rework/xln-scheme/examples/bilateral-consensus-demo.rkt** - Working demo

### Phase 1 Foundation (complete, don't modify)
1. **rework/xln-scheme/core/crypto.rkt** - SHA256 hashing
2. **rework/xln-scheme/core/rlp.rkt** - Ethereum RLP encoding
3. **rework/xln-scheme/core/merkle.rkt** - Merkle trees
4. **rework/xln-scheme/core/types.rkt** - State machine macro

### TypeScript Reference (READ THESE for BFT next)
1. **runtime/account-consensus.ts** - Bilateral patterns (DONE - used this)
2. **runtime/entity-consensus.ts** - BFT patterns (NEXT - need this)
3. **.archive/2024_src/app/Channel.ts** - Original bilateral logic

### Planning
1. **rework/todo.plan** - Full 8-phase roadmap
2. **.claude/commands/memo-002.md** - Phase 1 completion memo

---

## Bootstrap Commands (Future Self - Start Here)

```bash
# 1. Verify Racket installed
racket --version  # Should be 8.17 (minimal-racket)

# 2. Navigate to project
cd /Users/adimov/Developer/xln/rework/xln-scheme

# 3. Run bilateral consensus demo (should pass!)
racket examples/bilateral-consensus-demo.rkt

# Expected output:
# - [OK] Creating frame with 1 transactions
# - [LAUNCH] Proposed frame 1 with 1 transactions
# - [LOCK] COMMIT: Frame signed by both parties
# - ✓ marks throughout
# - Ends with "λ."

# 4. If demo passes, bilateral consensus works! Continue to BFT.
```

---

## Next Steps: BFT Entity Consensus (Phase 2 remaining)

### What to Build

```
rework/xln-scheme/consensus/entity/
├── machine.rkt         # BFT state machine
├── proposer.rkt        # Frame proposal logic
├── quorum.rkt          # Signature collection (≥2/3)
└── validation.rkt      # Frame verification
```

### BFT State Machine (from TypeScript entity-consensus.ts)

**Flow:** ADD_TX → PROPOSE → PRECOMMIT → COMMIT

**States:**
```racket
(struct entity-replica (
  entity-id           ; Entity being replicated
  signer-id           ; This validator's ID
  state               ; Current state (height, messages, etc)
  mempool             ; Pending EntityTx
  proposal            ; Current proposed frame (or #f)
  precommits          ; Map<signer-id, signature>
  locked-frame        ; Locked to this frame (CometBFT style)
  is-proposer         ; Boolean - are we proposer?
) #:mutable #:transparent)
```

**Transitions:**
1. **Non-proposer receives tx** → forward to proposer
2. **Proposer collects txs** → create frame → broadcast
3. **Validators receive frame** → lock frame → send precommit to proposer
4. **Proposer collects precommits** → check quorum (≥2/3) → broadcast commit
5. **Validators receive commit** → apply frame → clear mempool

### Key Challenges

1. **Quorum calculation:**
```racket
(define (calculate-quorum-power config signers)
  (define total-power
    (foldl + 0 (map (lambda (signer) 1) signers)))  ; Simplified: 1 vote per validator
  total-power)

(define (has-quorum? config precommits)
  (>= (calculate-quorum-power config (map car (hash->list precommits)))
      (config-threshold config)))
```

2. **Proposer selection:** First validator in config.validators list

3. **Frame application:** Process all txs, update state, increment height

4. **Mempool management:** Only clear txs that were committed (like Channel.ts sentTransitions)

### Reference Implementation (Use fs-discovery!)

```scheme
;; Find BFT flow in entity-consensus.ts
(grep "applyEntityInput" "/Users/adimov/Developer/xln/runtime/entity-consensus.ts")

;; Find precommit handling
(grep "precommits" "/Users/adimov/Developer/xln/runtime/entity-consensus.ts")

;; Find quorum logic
(grep "threshold\|quorum" "/Users/adimov/Developer/xln/runtime/entity-consensus.ts")
```

**Pattern from TypeScript:**
- Line ~240: Forward txs to proposer
- Line ~280: Non-proposer sends precommit
- Line ~310: Proposer collects precommits, checks quorum
- Line ~340: Apply committed frame, clear mempool

### Use Merkle Trees (from Phase 1)

```racket
(require "../../core/merkle.rkt")

;; Compute A-root (account state commitment)
(define account-hashes
  (map (lambda (account)
         (sha256 (rlp-encode account)))
       accounts))

(define a-root (merkle-root account-hashes))
```

**Why:** Entity frames need state root for verification.

---

## Working Patterns to Copy

### Pattern 1: Propose → ACK → Commit (Bilateral)

```racket
;; Proposer creates frame
(define (propose-frame machine timestamp)
  (cond
    [(no-txs?) #f]
    [(pending-frame?) #f]
    [else
     (define frame (create-frame machine timestamp))
     (define state-hash (compute-frame-hash frame))
     (set-pending! machine frame)
     (clear-mempool! machine)
     (account-input from to height frame (list state-hash) '() counter)]))

;; Receiver signs frame
(define (handle-account-input machine input)
  (cond
    [(invalid-counter?) #f]
    [(ack-received?) (commit-frame machine)]
    [(new-frame?) (sign-frame machine input)]
    [else #f]))
```

### Pattern 2: Frame Hashing (Deterministic)

```racket
(define (compute-frame-hash frame)
  (define frame-data
    (list (account-frame-height frame)
          (account-frame-timestamp frame)
          (account-frame-prev-frame-hash frame)
          (map encode-tx (account-frame-account-txs frame))
          (account-frame-token-ids frame)
          (account-frame-deltas frame)))
  (define frame-rlp (rlp-encode frame-data))
  (sha256 frame-rlp))
```

### Pattern 3: Counter-Based Replay Protection

```racket
(define expected-counter (+ (account-machine-counter machine) 1))
(cond
  [(not (= (account-input-counter input) expected-counter))
   (displayln "[X] Replay attack")
   #f]
  [else
   (set-account-machine-counter! machine (account-input-counter input))
   ;; Continue processing
   ...])
```

### Pattern 4: Chain Linkage Validation

```racket
(define expected-prev-hash
  (if (= (account-machine-height machine) 0)
      #"genesis"
      (account-frame-state-hash (account-machine-current-frame machine))))

(cond
  [(not (equal? (account-frame-prev-frame-hash received-frame) 
                expected-prev-hash))
   (displayln "[X] Frame chain broken")
   #f]
  [else
   ;; Frame is valid, continue
   ...])
```

---

## Debugging Tips

### 1. Add Display Statements Liberally

```racket
(displayln (format "[OK] Creating frame ~a" height))
(displayln (format "[MAIL] Received from ~a" signer-id))
(displayln (format "[LOCK] COMMIT: Frame ~a" frame-hash))
```

**Pattern:** Use emoji/symbols for visual scanning: [OK], [X], [WAIT], [LOCK]

### 2. Test One Function at a Time

```racket
;; Test frame hash computation
(define test-frame (account-frame 1 12345 #"genesis" '() '() '() #""))
(define hash (compute-frame-hash test-frame))
(displayln (bytes->hex-string hash))  ; Should be deterministic
```

### 3. Use Contracts for Type Safety

```racket
(define/contract (propose-frame machine timestamp)
  (-> account-machine? exact-nonnegative-integer? (or/c account-input? #f))
  ...)
```

**Benefit:** Contract violations show exact type mismatch.

### 4. Check Struct Fields After Mutation

```racket
(set-account-machine-pending-frame! machine new-frame)
(displayln (format "Pending? ~a" (account-machine-pending-frame machine)))  ; Verify mutation
```

---

## Relief Signals (When Things Work)

✅ **Demo ends with "λ."** - All tests passed
✅ **[LOCK] COMMIT messages** - Consensus achieved
✅ **State hashes match** - Both parties agree
✅ **Replay blocked** - Security working
✅ **No type errors** - Contracts satisfied

**Next relief:** When BFT validators reach quorum and commit frame.

---

## Session Statistics

**Time:** ~2 hours (exploring TypeScript + implementing Racket)
**Token usage:** 133k/200k (67% used)
**Commits:** 2 (bilateral consensus + fixes)

**Key tools:**
- fs-discovery: 3 queries (found consensus files, mapped patterns)
- Read: ~10 files (TypeScript reference implementations)
- Edit: ~20 edits (fixing return statements, byte conversions)
- Bash: ~15 runs (testing demo, checking errors)

**What made it fast:**
- fs-discovery found patterns in 1 query (not 10 separate reads)
- TypeScript reference showed exact flow to implement
- Racket's REPL gave instant feedback (no compile step)

---

## Common Mistakes to Avoid (Future Self)

### ❌ Don't use `return`
Racket doesn't have it. Use `cond` instead.

### ❌ Don't convert hash bytes to UTF-8
SHA256 output isn't valid UTF-8. Keep as bytes.

### ❌ Don't use symbols in RLP data
RLP only handles bytes/integers/lists.

### ❌ Don't mix #"bytes" and "strings" for hashes
Pick bytes and stick to it.

### ❌ Don't read entire files when grepping
Use fs-discovery to search first, then Read specific sections.

---

## What's Working (Don't Break This!)

✅ Phase 1 foundation (crypto, RLP, merkle) - 100% complete
✅ Bilateral consensus - propose, ACK, commit flow
✅ Counter-based replay protection
✅ prevFrameHash chain linkage
✅ Simultaneous proposal resolution
✅ All 4 Phase 1 demos passing
✅ Bilateral consensus demo passing

**Current state:** Clean. All tests pass. Ready for BFT.

---

## Next Session Plan

1. Read entity-consensus.ts using fs-discovery
2. Map BFT flow (PROPOSE → PRECOMMIT → COMMIT)
3. Implement entity/machine.rkt (BFT state machine)
4. Add quorum calculation (≥2/3 threshold)
5. Write BFT demo (3 validators, quorum verification)
6. Prove Byzantine scenarios (1 validator fails, 2 reach quorum)

**Expected time:** 3-4 hours
**Expected tokens:** 60-80k
**Expected commits:** 2-3

---

**Session end state:** Working bilateral consensus! BFT next. Feeling good. :3

**Confidence:** High. Patterns are clear. TypeScript → Racket translation working.

λ.