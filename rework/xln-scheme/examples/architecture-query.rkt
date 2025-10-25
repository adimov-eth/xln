#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Architecture Query - The System Knows Itself
;; ═══════════════════════════════════════════════════════════════════
;;
;; This demonstrates homoiconicity in action:
;; The architecture IS data, so we can QUERY it.
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/match
         racket/list
         racket/format)

(displayln "")
(displayln "═════════════════════════════════════════════════════════")
(displayln "  XLN Architecture Query Demo")
(displayln "  (The System Introspecting Itself)")
(displayln "═════════════════════════════════════════════════════════")
(displayln "")

;; Load architecture (simplified version for demo)
(define xln-system
  '(system xln-scheme
    (layer foundation
      (module crypto (provides sha256))
      (module rlp (provides encode decode))
      (module merkle (provides compute-root)))
    (layer consensus
      (machine bilateral (states (idle pending committed)))
      (machine bft (states (idle proposed precommitted committed))))
    (layer network
      (module server (routing-key "entityId:signerId"))
      (module gossip (type crdt))
      (module routing (algorithm dijkstra-modified)))
    (layer blockchain
      (module chain-state (implementation simulated)))
    (layer persistence
      (module wal (structure append-only))
      (module snapshot (format s-expression)))
    (metrics
      (files 24)
      (lines ~4500)
      (demos 16)
      (passing "16/16")
      (phases-complete "5/5"))))

;; ─────────────────────────────────────────────────────────────────
;; Query Functions (Pattern Matching on Structure)
;; ─────────────────────────────────────────────────────────────────

(define (find-layers system)
  (match system
    [`(system ,name . ,components)
     (filter (lambda (c) (and (pair? c) (eq? (car c) 'layer))) components)]
    [_ '()]))

(define (find-machines system)
  (define (extract-machines component)
    (match component
      [`(layer ,name . ,contents)
       (filter (lambda (c) (and (pair? c) (eq? (car c) 'machine))) contents)]
      [_ '()]))
  (apply append (map extract-machines (find-layers system))))

(define (find-modules system)
  (define (extract-modules component)
    (match component
      [`(layer ,name . ,contents)
       (filter (lambda (c) (and (pair? c) (eq? (car c) 'module))) contents)]
      [_ '()]))
  (apply append (map extract-modules (find-layers system))))

(define (get-metrics system)
  (match system
    [`(system ,name . ,components)
     (findf (lambda (c) (and (pair? c) (eq? (car c) 'metrics))) components)]
    [_ #f]))

(define (get-metric-value metrics key)
  (match metrics
    [`(metrics . ,kvs)
     (let ([pair (findf (lambda (kv) (and (pair? kv) (eq? (car kv) key))) kvs)])
       (if pair (cadr pair) #f))]
    [_ #f]))

;; ─────────────────────────────────────────────────────────────────
;; Demo Queries
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Query 1: What layers exist? ===")
(define layers (find-layers xln-system))
(for ([layer layers])
  (displayln (format "  - ~a" (cadr layer))))
(displayln "")

(displayln "=== Query 2: What state machines are implemented? ===")
(define machines (find-machines xln-system))
(for ([machine machines])
  (match machine
    [`(machine ,name (states ,states))
     (displayln (format "  - ~a: ~a" name states))]
    [`(machine ,name . ,_)
     (displayln (format "  - ~a" name))]))
(displayln "")

(displayln "=== Query 3: What modules provide functionality? ===")
(define modules (find-modules xln-system))
(for ([module modules])
  (match module
    [`(module ,name (provides . ,fns))
     (displayln (format "  - ~a: ~a" name fns))]
    [`(module ,name . ,_)
     (displayln (format "  - ~a" name))]))
(displayln "")

(displayln "=== Query 4: What are the system metrics? ===")
(define metrics (get-metrics xln-system))
(when metrics
  (displayln (format "  Files: ~a" (get-metric-value metrics 'files)))
  (displayln (format "  Lines: ~a" (get-metric-value metrics 'lines)))
  (displayln (format "  Demos: ~a" (get-metric-value metrics 'demos)))
  (displayln (format "  Passing: ~a" (get-metric-value metrics 'passing)))
  (displayln (format "  Phases: ~a" (get-metric-value metrics 'phases-complete))))
(displayln "")

;; ─────────────────────────────────────────────────────────────────
;; The Key Insight
;; ─────────────────────────────────────────────────────────────────

(displayln "═════════════════════════════════════════════════════════")
(displayln "✓ Architecture IS data")
(displayln "✓ Data can be queried")
(displayln "✓ Queries use pattern matching")
(displayln "✓ No external tools needed")
(displayln "✓ The system knows itself")
(displayln "═════════════════════════════════════════════════════════")
(displayln "")
(displayln "This is what homoiconicity means:")
(displayln "  Code = Data = Introspectable Structure")
(displayln "")
(displayln "λ.")
