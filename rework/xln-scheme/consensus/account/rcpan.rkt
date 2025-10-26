#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; RCPAN Invariant - The Core XLN Innovation
;; ═══════════════════════════════════════════════════════════════════
;;
;; RCPAN: Reserve + Collateral ≤ Position + Aggregate Netting
;;
;; Invariant: −Lₗ ≤ Δ ≤ C + Lᵣ
;;
;; Where:
;;   Δ  = net balance (positive = counterparty owes you, negative = you owe counterparty)
;;   C  = your collateral (what you can lose)
;;   Lₗ = credit limit you extend to counterparty (left, unsecured lending)
;;   Lᵣ = credit limit counterparty extends to you (right)
;;
;; What this enables:
;;   - Partial collateral (not 100% like Lightning)
;;   - Programmable credit as first-class primitive
;;   - Instant settlement without full reserve
;;   - Bilateral netting with risk management
;;
;; Impossibility before XLN:
;;   - Lightning: Requires C = |Δ| (full collateral)
;;   - Rollups: 7-day fraud period
;;   - Banks: Legal enforcement, not mechanical
;;   - XLN: Mechanical enforcement of partial collateral + credit
;;
;; Reference: Egor's c.txt, docs/12_invariant.md
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/match
         racket/hash)

(provide (struct-out rcpan-limits)
         (struct-out rcpan-state)

         create-rcpan-state
         validate-rcpan
         update-rcpan-delta!
         set-collateral!
         set-credit-left!
         set-credit-right!
         get-delta
         get-available-credit
         get-max-send
         get-max-receive)

;; ─────────────────────────────────────────────────────────────────
;; Data Types
;; ─────────────────────────────────────────────────────────────────

;; RCPAN limits per token
(struct rcpan-limits (
  collateral          ; C: Your collateral (what you can lose)
  credit-left         ; Lₗ: Credit you extend (counterparty can go negative)
  credit-right        ; Lᵣ: Credit extended to you (you can go positive beyond collateral)
) #:transparent)

;; RCPAN state per bilateral account
(struct rcpan-state (
  deltas              ; hash: token-id → current delta (Δ)
  limits              ; hash: token-id → rcpan-limits
) #:mutable #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; Creation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-rcpan-state)
  (-> rcpan-state?)
  (rcpan-state (make-hash) (make-hash)))

;; ─────────────────────────────────────────────────────────────────
;; RCPAN Invariant Validation
;; ─────────────────────────────────────────────────────────────────

(define/contract (validate-rcpan state token-id new-delta)
  (-> rcpan-state? exact-nonnegative-integer? exact-integer? boolean?)

  (define limits (hash-ref (rcpan-state-limits state) token-id #f))

  (cond
    ;; No limits set → allow anything (permissionless mode)
    [(not limits) #t]

    ;; RCPAN invariant: −Lₗ ≤ Δ ≤ C + Lᵣ
    [else
     (define C (rcpan-limits-collateral limits))
     (define Ll (rcpan-limits-credit-left limits))
     (define Lr (rcpan-limits-credit-right limits))

     (and (>= new-delta (- Ll))      ; Lower bound: −Lₗ
          (<= new-delta (+ C Lr)))]))  ; Upper bound: C + Lᵣ

;; ─────────────────────────────────────────────────────────────────
;; Delta Updates
;; ─────────────────────────────────────────────────────────────────

(define/contract (update-rcpan-delta! state token-id delta-change)
  (-> rcpan-state? exact-nonnegative-integer? exact-integer? void?)

  (define current-delta (hash-ref (rcpan-state-deltas state) token-id 0))
  (define new-delta (+ current-delta delta-change))

  ;; Validate RCPAN invariant
  (unless (validate-rcpan state token-id new-delta)
    (error 'update-rcpan-delta!
           "RCPAN invariant violated: token ~a, current Δ=~a, change=~a, new Δ=~a"
           token-id current-delta delta-change new-delta))

  ;; Update delta
  (hash-set! (rcpan-state-deltas state) token-id new-delta))

;; ─────────────────────────────────────────────────────────────────
;; Limit Management
;; ─────────────────────────────────────────────────────────────────

(define/contract (set-collateral! state token-id amount)
  (-> rcpan-state? exact-nonnegative-integer? exact-nonnegative-integer? void?)

  (define current-limits (hash-ref (rcpan-state-limits state) token-id
                                   (rcpan-limits 0 0 0)))
  (define new-limits (struct-copy rcpan-limits current-limits
                                  (collateral amount)))
  (hash-set! (rcpan-state-limits state) token-id new-limits))

(define/contract (set-credit-left! state token-id amount)
  (-> rcpan-state? exact-nonnegative-integer? exact-nonnegative-integer? void?)

  (define current-limits (hash-ref (rcpan-state-limits state) token-id
                                   (rcpan-limits 0 0 0)))
  (define new-limits (struct-copy rcpan-limits current-limits
                                  (credit-left amount)))
  (hash-set! (rcpan-state-limits state) token-id new-limits))

(define/contract (set-credit-right! state token-id amount)
  (-> rcpan-state? exact-nonnegative-integer? exact-nonnegative-integer? void?)

  (define current-limits (hash-ref (rcpan-state-limits state) token-id
                                   (rcpan-limits 0 0 0)))
  (define new-limits (struct-copy rcpan-limits current-limits
                                  (credit-right amount)))
  (hash-set! (rcpan-state-limits state) token-id new-limits))

;; ─────────────────────────────────────────────────────────────────
;; Queries
;; ─────────────────────────────────────────────────────────────────

(define/contract (get-delta state token-id)
  (-> rcpan-state? exact-nonnegative-integer? exact-integer?)
  (hash-ref (rcpan-state-deltas state) token-id 0))

(define/contract (get-available-credit state token-id)
  (-> rcpan-state? exact-nonnegative-integer? exact-nonnegative-integer?)

  (define current-delta (get-delta state token-id))
  (define limits (hash-ref (rcpan-state-limits state) token-id #f))

  (cond
    [(not limits) +inf.0]  ; No limits → infinite credit
    [else
     (define C (rcpan-limits-collateral limits))
     (define Lr (rcpan-limits-credit-right limits))
     (max 0 (- (+ C Lr) current-delta))]))

(define/contract (get-max-send state token-id)
  (-> rcpan-state? exact-nonnegative-integer? exact-nonnegative-integer?)

  ;; Maximum we can send = how far we can go negative
  ;; Lower bound: Δ ≥ −Lₗ
  ;; If Δ = 100, Lₗ = 200, can send up to 300 (reaching Δ = -200)

  (define current-delta (get-delta state token-id))
  (define limits (hash-ref (rcpan-state-limits state) token-id #f))

  (cond
    [(not limits) +inf.0]
    [else
     (define Ll (rcpan-limits-credit-left limits))
     (+ current-delta Ll)]))

(define/contract (get-max-receive state token-id)
  (-> rcpan-state? exact-nonnegative-integer? exact-nonnegative-integer?)

  ;; Maximum we can receive = how far we can go positive
  ;; Upper bound: Δ ≤ C + Lᵣ
  ;; If Δ = -100, C = 1000, Lᵣ = 200, can receive up to 1300 (reaching Δ = 1200)

  (define current-delta (get-delta state token-id))
  (define limits (hash-ref (rcpan-state-limits state) token-id #f))

  (cond
    [(not limits) +inf.0]
    [else
     (define C (rcpan-limits-collateral limits))
     (define Lr (rcpan-limits-credit-right limits))
     (- (+ C Lr) current-delta)]))

;; ═══════════════════════════════════════════════════════════════════
;; RCPAN Examples
;; ═══════════════════════════════════════════════════════════════════
;;
;; Example 1: Pure Collateral (Lightning-style)
;; Alice: C=1000, Lₗ=0, Lᵣ=0
;; Bob:   C=1000, Lₗ=0, Lᵣ=0
;; → Alice can send up to 1000 (reaching Δ = -1000 = -Lₗ)
;; → Alice can receive up to 1000 (reaching Δ = 1000 = C + Lᵣ)
;;
;; Example 2: Partial Collateral + Credit
;; Alice: C=500, Lₗ=200, Lᵣ=300
;; → Alice can send up to 700 (Δ reaches -200 = -Lₗ)
;; → Alice can receive up to 800 (Δ reaches 800 = C + Lᵣ)
;;
;; Example 3: Pure Credit (Bank-style)
;; Alice: C=0, Lₗ=1000, Lᵣ=1000
;; → Alice can send up to 1000 (unsecured lending)
;; → Alice can receive up to 1000 (unsecured borrowing)
;;
;; Example 4: Current State Matters
;; Alice: C=1000, Lₗ=200, Lᵣ=300, current Δ = 500
;; → Can send: 500 + 200 = 700 (to reach Δ = -200)
;; → Can receive: 1000 + 300 - 500 = 800 (to reach Δ = 1300)
;;
;; ═══════════════════════════════════════════════════════════════════
