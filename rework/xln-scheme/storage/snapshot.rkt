#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Snapshots - Periodic State Checkpoints
;; ═══════════════════════════════════════════════════════════════════
;;
;; Provides periodic snapshots of server environment for faster recovery.
;; Instead of replaying from genesis, load latest snapshot then replay WAL.
;;
;; Snapshot Format:
;;   (snapshot height timestamp replicas-data)
;;
;; Where replicas-data is:
;;   ((entity-id:signer-id . replica-state) ...)
;;
;; Usage:
;;   (snapshot-save! env "path/to/snapshot-123.ss")
;;   (define env (snapshot-load "path/to/snapshot-123.ss"))
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/port
         racket/pretty
         racket/match
         "../network/server.rkt"
         "../consensus/entity/machine.rkt")

(provide snapshot-save!
         snapshot-load
         snapshot-file-name)

;; ─────────────────────────────────────────────────────────────────
;; Snapshot File Naming
;; ─────────────────────────────────────────────────────────────────

(define/contract (snapshot-file-name dir height)
  (-> path-string? exact-nonnegative-integer? path-string?)

  (build-path dir (format "snapshot-~a.ss" height)))

;; ─────────────────────────────────────────────────────────────────
;; Snapshot Save
;; ─────────────────────────────────────────────────────────────────

(define (serialize-entity-state state)
  ;; Convert entity-state to serializable S-expression
  (list 'entity-state
        (entity-state-entity-id state)
        (entity-state-height state)
        (entity-state-timestamp state)
        (hash->list (entity-state-nonces state))
        (entity-state-messages state)
        ;; Config
        (list 'config
              (consensus-config-mode (entity-state-config state))
              (consensus-config-threshold (entity-state-config state))
              (consensus-config-validators (entity-state-config state))
              (hash->list (consensus-config-shares (entity-state-config state))))))

(define (serialize-replica replica)
  ;; Convert entity-replica to serializable S-expression
  (list 'entity-replica
        (entity-replica-entity-id replica)
        (entity-replica-signer-id replica)
        (serialize-entity-state (entity-replica-state replica))
        (entity-replica-mempool replica)
        (entity-replica-is-proposer replica)
        ;; Proposal and locked-frame set to #f (not persisted)
        #f
        #f))

(define/contract (snapshot-save! env file-path)
  (-> server-env? path-string? void?)

  (displayln (format "[SNAPSHOT] Saving to ~a..." file-path))

  ;; Serialize replicas
  (define replicas-list
    (for/list ([(key replica) (server-env-replicas env)])
      (cons key (serialize-replica replica))))

  ;; Create snapshot data
  (define snapshot-data
    (list 'snapshot
          (server-env-height env)
          (server-env-timestamp env)
          replicas-list))

  ;; Write to file
  (with-output-to-file file-path
    #:exists 'replace
    (lambda ()
      (pretty-print snapshot-data)))

  (displayln (format "[SNAPSHOT] Saved ~a replicas at height ~a"
                     (length replicas-list)
                     (server-env-height env))))

;; ─────────────────────────────────────────────────────────────────
;; Snapshot Load
;; ─────────────────────────────────────────────────────────────────

(define (deserialize-entity-state data)
  (match data
    [(list 'entity-state entity-id height timestamp nonces messages config-data)
     (match config-data
       [(list 'config mode threshold validators shares-list)
        (entity-state
         entity-id
         height
         timestamp
         (make-hash nonces)
         messages
         (consensus-config
          mode
          threshold
          validators
          (make-hash shares-list)))]
       [_
        (error 'deserialize-entity-state "Invalid config format: ~a" config-data)])]
    [_
     (error 'deserialize-entity-state "Invalid entity-state format: ~a" data)]))

(define (deserialize-replica data)
  (match data
    [(list 'entity-replica entity-id signer-id state-data mempool is-proposer proposal locked-frame)
     (entity-replica
      entity-id
      signer-id
      (deserialize-entity-state state-data)
      mempool
      #f  ; Proposal not persisted
      #f  ; Locked frame not persisted
      is-proposer)]
    [_
     (error 'deserialize-replica "Invalid replica format: ~a" data)]))

(define/contract (snapshot-load file-path)
  (-> path-string? server-env?)

  (displayln (format "[SNAPSHOT] Loading from ~a..." file-path))

  ;; Read snapshot data
  (define snapshot-data
    (with-input-from-file file-path read))

  (match snapshot-data
    [(list 'snapshot height timestamp replicas-list)
     ;; Create server environment
     (define env (create-server-env))
     (set-server-env-height! env height)
     (set-server-env-timestamp! env timestamp)

     ;; Deserialize replicas
     (for ([(key replica-data) replicas-list])
       (define replica (deserialize-replica replica-data))
       (hash-set! (server-env-replicas env) key replica))

     (displayln (format "[SNAPSHOT] Loaded ~a replicas at height ~a"
                        (length replicas-list)
                        height))

     env]
    [_
     (error 'snapshot-load "Invalid snapshot format")]))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
