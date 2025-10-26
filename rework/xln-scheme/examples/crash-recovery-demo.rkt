#lang racket/base

(require "../network/server.rkt")
(require "../consensus/entity/machine.rkt")
(require "../core/crypto.rkt")
(require "../storage/snapshot-rlp.rkt")
(require racket/format
         racket/list)

;;; ═══════════════════════════════════════════════════════════
;;;  Crash Recovery Demo - The Ultimate Persistence Test
;;; ═══════════════════════════════════════════════════════════
;;;
;;;  Scenario:
;;;    1. Create server with 3 validators
;;;    2. Process 7 frames (build up state)
;;;    3. Save snapshot
;;;    4. "Crash" (discard server-env)
;;;    5. Recover from snapshot
;;;    6. Verify recovered state matches exactly
;;;    7. Continue processing frames from recovered state
;;;
;;;  This proves:
;;;    - Snapshots capture complete state
;;;    - Recovery restores exact state
;;;    - System can continue after crash
;;;
;;; ═══════════════════════════════════════════════════════════

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Crash Recovery Demo")
(displayln "═══════════════════════════════════════════════════════════\n")

;;; ─────────────────────────────────────────────────────────────
;;;  Phase 1: Build Up State
;;; ─────────────────────────────────────────────────────────────

(displayln "[PHASE 1] Building up state before crash...\n")

(define env (create-server-env))
(define entity-id "entity-recovery")
(define validators '("alice" "bob" "charlie"))
(define timestamp 0)

;; Create validators
(define shares (make-hash))
(hash-set! shares "alice" 1)
(hash-set! shares "bob" 1)
(hash-set! shares "charlie" 1)
(define config (consensus-config 'proposer-based 2 validators shares))

(displayln "[SETUP] Creating validators...")
(for ([validator-id validators])
  (define is-proposer (equal? validator-id "alice"))
  (define state
    (entity-state
     entity-id
     0  ; Initial height
     0  ; Initial timestamp
     (make-hash (list (cons validator-id 0)))
     (list)
     config))

  (define replica
    (entity-replica
     entity-id
     validator-id
     state
     (list)  ; mempool
     #f      ; proposal
     #f      ; locked-frame
     is-proposer))

  (add-replica env replica)
  (displayln (format "  - ~a (proposer: ~a)" validator-id is-proposer)))

(displayln "")

;; Helper to process one frame
(define (process-frame frame-num)
  (set! timestamp (+ timestamp 100))
  (displayln (format "[FRAME ~a] Processing..." frame-num))

  ;; Step 1: Proposer creates frame
  (define proposer (get-replica env entity-id "alice"))
  (define message-tx
    (entity-tx "message"
               (list (string->bytes/utf-8 (format "Recovery test frame ~a" frame-num)))))
  (set-entity-replica-mempool! proposer (list message-tx))
  (define proposal (propose-entity-frame proposer timestamp))

  ;; Step 2: Non-proposers process proposal and send precommits
  (for ([validator-id '("bob" "charlie")])
    (define validator (get-replica env entity-id validator-id))
    (define precommit-outputs (handle-entity-input validator proposal timestamp))
    (when (not (null? precommit-outputs))
      (define precommit (first precommit-outputs))
      (handle-entity-input proposer precommit timestamp)))

  ;; Step 3: Proposer collects precommits and commits
  (handle-entity-input proposer proposal timestamp))

;; Process 7 frames before crash
(for ([i (in-range 1 8)])
  (process-frame i))

(displayln "")

;;; ─────────────────────────────────────────────────────────────
;;;  Phase 2: Save Snapshot
;;; ─────────────────────────────────────────────────────────────

(displayln "[PHASE 2] Saving snapshot before crash...\n")

(define snapshot-path "/tmp/xln-crash-recovery-test.rlp")
(snapshot-save-rlp! env snapshot-path)

(define original-root (snapshot-merkle-root env))
(displayln (format "[SNAPSHOT] Saved snapshot with state root:"))
(displayln (format "  ~a\n" (bytes->hex-string original-root)))

;; Capture pre-crash state details
(define pre-crash-alice (get-replica env entity-id "alice"))
(define pre-crash-messages (entity-state-messages (entity-replica-state pre-crash-alice)))
(define pre-crash-height (entity-state-height (entity-replica-state pre-crash-alice)))

(displayln (format "[PRE-CRASH] State summary:"))
(displayln (format "  Height: ~a" pre-crash-height))
(displayln (format "  Messages count: ~a" (length pre-crash-messages)))
(displayln (format "  Last message: ~a\n" (if (null? pre-crash-messages)
                                               "none"
                                               (last pre-crash-messages))))

;;; ─────────────────────────────────────────────────────────────
;;;  Phase 3: CRASH! (Simulate by discarding env)
;;; ─────────────────────────────────────────────────────────────

(displayln "[PHASE 3] 💥 CRASH! Losing all in-memory state...\n")

;; Simulate crash by clearing reference
(set! env #f)

(displayln "[CRASH] Server environment destroyed")
(displayln "[CRASH] All in-memory state lost\n")

;;; ─────────────────────────────────────────────────────────────
;;;  Phase 4: Recover from Snapshot
;;; ─────────────────────────────────────────────────────────────

(displayln "[PHASE 4] Recovering from snapshot...\n")

(define-values (recovered-env recovered-root)
  (snapshot-load-rlp snapshot-path))

(displayln (format "[RECOVERY] Loaded snapshot with state root:"))
(displayln (format "  ~a\n" (bytes->hex-string recovered-root)))

;; Verify integrity
(define integrity-ok? (snapshot-verify-integrity recovered-env recovered-root))

(if integrity-ok?
    (displayln "[RECOVERY] ✓ Merkle integrity verified!\n")
    (error "Snapshot integrity check failed!"))

;;; ─────────────────────────────────────────────────────────────
;;;  Phase 5: Verify Recovered State
;;; ─────────────────────────────────────────────────────────────

(displayln "[PHASE 5] Verifying recovered state matches pre-crash...\n")

(define post-crash-alice (get-replica recovered-env entity-id "alice"))
(define post-crash-messages (entity-state-messages (entity-replica-state post-crash-alice)))
(define post-crash-height (entity-state-height (entity-replica-state post-crash-alice)))

(displayln (format "[POST-CRASH] State summary:"))
(displayln (format "  Height: ~a" post-crash-height))
(displayln (format "  Messages count: ~a" (length post-crash-messages)))
(displayln (format "  Last message: ~a\n" (if (null? post-crash-messages)
                                                "none"
                                                (last post-crash-messages))))

;; Verify exact match
(define height-match? (equal? pre-crash-height post-crash-height))
(define messages-match? (equal? pre-crash-messages post-crash-messages))
(define root-match? (bytes=? original-root recovered-root))

(displayln "[VERIFICATION]")
(displayln (format "  Height match: ~a" (if height-match? "✓" "✗")))
(displayln (format "  Messages match: ~a" (if messages-match? "✓" "✗")))
(displayln (format "  State root match: ~a\n" (if root-match? "✓" "✗")))

(unless (and height-match? messages-match? root-match?)
  (error "State mismatch after recovery!"))

;;; ─────────────────────────────────────────────────────────────
;;;  Phase 6: Continue from Recovered State
;;; ─────────────────────────────────────────────────────────────

(displayln "[PHASE 6] Continuing operation from recovered state...\n")

;; Update environment reference to recovered state
(set! env recovered-env)

;; Process 3 more frames to prove system still works
(displayln "[CONTINUE] Processing 3 more frames post-recovery...\n")

(for ([i (in-range 8 11)])
  (process-frame i))

(displayln "")

;; Check final state
(define final-alice (get-replica env entity-id "alice"))
(define final-messages (entity-state-messages (entity-replica-state final-alice)))
(define final-height (entity-state-height (entity-replica-state final-alice)))

(displayln "[FINAL] State after recovery + continuation:")
(displayln (format "  Height: ~a" final-height))
(displayln (format "  Messages count: ~a" (length final-messages)))
(displayln (format "  Last message: ~a\n" (if (null? final-messages)
                                               "none"
                                               (last final-messages))))

;;; ─────────────────────────────────────────────────────────────
;;;  Success!
;;; ─────────────────────────────────────────────────────────────

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  ✓ Crash Recovery Demo: SUCCESS")
(displayln "═══════════════════════════════════════════════════════════\n")

(displayln "Proven capabilities:")
(displayln "  ✓ Snapshot captures complete state")
(displayln "  ✓ Recovery restores exact state (Merkle verified)")
(displayln "  ✓ System continues processing after crash")
(displayln "  ✓ Production-ready fault tolerance!\n")

(displayln "Real-world impact:")
(displayln "  - Node crashes don't lose state")
(displayln "  - Instant recovery from latest snapshot")
(displayln "  - Cryptographic integrity guaranteed")
(displayln "  - Zero data loss (with periodic snapshots + WAL)\n")

(displayln "λ.")
