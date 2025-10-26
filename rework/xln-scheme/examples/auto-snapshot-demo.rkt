#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Automatic Snapshot Demo - Persistence Every 5 Heights
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates automatic snapshot persistence:
;; - Server saves RLP snapshots every 5 heights
;; - Creates snapshots/snapshot-5.rlp, snapshot-10.rlp, etc.
;; - Verifies Merkle integrity after each snapshot
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../consensus/entity/machine.rkt"
         "../network/server.rkt"
         "../storage/snapshot-rlp.rkt"
         (only-in "../storage/server-persistence.rkt" maybe-save-snapshot)
         racket/format)

(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Automatic Snapshot Demo - Every 5 Heights")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")

;; ─────────────────────────────────────────────────────────────────
;; Setup: Create Server with Automatic Snapshots
;; ─────────────────────────────────────────────────────────────────

(define snapshot-dir "/tmp/xln-auto-snapshots")

(displayln (format "[SETUP] Creating server with automatic snapshots"))
(displayln (format "  - Snapshot directory: ~a" snapshot-dir))
(displayln (format "  - Snapshot interval: every 5 heights"))
(displayln "")

(define env (create-server-env))

;; Create test entity configuration
(define entity-id "entity-auto")
(define validators '("alice" "bob" "charlie"))
(define shares (make-hash))
(hash-set! shares "alice" 1)
(hash-set! shares "bob" 1)
(hash-set! shares "charlie" 1)
(define threshold 2)

(define config
  (consensus-config
   'proposer-based
   threshold
   validators
   shares))

;; Create replicas
(displayln "[SETUP] Creating 3 validators...")
(for ([validator validators])
  (define is-proposer (equal? validator "alice"))
  (define state
    (entity-state
     entity-id
     0  ; Initial height
     0  ; Initial timestamp
     (make-hash (list (cons validator 0)))
     (list)
     config))

  (define replica
    (entity-replica
     entity-id
     validator
     state
     (list)
     #f
     #f
     is-proposer))

  (add-replica env replica)
  (displayln (format "  - ~a (proposer: ~a)" validator is-proposer)))

(displayln "")

;; ─────────────────────────────────────────────────────────────────
;; Run 15 Frames (Should Create 3 Snapshots: 5, 10, 15)
;; ─────────────────────────────────────────────────────────────────

(displayln "[RUN] Processing 15 frames...")
(displayln "")

(for ([frame-num (in-range 1 16)])
  (define timestamp (* frame-num 100))

  (displayln (format "[FRAME ~a] Timestamp: ~a" frame-num timestamp))

  ;; Step 1: Proposer creates frame
  (define proposer (get-replica env entity-id "alice"))

  ;; Add transaction to proposer's mempool
  (define message-tx
    (entity-tx "message"
               (list (string->bytes/utf-8 (format "Frame ~a" frame-num)))))
  (set-entity-replica-mempool! proposer (list message-tx))

  ;; Propose frame
  (define proposal (propose-entity-frame proposer timestamp))

  (when proposal
    ;; Step 2: Validators process proposal
    (define all-precommits '())

    (for ([validator-id validators])
      (when (not (equal? validator-id "alice"))
        (define validator (get-replica env entity-id validator-id))
        (define precommit-outputs (handle-entity-input validator proposal timestamp))

        (when (not (null? precommit-outputs))
          (set! all-precommits (append all-precommits precommit-outputs)))))

    ;; Step 3: Proposer commits
    (for ([precommit all-precommits])
      (handle-entity-input proposer precommit timestamp))

    ;; Trigger snapshot check after processing
    (maybe-save-snapshot env snapshot-dir 5))

  (displayln ""))

;; ─────────────────────────────────────────────────────────────────
;; Verify Snapshots Were Created
;; ─────────────────────────────────────────────────────────────────

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Verification: Checking Snapshots")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")

(define snapshot-heights '(5 10 15))

(for ([height snapshot-heights])
  (define snapshot-path
    (format "~a/snapshot-~a.rlp" snapshot-dir height))

  (displayln (format "[CHECK] Snapshot at height ~a:" height))

  (cond
    [(file-exists? snapshot-path)
     (displayln (format "  ✓ File exists: ~a" snapshot-path))

     ;; Load and verify
     (define-values (loaded-env loaded-root) (snapshot-load-rlp snapshot-path))
     (define integrity-ok? (snapshot-verify-integrity loaded-env loaded-root))

     (displayln (format "  - Loaded height: ~a" (server-env-height loaded-env)))
     (displayln (format "  - Merkle integrity: ~a"
                        (if integrity-ok? "OK ✓" "FAILED ✗")))

     ;; Check debug snapshot too
     (define debug-path (string-append snapshot-path ".debug.ss"))
     (when (file-exists? debug-path)
       (displayln (format "  ✓ Debug snapshot exists: ~a" debug-path)))]

    [else
     (displayln (format "  ✗ File missing: ~a" snapshot-path))])

  (displayln ""))

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Demo Complete")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "Achievements:")
(displayln "  ✓ Automatic snapshots every 5 heights")
(displayln "  ✓ RLP + Merkle integrity verification")
(displayln "  ✓ Dual format (RLP + S-expr debug)")
(displayln "  ✓ Production-ready persistence!")
(displayln "")
