#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Subcontracts - Programmable Delta Transformers
;; ═══════════════════════════════════════════════════════════════════
;;
;; Every bilateral account can have programmable subcontracts that
;; transform deltas conditionally.
;;
;; Examples from Egor's spec:
;;   - HTLC (Hash Time-Locked Contract)
;;   - Limit Orders (conditional execution)
;;   - Dividend Distribution (proportional splits)
;;   - Atomic Swaps (cross-token exchanges)
;;
;; Subcontract = Delta Transformer that respects RCPAN invariant
;;
;; Reference: c.txt "Building on XLN: Delta Transformers"
;; ═══════════════════════════════════════════════════════════════════

(require "../../core/crypto.rkt")

(provide (all-defined-out))

;; ─────────────────────────────────────────────────────────────────
;; Data Types
;; ─────────────────────────────────────────────────────────────────

;; Generic subcontract
(struct subcontract (
  id                  ; Unique identifier
  type                ; 'htlc, 'limit-order, 'dividend, etc.
  active?             ; Is this subcontract still active?
  condition           ; (state → boolean) - when to execute
  delta-fn            ; (state → deltas) - what deltas to apply
) #:transparent)

;; HTLC (Hash Time-Locked Contract)
;; Alice sends Bob 1000 tokens locked by hash H
;; Bob can claim if he reveals R where hash(R) = H before timeout
;; Otherwise Alice can reclaim after timeout
(struct htlc (
  id
  amount              ; Tokens locked
  token-id            ; Which token
  hash-lock           ; SHA256 hash that must be revealed
  timeout             ; Unix timestamp when Alice can reclaim
  sender              ; Who locked the tokens (Alice)
  receiver            ; Who can claim with preimage (Bob)
  [revealed-preimage #:mutable]   ; #f or the revealed preimage
  [claimed? #:mutable]            ; Has Bob claimed?
  [refunded? #:mutable]           ; Has Alice reclaimed?
) #:transparent)

;; Limit Order
;; "Buy 100 USDC at price ≤ 2000 USDC/ETH"
;; Executes when oracle price meets condition
(struct limit-order (
  id
  from-token          ; Token being sold
  to-token            ; Token being bought
  from-amount         ; Amount to sell
  to-amount           ; Amount to buy
  price-condition     ; (oracle-price → boolean)
  [executed? #:mutable]   ; Has order executed?
) #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; HTLC Implementation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-htlc amount token-id hash-lock timeout sender receiver)
  (-> exact-nonnegative-integer?
      exact-nonnegative-integer?
      bytes?
      exact-nonnegative-integer?
      string?
      string?
      htlc?)

  (htlc (generate-id)
        amount
        token-id
        hash-lock
        timeout
        sender
        receiver
        #f      ; No preimage revealed yet
        #f      ; Not claimed
        #f))    ; Not refunded

(define/contract (execute-htlc-reveal htlc-contract preimage)
  (-> htlc? bytes? (or/c (list/c string? exact-integer?) #f))

  ;; Verify preimage matches hash
  (define preimage-hash (sha256 preimage))
  (cond
    [(not (bytes=? preimage-hash (htlc-hash-lock htlc-contract)))
     #f]  ; Invalid preimage

    [(htlc-claimed? htlc-contract)
     #f]  ; Already claimed

    [(htlc-refunded? htlc-contract)
     #f]  ; Already refunded

    [else
     ;; Valid reveal! Update HTLC state
     (set-htlc-revealed-preimage! htlc-contract preimage)
     (set-htlc-claimed?! htlc-contract #t)

     ;; Return delta: receiver gets amount
     (list (htlc-receiver htlc-contract)
           (htlc-amount htlc-contract))]))

(define/contract (execute-htlc-timeout htlc-contract current-time)
  (-> htlc? exact-nonnegative-integer? (or/c (list/c string? exact-integer?) #f))

  (cond
    [(< current-time (htlc-timeout htlc-contract))
     #f]  ; Too early to timeout

    [(htlc-claimed? htlc-contract)
     #f]  ; Already claimed by receiver

    [(htlc-refunded? htlc-contract)
     #f]  ; Already refunded

    [else
     ;; Timeout! Refund to sender
     (set-htlc-refunded?! htlc-contract #t)

     ;; Return delta: sender gets refund
     (list (htlc-sender htlc-contract)
           (htlc-amount htlc-contract))]))

;; ─────────────────────────────────────────────────────────────────
;; Limit Order Implementation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-limit-order from-token to-token from-amount to-amount price-condition)
  (-> exact-nonnegative-integer?
      exact-nonnegative-integer?
      exact-nonnegative-integer?
      exact-nonnegative-integer?
      procedure?
      limit-order?)

  (limit-order (generate-id)
               from-token
               to-token
               from-amount
               to-amount
               price-condition
               #f))  ; Not executed yet

(define/contract (execute-limit-order order oracle-price)
  (-> limit-order? exact-nonnegative-integer? (or/c (list/c (list/c exact-integer? exact-integer?)
                                                            (list/c exact-integer? exact-integer?)) #f))

  (cond
    [(limit-order-executed? order)
     #f]  ; Already executed

    [(not ((limit-order-price-condition order) oracle-price))
     #f]  ; Price condition not met

    [else
     ;; Execute order!
     (set-limit-order-executed?! order #t)

     ;; Return deltas: sell from-token, buy to-token
     (list (list (limit-order-from-token order) (- (limit-order-from-amount order)))
           (list (limit-order-to-token order) (limit-order-to-amount order)))]))

;; ─────────────────────────────────────────────────────────────────
;; Utilities
;; ─────────────────────────────────────────────────────────────────

(define id-counter 0)

(define (generate-id)
  (set! id-counter (+ id-counter 1))
  (string->symbol (format "subcontract-~a" id-counter)))

(define/contract (is-subcontract-active? sc)
  (-> subcontract? boolean?)
  (subcontract-active? sc))

;; ═══════════════════════════════════════════════════════════════════
;; Subcontract Examples
;; ═══════════════════════════════════════════════════════════════════
;;
;; Example 1: HTLC for atomic swap
;;   Alice creates HTLC: 1000 tokens locked by hash(secret)
;;   Bob reveals secret → Bob gets 1000 tokens
;;   If Bob doesn't reveal before timeout → Alice gets refund
;;
;; Example 2: Limit order
;;   "Buy 100 USDC at price ≤ 2000 USDC/ETH"
;;   When oracle reports price ≤ 2000 → execute trade
;;   Deltas: -0.05 ETH, +100 USDC
;;
;; Example 3: Dividend distribution
;;   Entity pays 10% dividend to all C-share holders
;;   For each holder: Δ = reserves × 0.1 × (holder.cShares / totalCShares)
;;
;; Example 4: Netting optimizer
;;   Instead of A→B→C→D (3 hops)
;;   Net to A→D (1 hop)
;;   Deltas: {A: -100, D: +100} (B and C canceled)
;;
;; ═══════════════════════════════════════════════════════════════════
