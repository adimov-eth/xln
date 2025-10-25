#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Architecture Tree - Visual Rendering of System Structure
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates compositional tree rendering:
;; The architecture (data) → tree traversal (function) → visual output
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/match
         racket/list
         racket/format
         racket/string)

(displayln "")
(displayln "═════════════════════════════════════════════════════════")
(displayln "  XLN Architecture Tree")
(displayln "  (Compositional Rendering from S-Expression Data)")
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
      (demos 17)
      (passing "17/17")
      (phases-complete "5/5"))))

;; ─────────────────────────────────────────────────────────────────
;; Tree Rendering (Compositional)
;; ─────────────────────────────────────────────────────────────────

(define (render-tree node [prefix ""] [is-last #t])
  "Recursively render S-expression as tree structure"

  (define connector (if is-last "└── " "├── "))
  (define extension (if is-last "    " "│   "))

  (match node
    ;; System root
    [`(system ,name . ,components)
     (displayln (format "~a~a ~a" prefix connector name))
     (render-children components (string-append prefix extension))]

    ;; Layer with contents
    [`(layer ,name . ,contents)
     (displayln (format "~a~a [LAYER] ~a" prefix connector name))
     (render-children contents (string-append prefix extension))]

    ;; Module with properties
    [`(module ,name . ,props)
     (displayln (format "~a~a [MODULE] ~a" prefix connector name))
     (render-properties props (string-append prefix extension))]

    ;; State machine
    [`(machine ,name . ,props)
     (displayln (format "~a~a [MACHINE] ~a" prefix connector name))
     (render-properties props (string-append prefix extension))]

    ;; Metrics section
    [`(metrics . ,kvs)
     (displayln (format "~a~a [METRICS]" prefix connector))
     (for ([kv kvs] [i (in-naturals)])
       (define last? (= i (- (length kvs) 1)))
       (define conn (if last? "└── " "├── "))
       (match kv
         [`(,key ,value)
          (displayln (format "~a~a~a ~a: ~a" prefix extension conn key value))]
         [_ (void)]))]

    ;; Property pair
    [`(,key ,value)
     (displayln (format "~a~a ~a: ~a" prefix connector key value))]

    ;; List of items
    [(list items ...)
     (for ([item items] [i (in-naturals)])
       (define last? (= i (- (length items) 1)))
       (render-tree item prefix last?))]

    ;; Atom
    [atom
     (displayln (format "~a~a ~a" prefix connector atom))]))

(define (render-children children prefix)
  "Render list of child nodes with proper connectors"
  (for ([child children] [i (in-naturals)])
    (define last? (= i (- (length children) 1)))
    (render-tree child prefix last?)))

(define (render-properties props prefix)
  "Render module/machine properties"
  (for ([prop props] [i (in-naturals)])
    (define last? (= i (- (length props) 1)))
    (define conn (if last? "└── " "├── "))
    (match prop
      [`(,key . ,values)
       (displayln (format "~a~a ~a: ~a" prefix conn key values))]
      [_ (void)])))

;; ─────────────────────────────────────────────────────────────────
;; Render the Architecture
;; ─────────────────────────────────────────────────────────────────

(render-tree xln-system)

(displayln "")
(displayln "═════════════════════════════════════════════════════════")
(displayln "✓ Architecture rendered as tree")
(displayln "✓ Compositional traversal (recursive descent)")
(displayln "✓ Pattern matching on structure")
(displayln "✓ Visual hierarchy from S-expression data")
(displayln "═════════════════════════════════════════════════════════")
(displayln "")
(displayln "The same data, different view:")
(displayln "  architecture-query.rkt → extracts specific information")
(displayln "  architecture-tree.rkt  → renders hierarchical structure")
(displayln "")
(displayln "Both operate on the SAME S-expression representation.")
(displayln "That's the homoiconic power: data IS code IS queryable.")
(displayln "")
(displayln "λ.")
