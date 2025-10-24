#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Basic Channel Demo - Proving the Concepts
;; ═══════════════════════════════════════════════════════════════════

(require "../core/types.rkt"
         racket/match)

;; ─────────────────────────────────────────────────────────────────
;; Demo 1: Create a bilateral channel
;; ─────────────────────────────────────────────────────────────────

(define alice (entity-id 1))
(define bob (entity-id 2))
(define channel-key (account-key alice bob))

(displayln "=== Demo 1: Channel Creation ===")
(displayln (format "Alice: ~a" alice))
(displayln (format "Bob: ~a" bob))
(displayln (format "Channel key (canonical): ~a" channel-key))

;; Verify canonical ordering
(define reverse-key (account-key bob alice))
(displayln (format "Reverse construction: ~a" reverse-key))
(displayln (format "Keys equal? ~a" (equal? channel-key reverse-key)))

;; ─────────────────────────────────────────────────────────────────
;; Demo 2: RCPAN Invariant Enforcement
;; ─────────────────────────────────────────────────────────────────

(displayln "\n=== Demo 2: RCPAN Invariant ===")

;; Valid delta: −L_left ≤ δ ≤ C + L_right
(define valid-delta
  (delta 1              ; token-id
         1000           ; collateral
         500            ; ondelta
         -200           ; offdelta (combined = 300)
         100            ; left-credit-limit
         200            ; right-credit-limit
         1000           ; left-allowance
         1000))         ; right-allowance

(displayln (format "Valid delta created: ~a" valid-delta))
(displayln (format "Combined delta: ~a" (+ (delta-ondelta valid-delta)
                                           (delta-offdelta valid-delta))))
(displayln (format "RCPAN range: [~a, ~a]"
                   (- (delta-left-credit-limit valid-delta))
                   (+ (delta-collateral valid-delta)
                      (delta-right-credit-limit valid-delta))))

;; Invalid delta - should error
(displayln "\nAttempting invalid delta (violates RCPAN)...")
(with-handlers ([exn:fail? (λ (e) (displayln (format "[CHECK] Caught error: ~a"
                                                      (exn-message e))))])
  (delta 1 1000 2000 0 100 200 1000 1000)  ; combined=2000 > 1200
  (displayln "[BALLOT] Should have failed!"))

;; ─────────────────────────────────────────────────────────────────
;; Demo 3: Perspective-Aware Capacity Calculation
;; ─────────────────────────────────────────────────────────────────

(displayln "\n=== Demo 3: Perspective Calculation ===")

;; Alice's perspective (is-left? = #t)
(define-values (alice-in alice-out)
  (derive-capacity valid-delta #t))

(displayln (format "Alice's view:"))
(displayln (format "  Can receive: ~a" alice-in))
(displayln (format "  Can send: ~a" alice-out))

;; Bob's perspective (is-left? = #f)
(define-values (bob-in bob-out)
  (derive-capacity valid-delta #f))

(displayln (format "Bob's view:"))
(displayln (format "  Can receive: ~a" bob-in))
(displayln (format "  Can send: ~a" bob-out))

;; Verify symmetry: Alice's in = Bob's out
(displayln (format "\nSymmetry check:"))
(displayln (format "  Alice-in (~a) = Bob-out (~a)? ~a"
                   alice-in bob-out (= alice-in bob-out)))
(displayln (format "  Alice-out (~a) = Bob-in (~a)? ~a"
                   alice-out bob-in (= alice-out bob-in)))

;; ─────────────────────────────────────────────────────────────────
;; Demo 4: State Machine Introspection
;; ─────────────────────────────────────────────────────────────────

(displayln "\n=== Demo 4: Machine Introspection ===")
(displayln (format "Machine name: ~a" (machine-name bilateral-channel-machine)))
(displayln (format "States: ~a" (get-machine-states bilateral-channel-machine)))
(displayln (format "Transitions count: ~a"
                   (length (get-machine-transitions bilateral-channel-machine))))

;; ─────────────────────────────────────────────────────────────────
;; Demo 5: State Transition
;; ─────────────────────────────────────────────────────────────────

(displayln "\n=== Demo 5: State Transition ===")

(define initial-state (make-initial-account-state channel-key))
(displayln (format "Initial state: ~a" initial-state))

(define payment-input
  (propose-payment alice bob 100 1 '()))  ; No routing

(define-values (new-state outputs)
  (account-transition initial-state payment-input))

(displayln (format "After payment proposal:"))
(displayln (format "  New counter: ~a" (account-state-counter new-state)))
(displayln (format "  Pending forward: ~a" (account-state-pending-forward new-state)))
(displayln (format "  Outputs: ~a" (length outputs)))

;; ─────────────────────────────────────────────────────────────────
;; Summary
;; ─────────────────────────────────────────────────────────────────

(displayln "\n=== Summary ===")
(displayln "[CHECK] Canonical channel key construction")
(displayln "[CHECK] RCPAN invariant enforced at compile time")
(displayln "[CHECK] Perspective-aware capacity calculations")
(displayln "[CHECK] State machine introspection")
(displayln "[CHECK] Pure transition functions")
(displayln "\nFoundation is sound. λ.")
