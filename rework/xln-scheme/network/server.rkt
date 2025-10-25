#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Network Server - Multi-Replica Coordinator
;; ═══════════════════════════════════════════════════════════════════
;;
;; Coordinates multiple entity replicas in a single process.
;; Based on TypeScript runtime/runtime.ts patterns.
;;
;; Flow:
;;   1. Collect entity inputs
;;   2. Route inputs to replicas (by entityId:signerId key)
;;   3. Apply consensus (handle-entity-input)
;;   4. Update replica states
;;   5. Collect outputs for next iteration
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/match
         racket/list
         "../consensus/entity/machine.rkt")

(provide (struct-out server-env)
         create-server-env
         add-replica
         process-inputs
         get-replica
         list-all-replicas)

;; ─────────────────────────────────────────────────────────────────
;; Server Environment
;; ─────────────────────────────────────────────────────────────────

;; Server environment (holds all replicas)
(struct server-env (
  replicas          ; Hash table: "entityId:signerId" → entity-replica
  height            ; Server height (frame counter)
  timestamp         ; Current server timestamp
) #:mutable #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; Server Creation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-server-env)
  (-> server-env?)

  (server-env
   (make-hash)       ; Empty replicas
   0                 ; Initial height
   0))               ; Initial timestamp

;; ─────────────────────────────────────────────────────────────────
;; Replica Management
;; ─────────────────────────────────────────────────────────────────

(define/contract (add-replica env replica)
  (-> server-env? entity-replica? void?)

  (define key (format "~a:~a"
                      (entity-replica-entity-id replica)
                      (entity-replica-signer-id replica)))

  (hash-set! (server-env-replicas env) key replica)

  (displayln (format "[SERVER] Added replica: ~a (isProposer=~a)"
                     key
                     (entity-replica-is-proposer replica))))

(define/contract (get-replica env entity-id signer-id)
  (-> server-env? string? string? (or/c entity-replica? #f))

  (define key (format "~a:~a" entity-id signer-id))
  (hash-ref (server-env-replicas env) key #f))

(define/contract (list-all-replicas env)
  (-> server-env? (listof entity-replica?))

  (hash-values (server-env-replicas env)))

;; ─────────────────────────────────────────────────────────────────
;; Input Processing
;; ─────────────────────────────────────────────────────────────────

(define/contract (process-inputs env inputs timestamp)
  (-> server-env? (listof entity-input?) exact-nonnegative-integer?
      (listof entity-input?))

  (displayln (format "\n[SERVER] Processing ~a inputs at timestamp ~a"
                     (length inputs)
                     timestamp))

  ;; Update server timestamp
  (set-server-env-timestamp! env timestamp)

  (define all-outputs '())

  ;; Process each input
  (for ([input inputs])
    (define entity-id (entity-input-entity-id input))
    (define signer-id (entity-input-signer-id input))
    (define key (format "~a:~a" entity-id signer-id))

    ;; Find replica
    (define replica (hash-ref (server-env-replicas env) key #f))

    (cond
      [(not replica)
       (displayln (format "[WARN] No replica found for ~a" key))]

      [else
       (displayln (format "[SERVER] Processing input for ~a" key))

       ;; Apply consensus
       (define outputs (handle-entity-input replica input timestamp))

       ;; Update replica in environment (replica is mutable, but good practice)
       (hash-set! (server-env-replicas env) key replica)

       ;; Collect outputs
       (set! all-outputs (append all-outputs outputs))

       (displayln (format "[SERVER] Generated ~a outputs from ~a"
                          (length outputs)
                          key))]))

  ;; Increment server height
  (set-server-env-height! env (+ (server-env-height env) 1))

  (displayln (format "[SERVER] Server height now: ~a"
                     (server-env-height env)))

  all-outputs)

;; ─────────────────────────────────────────────────────────────────
;; Utilities
;; ─────────────────────────────────────────────────────────────────

(define/contract (get-proposer env entity-id)
  (-> server-env? string? (or/c entity-replica? #f))

  ;; Find proposer (first validator)
  (define replicas (list-all-replicas env))
  (define entity-replicas
    (filter (lambda (r)
              (equal? (entity-replica-entity-id r) entity-id))
            replicas))

  (cond
    [(null? entity-replicas) #f]
    [else
     (findf (lambda (r) (entity-replica-is-proposer r))
            entity-replicas)]))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
