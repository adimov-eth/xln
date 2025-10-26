#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; RCPAN Invariant Demo - The Core XLN Innovation
;; ═══════════════════════════════════════════════════════════════════
;;
;; Sign convention (from Egor's spec):
;;   Δ > 0: Counter party owes you (you sent tokens, waiting for settlement)
;;   Δ < 0: You owe counterparty (you received tokens, owe settlement)
;;   Δ = 0: Balanced
;;
;; Invariant: −Lₗ ≤ Δ ≤ C + Lᵣ
;;
;; Lower bound (−Lₗ): Maximum debt you can incur
;;   - Lₗ = credit extended TO you BY counterparty
;;   - You can receive up to Lₗ tokens without collateral
;;
;; Upper bound (C + Lᵣ): Maximum credit you can extend
;;   - C = your collateral
;;   - Lᵣ = credit you extend to counterparty
;;   - You can send up to C + Lᵣ tokens
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../consensus/account/rcpan.rkt")

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  RCPAN Invariant Demo - XLN Core Innovation")
(displayln "═══════════════════════════════════════════════════════════")
(newline)

(displayln "RCPAN Invariant: −Lₗ ≤ Δ ≤ C + Lᵣ")
(newline)
(displayln "Sign convention:")
(displayln "  Δ > 0: Counterparty owes you (you sent tokens)")
(displayln "  Δ < 0: You owe counterparty (you received tokens)")
(newline)
(displayln "Components:")
(displayln "  C  = your collateral (what you deposited)")
(displayln "  Lₗ = credit extended TO you (you can go negative)")
(displayln "  Lᵣ = credit you extend TO counterparty (they can go negative)")
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Demo 1: Pure Collateral (Lightning-style, 100% reserve)
;; ═══════════════════════════════════════════════════════════════════

(displayln "═══ Demo 1: Pure Collateral (Lightning-style) ═══")
(newline)

(define alice-lightning (create-rcpan-state))
(set-collateral! alice-lightning 1 1000)  ; Alice deposits 1000
(set-credit-left! alice-lightning 1 0)    ; No credit TO Alice
(set-credit-right! alice-lightning 1 0)   ; No credit FROM Alice

(displayln "Alice's setup:")
(displayln "  C  = 1000 (collateral deposited)")
(displayln "  Lₗ = 0    (no credit extended to Alice)")
(displayln "  Lᵣ = 0    (Alice extends no credit)")
(displayln "  Δ = 0     (starting balanced)")
(newline)

(displayln "Invariant: −0 ≤ Δ ≤ 1000 + 0")
(displayln "          → 0 ≤ Δ ≤ 1000")
(displayln "  → Alice can send up to 1000 (Δ reaches 1000)")
(displayln "  → Alice can receive nothing (would make Δ negative)")
(newline)

;; Alice sends 500 tokens (Δ becomes +500)
(displayln "Alice sends 500 tokens to Bob...")
(update-rcpan-delta! alice-lightning 1 500)
(displayln (format "  ✓ Δ = ~a (Bob owes Alice 500)" (get-delta alice-lightning 1)))
(displayln (format "  Can send ~a more (to reach Δ = 1000)" (get-max-send alice-lightning 1)))
(displayln (format "  Can receive ~a (would violate Δ ≥ 0)" (get-max-receive alice-lightning 1)))
(newline)

;; Try to send 600 more (would make Δ = 1100, exceeds upper bound)
(displayln "Alice tries to send 600 more tokens...")
(with-handlers ([exn:fail? (lambda (e)
                             (displayln "  ✗ Rejected: Would exceed upper bound (Δ = 1100 > 1000)"))])
  (update-rcpan-delta! alice-lightning 1 600))
(newline)

(displayln "✓ Lightning-style works: Can only send up to collateral")
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Demo 2: Partial Collateral + Credit (XLN Innovation)
;; ═══════════════════════════════════════════════════════════════════

(displayln "═══ Demo 2: Partial Collateral + Credit (XLN) ═══")
(newline)

(define alice-xln (create-rcpan-state))
(set-collateral! alice-xln 1 500)       ; Only 500 collateral
(set-credit-left! alice-xln 1 200)      ; Bob extends 200 credit TO Alice
(set-credit-right! alice-xln 1 300)     ; Alice extends 300 credit TO Bob

(displayln "Alice's setup:")
(displayln "  C  = 500  (collateral)")
(displayln "  Lₗ = 200  (Bob trusts Alice for 200)")
(displayln "  Lᵣ = 300  (Alice trusts Bob for 300)")
(displayln "  Δ = 0")
(newline)

(displayln "Invariant: −200 ≤ Δ ≤ 500 + 300")
(displayln "          → −200 ≤ Δ ≤ 800")
(displayln "  → Alice can send up to 800 (C + Lᵣ)")
(displayln "  → Alice can receive up to 200 (to reach Δ = -200)")
(newline)

;; Alice sends 700 tokens (beyond her collateral!)
(displayln "Alice sends 700 tokens (exceeds her 500 collateral)...")
(update-rcpan-delta! alice-xln 1 700)
(displayln (format "  ✓ Δ = ~a (Bob owes Alice 700)" (get-delta alice-xln 1)))
(displayln "  → Backed by: 500 collateral + 200 credit extended to Bob")
(displayln (format "  Can send ~a more" (get-max-send alice-xln 1)))
(newline)

;; Alice receives 150 tokens back
(displayln "Alice receives 150 tokens back from Bob...")
(update-rcpan-delta! alice-xln 1 -150)
(displayln (format "  ✓ Δ = ~a (net: Bob owes Alice 550)" (get-delta alice-xln 1)))
(newline)

;; Alice receives 300 more (Δ becomes 250)
(displayln "Alice receives 300 more tokens...")
(update-rcpan-delta! alice-xln 1 -300)
(displayln (format "  ✓ Δ = ~a (net: Bob owes Alice 250)" (get-delta alice-xln 1)))
(newline)

;; Alice receives 500 more (Δ would become -250, exceeds lower bound)
(displayln "Alice tries to receive 500 more tokens...")
(with-handlers ([exn:fail? (lambda (e)
                             (displayln "  ✗ Rejected: Would violate lower bound (Δ = -250 < -200)"))])
  (update-rcpan-delta! alice-xln 1 -500))
(newline)

(displayln "✓ XLN innovation works!")
(displayln "  - Sent 700 with only 500 collateral (used credit)")
(displayln "  - Can receive up to 200 beyond balance (credit from Bob)")
(displayln "  - IMPOSSIBLE in Lightning (requires full collateral)")
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Demo 3: Pure Credit (Bank-style)
;; ═══════════════════════════════════════════════════════════════════

(displayln "═══ Demo 3: Pure Credit (Bank-style) ═══")
(newline)

(define alice-bank (create-rcpan-state))
(set-collateral! alice-bank 1 0)          ; NO collateral
(set-credit-left! alice-bank 1 1000)      ; Bob trusts Alice for 1000
(set-credit-right! alice-bank 1 1000)     ; Alice trusts Bob for 1000

(displayln "Alice's setup:")
(displayln "  C  = 0    (NO collateral)")
(displayln "  Lₗ = 1000 (Bob extends 1000 credit)")
(displayln "  Lᵣ = 1000 (Alice extends 1000 credit)")
(newline)

(displayln "Invariant: −1000 ≤ Δ ≤ 0 + 1000")
(displayln "          → −1000 ≤ Δ ≤ 1000")
(newline)

;; Alice sends 800 (pure unsecured lending)
(displayln "Alice sends 800 tokens (NO collateral backing!)...")
(update-rcpan-delta! alice-bank 1 800)
(displayln (format "  ✓ Δ = ~a (Bob owes 800, unsecured)" (get-delta alice-bank 1)))
(newline)

;; Alice receives 1500 tokens (net Δ = -700, unsecured borrowing)
(displayln "Alice receives 1500 tokens...")
(update-rcpan-delta! alice-bank 1 -1500)
(displayln (format "  ✓ Δ = ~a (Alice owes 700, unsecured)" (get-delta alice-bank 1)))
(displayln "  → Alice borrowed 700 with ZERO collateral")
(newline)

(displayln "✓ Bank-style credit works!")
(displayln "  - Zero collateral required")
(displayln "  - Mechanically enforced credit limits")
(displayln "  - NEW: Programmable credit in crypto")
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Summary
;; ═══════════════════════════════════════════════════════════════════

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Why RCPAN is Revolutionary")
(displayln "═══════════════════════════════════════════════════════════")
(newline)

(displayln "Before XLN:")
(newline)
(displayln "Lightning Network:")
(displayln "  ✗ Requires Δ ∈ [−C, C] (full collateral both sides)")
(displayln "  ✗ Capital inefficient")
(displayln "  ✗ No credit extension")
(newline)

(displayln "Rollups:")
(displayln "  ✗ 7-day fraud period")
(displayln "  ✗ Not instant bilateral")
(displayln "  ✗ No credit primitives")
(newline)

(displayln "Banks:")
(displayln "  ✗ Credit via legal system")
(displayln "  ✗ Not programmable")
(displayln "  ✗ Not crypto-native")
(newline)

(displayln "XLN combines ALL:")
(displayln "  ✓ Partial collateral (capital efficient)")
(displayln "  ✓ Instant settlement (bilateral consensus)")
(displayln "  ✓ Programmable credit (first-class primitive)")
(displayln "  ✓ Mechanical enforcement (no courts)")
(newline)

(displayln "Real-world impact:")
(displayln "  - 50% collateral instead of 100% → 2× capital efficiency")
(displayln "  - Credit scoring as code (not legal contracts)")
(displayln "  - HTLCs, limit orders, dividends with partial collateral")
(newline)

(displayln "RCPAN: The innovation that makes XLN unique in crypto.")
(newline)
(displayln "λ.")
