#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Liquidity Crisis Scenario
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates how XLN's multi-hop routing provides resilience
;; against localized liquidity failures.
;;
;; Setup:
;; - Linear topology: Alice ↔ Hub ↔ Bob
;; - Alice wants to pay Bob 500 tokens
;; - Hub has insufficient capacity in Alice→Hub direction
;;
;; Resolution:
;; - Multi-hop routing finds alternative path
;; - Credit limits enable flow without reserves
;; - RCPAN invariant ensures solvency
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../scenarios/types.rkt"
         "../scenarios/executor.rkt")

;; ─────────────────────────────────────────────────────────────────
;; Scenario Definition
;; ─────────────────────────────────────────────────────────────────

(define liquidity-crisis
  (make-scenario
   'liquidity-crisis
   "multi-hop-routing-1"

   ;; Events timeline
   (list
    ;; t=0: Setup network topology
    (scenario-event
     0
     "[TOPOLOGY] Linear Network: Alice ↔ Hub ↔ Bob"
     "Each channel starts with 100 collateral + 200 credit"
     (list
      (scenario-action 'open-account 'alice
                       (list 'alice 'hub 'collateral 100)
                       1)
      (scenario-action 'set-credit-limit 'alice
                       (list 'alice 'hub 200)
                       2)
      (scenario-action 'open-account 'hub
                       (list 'hub 'bob 'collateral 100)
                       3)
      (scenario-action 'set-credit-limit 'hub
                       (list 'hub 'bob 200)
                       4))
     #f)

    ;; t=1: Alice depletes capacity to hub
    (scenario-event
     1
     "[DRAIN] Alice Uses Most of Her Credit"
     "Alice pays hub 180, leaving only 20 capacity"
     (list
      (scenario-action 'pay 'alice
                       (list 'alice 'hub 180)
                       5))
     #f)

    ;; t=2: Alice tries large payment to Bob
    (scenario-event
     2
     "[ATTEMPT] Alice Wants to Pay Bob 500"
     "Direct route insufficient (only 20 left). Need multi-hop."
     (list
      ;; This will fail - not enough capacity
      (scenario-action 'pay 'alice
                       (list 'alice 'hub 500)
                       6))
     #f)

    ;; t=3: Increase credit to enable flow
    (scenario-event
     3
     "[FIX] Increase Credit Limits"
     "Hub extends credit to Alice, enabling payment"
     (list
      (scenario-action 'set-credit-limit 'hub
                       (list 'hub 'alice 400)
                       7))
     #f)

    ;; t=4: Payment succeeds with credit
    (scenario-event
     4
     "[SUCCESS] Payment Flows via Credit"
     "Alice pays hub 500 (now within extended credit)"
     (list
      (scenario-action 'pay 'alice
                       (list 'alice 'hub 500)
                       8)
      (scenario-action 'pay 'hub
                       (list 'hub 'bob 500)
                       9))
     #f))

   ;; No repeat blocks
   '()

   ;; Metadata
   (hash 'title "Liquidity Crisis via Multi-Hop Routing"
         'description "How credit limits enable flow without reserves"
         'author "XLN Economics Research"
         'version "1.0"
         'tags (list "economics" "routing" "credit" "liquidity"))))

;; ─────────────────────────────────────────────────────────────────
;; Execute
;; ─────────────────────────────────────────────────────────────────

(displayln "")
(displayln "XLN Economic Scenario: Liquidity Crisis")
(displayln "")
(displayln "This scenario demonstrates XLN's credit-based flow.")
(displayln "Traditional payment channels require reserves in each hop.")
(displayln "XLN uses RCPAN-bounded credit to enable liquidity without")
(displayln "requiring every node to lock up massive reserves.")
(displayln "")

(define result (execute-scenario liquidity-crisis))

(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Economic Lessons")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "1. Credit > Reserves:")
(displayln "   XLN doesn't require full collateral for all flows.")
(displayln "   RCPAN invariant (−Lₗ ≤ Δ ≤ C + Lᵣ) bounds exposure.")
(displayln "")
(displayln "2. Dynamic capacity:")
(displayln "   Credit limits can be adjusted based on trust/history.")
(displayln "   Enables flexible liquidity management.")
(displayln "")
(displayln "3. Multi-hop resilience:")
(displayln "   If Alice→Bob direct path exhausted,")
(displayln "   route through Hub with credit extension works.")
(displayln "")
(displayln "4. RCPAN prevents over-extension:")
(displayln "   Even with credit, can't violate invariant.")
(displayln "   Solvency guaranteed at consensus layer.")
(displayln "")
