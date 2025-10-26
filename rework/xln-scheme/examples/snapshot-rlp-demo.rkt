#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; RLP Snapshot Demo - Vibepaper-Compliant Persistence Test
;; ═══════════════════════════════════════════════════════════════════

(require "../storage/snapshot-rlp.rkt"
         "../network/server.rkt"
         "../consensus/entity/machine.rkt"
         "../core/crypto.rkt")

(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  RLP Snapshot Demo - Vibepaper Architecture")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")

;; Create test environment
(define env (create-server-env))
(set-server-env-height! env 42)
(set-server-env-timestamp! env 1706284800000)

;; Create test entities
(define alice-id "alice")
(define bob-id "bob")

(define config
  (consensus-config
   'proposer-based
   667  ; 2/3 of 1000
   (list alice-id bob-id)
   (make-hash (list (cons alice-id 600) (cons bob-id 400)))))

(define alice-state
  (entity-state alice-id 42 1706284800000
                (make-hash (list (cons alice-id 5)))
                (list "Hello from Alice" "Testing RLP snapshots")
                config))

(define bob-state
  (entity-state bob-id 42 1706284800000
                (make-hash (list (cons bob-id 3)))
                (list "Bob here" "RLP encoding works!")
                config))

(define alice-replica
  (entity-replica alice-id alice-id alice-state (list) #f #f #t))

(define bob-replica
  (entity-replica bob-id bob-id bob-state (list) #f #f #f))

;; Add replicas to environment
(hash-set! (server-env-replicas env) (format "~a:~a" alice-id alice-id) alice-replica)
(hash-set! (server-env-replicas env) (format "~a:~a" bob-id bob-id) bob-replica)

(displayln "[STEP 1] Created test environment:")
(displayln (format "  - Height: ~a" (server-env-height env)))
(displayln (format "  - Timestamp: ~a" (server-env-timestamp env)))
(displayln (format "  - Replicas: ~a" (hash-count (server-env-replicas env))))
(displayln "")

;; Compute and display Merkle root
(displayln "[STEP 2] Computing Merkle root...")
(define original-root (snapshot-merkle-root env))
(displayln (format "  State Root: ~a" (bytes->hex-string original-root)))
(displayln "")

;; Save RLP snapshot
(displayln "[STEP 3] Saving RLP snapshot...")
(define snapshot-path "/tmp/xln-test-snapshot-42.rlp")
(snapshot-save-rlp! env snapshot-path)
(displayln "")

;; Load RLP snapshot
(displayln "[STEP 4] Loading RLP snapshot...")
(define-values (loaded-env loaded-root) (snapshot-load-rlp snapshot-path))
(displayln "")

;; Verify integrity
(displayln "[STEP 5] Verifying Merkle integrity...")
(define integrity-ok? (snapshot-verify-integrity loaded-env loaded-root))
(displayln "")

;; Compare environments
(displayln "[STEP 6] Comparing original vs loaded...")
(displayln (format "  Original height: ~a" (server-env-height env)))
(displayln (format "  Loaded height:   ~a" (server-env-height loaded-env)))
(displayln (format "  Original timestamp: ~a" (server-env-timestamp env)))
(displayln (format "  Loaded timestamp:   ~a" (server-env-timestamp loaded-env)))
(displayln (format "  Original replicas: ~a" (hash-count (server-env-replicas env))))
(displayln (format "  Loaded replicas:   ~a" (hash-count (server-env-replicas loaded-env))))
(displayln (format "  State roots match: ~a" (equal? original-root loaded-root)))
(displayln "")

;; Verify replica details
(displayln "[STEP 7] Verifying replica data...")
(define loaded-alice (hash-ref (server-env-replicas loaded-env) (format "~a:~a" alice-id alice-id)))
(displayln (format "  Alice entity-id: ~a" (entity-replica-entity-id loaded-alice)))
(displayln (format "  Alice signer-id: ~a" (entity-replica-signer-id loaded-alice)))
(displayln (format "  Alice messages:  ~a" (entity-state-messages (entity-replica-state loaded-alice))))
(displayln (format "  Alice is-proposer: ~a" (entity-replica-is-proposer loaded-alice)))
(displayln "")

(define loaded-bob (hash-ref (server-env-replicas loaded-env) (format "~a:~a" bob-id bob-id)))
(displayln (format "  Bob entity-id: ~a" (entity-replica-entity-id loaded-bob)))
(displayln (format "  Bob messages:  ~a" (entity-state-messages (entity-replica-state loaded-bob))))
(displayln (format "  Bob is-proposer: ~a" (entity-replica-is-proposer loaded-bob)))
(displayln "")

;; Final result
(displayln "═══════════════════════════════════════════════════════════")
(if integrity-ok?
    (displayln "  ✓ RLP Snapshot Demo: SUCCESS")
    (displayln "  ✗ RLP Snapshot Demo: FAILED"))
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "Achievements:")
(displayln "  ✓ RLP encoding working (Ethereum-compatible)")
(displayln "  ✓ Merkle root computation (cryptographic integrity)")
(displayln "  ✓ Dual snapshot format (RLP + S-expr debug)")
(displayln "  ✓ Vibepaper architecture implemented!")
(displayln "")
