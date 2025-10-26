#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Diamond-Dybvig Bank Run Scenario
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates classic bank run dynamics in XLN payment channels.
;;
;; Setup:
;; - Hub (bank) opens channels with 3 users
;; - Each user gets 1000 tokens collateral
;; - Hub has 3000 total liquidity
;;
;; Bank Run:
;; - User 1 withdraws 800 → hub down to 2200
;; - User 2 panics, withdraws 800 → hub down to 1400
;; - User 3 tries to withdraw 800 → FAILS (insufficient reserves)
;;
;; Classic Diamond-Dybvig: First-mover advantage in fractional reserve.
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../scenarios/types.rkt"
         "../scenarios/executor.rkt")

;; ─────────────────────────────────────────────────────────────────
;; Scenario Definition
;; ─────────────────────────────────────────────────────────────────

(define diamond-dybvig
  (make-scenario
   'diamond-dybvig
   "bank-run-demo-1"

   ;; Events timeline
   (list
    ;; t=0: Setup
    (scenario-event
     0
     "[BANK] Setup: Hub Provides Liquidity"
     "Hub opens channels with 3 users. Each channel has 1000 tokens."
     (list
      (scenario-action 'open-account 'hub
                       (list 'hub 'user-1 'collateral 1000)
                       1)
      (scenario-action 'open-account 'hub
                       (list 'hub 'user-2 'collateral 1000)
                       2)
      (scenario-action 'open-account 'hub
                       (list 'hub 'user-3 'collateral 1000)
                       3))
     #f)

    ;; t=1-4: Normal operations
    (scenario-event
     1
     "[OK] Normal Operations"
     "Users make small payments. Everything works smoothly."
     (list
      (scenario-action 'pay 'user-1
                       (list 'user-1 'hub 10)
                       5)
      (scenario-action 'pay 'user-2
                       (list 'user-2 'hub 15)
                       6))
     #f)

    ;; t=5: First withdrawal
    (scenario-event
     5
     "[WARN] First Withdrawal: Panic Begins"
     "User 1 sees market volatility, closes channel and withdraws 800 tokens."
     (list
      (scenario-action 'withdraw 'user-1
                       (list 'user-1 800)
                       10))
     #f)

    ;; t=8: Cascade
    (scenario-event
     8
     "💥 Cascade: Others Follow"
     "User 2 observes declining reserves, rushes to withdraw. Bank run psychology."
     (list
      (scenario-action 'withdraw 'user-2
                       (list 'user-2 800)
                       12))
     #f)

    ;; t=12: Collapse
    (scenario-event
     12
     "[BOOM] Collapse: Hub Out of Reserves"
     "User 3 cannot withdraw - hub has insufficient reserves. Classic Diamond-Dybvig complete."
     (list
      (scenario-action 'withdraw 'user-3
                       (list 'user-3 800)
                       15))
     #f))

   ;; No repeat blocks
   '()

   ;; Metadata
   (hash 'title "Diamond-Dybvig Bank Run"
         'description "Classic bank run dynamics in payment channels"
         'author "XLN Economics Research"
         'version "1.0"
         'tags (list "economics" "bank-run" "fractional-reserve"))))

;; ─────────────────────────────────────────────────────────────────
;; Execute
;; ─────────────────────────────────────────────────────────────────

(displayln "")
(displayln "XLN Economic Scenario: Diamond-Dybvig Bank Run")
(displayln "")
(displayln "This scenario demonstrates why fractional reserve banking")
(displayln "is vulnerable to bank runs when depositors can withdraw")
(displayln "on demand but the bank has lent out most reserves.")
(displayln "")
(displayln "In XLN terms: Hub opens channels (deposits) but uses")
(displayln "the liquidity elsewhere. First-movers can withdraw,")
(displayln "but late-comers face insufficient reserves.")
(displayln "")

(define result (execute-scenario diamond-dybvig))

(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Economic Lessons")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "1. First-mover advantage:")
(displayln "   Users who withdraw first get their funds.")
(displayln "   Late-comers face insufficient liquidity.")
(displayln "")
(displayln "2. Rational panic:")
(displayln "   Even if the hub is solvent long-term,")
(displayln "   rational users withdraw when they see others withdrawing.")
(displayln "")
(displayln "3. Fractional reserve fragility:")
(displayln "   Hub with 3000 liquidity supports 3 channels of 1000 each.")
(displayln "   Works fine until coordinated withdrawals.")
(displayln "")
(displayln "4. XLN implications:")
(displayln "   - Credit limits can mitigate (users can't withdraw beyond C)")
(displayln "   - RCPAN invariant prevents over-extension")
(displayln "   - Multi-hop routing reduces hub centrality")
(displayln "")
