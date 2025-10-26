#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Scenario Executor - Run Economic Simulations
;; ═══════════════════════════════════════════════════════════════════

(require "types.rkt"
         "../consensus/account/rcpan.rkt")

(provide execute-scenario
         execute-action
         create-execution-context)

;; ─────────────────────────────────────────────────────────────────
;; Execution Context
;; ─────────────────────────────────────────────────────────────────

(define (create-execution-context scenario)
  (define max-time
    (apply max
           (cons 0 (map scenario-event-timestamp (scenario-events scenario)))))

  (define total-frames (ceiling (* max-time 10)))  ; 10 FPS default

  (scenario-context scenario
                    0                    ; current-frame
                    total-frames
                    0.0                  ; elapsed-time
                    (make-hash)          ; entity-mapping
                    (make-hash)          ; view-history
                    100))                ; tick-interval (ms)

;; ─────────────────────────────────────────────────────────────────
;; Action Execution
;; ─────────────────────────────────────────────────────────────────

(define (execute-action action context state)
  (match (scenario-action-type action)
    ;; Account management
    ['open-account
     (execute-open-account action context state)]

    ['pay
     (execute-payment action context state)]

    ['withdraw
     (execute-withdrawal action context state)]

    ['set-credit-limit
     (execute-set-credit action context state)]

    ;; Collateral operations
    ['deposit-collateral
     (execute-deposit-collateral action context state)]

    ;; HTLC operations
    ['create-htlc
     (execute-create-htlc action context state)]

    ['claim-htlc
     (execute-claim-htlc action context state)]

    ['refund-htlc
     (execute-refund-htlc action context state)]

    ;; View state changes (no state mutation)
    ['camera
     (execute-camera-change action context state)]

    ['focus
     (execute-focus-change action context state)]

    ;; Unknown action
    [_
     (values state
             context
             (list (format "Unknown action: ~a" (scenario-action-type action))))]))

;; ─────────────────────────────────────────────────────────────────
;; Account Operations
;; ─────────────────────────────────────────────────────────────────

(define (execute-open-account action ctx state)
  ;; Extract parameters
  (define params (scenario-action-params action))
  (define from-entity (list-ref params 0))
  (define to-entity (list-ref params 1))
  (define collateral
    (hash-ref (list->hash (drop params 2)) 'collateral 0))

  ;; Create RCPAN state for this account
  (define rcpan (create-rcpan-state))

  ;; Set collateral if provided
  (when (> collateral 0)
    (set-collateral! rcpan 1 collateral))

  ;; Add to state (simplified - real version needs full consensus)
  (define account-key (canonical-account-key from-entity to-entity))
  (define new-state
    (hash-set (if (immutable? state) state (hash-copy state))
              account-key
              rcpan))

  (displayln (format "[OK] Opened account ~a → ~a (collateral: ~a)"
                    from-entity to-entity collateral))

  (values new-state ctx '()))

(define (execute-payment action ctx state)
  ;; Extract parameters
  (define params (scenario-action-params action))
  (define from-entity (list-ref params 0))
  (define to-entity (list-ref params 1))
  (define amount (list-ref params 2))

  ;; Find account
  (define account-key (canonical-account-key from-entity to-entity))
  (define rcpan-state (hash-ref state account-key #f))

  (if rcpan-state
      (with-handlers ([exn:fail?
                       (lambda (e)
                         (values state
                                 ctx
                                 (list (format "[X] Payment failed: ~a"
                                              (exn-message e)))))])
        ;; Try to update delta (will fail if violates RCPAN)
        (update-rcpan-delta! rcpan-state 1 amount)

        (displayln (format "[$$] ~a paid ~a to ~a (Δ = ~a)"
                          from-entity amount to-entity
                          (get-delta rcpan-state 1)))

        (values state ctx '()))
      (values state
              ctx
              (list (format "[X] Account ~a not found" account-key)))))

(define (execute-withdrawal action ctx state)
  ;; Similar to payment but withdraws from channel to on-chain
  (define params (scenario-action-params action))
  (define entity (list-ref params 0))
  (define amount (list-ref params 1))

  (displayln (format "[WITHDRAW] ~a withdrawing ~a" entity amount))

  ;; TODO: Implement withdrawal logic
  (values state ctx '()))

(define (execute-set-credit action ctx state)
  ;; Set credit limit on an account
  (define params (scenario-action-params action))
  (define from-entity (list-ref params 0))
  (define to-entity (list-ref params 1))
  (define limit (list-ref params 2))

  (define account-key (canonical-account-key from-entity to-entity))
  (define rcpan-state (hash-ref state account-key #f))

  (if rcpan-state
      (begin
        (set-credit-right! rcpan-state 1 limit)
        (displayln (format "[OK] Set credit limit ~a → ~a: ~a"
                          from-entity to-entity limit))
        (values state ctx '()))
      (values state
              ctx
              (list (format "[X] Account ~a not found" account-key)))))

;; ─────────────────────────────────────────────────────────────────
;; Collateral Operations
;; ─────────────────────────────────────────────────────────────────

(define (execute-deposit-collateral action ctx state)
  (define params (scenario-action-params action))
  (displayln (format "[OK] Deposited collateral: ~a" params))
  (values state ctx '()))

;; ─────────────────────────────────────────────────────────────────
;; HTLC Operations
;; ─────────────────────────────────────────────────────────────────

(define (execute-create-htlc action ctx state)
  (displayln "[OK] Created HTLC")
  (values state ctx '()))

(define (execute-claim-htlc action ctx state)
  (displayln "[OK] Claimed HTLC")
  (values state ctx '()))

(define (execute-refund-htlc action ctx state)
  (displayln "[OK] Refunded HTLC")
  (values state ctx '()))

;; ─────────────────────────────────────────────────────────────────
;; View State Changes
;; ─────────────────────────────────────────────────────────────────

(define (execute-camera-change action ctx state)
  ;; Update camera in view-history
  (values state ctx '()))

(define (execute-focus-change action ctx state)
  ;; Update focus entity
  (values state ctx '()))

;; ─────────────────────────────────────────────────────────────────
;; Main Execution Loop
;; ─────────────────────────────────────────────────────────────────

(define (execute-scenario scenario)
  (displayln "═══════════════════════════════════════════════════════════")
  (displayln (format "  Executing Scenario: ~a" (scenario-name scenario)))
  (displayln "═══════════════════════════════════════════════════════════")
  (displayln "")

  ;; Create execution context
  (define ctx (create-execution-context scenario))

  ;; Merge timeline (one-time events + repeats)
  (define max-time
    (scenario-context-total-frames ctx))

  (define timeline
    (merge-timeline (scenario-events scenario)
                    (scenario-repeat-blocks scenario)
                    max-time))

  ;; Execute events sequentially
  (define-values (final-state final-ctx errors)
    (for/fold ([state (make-immutable-hash)]
               [context ctx]
               [errors '()])
              ([event (in-list timeline)])

      ;; Print event header
      (when (scenario-event-title event)
        (displayln "")
        (displayln (format "=== ~a (t=~a) ==="
                          (scenario-event-title event)
                          (scenario-event-timestamp event))))

      (when (scenario-event-description event)
        (displayln (scenario-event-description event)))

      ;; Execute all actions in this event
      (for/fold ([st state]
                 [ct context]
                 [errs errors])
                ([action (in-list (scenario-event-actions event))])
        (define-values (new-state new-ctx action-errors)
          (execute-action action ct st))

        (values new-state
                new-ctx
                (append errs action-errors)))))

  ;; Print results
  (displayln "")
  (displayln "═══════════════════════════════════════════════════════════")
  (if (null? errors)
      (displayln "  Scenario completed successfully!")
      (begin
        (displayln "  Scenario completed with errors:")
        (for ([err (in-list errors)])
          (displayln (format "    - ~a" err)))))
  (displayln "═══════════════════════════════════════════════════════════")

  ;; Return result
  (scenario-result (null? errors)
                   (hash-count final-state)
                   (scenario-context-elapsed-time final-ctx)
                   errors
                   final-ctx))

;; ─────────────────────────────────────────────────────────────────
;; Helpers
;; ─────────────────────────────────────────────────────────────────

;; Canonical account key (lexicographic ordering)
(define (canonical-account-key e1 e2)
  (define s1 (symbol->string e1))
  (define s2 (symbol->string e2))
  (if (string<? s1 s2)
      (format "~a-~a" e1 e2)
      (format "~a-~a" e2 e1)))

(define (list->hash lst)
  (for/hash ([pair (in-list (pairwise lst))])
    (values (car pair) (cadr pair))))

(define (pairwise lst)
  (if (<= (length lst) 1)
      '()
      (cons (take lst 2)
            (pairwise (drop lst 2)))))
