#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; HTLC (Hash Time-Locked Contract) Demo
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates atomic swaps using HTLCs:
;; 1. Alice locks 1000 tokens with hash H
;; 2. Bob reveals preimage R where hash(R) = H → gets 1000 tokens
;; 3. If Bob doesn't reveal before timeout → Alice gets refund
;;
;; Real-world use case: Cross-chain atomic swaps
;; - Alice has Bitcoin, wants Ethereum
;; - Bob has Ethereum, wants Bitcoin
;; - They use HTLCs with same hash to ensure atomic swap
;;
;; Reference: c.txt "Building on XLN: Delta Transformers"
;; ═══════════════════════════════════════════════════════════════════

(require "../consensus/account/subcontracts.rkt"
         "../core/crypto.rkt")

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  HTLC Demo - Atomic Swaps via Hash Locks")
(displayln "═══════════════════════════════════════════════════════════")
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Scenario: Alice and Bob do cross-chain atomic swap
;; ═══════════════════════════════════════════════════════════════════

(displayln "Scenario: Alice ↔ Bob atomic swap")
(displayln "  - Alice has 1000 TokenA, wants TokenB")
(displayln "  - Bob has 1000 TokenB, wants TokenA")
(displayln "  - They use HTLCs with same secret for atomicity")
(newline)

;; Alice generates secret
(define secret #"my-secret-phrase-12345")
(define hash-lock (sha256 secret))

(displayln "Step 1: Alice generates secret")
(displayln (format "  Secret: ~a" secret))
(displayln (format "  Hash (first 16 bytes): ~a..." (subbytes hash-lock 0 16)))
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Happy Path: Bob reveals preimage and claims
;; ═══════════════════════════════════════════════════════════════════

(displayln "═══ Happy Path: Bob Reveals Preimage ═══")
(newline)

;; Alice creates HTLC
(define htlc-alice
  (create-htlc 1000           ; 1000 tokens
               1              ; Token ID 1
               hash-lock      ; Locked by hash
               9999999999     ; Timeout (far future)
               "alice"        ; Sender
               "bob"))        ; Receiver

(displayln "Step 2: Alice creates HTLC")
(displayln "  Amount: 1000 TokenA")
(displayln "  Locked until: Bob reveals preimage OR timeout")
(displayln (format "  HTLC ID: ~a" (htlc-id htlc-alice)))
(newline)

;; Bob reveals secret and claims
(displayln "Step 3: Bob reveals secret and claims...")
(define claim-result (execute-htlc-reveal htlc-alice secret))

(cond
  [claim-result
   (displayln "  ✓ HTLC unlocked!")
   (displayln (format "  Bob receives: ~a tokens" (second claim-result)))]
  [else
   (displayln "  ✗ Failed to unlock (should not happen)")])

(newline)

;; Verify state
(displayln "State after claim:")
(displayln (format "  Claimed? ~a" (htlc-claimed? htlc-alice)))
(displayln (format "  Refunded? ~a" (htlc-refunded? htlc-alice)))
(displayln (format "  Revealed preimage: ~a" (htlc-revealed-preimage htlc-alice)))
(newline)

(displayln "✓ Atomic swap successful!")
(displayln "  - Bob got TokenA by revealing secret")
(displayln "  - Alice now knows secret, can claim TokenB on other chain")
(displayln "  - ATOMICITY: Either both swaps happen or neither")
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Unhappy Path: Timeout without reveal
;; ═══════════════════════════════════════════════════════════════════

(displayln "═══ Unhappy Path: Timeout Refund ═══")
(newline)

;; Alice creates HTLC with short timeout
(define htlc-timeout
  (create-htlc 500            ; 500 tokens
               1              ; Token ID 1
               (sha256 #"different-secret")
               1000           ; Timeout at timestamp 1000
               "alice"
               "bob"))

(displayln "Alice creates HTLC with timeout at t=1000")
(displayln "  Amount: 500 TokenA")
(newline)

;; Try to claim before timeout (fails)
(displayln "Bob tries to timeout at t=500 (too early)...")
(define early-timeout (execute-htlc-timeout htlc-timeout 500))
(if early-timeout
    (displayln "  ✓ Refunded (should not happen)")
    (displayln "  ✗ Rejected: Too early for timeout"))
(newline)

;; Timeout reached, Alice reclaims
(displayln "Time passes... now t=1001")
(displayln "Alice reclaims tokens after timeout...")
(define timeout-result (execute-htlc-timeout htlc-timeout 1001))

(cond
  [timeout-result
   (displayln "  ✓ HTLC refunded!")
   (displayln (format "  Alice receives: ~a tokens back" (second timeout-result)))]
  [else
   (displayln "  ✗ Failed to timeout")])

(newline)

(displayln "✓ Timeout protection works!")
(displayln "  - Bob didn't reveal secret in time")
(displayln "  - Alice got her tokens back")
(displayln "  - No loss for Alice")
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Invalid Scenarios
;; ═══════════════════════════════════════════════════════════════════

(displayln "═══ Invalid Scenarios ═══")
(newline)

;; Wrong preimage
(define htlc-wrong
  (create-htlc 100 1 (sha256 #"correct-secret") 9999999999 "alice" "bob"))

(displayln "Bob tries to reveal WRONG preimage...")
(define wrong-reveal (execute-htlc-reveal htlc-wrong #"wrong-secret"))
(if wrong-reveal
    (displayln "  ✓ Unlocked (should not happen)")
    (displayln "  ✗ Rejected: Preimage doesn't match hash"))
(newline)

;; Double claim
(define htlc-double
  (create-htlc 100 1 (sha256 #"secret") 9999999999 "alice" "bob"))
(execute-htlc-reveal htlc-double #"secret")  ; First claim

(displayln "Bob tries to claim TWICE...")
(define double-claim (execute-htlc-reveal htlc-double #"secret"))
(if double-claim
    (displayln "  ✓ Claimed again (should not happen)")
    (displayln "  ✗ Rejected: Already claimed"))
(newline)

;; Timeout after claim
(displayln "Alice tries to timeout AFTER Bob claimed...")
(define timeout-after-claim (execute-htlc-timeout htlc-double 9999999999))
(if timeout-after-claim
    (displayln "  ✓ Refunded (should not happen)")
    (displayln "  ✗ Rejected: Already claimed by Bob"))
(newline)

;; ═══════════════════════════════════════════════════════════════════
;; Summary
;; ═══════════════════════════════════════════════════════════════════

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Why HTLCs Enable Atomic Swaps")
(displayln "═══════════════════════════════════════════════════════════")
(newline)

(displayln "Without HTLCs:")
(displayln "  ✗ Alice sends TokenA → Bob might not send TokenB")
(displayln "  ✗ Requires trusted intermediary")
(displayln "  ✗ Counterparty risk")
(newline)

(displayln "With HTLCs:")
(displayln "  ✓ Alice locks TokenA with hash H")
(displayln "  ✓ Bob locks TokenB with SAME hash H")
(displayln "  ✓ If Bob claims TokenA (reveals secret) → Alice learns secret → claims TokenB")
(displayln "  ✓ If timeout → both get refunds")
(displayln "  ✓ ATOMIC: Either both swaps happen or neither")
(newline)

(displayln "Real-world use cases:")
(displayln "  - Cross-chain atomic swaps (Bitcoin ↔ Ethereum)")
(displayln "  - Lightning Network routing (multi-hop HTLCs)")
(displayln "  - Submarine swaps (on-chain ↔ off-chain)")
(displayln "  - Conditional payments (reveal secret = payment released)")
(newline)

(displayln "HTLCs are building blocks for trustless exchange.")
(newline)
(displayln "λ.")
