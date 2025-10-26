#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Atomic Swap Scenario (Cross-Chain HTLC)
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates hash time-locked contracts for trustless exchange.
;;
;; Setup:
;; - Alice has 1000 XLN tokens
;; - Bob has 0.5 BTC (simulated)
;; - They want to swap without trusted intermediary
;;
;; Protocol:
;; 1. Alice generates secret preimage, computes hash H
;; 2. Alice creates HTLC: "Bob gets 1000 XLN if reveals preimage for H within 24h"
;; 3. Bob creates HTLC: "Alice gets 0.5 BTC if reveals preimage for H within 12h"
;; 4. Alice reveals preimage to claim BTC (Bob learns preimage)
;; 5. Bob uses preimage to claim XLN
;; 6. Swap complete, both parties satisfied
;;
;; Security:
;; - If Alice doesn't reveal, both HTLCs timeout and refund
;; - Once Alice reveals to claim BTC, Bob can immediately claim XLN
;; - No way for Alice to take BTC without Bob getting XLN
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../scenarios/types.rkt"
         "../scenarios/executor.rkt")

;; ─────────────────────────────────────────────────────────────────
;; Scenario Definition
;; ─────────────────────────────────────────────────────────────────

(define atomic-swap
  (make-scenario
   'atomic-swap
   "htlc-cross-chain-1"

   ;; Events timeline
   (list
    ;; t=0: Setup accounts
    (scenario-event
     0
     "[SETUP] Alice and Bob Open Accounts"
     "Alice has 1000 XLN collateral, Bob has 1000 BTC collateral"
     (list
      (scenario-action 'open-account 'alice
                       (list 'alice 'escrow 'collateral 1000)
                       1)
      (scenario-action 'open-account 'bob
                       (list 'bob 'escrow 'collateral 1000)
                       2))
     #f)

    ;; t=1: Alice locks XLN
    (scenario-event
     1
     "[LOCK] Alice Creates HTLC for 1000 XLN"
     "Hash: H = sha256('secret123'), Timeout: 24h"
     (list
      (scenario-action 'create-htlc 'alice
                       (list 'alice 'bob 1000 'token-1
                             'hash "sha256(secret123)"
                             'timeout 86400)
                       3))
     #f)

    ;; t=2: Bob locks BTC (after seeing Alice's HTLC)
    (scenario-event
     2
     "[LOCK] Bob Creates HTLC for 0.5 BTC"
     "Same hash H, shorter timeout: 12h (safety margin)"
     (list
      (scenario-action 'create-htlc 'bob
                       (list 'bob 'alice 500 'token-2
                             'hash "sha256(secret123)"
                             'timeout 43200)
                       4))
     #f)

    ;; t=3: Alice reveals preimage to claim BTC
    (scenario-event
     3
     "[REVEAL] Alice Claims BTC by Revealing Secret"
     "Preimage: 'secret123' → Bob learns it"
     (list
      (scenario-action 'claim-htlc 'alice
                       (list 'htlc-bob-alice 'preimage "secret123")
                       5))
     #f)

    ;; t=4: Bob uses preimage to claim XLN
    (scenario-event
     4
     "[CLAIM] Bob Claims XLN Using Same Preimage"
     "Atomic swap complete - both parties satisfied"
     (list
      (scenario-action 'claim-htlc 'bob
                       (list 'htlc-alice-bob 'preimage "secret123")
                       6))
     #f))

   ;; No repeat blocks
   '()

   ;; Metadata
   (hash 'title "Atomic Swap via HTLCs"
         'description "Trustless cross-chain token exchange"
         'author "XLN Economics Research"
         'version "1.0"
         'tags (list "htlc" "atomic-swap" "cross-chain" "trustless"))))

;; ─────────────────────────────────────────────────────────────────
;; Execute
;; ─────────────────────────────────────────────────────────────────

(displayln "")
(displayln "XLN Economic Scenario: Atomic Swap")
(displayln "")
(displayln "This scenario demonstrates how HTLCs enable trustless")
(displayln "cross-chain swaps without requiring a trusted intermediary.")
(displayln "")
(displayln "Key insight: Both HTLCs use the SAME hash. Once Alice")
(displayln "reveals the preimage to claim Bob's BTC, Bob immediately")
(displayln "learns it and can claim Alice's XLN. Atomicity guaranteed.")
(displayln "")

(define result (execute-scenario atomic-swap))

(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Economic Lessons")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "1. Trustless exchange:")
(displayln "   No intermediary needed. Smart contract enforces atomicity.")
(displayln "")
(displayln "2. Hash-locked coupling:")
(displayln "   Same hash H links both HTLCs.")
(displayln "   Revealing preimage to claim one → enables claiming other.")
(displayln "")
(displayln "3. Timeout safety:")
(displayln "   Bob's HTLC has shorter timeout (12h vs 24h).")
(displayln "   If Alice delays, Bob's HTLC refunds first.")
(displayln "   Alice incentivized to reveal quickly.")
(displayln "")
(displayln "4. Refund guarantee:")
(displayln "   If Alice never reveals, both HTLCs timeout.")
(displayln "   Both parties get refunds. No loss.")
(displayln "")
(displayln "5. XLN enables on-chain + off-chain HTLCs:")
(displayln "   Can swap on-chain BTC ↔ off-chain XLN tokens.")
(displayln "   Subcontracts handle disputes, cooperative path is fast.")
(displayln "")
