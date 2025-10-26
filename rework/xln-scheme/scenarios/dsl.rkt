#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Scenario DSL - Syntactic Sugar for Economic Simulations
;; ═══════════════════════════════════════════════════════════════════
;;
;; This module provides macros that make scenario creation more natural.
;;
;; Instead of:
;;   (scenario-event 0 "Title" "Description"
;;     (list (scenario-action 'pay 'alice (list 'alice 'bob 100) 1)) #f)
;;
;; Write:
;;   (at 0 "Title" "Description"
;;     (pay alice bob 100))
;;
;; The macro expands to the verbose form automatically.
;;
;; ═══════════════════════════════════════════════════════════════════

(require "types.rkt"
         (for-syntax racket/base
                     racket/syntax))

(provide define-scenario
         at
         every
         open-account
         pay
         withdraw
         set-credit
         create-htlc
         claim-htlc
         refund-htlc
         camera
         focus)

;; ─────────────────────────────────────────────────────────────────
;; Action Macros (Syntactic Sugar)
;; ─────────────────────────────────────────────────────────────────

(define-syntax (open-account stx)
  (syntax-case stx ()
    [(_ from to #:collateral coll)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'open-account 'from
                          (list 'from 'to 'collateral coll)
                          line-num))]))

(define-syntax (pay stx)
  (syntax-case stx ()
    [(_ from to amount)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'pay 'from
                          (list 'from 'to amount)
                          line-num))]))

(define-syntax (withdraw stx)
  (syntax-case stx ()
    [(_ entity amount)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'withdraw 'entity
                          (list 'entity amount)
                          line-num))]))

(define-syntax (set-credit stx)
  (syntax-case stx ()
    [(_ from to limit)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'set-credit-limit 'from
                          (list 'from 'to limit)
                          line-num))]))

(define-syntax (create-htlc stx)
  (syntax-case stx ()
    [(_ sender receiver amount token hash timeout)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'create-htlc 'sender
                          (list 'sender 'receiver amount 'token
                                'hash hash 'timeout timeout)
                          line-num))]))

(define-syntax (claim-htlc stx)
  (syntax-case stx ()
    [(_ claimer htlc-id preimage)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'claim-htlc 'claimer
                          (list htlc-id 'preimage preimage)
                          line-num))]))

(define-syntax (refund-htlc stx)
  (syntax-case stx ()
    [(_ refunder htlc-id)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'refund-htlc 'refunder
                          (list htlc-id)
                          line-num))]))

(define-syntax (camera stx)
  (syntax-case stx ()
    [(_ mode)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'camera #f
                          (list 'mode)
                          line-num))]))

(define-syntax (focus stx)
  (syntax-case stx ()
    [(_ entity)
     (with-syntax ([line-num (syntax-line stx)])
       #'(scenario-action 'focus #f
                          (list 'entity)
                          line-num))]))

;; ─────────────────────────────────────────────────────────────────
;; Event Macros
;; ─────────────────────────────────────────────────────────────────

(define-syntax (at stx)
  (syntax-case stx ()
    [(_ timestamp title description action ...)
     #'(scenario-event timestamp title description
                       (list action ...)
                       #f)]
    [(_ timestamp action ...)
     #'(scenario-event timestamp #f #f
                       (list action ...)
                       #f)]))

(define-syntax (every stx)
  (syntax-case stx ()
    [(_ interval action ...)
     #'(repeat-block interval
                     (list action ...)
                     0)]))

;; ─────────────────────────────────────────────────────────────────
;; Scenario Definition Macro
;; ─────────────────────────────────────────────────────────────────

(define-syntax (define-scenario stx)
  (syntax-case stx ()
    [(_ name
        #:seed seed-str
        #:metadata metadata-hash
        event-or-repeat ...)
     #'(define name
         (let ([events '()]
               [repeats '()])
           ;; Separate events from repeats
           (for ([item (list event-or-repeat ...)])
             (cond
               [(scenario-event? item)
                (set! events (cons item events))]
               [(repeat-block? item)
                (set! repeats (cons item repeats))]))
           ;; Create scenario
           (make-scenario 'name seed-str
                          (reverse events)
                          (reverse repeats)
                          metadata-hash)))]
    [(_ name
        #:seed seed-str
        event-or-repeat ...)
     #'(define-scenario name
         #:seed seed-str
         #:metadata (hash)
         event-or-repeat ...)]))

;; ─────────────────────────────────────────────────────────────────
;; Example Usage (Commented Out)
;; ─────────────────────────────────────────────────────────────────

;; (define-scenario simple-payment
;;   #:seed "example-1"
;;   #:metadata (hash 'title "Simple Payment"
;;                    'description "Alice pays Bob")
;;
;;   (at 0 "Setup" "Open accounts"
;;     (open-account alice bob #:collateral 1000))
;;
;;   (at 1 "Payment" "Alice sends 100 to Bob"
;;     (pay alice bob 100))
;;
;;   (every 1
;;     (pay alice bob 10)))
