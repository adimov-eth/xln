#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; DSL Demo - Same Scenario, Different Syntax
;; ═══════════════════════════════════════════════════════════════════
;;
;; This demonstrates the scenario DSL macros.
;;
;; Compare verbosity:
;;
;; Old way (manual structs):
;;   (scenario-event 0 "Title" "Desc"
;;     (list (scenario-action 'pay 'alice (list 'alice 'bob 100) 1))
;;     #f)
;;
;; New way (DSL macros):
;;   (at 0 "Title" "Desc"
;;     (pay alice bob 100))
;;
;; This is homoiconicity winning: macros transform surface syntax
;; into the same data structures, but with less noise.
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../scenarios/dsl.rkt"
         "../scenarios/executor.rkt")

;; ─────────────────────────────────────────────────────────────────
;; Scenario Using DSL Macros
;; ─────────────────────────────────────────────────────────────────

(define-scenario coffee-shop
  #:seed "daily-coffee-1"
  #:metadata (hash 'title "Coffee Shop Economics"
                   'description "Recurring micropayments via XLN"
                   'author "XLN Economics Research"
                   'tags (list "micropayments" "recurring" "real-world"))

  ;; t=0: Setup account
  (at 0 "Alice Opens Tab at Coffee Shop"
      "500 collateral + 200 credit for daily coffee"
    (open-account alice coffee-shop #:collateral 500)
    (set-credit coffee-shop alice 200))

  ;; t=1: First purchase
  (at 1 "Alice Buys Morning Coffee"
      "Latte: $5"
    (pay alice coffee-shop 5))

  ;; t=2: Lunch
  (at 2 "Alice Buys Lunch"
      "Sandwich + Drink: $12"
    (pay alice coffee-shop 12))

  ;; t=3: Afternoon coffee
  (at 3 "Alice Buys Afternoon Coffee"
      "Espresso: $3"
    (pay alice coffee-shop 3))

  ;; t=4: Evening - running low on balance
  (at 4 "Alice Checks Balance, Still Has Credit"
      "Spent $20, has $680 capacity left (500 + 200 - 20)"
    (pay alice coffee-shop 2))

  ;; t=5-10: Continuous small payments
  (every 1
    (pay alice coffee-shop 1)))

;; ─────────────────────────────────────────────────────────────────
;; Execute
;; ─────────────────────────────────────────────────────────────────

(displayln "")
(displayln "XLN DSL Demo: Coffee Shop Micropayments")
(displayln "")
(displayln "This scenario shows:")
(displayln "1. Clean DSL syntax (pay alice bob 100)")
(displayln "2. Recurring payments (every 1 ...)")
(displayln "3. Real-world use case (daily coffee tab)")
(displayln "")

(define result (execute-scenario coffee-shop))

(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  DSL Benefits")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "1. Readable syntax:")
(displayln "   (pay alice bob 100) vs verbose struct creation")
(displayln "")
(displayln "2. Homoiconic expansion:")
(displayln "   Macros expand to same data structures.")
(displayln "   No parser needed - just syntax transformation.")
(displayln "")
(displayln "3. Composable:")
(displayln "   Can define custom macros that expand to base actions.")
(displayln "   (buy-coffee) → (pay user shop 5)")
(displayln "")
(displayln "4. Inspectable:")
(displayln "   Even after macro expansion, still S-expressions.")
(displayln "   Can query, transform, serialize scenarios as data.")
(displayln "")
