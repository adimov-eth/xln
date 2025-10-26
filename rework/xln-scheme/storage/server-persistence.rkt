#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Server Persistence - Automatic Snapshot Wrapper
;; ═══════════════════════════════════════════════════════════════════
;;
;; Wraps server.rkt with automatic snapshot persistence.
;; Breaks circular dependency by composing modules instead of importing.
;;
;; Usage:
;;   (process-inputs-with-snapshots env inputs timestamp
;;     #:snapshot-dir "/tmp/snapshots"
;;     #:snapshot-interval 5)
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/file
         "../network/server.rkt"
         "../consensus/entity/machine.rkt"
         "./snapshot-rlp.rkt")

(provide process-inputs-with-snapshots
         maybe-save-snapshot)

;; ─────────────────────────────────────────────────────────────────
;; Process Inputs with Automatic Snapshots
;; ─────────────────────────────────────────────────────────────────

(define/contract (process-inputs-with-snapshots env inputs timestamp
                                                 #:snapshot-dir [dir #f]
                                                 #:snapshot-interval [interval #f])
  (->* (server-env? (listof entity-input?) exact-nonnegative-integer?)
       (#:snapshot-dir (or/c path-string? #f)
        #:snapshot-interval (or/c exact-positive-integer? #f))
       (listof entity-input?))

  ;; Process inputs (updates env)
  (define outputs (process-inputs env inputs timestamp))

  ;; Maybe save snapshot
  (maybe-save-snapshot env dir interval)

  outputs)

;; ─────────────────────────────────────────────────────────────────
;; Snapshot Logic
;; ─────────────────────────────────────────────────────────────────

(define/contract (maybe-save-snapshot env dir interval)
  (-> server-env? (or/c path-string? #f) (or/c exact-positive-integer? #f) void?)

  ;; Get max entity height (since server-env-height may not be updated)
  (define height
    (if (zero? (hash-count (server-env-replicas env)))
        0
        (apply max
               (for/list ([(key replica) (server-env-replicas env)])
                 (entity-state-height (entity-replica-state replica))))))

  (cond
    ;; Snapshots disabled
    [(or (not dir) (not interval))
     (void)]

    ;; Not yet at snapshot height
    [(not (zero? (modulo height interval)))
     (void)]

    ;; Save snapshot
    [else
     (displayln (format "[SNAPSHOT] Saving automatic snapshot at height ~a" height))

     ;; Ensure snapshot directory exists
     (unless (directory-exists? dir)
       (make-directory* dir))

     ;; Save snapshot: snapshots/snapshot-HEIGHT.rlp
     (define snapshot-path (build-path dir (format "snapshot-~a.rlp" height)))
     (snapshot-save-rlp! env (path->string snapshot-path))

     (displayln (format "[SNAPSHOT] Saved to ~a" snapshot-path))]))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
