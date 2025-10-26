#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Network Effects Scenario
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates how XLN's gossip protocol enables emergent routing.
;;
;; Setup:
;; - Star topology: Hub with 5 spokes (users)
;; - Each user opens bilateral account with hub
;; - Gossip propagates profiles automatically
;;
;; Dynamics:
;; - As users join, network capacity grows superlinearly
;; - PathFinder discovers routes without manual configuration
;; - Credit limits create economic incentives for routing
;;
;; Network Value:
;; - 2 nodes: 1 route
;; - 3 nodes: 3 routes (3x value)
;; - 5 nodes: 10 routes (10x value)
;; - n nodes: n(n-1)/2 routes → O(n²) growth
;;
;; This is Metcalfe's Law in action.
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../scenarios/types.rkt"
         "../scenarios/executor.rkt")

;; ─────────────────────────────────────────────────────────────────
;; Scenario Definition
;; ─────────────────────────────────────────────────────────────────

(define network-effects
  (make-scenario
   'network-effects
   "metcalfe-law-1"

   ;; Events timeline
   (list
    ;; t=0: First user joins
    (scenario-event
     0
     "[JOIN] User-1 Joins Network"
     "Opens account with hub. Network value: 0 (no routes yet)"
     (list
      (scenario-action 'open-account 'user-1
                       (list 'hub 'user-1 'collateral 500)
                       1)
      (scenario-action 'set-credit-limit 'hub
                       (list 'hub 'user-1 300)
                       2))
     #f)

    ;; t=1: Second user joins
    (scenario-event
     1
     "[JOIN] User-2 Joins Network"
     "Opens account with hub. Network value: 1 route (user-1 ↔ user-2)"
     (list
      (scenario-action 'open-account 'user-2
                       (list 'hub 'user-2 'collateral 500)
                       3)
      (scenario-action 'set-credit-limit 'hub
                       (list 'hub 'user-2 300)
                       4))
     #f)

    ;; t=2: Third user joins
    (scenario-event
     2
     "[JOIN] User-3 Joins Network"
     "Network value: 3 routes (1↔2, 1↔3, 2↔3)"
     (list
      (scenario-action 'open-account 'user-3
                       (list 'hub 'user-3 'collateral 500)
                       5)
      (scenario-action 'set-credit-limit 'hub
                       (list 'hub 'user-3 300)
                       6))
     #f)

    ;; t=3: Fourth user joins
    (scenario-event
     3
     "[JOIN] User-4 Joins Network"
     "Network value: 6 routes (all pairs of 4 users)"
     (list
      (scenario-action 'open-account 'user-4
                       (list 'hub 'user-4 'collateral 500)
                       7)
      (scenario-action 'set-credit-limit 'hub
                       (list 'hub 'user-4 300)
                       8))
     #f)

    ;; t=4: Fifth user joins
    (scenario-event
     4
     "[JOIN] User-5 Joins Network"
     "Network value: 10 routes (all pairs of 5 users)"
     (list
      (scenario-action 'open-account 'user-5
                       (list 'hub 'user-5 'collateral 500)
                       9)
      (scenario-action 'set-credit-limit 'hub
                       (list 'hub 'user-5 300)
                       10))
     #f)

    ;; t=5: Demonstrate routing
    (scenario-event
     5
     "[ROUTE] User-1 Pays User-5 via Hub"
     "Gossip + PathFinder found route automatically"
     (list
      (scenario-action 'pay 'user-1
                       (list 'user-1 'hub 100)
                       11)
      (scenario-action 'pay 'hub
                       (list 'hub 'user-5 100)
                       12))
     #f))

   ;; No repeat blocks
   '()

   ;; Metadata
   (hash 'title "Network Effects (Metcalfe's Law)"
         'description "Value grows as O(n²) with number of participants"
         'author "XLN Economics Research"
         'version "1.0"
         'tags (list "economics" "network-effects" "metcalfe" "routing" "gossip"))))

;; ─────────────────────────────────────────────────────────────────
;; Execute
;; ─────────────────────────────────────────────────────────────────

(displayln "")
(displayln "XLN Economic Scenario: Network Effects")
(displayln "")
(displayln "This scenario demonstrates Metcalfe's Law:")
(displayln "Network value grows as O(n²) with participants.")
(displayln "")
(displayln "Why? Because each new user can transact with")
(displayln "ALL existing users, creating n-1 new routes.")
(displayln "")
(displayln "XLN's gossip protocol makes this emergent:")
(displayln "- No manual route configuration")
(displayln "- PathFinder discovers optimal paths")
(displayln "- Credit limits create economic incentives")
(displayln "")

(define result (execute-scenario network-effects))

(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Economic Lessons")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "1. Superlinear value growth:")
(displayln "   - 1 user:  0 routes")
(displayln "   - 2 users: 1 route  (1x)")
(displayln "   - 3 users: 3 routes (3x)")
(displayln "   - 5 users: 10 routes (10x)")
(displayln "   - n users: n(n-1)/2 routes (O(n²))")
(displayln "")
(displayln "2. Emergent routing:")
(displayln "   Gossip propagates profiles automatically.")
(displayln "   PathFinder discovers routes without config.")
(displayln "")
(displayln "3. Hub economics:")
(displayln "   Hub earns fees on all routed payments.")
(displayln "   Incentive to maintain high capacity + uptime.")
(displayln "")
(displayln "4. Decentralization path:")
(displayln "   Start with star (centralized hub).")
(displayln "   Users open direct channels (mesh topology).")
(displayln "   Network becomes resilient, hub becomes optional.")
(displayln "")
(displayln "5. Credit enables bootstrapping:")
(displayln "   Don't need massive reserves to start.")
(displayln "   RCPAN bounds exposure while enabling flow.")
(displayln "")
