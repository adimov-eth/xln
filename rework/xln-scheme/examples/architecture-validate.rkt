#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Architecture Validation - Compositional Invariant Checking
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates validation rules as composable predicates:
;; - Each rule is a pure function: architecture → (list-of errors)
;; - Compose rules to build comprehensive validation
;; - Empty list = all checks pass
;;
;; This shows: constraints as data, validation as composition
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/match
         racket/list
         racket/string)

(displayln "")
(displayln "═════════════════════════════════════════════════════════")
(displayln "  XLN Architecture Validation")
(displayln "  (Compositional Invariant Checking)")
(displayln "═════════════════════════════════════════════════════════")
(displayln "")

;; Load architecture
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
      (demos 14)
      (passing "14/14")
      (phases-complete "5/5"))))

;; ─────────────────────────────────────────────────────────────────
;; Validation Rules (Composable Predicates)
;; ─────────────────────────────────────────────────────────────────

(define (validate-system-has-name arch)
  "Ensure system has a name"
  (match arch
    [`(system ,name . ,_)
     (if (symbol? name)
         '()
         (list "System name must be a symbol"))]
    [_ (list "Invalid system structure")]))

(define (validate-has-layers arch)
  "Ensure system has at least one layer"
  (match arch
    [`(system ,_ . ,components)
     (define layers (filter (lambda (c) (and (pair? c) (eq? (car c) 'layer))) components))
     (if (empty? layers)
         (list "System must have at least one layer")
         '())]
    [_ '()]))

(define (validate-layers-have-content arch)
  "Ensure each layer has at least one module or machine"
  (match arch
    [`(system ,_ . ,components)
     (define layers (filter (lambda (c) (and (pair? c) (eq? (car c) 'layer))) components))
     (apply append
            (for/list ([layer layers])
              (match layer
                [`(layer ,name . ,contents)
                 (if (empty? contents)
                     (list (format "Layer ~a is empty" name))
                     '())]
                [_ '()])))]
    [_ '()]))

(define (validate-machines-have-states arch)
  "Ensure each state machine defines states"
  (match arch
    [`(system ,_ . ,components)
     (define layers (filter (lambda (c) (and (pair? c) (eq? (car c) 'layer))) components))
     (apply append
            (for/list ([layer layers])
              (match layer
                [`(layer ,layer-name . ,contents)
                 (define machines (filter (lambda (c) (and (pair? c) (eq? (car c) 'machine))) contents))
                 (apply append
                        (for/list ([machine machines])
                          (match machine
                            [`(machine ,name . ,props)
                             (define has-states?
                               (ormap (lambda (p) (and (pair? p) (eq? (car p) 'states))) props))
                             (if has-states?
                                 '()
                                 (list (format "Machine ~a in layer ~a missing states" name layer-name)))]
                            [_ '()])))]
                [_ '()])))]
    [_ '()]))

(define (validate-modules-have-properties arch)
  "Ensure each module defines at least one property"
  (match arch
    [`(system ,_ . ,components)
     (define layers (filter (lambda (c) (and (pair? c) (eq? (car c) 'layer))) components))
     (apply append
            (for/list ([layer layers])
              (match layer
                [`(layer ,layer-name . ,contents)
                 (define modules (filter (lambda (c) (and (pair? c) (eq? (car c) 'module))) contents))
                 (apply append
                        (for/list ([module modules])
                          (match module
                            [`(module ,name . ,props)
                             (if (empty? props)
                                 (list (format "Module ~a in layer ~a has no properties" name layer-name))
                                 '())]
                            [_ '()])))]
                [_ '()])))]
    [_ '()]))

(define (validate-metrics-present arch)
  "Ensure system has metrics section"
  (match arch
    [`(system ,_ . ,components)
     (define has-metrics?
       (ormap (lambda (c) (and (pair? c) (eq? (car c) 'metrics))) components))
     (if has-metrics?
         '()
         (list "System missing metrics section"))]
    [_ '()]))

(define (validate-metrics-complete arch)
  "Ensure metrics section has all required fields"
  (match arch
    [`(system ,_ . ,components)
     (define metrics (findf (lambda (c) (and (pair? c) (eq? (car c) 'metrics))) components))
     (if metrics
         (match metrics
           [`(metrics . ,kvs)
            (define required-keys '(files lines demos passing phases-complete))
            (define actual-keys (map car kvs))
            (define missing (filter (lambda (k) (not (member k actual-keys))) required-keys))
            (if (empty? missing)
                '()
                (list (format "Metrics missing keys: ~a" missing)))]
           [_ '()])
         '())]
    [_ '()]))

;; ─────────────────────────────────────────────────────────────────
;; Compose All Validation Rules
;; ─────────────────────────────────────────────────────────────────

(define validation-rules
  (list validate-system-has-name
        validate-has-layers
        validate-layers-have-content
        validate-machines-have-states
        validate-modules-have-properties
        validate-metrics-present
        validate-metrics-complete))

(define (validate-architecture arch)
  "Run all validation rules and collect errors"
  (apply append (map (lambda (rule) (rule arch)) validation-rules)))

;; ─────────────────────────────────────────────────────────────────
;; Run Validation
;; ─────────────────────────────────────────────────────────────────

(displayln "Running validation rules...")
(displayln "")

(define errors (validate-architecture xln-system))

(if (empty? errors)
    (begin
      (displayln "✓ All validation checks passed!")
      (displayln "")
      (displayln "Checked:")
      (displayln "  ✓ System has valid name")
      (displayln "  ✓ System has layers")
      (displayln "  ✓ All layers have content")
      (displayln "  ✓ All machines define states")
      (displayln "  ✓ All modules have properties")
      (displayln "  ✓ Metrics section present")
      (displayln "  ✓ Metrics section complete"))
    (begin
      (displayln "✗ Validation failed with errors:")
      (displayln "")
      (for ([err errors] [i (in-naturals 1)])
        (displayln (format "  ~a. ~a" i err)))))

(displayln "")
(displayln "═════════════════════════════════════════════════════════")
(displayln "Validation Rules:")
(displayln (format "  Total rules: ~a" (length validation-rules)))
(displayln (format "  Errors found: ~a" (length errors)))
(displayln (format "  Status: ~a" (if (empty? errors) "PASS" "FAIL")))
(displayln "═════════════════════════════════════════════════════════")
(displayln "")
(displayln "Key insight:")
(displayln "  - Validation rules are composable functions")
(displayln "  - Each rule: architecture → (list-of errors)")
(displayln "  - Combine rules with apply append")
(displayln "  - Empty list = all checks pass")
(displayln "")
(displayln "This is architectural validation as COMPOSITION,")
(displayln "not imperative checking. The rules are data.")
(displayln "")
(displayln "λ.")
