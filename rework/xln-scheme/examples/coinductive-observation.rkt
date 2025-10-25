#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Coinductive Observation - One Hand Clapping
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates coinductive (infinite) structures through lazy streams.
;;
;; Inductive:  Verify base case, build up from ground
;; Coinductive: Productive observation, unfold infinitely
;;
;; The consensus system is coinductive:
;; - Channels don't terminate
;; - State machines unfold forever
;; - The observation produces itself
;;
;; ```
;; OneHand (fun c => hear c)  ; sound without clapper
;; ```
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/stream
         racket/match
         racket/format)

(displayln "")
(displayln "═════════════════════════════════════════════════════════")
(displayln "  Coinductive Observation")
(displayln "  (One Hand Clapping)")
(displayln "═════════════════════════════════════════════════════════")
(displayln "")

;; ─────────────────────────────────────────────────────────────────
;; Example 1: Infinite Stream of Natural Numbers
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Example 1: Infinite Naturals ===")
(displayln "")

(define (naturals-from n)
  "Coinductive stream: n, n+1, n+2, ..."
  (stream-cons n (naturals-from (+ n 1))))

(define nats (naturals-from 0))

(displayln "First 10 natural numbers:")
(for ([n (stream-take nats 10)])
  (display (format "~a " n)))
(displayln "...")
(displayln "")
(displayln "This stream is INFINITE. No base case. Productive unfolding.")
(displayln "")

;; ─────────────────────────────────────────────────────────────────
;; Example 2: Fibonacci Stream (Coinductive)
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Example 2: Fibonacci Stream ===")
(displayln "")

(define (fib-stream a b)
  "Coinductive Fibonacci: a, b, a+b, b+(a+b), ..."
  (stream-cons a (fib-stream b (+ a b))))

(define fibs (fib-stream 0 1))

(displayln "First 15 Fibonacci numbers:")
(for ([f (stream-take fibs 15)])
  (display (format "~a " f)))
(displayln "...")
(displayln "")
(displayln "No termination. Just productive observation.")
(displayln "")

;; ─────────────────────────────────────────────────────────────────
;; Example 3: State Machine as Coinductive Stream
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Example 3: Consensus State Machine Stream ===")
(displayln "")

(struct consensus-state (phase counter timestamp) #:transparent)

(define (consensus-stream state)
  "Coinductive consensus: state evolves forever"
  (match state
    [(consensus-state 'idle counter ts)
     (stream-cons state
                  (consensus-stream (consensus-state 'proposed (+ counter 1) (+ ts 100))))]
    [(consensus-state 'proposed counter ts)
     (stream-cons state
                  (consensus-stream (consensus-state 'committed counter (+ ts 100))))]
    [(consensus-state 'committed counter ts)
     (stream-cons state
                  (consensus-stream (consensus-state 'idle counter (+ ts 100))))]))

(define initial-state (consensus-state 'idle 0 0))
(define consensus-evolution (consensus-stream initial-state))

(displayln "First 12 state transitions:")
(for ([s (stream-take consensus-evolution 12)] [i (in-naturals)])
  (match s
    [(consensus-state phase counter ts)
     (displayln (format "  ~a. phase: ~a, counter: ~a, ts: ~a" i phase counter ts))]))
(displayln "...")
(displayln "")
(displayln "The state machine never terminates. It UNFOLDS productively.")
(displayln "")

;; ─────────────────────────────────────────────────────────────────
;; Example 4: Bilateral Channel as Coinductive Observation
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Example 4: Bilateral Channel Evolution ===")
(displayln "")

(struct channel-state (left-balance right-balance frame-count) #:transparent)

(define (channel-stream state)
  "Coinductive channel: balances shift forever"
  (match state
    [(channel-state left right count)
     (define delta (if (even? count) 10 -10))  ; Oscillate
     (stream-cons state
                  (channel-stream (channel-state (- left delta)
                                                  (+ right delta)
                                                  (+ count 1))))]))

(define initial-channel (channel-state 1000 1000 0))
(define channel-evolution (channel-stream initial-channel))

(displayln "First 10 bilateral frames:")
(for ([s (stream-take channel-evolution 10)] [i (in-naturals)])
  (match s
    [(channel-state left right count)
     (displayln (format "  Frame ~a: Alice=~a, Bob=~a" count left right))]))
(displayln "...")
(displayln "")
(displayln "Bilateral consensus as INFINITE OBSERVATION.")
(displayln "No final state. Just continued operation.")
(displayln "")

;; ─────────────────────────────────────────────────────────────────
;; The Key Insight: Coinduction vs Induction
;; ─────────────────────────────────────────────────────────────────

(displayln "═════════════════════════════════════════════════════════")
(displayln "Inductive Proof:")
(displayln "  1. Prove base case P(0)")
(displayln "  2. Prove P(n) → P(n+1)")
(displayln "  3. Therefore P(k) for all k")
(displayln "")
(displayln "Coinductive Observation:")
(displayln "  1. Observe P holds NOW")
(displayln "  2. Observation produces NEXT observation")
(displayln "  3. Productive unfolding continues ∞")
(displayln "")
(displayln "XLN consensus is coinductive:")
(displayln "  - Channels don't terminate")
(displayln "  - State machines unfold forever")
(displayln "  - Each frame validates NEXT frame")
(displayln "  - The observation produces itself")
(displayln "═════════════════════════════════════════════════════════")
(displayln "")
(displayln "```agda")
(displayln "record Clap : Set where")
(displayln "  coinductive")
(displayln "  field")
(displayln "    hear : ∞ Sound")
(displayln "")
(displayln "one : Clap")
(displayln "Clap.hear one = ♯ resonance")
(displayln "```")
(displayln "")
(displayln "Sound without clapper. The observation produces itself.")
(displayln "")
(displayln "λ.")
