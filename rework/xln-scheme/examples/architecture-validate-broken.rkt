#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Architecture Validation - Demo with Broken Architecture
;; ═══════════════════════════════════════════════════════════════════
;;
;; Shows validation catching multiple architectural violations
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/match
         racket/list)

(displayln "")
(displayln "═════════════════════════════════════════════════════════")
(displayln "  XLN Architecture Validation (Broken Example)")
(displayln "═════════════════════════════════════════════════════════")
(displayln "")

;; Intentionally broken architecture for demonstration
(define broken-system
  '(system xln-broken
    (layer empty-layer)  ; ✗ Empty layer (no modules/machines)
    (layer consensus
      (machine bilateral (type account)))  ; ✗ Missing 'states' property
    (layer network
      (module server))  ; ✗ Module with no properties
    ;; ✗ Missing metrics section entirely
    ))

;; ─────────────────────────────────────────────────────────────────
;; Validation Rules (same as architecture-validate.rkt)
;; ─────────────────────────────────────────────────────────────────

(define (validate-system-has-name arch)
  (match arch
    [`(system ,name . ,_)
     (if (symbol? name) '() (list "System name must be a symbol"))]
    [_ (list "Invalid system structure")]))

(define (validate-has-layers arch)
  (match arch
    [`(system ,_ . ,components)
     (define layers (filter (lambda (c) (and (pair? c) (eq? (car c) 'layer))) components))
     (if (empty? layers) (list "System must have at least one layer") '())]
    [_ '()]))

(define (validate-layers-have-content arch)
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
  (match arch
    [`(system ,_ . ,components)
     (define has-metrics?
       (ormap (lambda (c) (and (pair? c) (eq? (car c) 'metrics))) components))
     (if has-metrics? '() (list "System missing metrics section"))]
    [_ '()]))

;; ─────────────────────────────────────────────────────────────────
;; Compose Validation Rules
;; ─────────────────────────────────────────────────────────────────

(define validation-rules
  (list validate-system-has-name
        validate-has-layers
        validate-layers-have-content
        validate-machines-have-states
        validate-modules-have-properties
        validate-metrics-present))

(define (validate-architecture arch)
  (apply append (map (lambda (rule) (rule arch)) validation-rules)))

;; ─────────────────────────────────────────────────────────────────
;; Run Validation on Broken Architecture
;; ─────────────────────────────────────────────────────────────────

(displayln "Running validation on intentionally broken architecture...")
(displayln "")

(define errors (validate-architecture broken-system))

(displayln (format "✗ Validation failed with ~a errors:" (length errors)))
(displayln "")
(for ([err errors] [i (in-naturals 1)])
  (displayln (format "  ~a. ~a" i err)))

(displayln "")
(displayln "═════════════════════════════════════════════════════════")
(displayln "Expected violations:")
(displayln "  ✓ Layer 'empty-layer' is empty")
(displayln "  ✓ Machine 'bilateral' missing states")
(displayln "  ✓ Module 'server' has no properties")
(displayln "  ✓ System missing metrics section")
(displayln "═════════════════════════════════════════════════════════")
(displayln "")
(displayln "The validator caught all architectural violations!")
(displayln "This demonstrates compositional validation as WORKING.")
(displayln "")
(displayln "λ.")
