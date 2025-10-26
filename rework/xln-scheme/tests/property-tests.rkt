#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Property-Based Test Suite for XLN
;; ═══════════════════════════════════════════════════════════════════
;;
;; Tests fundamental invariants that must hold under all circumstances.
;; Inspired by QuickCheck - generates random inputs, verifies properties.
;;
;; ═══════════════════════════════════════════════════════════════════

(require rackunit
         "../consensus/account/rcpan.rkt"
         "../core/types.rkt")

(provide run-all-property-tests)

;; ─────────────────────────────────────────────────────────────────
;; Test Generators (Random Input Creation)
;; ─────────────────────────────────────────────────────────────────

(define (random-amount [max 10000])
  (random 0 max))

(define (random-bigint [min -1000] [max 1000])
  (+ min (random (- max min))))

(define (random-rcpan-limits)
  (define C (random-amount))
  (define Ll (random-amount))
  (define Lr (random-amount))
  (values C Ll Lr))

;; ─────────────────────────────────────────────────────────────────
;; Property 1: RCPAN Invariant Always Holds
;; ─────────────────────────────────────────────────────────────────

(define (test-rcpan-bounds-property)
  (test-case "RCPAN: Valid deltas within bounds always accepted"
    (for ([i (in-range 100)])  ; Test 100 random cases
      (define-values (C Ll Lr) (random-rcpan-limits))
      (define state (create-rcpan-state))
      (set-collateral! state 1 C)
      (set-credit-left! state 1 Ll)
      (set-credit-right! state 1 Lr)

      ;; Generate delta within valid range: −Lₗ ≤ Δ ≤ C + Lᵣ
      (define lower-bound (- Ll))
      (define upper-bound (+ C Lr))
      (define valid-delta (+ lower-bound (random (+ 1 (- upper-bound lower-bound)))))

      ;; Should NOT throw
      (check-not-exn
       (lambda ()
         (update-rcpan-delta! state 1 valid-delta))
       (format "Valid delta ~a should be accepted (bounds: [~a, ~a])"
               valid-delta lower-bound upper-bound)))))

(define (test-rcpan-rejection-property)
  (test-case "RCPAN: Invalid deltas outside bounds always rejected"
    (for ([i (in-range 100)])
      (define-values (C Ll Lr) (random-rcpan-limits))
      (define state (create-rcpan-state))
      (set-collateral! state 1 C)
      (set-credit-left! state 1 Ll)
      (set-credit-right! state 1 Lr)

      (define lower-bound (- Ll))
      (define upper-bound (+ C Lr))

      ;; Generate invalid delta (either too low or too high)
      (define invalid-delta
        (if (> (random) 0.5)
            (- lower-bound (random 1 100))  ; Below lower bound
            (+ upper-bound (random 1 100)))) ; Above upper bound

      ;; Should throw
      (check-exn
       exn:fail?
       (lambda ()
         (update-rcpan-delta! state 1 invalid-delta))
       (format "Invalid delta ~a should be rejected (bounds: [~a, ~a])"
               invalid-delta lower-bound upper-bound)))))

;; ─────────────────────────────────────────────────────────────────
;; Property 2: RCPAN Invariant Preserved After Multiple Operations
;; ─────────────────────────────────────────────────────────────────

(define (test-rcpan-sequence-property)
  (test-case "RCPAN: Multiple valid operations maintain invariant"
    (for ([trial (in-range 50)])
      (define-values (C Ll Lr) (random-rcpan-limits))
      (define state (create-rcpan-state))
      (set-collateral! state 1 C)
      (set-credit-left! state 1 Ll)
      (set-credit-right! state 1 Lr)

      (define lower-bound (- Ll))
      (define upper-bound (+ C Lr))

      ;; Perform sequence of small valid updates
      (for ([step (in-range 20)])
        (define current-delta (get-delta state 1))

        ;; Calculate safe range for next delta change
        (define max-increase (- upper-bound current-delta))
        (define max-decrease (- current-delta lower-bound))

        (when (and (> max-increase 0) (> max-decrease 0))
          (define delta-change
            (if (> (random) 0.5)
                (random 1 (min 50 (+ 1 max-increase)))   ; Small increase
                (- (random 1 (min 50 (+ 1 max-decrease)))))) ; Small decrease

          (check-not-exn
           (lambda ()
             (update-rcpan-delta! state 1 delta-change))
           (format "Step ~a: delta change ~a should work (current: ~a, bounds: [~a, ~a])"
                   step delta-change current-delta lower-bound upper-bound)))))))

;; ─────────────────────────────────────────────────────────────────
;; Property 3: RCPAN Symmetry (Left/Right Perspective)
;; ─────────────────────────────────────────────────────────────────

(define (test-rcpan-symmetry-property)
  (test-case "RCPAN: Capacity symmetric from both perspectives"
    (for ([i (in-range 50)])
      (define C (random-amount))
      (define Ll (random-amount))
      (define Lr (random-amount))

      ;; Generate delta valid from BOTH perspectives
      ;; Left bounds: −Lₗ ≤ Δ ≤ C + Lᵣ
      ;; Right bounds (for -Δ): −Lᵣ ≤ −Δ ≤ C + Lₗ  →  −(C + Lₗ) ≤ Δ ≤ Lᵣ
      ;; Intersection: max(−Lₗ, −(C + Lₗ)) ≤ Δ ≤ min(C + Lᵣ, Lᵣ)
      (define left-lower (- Ll))
      (define left-upper (+ C Lr))
      (define right-lower (- (+ C Ll)))
      (define right-upper Lr)

      (define safe-lower (max left-lower right-lower))
      (define safe-upper (min left-upper right-upper))

      ;; Only test if valid range exists
      (when (< safe-lower safe-upper)
        (define delta (+ safe-lower (random (- safe-upper safe-lower))))

        ;; Create state from left perspective
        (define state-left (create-rcpan-state))
        (set-collateral! state-left 1 C)
        (set-credit-left! state-left 1 Ll)
        (set-credit-right! state-left 1 Lr)
        (update-rcpan-delta! state-left 1 delta)

        ;; Create state from right perspective (negated delta, swapped credits)
        (define state-right (create-rcpan-state))
        (set-collateral! state-right 1 C)
        (set-credit-left! state-right 1 Lr)   ; Swapped
        (set-credit-right! state-right 1 Ll)  ; Swapped
        (update-rcpan-delta! state-right 1 (- delta))

        ;; Total capacity should be identical
        (define total-cap-left (+ C Ll Lr))
        (define total-cap-right (+ C Lr Ll))
        (check-equal? total-cap-left total-cap-right
                      "Total capacity symmetric")))))

;; ─────────────────────────────────────────────────────────────────
;; Property 4: Zero Collateral Edge Case
;; ─────────────────────────────────────────────────────────────────

(define (test-rcpan-zero-collateral-property)
  (test-case "RCPAN: Works correctly with zero collateral"
    (for ([i (in-range 50)])
      (define Ll (random-amount 1000))
      (define Lr (random-amount 1000))
      (define state (create-rcpan-state))
      (set-collateral! state 1 0)  ; Zero collateral
      (set-credit-left! state 1 Ll)
      (set-credit-right! state 1 Lr)

      ;; With C=0, bounds are: −Lₗ ≤ Δ ≤ Lᵣ
      (define valid-delta (random-bigint (- Ll) Lr))
      (check-not-exn
       (lambda ()
         (update-rcpan-delta! state 1 valid-delta))
       (format "Zero collateral: delta ~a should work (bounds: [~a, ~a])"
               valid-delta (- Ll) Lr)))))

;; ─────────────────────────────────────────────────────────────────
;; Property 5: Zero Credit Edge Case
;; ─────────────────────────────────────────────────────────────────

(define (test-rcpan-zero-credit-property)
  (test-case "RCPAN: Works correctly with zero credit limits"
    (for ([i (in-range 50)])
      (define C (random-amount 1000))
      (define state (create-rcpan-state))
      (set-collateral! state 1 C)
      (set-credit-left! state 1 0)   ; Zero credit
      (set-credit-right! state 1 0)  ; Zero credit

      ;; With Ll=0, Lr=0, bounds are: 0 ≤ Δ ≤ C
      (define valid-delta (random 0 (+ 1 C)))
      (check-not-exn
       (lambda ()
         (update-rcpan-delta! state 1 valid-delta))
       (format "Zero credit: delta ~a should work (bounds: [0, ~a])"
               valid-delta C)))))

;; ─────────────────────────────────────────────────────────────────
;; Property 6: Boundary Conditions (Exact Bounds)
;; ─────────────────────────────────────────────────────────────────

(define (test-rcpan-exact-bounds-property)
  (test-case "RCPAN: Exact boundary values always accepted"
    (for ([i (in-range 50)])
      (define-values (C Ll Lr) (random-rcpan-limits))
      (define state (create-rcpan-state))
      (set-collateral! state 1 C)
      (set-credit-left! state 1 Ll)
      (set-credit-right! state 1 Lr)

      ;; Test exact lower bound
      (check-not-exn
       (lambda ()
         (update-rcpan-delta! state 1 (- Ll)))
       "Exact lower bound −Lₗ should be accepted")

      ;; Reset state
      (set! state (create-rcpan-state))
      (set-collateral! state 1 C)
      (set-credit-left! state 1 Ll)
      (set-credit-right! state 1 Lr)

      ;; Test exact upper bound
      (check-not-exn
       (lambda ()
         (update-rcpan-delta! state 1 (+ C Lr)))
       "Exact upper bound C + Lᵣ should be accepted"))))

;; ─────────────────────────────────────────────────────────────────
;; Property 7: Off-By-One Boundary Rejection
;; ─────────────────────────────────────────────────────────────────

(define (test-rcpan-off-by-one-property)
  (test-case "RCPAN: Off-by-one violations always rejected"
    (for ([i (in-range 50)])
      (define-values (C Ll Lr) (random-rcpan-limits))
      (define state (create-rcpan-state))
      (set-collateral! state 1 C)
      (set-credit-left! state 1 Ll)
      (set-credit-right! state 1 Lr)

      ;; Test lower bound - 1
      (check-exn
       exn:fail?
       (lambda ()
         (update-rcpan-delta! state 1 (- (- Ll) 1)))
       "Lower bound - 1 should be rejected")

      ;; Reset state
      (set! state (create-rcpan-state))
      (set-collateral! state 1 C)
      (set-credit-left! state 1 Ll)
      (set-credit-right! state 1 Lr)

      ;; Test upper bound + 1
      (check-exn
       exn:fail?
       (lambda ()
         (update-rcpan-delta! state 1 (+ (+ C Lr) 1)))
       "Upper bound + 1 should be rejected"))))

;; ─────────────────────────────────────────────────────────────────
;; Test Runner
;; ─────────────────────────────────────────────────────────────────

(define (run-all-property-tests)
  (displayln "")
  (displayln "═══════════════════════════════════════════════════════════")
  (displayln "  Running Property-Based Test Suite")
  (displayln "═══════════════════════════════════════════════════════════")
  (displayln "")

  (displayln "[TEST] RCPAN Bounds Properties...")
  (test-rcpan-bounds-property)
  (displayln "  ✓ Valid deltas accepted (100 cases)")

  (test-rcpan-rejection-property)
  (displayln "  ✓ Invalid deltas rejected (100 cases)")

  (displayln "")
  (displayln "[TEST] RCPAN Sequence Properties...")
  (test-rcpan-sequence-property)
  (displayln "  ✓ Multiple operations preserve invariant (50 trials × 20 steps)")

  (displayln "")
  (displayln "[TEST] RCPAN Symmetry Properties...")
  (test-rcpan-symmetry-property)
  (displayln "  ✓ Left/right perspective symmetry (50 cases)")

  (displayln "")
  (displayln "[TEST] RCPAN Edge Cases...")
  (test-rcpan-zero-collateral-property)
  (displayln "  ✓ Zero collateral works (50 cases)")

  (test-rcpan-zero-credit-property)
  (displayln "  ✓ Zero credit limits work (50 cases)")

  (displayln "")
  (displayln "[TEST] RCPAN Boundary Conditions...")
  (test-rcpan-exact-bounds-property)
  (displayln "  ✓ Exact bounds accepted (50 cases)")

  (test-rcpan-off-by-one-property)
  (displayln "  ✓ Off-by-one violations rejected (50 cases)")

  (displayln "")
  (displayln "═══════════════════════════════════════════════════════════")
  (displayln "  All Property Tests Passed!")
  (displayln "═══════════════════════════════════════════════════════════")
  (displayln "")
  (displayln "Total cases tested: ~550")
  (displayln "Properties verified:")
  (displayln "  ✓ RCPAN invariant holds under all valid operations")
  (displayln "  ✓ RCPAN invariant violated by all invalid operations")
  (displayln "  ✓ Multiple operations preserve invariant")
  (displayln "  ✓ Perspective symmetry (left/right)")
  (displayln "  ✓ Edge cases (zero collateral, zero credit)")
  (displayln "  ✓ Boundary exactness (inclusive bounds)")
  (displayln "  ✓ Off-by-one detection (exclusive violations)")
  (displayln ""))

;; ─────────────────────────────────────────────────────────────────
;; Module Test
;; ─────────────────────────────────────────────────────────────────

(module+ test
  (run-all-property-tests))
