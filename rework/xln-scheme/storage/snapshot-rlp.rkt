#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN RLP-based Snapshots - Vibepaper-Compliant Persistence
;; ═══════════════════════════════════════════════════════════════════
;;
;; Implements vibepaper's correct architecture:
;; - RLP encoding for deterministic serialization
;; - Merkle roots for cryptographic state integrity
;; - Dual format: RLP (production) + S-expr (debug)
;;
;; Snapshot Format (RLP-encoded):
;;   [height, timestamp, state-root, replicas-rlp]
;;
;; State Root = Merkle root of all replica state hashes
;;
;; Usage:
;;   (snapshot-save-rlp! env "path/to/snapshot-123.rlp")
;;   (define env (snapshot-load-rlp "path/to/snapshot-123.rlp"))
;;
;; Debug snapshots (human-readable S-expressions) saved alongside:
;;   snapshot-123.rlp      (production: RLP-encoded, deterministic)
;;   snapshot-123.debug.ss (debug: S-expression, human-readable)
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/port
         racket/pretty
         racket/match
         "../core/rlp.rkt"
         "../core/merkle.rkt"
         "../core/crypto.rkt"
         "../network/server.rkt"
         "../consensus/entity/machine.rkt")

(provide snapshot-save-rlp!
         snapshot-load-rlp
         snapshot-merkle-root
         snapshot-verify-integrity
         replica->rlp
         replica-state-hash)

;; ─────────────────────────────────────────────────────────────────
;; RLP Serialization (Vibepaper-Compliant)
;; ─────────────────────────────────────────────────────────────────

;; Convert entity-state to RLP-encodable list
(define (entity-state->rlp state)
  (list
   (string->bytes/utf-8 (entity-state-entity-id state))
   (entity-state-height state)
   (entity-state-timestamp state)
   ;; Nonces: [[signer-id, nonce], ...] SORTED by signer-id for determinism
   (for/list ([signer (sort (hash-keys (entity-state-nonces state)) string<?)])
     (list (string->bytes/utf-8 signer) (hash-ref (entity-state-nonces state) signer)))
   ;; Messages: [msg1, msg2, ...]
   (map string->bytes/utf-8 (entity-state-messages state))
   ;; Config: [mode, threshold, validators, shares]
   (list
    (string->bytes/utf-8 (symbol->string (consensus-config-mode (entity-state-config state))))
    (consensus-config-threshold (entity-state-config state))
    (map string->bytes/utf-8 (consensus-config-validators (entity-state-config state)))
    ;; Shares: [[validator, share], ...] SORTED by validator for determinism
    (for/list ([validator (sort (hash-keys (consensus-config-shares (entity-state-config state))) string<?)])
      (list (string->bytes/utf-8 validator) (hash-ref (consensus-config-shares (entity-state-config state)) validator))))))

;; Convert entity-replica to RLP-encodable list
(define (replica->rlp replica)
  (list
   (string->bytes/utf-8 (entity-replica-entity-id replica))
   (string->bytes/utf-8 (entity-replica-signer-id replica))
   (entity-state->rlp (entity-replica-state replica))
   ;; Mempool: serialized as empty for snapshots (transient state)
   (list)
   ;; Is proposer: 0 or 1
   (if (entity-replica-is-proposer replica) 1 0)))

;; Compute hash of replica state (for Merkle tree)
(define/contract (replica-state-hash replica)
  (-> entity-replica? bytes?)
  (sha256 (rlp-encode (replica->rlp replica))))

;; ─────────────────────────────────────────────────────────────────
;; Merkle Root Computation
;; ─────────────────────────────────────────────────────────────────

(define/contract (snapshot-merkle-root env)
  (-> server-env? bytes?)
  ;; Compute Merkle root from all replica state hashes
  ;; CRITICAL: Sort keys for deterministic ordering
  (define sorted-keys (sort (hash-keys (server-env-replicas env)) string<?))
  (define replica-hashes
    (for/list ([key sorted-keys])
      (replica-state-hash (hash-ref (server-env-replicas env) key))))

  (if (null? replica-hashes)
      (sha256 #"")  ; Empty state root
      (merkle-root replica-hashes)))

;; ─────────────────────────────────────────────────────────────────
;; Snapshot Save (RLP + Debug)
;; ─────────────────────────────────────────────────────────────────

(define/contract (snapshot-save-rlp! env file-path)
  (-> server-env? path-string? void?)

  (displayln (format "[SNAPSHOT-RLP] Saving to ~a..." file-path))

  ;; Compute state root (Merkle root of all replica hashes)
  (define state-root (snapshot-merkle-root env))
  (displayln (format "[SNAPSHOT-RLP] State root: ~a" (bytes->hex-string state-root)))

  ;; Serialize replicas to RLP
  (define replicas-rlp
    (for/list ([(key replica) (server-env-replicas env)])
      (list
       (string->bytes/utf-8 key)
       (replica->rlp replica))))

  ;; Create snapshot: [height, timestamp, state-root, replicas]
  (define snapshot-data
    (list
     (server-env-height env)
     (server-env-timestamp env)
     state-root
     replicas-rlp))

  ;; Encode to RLP
  (define rlp-bytes (rlp-encode snapshot-data))

  ;; Write RLP snapshot
  (with-output-to-file file-path
    #:exists 'replace
    #:mode 'binary
    (lambda ()
      (write-bytes rlp-bytes)))

  (displayln (format "[SNAPSHOT-RLP] Saved ~a bytes (~a replicas at height ~a)"
                     (bytes-length rlp-bytes)
                     (hash-count (server-env-replicas env))
                     (server-env-height env)))

  ;; ALSO save debug S-expression snapshot (human-readable)
  (save-debug-snapshot! env file-path state-root))

;; Save human-readable S-expression snapshot for debugging
(define (save-debug-snapshot! env rlp-path state-root)
  (define debug-path (string-append rlp-path ".debug.ss"))

  (define replicas-list
    (for/list ([(key replica) (server-env-replicas env)])
      (list key
            (entity-replica-entity-id replica)
            (entity-replica-signer-id replica)
            (entity-state-height (entity-replica-state replica))
            (entity-state-messages (entity-replica-state replica)))))

  (define debug-data
    (list 'snapshot-debug
          (server-env-height env)
          (server-env-timestamp env)
          (bytes->hex-string state-root)
          replicas-list))

  (with-output-to-file debug-path
    #:exists 'replace
    (lambda ()
      (pretty-print debug-data)))

  (displayln (format "[SNAPSHOT-DEBUG] Saved human-readable snapshot to ~a" debug-path)))

;; ─────────────────────────────────────────────────────────────────
;; Snapshot Load (RLP)
;; ─────────────────────────────────────────────────────────────────

;; Deserialize entity-state from RLP list
(define (rlp->entity-state data entity-id)
  (match data
    [(list entity-id-bytes height-bytes timestamp-bytes nonces-list messages-list config-list)
     (match config-list
       [(list mode-bytes threshold-bytes validators-list shares-list)
        (entity-state
         entity-id
         (rlp-bytes->integer height-bytes)
         (rlp-bytes->integer timestamp-bytes)
         ;; Nonces: hash table from list
         (make-hash
          (for/list ([pair nonces-list])
            (match pair
              [(list signer-bytes nonce-bytes)
               (cons (bytes->string/utf-8 signer-bytes)
                     (rlp-bytes->integer nonce-bytes))])))
         ;; Messages
         (map bytes->string/utf-8 messages-list)
         ;; Config
         (consensus-config
          (string->symbol (bytes->string/utf-8 mode-bytes))
          (rlp-bytes->integer threshold-bytes)
          (map bytes->string/utf-8 validators-list)
          (make-hash
           (for/list ([pair shares-list])
             (match pair
               [(list validator-bytes share-bytes)
                (cons (bytes->string/utf-8 validator-bytes)
                      (rlp-bytes->integer share-bytes))])))))]
       [_
        (error 'rlp->entity-state "Invalid config format")])]
    [_
     (error 'rlp->entity-state "Invalid entity-state format")]))

;; Helper: Convert RLP bytes to integer (RLP decoder returns bytes for integers)
(define (rlp-bytes->integer bs)
  (if (zero? (bytes-length bs))
      0
      (bytes-be->integer bs)))

;; Helper: Convert bytes-be to integer
(define (bytes-be->integer bs)
  (for/fold ([result 0])
            ([b (in-bytes bs)])
    (+ (* result 256) b)))

;; Deserialize entity-replica from RLP list
(define (rlp->replica data)
  (match data
    [(list entity-id-bytes signer-id-bytes state-data mempool-data is-proposer-bytes)
     (define entity-id (bytes->string/utf-8 entity-id-bytes))
     (define signer-id (bytes->string/utf-8 signer-id-bytes))
     (define is-proposer-num (rlp-bytes->integer is-proposer-bytes))
     (entity-replica
      entity-id
      signer-id
      (rlp->entity-state state-data entity-id)
      (list)  ; Mempool not persisted
      #f      ; Proposal not persisted
      #f      ; Locked frame not persisted
      (= is-proposer-num 1))]
    [_
     (error 'rlp->replica "Invalid replica format")]))

(define/contract (snapshot-load-rlp file-path)
  (-> path-string? (values server-env? bytes?))

  (displayln (format "[SNAPSHOT-RLP] Loading from ~a..." file-path))

  ;; Read RLP bytes
  (define rlp-bytes
    (with-input-from-file file-path
      #:mode 'binary
      (lambda ()
        (port->bytes))))

  (displayln (format "[SNAPSHOT-RLP] Read ~a bytes" (bytes-length rlp-bytes)))

  ;; Decode RLP
  (define snapshot-data (rlp-decode rlp-bytes))

  (match snapshot-data
    [(list height-bytes timestamp-bytes state-root replicas-list)
     (define height (rlp-bytes->integer height-bytes))
     (define timestamp (rlp-bytes->integer timestamp-bytes))
     (displayln (format "[SNAPSHOT-RLP] Decoded: height=~a, state-root=~a"
                        height
                        (bytes->hex-string state-root)))

     ;; Create server environment
     (define env (create-server-env))
     (set-server-env-height! env height)
     (set-server-env-timestamp! env timestamp)

     ;; Deserialize replicas
     (for ([entry replicas-list])
       (match entry
         [(list key-bytes replica-data)
          (define key (bytes->string/utf-8 key-bytes))
          (define replica (rlp->replica replica-data))
          (hash-set! (server-env-replicas env) key replica)]))

     (displayln (format "[SNAPSHOT-RLP] Loaded ~a replicas"
                        (hash-count (server-env-replicas env))))

     (values env state-root)]
    [_
     (error 'snapshot-load-rlp "Invalid snapshot format")]))

;; ─────────────────────────────────────────────────────────────────
;; Snapshot Integrity Verification
;; ─────────────────────────────────────────────────────────────────

(define/contract (snapshot-verify-integrity env expected-state-root)
  (-> server-env? bytes? boolean?)

  (displayln "[SNAPSHOT-RLP] Verifying state integrity...")

  (define computed-root (snapshot-merkle-root env))
  (define matches? (equal? computed-root expected-state-root))

  (displayln (format "[SNAPSHOT-RLP] Expected: ~a" (bytes->hex-string expected-state-root)))
  (displayln (format "[SNAPSHOT-RLP] Computed: ~a" (bytes->hex-string computed-root)))
  (displayln (format "[SNAPSHOT-RLP] Integrity: ~a" (if matches? "OK ✓" "FAILED ✗")))

  matches?)

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete - Vibepaper-Compliant RLP+Merkle Snapshots
;; ═══════════════════════════════════════════════════════════════════
