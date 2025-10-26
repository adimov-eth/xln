#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Griefing Attack Scenario (RCPAN Defense)
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates how RCPAN invariant prevents channel jamming attacks.
;;
;; Attack Vector (Lightning Network vulnerability):
;; - Attacker opens channel with victim
;; - Sends maximum payment, locking victim's liquidity
;; - Never completes HTLC (neither reveals nor times out quickly)
;; - Victim's funds stuck, can't route other payments
;; - Griefing: Attacker loses nothing, victim loses opportunity cost
;;
;; XLN Defense via RCPAN:
;; - Credit limits bound maximum exposure
;; - Attacker can't lock more than C + Lᵣ
;; - Victim retains capacity via left credit (Lₗ)
;; - Failed attacks cost attacker reputation
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../scenarios/types.rkt"
         "../scenarios/executor.rkt")

;; ─────────────────────────────────────────────────────────────────
;; Scenario Definition
;; ─────────────────────────────────────────────────────────────────

(define griefing-attack
  (make-scenario
   'griefing-attack
   "rcpan-defense-1"

   ;; Events timeline
   (list
    ;; t=0: Setup - Victim opens generous channel
    (scenario-event
     0
     "[SETUP] Victim Opens Channel with Unknown Attacker"
     "Victim: 1000 collateral, extends 500 credit to attacker"
     (list
      (scenario-action 'open-account 'victim
                       (list 'victim 'attacker 'collateral 1000)
                       1)
      (scenario-action 'set-credit-limit 'victim
                       (list 'victim 'attacker 500)
                       2))
     #f)

    ;; t=1: Normal operation
    (scenario-event
     1
     "[OK] Small Payments Work Fine"
     "Attacker behaves normally at first"
     (list
      (scenario-action 'pay 'attacker
                       (list 'attacker 'victim 50)
                       3)
      (scenario-action 'pay 'victim
                       (list 'victim 'attacker 30)
                       4))
     #f)

    ;; t=2: Griefing attempt - max out channel
    (scenario-event
     2
     "[ATTACK] Attacker Tries to Lock Maximum Funds"
     "Attempts payment of 2000 (exceeds RCPAN bound)"
     (list
      ;; This will FAIL - exceeds C + Lr = 1000 + 500 = 1500
      (scenario-action 'pay 'attacker
                       (list 'attacker 'victim 2000)
                       5))
     #f)

    ;; t=3: Attacker tries within bounds
    (scenario-event
     3
     "[ATTACK] Attacker Locks Within RCPAN Limit"
     "Sends 1480 (just under 1500 bound, accounting for Δ=-20)"
     (list
      ;; Current Δ = -20 (attacker owes 20 to victim)
      ;; Upper bound = 1000 + 500 = 1500
      ;; Can add up to 1520 → tries 1480
      (scenario-action 'pay 'attacker
                       (list 'attacker 'victim 1480)
                       6))
     #f)

    ;; t=4: Victim still has capacity via credit
    (scenario-event
     4
     "[DEFENSE] Victim Routes Other Payments"
     "Can still receive from others using left credit (Lₗ)"
     (list
      (scenario-action 'open-account 'other-user
                       (list 'other-user 'victim 'collateral 500)
                       7)
      (scenario-action 'pay 'other-user
                       (list 'other-user 'victim 100)
                       8))
     #f))

   ;; No repeat blocks
   '()

   ;; Metadata
   (hash 'title "Griefing Attack Defense via RCPAN"
         'description "How credit limits prevent channel jamming"
         'author "XLN Security Research"
         'version "1.0"
         'tags (list "security" "griefing" "rcpan" "defense"))))

;; ─────────────────────────────────────────────────────────────────
;; Execute
;; ─────────────────────────────────────────────────────────────────

(displayln "")
(displayln "XLN Security Scenario: Griefing Attack Defense")
(displayln "")
(displayln "In Lightning Network, attackers can lock victim's funds")
(displayln "by initiating large HTLCs and delaying resolution.")
(displayln "Victim can't route other payments while funds locked.")
(displayln "")
(displayln "XLN's RCPAN invariant (−Lₗ ≤ Δ ≤ C + Lᵣ) prevents this:")
(displayln "- Attacker can't lock more than C + Lᵣ")
(displayln "- Victim retains capacity via Lₗ (left credit)")
(displayln "- Failed attacks cost attacker reputation")
(displayln "")

(define result (execute-scenario griefing-attack))

(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Security Lessons")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "1. RCPAN prevents over-commitment:")
(displayln "   Attacker cannot lock more than C + Lᵣ.")
(displayln "   Invariant enforced at consensus layer.")
(displayln "")
(displayln "2. Victim retains capacity:")
(displayln "   Even if attacker maxes out credit,")
(displayln "   victim can still receive via Lₗ (left credit).")
(displayln "")
(displayln "3. Reputation cost:")
(displayln "   Failed attacks visible on-chain.")
(displayln "   Victims adjust credit limits dynamically.")
(displayln "   Repeat attackers lose access to network.")
(displayln "")
(displayln "4. Economic deterrence:")
(displayln "   Locking funds costs attacker opportunity cost.")
(displayln "   If attack fails, attacker pays fees for nothing.")
(displayln "   Griefing becomes economically irrational.")
(displayln "")
(displayln "5. Comparison with Lightning:")
(displayln "   Lightning: Victim fully locked until timeout")
(displayln "   XLN: Victim retains partial capacity via credit")
(displayln "   RCPAN > reserve-based security model")
(displayln "")
