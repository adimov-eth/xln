#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; XLN Scenario System - Declarative Economic Simulations
;; ═══════════════════════════════════════════════════════════════════
;;
;; S-expression DSL for describing economic scenarios that unfold over time.
;; Inspired by TypeScript scenarios/ but homoiconic and compositional.
;;
;; Example usage:
;;
;; (scenario 'diamond-dybvig
;;   (seed "bank-run-1")
;;
;;   (at 0
;;     (title "Setup: Hub Provides Liquidity")
;;     (open-account 'E1 'E3 #:collateral 1000))
;;
;;   (at 5
;;     (title "First Withdrawal")
;;     (withdraw 'E3 800))
;;
;;   (repeat every: 1
;;     (pay 'E1 'E2 10)))  ; Continuous background activity
;;
;; ═══════════════════════════════════════════════════════════════════

(provide (all-defined-out))

;; ─────────────────────────────────────────────────────────────────
;; Data Types
;; ─────────────────────────────────────────────────────────────────

;; Camera/view state for cinematic scenarios
(struct view-state (
  camera           ; 'orbital, 'overview, 'follow, 'free
  zoom             ; Number (1.0 = default)
  focus            ; Entity ID to center on
  panel            ; 'accounts, 'transactions, 'consensus, 'network
  speed            ; Playback multiplier
  position         ; (x y z) or #f
  rotation         ; (x y z) or #f
) #:transparent)

;; Single action at a timestamp
(struct scenario-action (
  type             ; Symbol: 'open-account, 'pay, 'withdraw, etc.
  entity-id        ; Which entity performs this (or #f)
  params           ; Parameters (list or hash)
  source-line      ; For error reporting
) #:transparent)

;; Event at a specific timestamp
(struct scenario-event (
  timestamp        ; Number (seconds, can be decimal)
  title            ; String or #f
  description      ; String or #f
  actions          ; List of scenario-action
  view-state       ; view-state or #f
) #:transparent)

;; Repeating block of actions
(struct repeat-block (
  interval         ; Seconds between repetitions
  actions          ; List of scenario-action
  start-timestamp  ; When this was defined
) #:transparent)

;; Complete scenario definition
(struct scenario (
  name             ; Symbol
  seed             ; String for determinism
  events           ; List of scenario-event (sorted by timestamp)
  repeat-blocks    ; List of repeat-block
  includes         ; List of paths (for scenario composition)
  metadata         ; Hash with title, description, author, etc.
) #:transparent)

;; Execution context
(struct scenario-context (
  scenario         ; The scenario being executed
  current-frame    ; Current frame index
  total-frames     ; Total frames to generate
  elapsed-time     ; Seconds elapsed
  entity-mapping   ; Hash: scenario-id -> actual entity address
  view-history     ; Hash: frame-index -> view-state
  tick-interval    ; Milliseconds between ticks (0 = instant)
) #:transparent)

;; Execution result
(struct scenario-result (
  success?         ; Boolean
  frames-generated ; Number
  final-timestamp  ; Number (seconds)
  errors           ; List of error strings
  context          ; scenario-context
) #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; Helper Functions
;; ─────────────────────────────────────────────────────────────────

;; Create default view state
(define (default-view-state)
  (view-state 'orbital 1.0 #f 'accounts 1.0 #f #f))

;; Sort events by timestamp
(define (sort-events events)
  (sort events < #:key scenario-event-timestamp))

;; Expand repeat blocks into events at specific timestamps
;; (for execution planning)
(define (expand-repeat-blocks blocks max-time)
  (for*/list ([block (in-list blocks)]
              [t (in-range (repeat-block-start-timestamp block)
                           max-time
                           (repeat-block-interval block))])
    (scenario-event t #f #f (repeat-block-actions block) #f)))

;; Merge one-time events with expanded repeats
(define (merge-timeline events repeat-blocks max-time)
  (define expanded (expand-repeat-blocks repeat-blocks max-time))
  (sort-events (append events expanded)))

;; Create scenario from builder pattern
(define (make-scenario name seed events repeats [metadata (hash)])
  (scenario name
            seed
            (sort-events events)
            repeats
            '()
            metadata))

;; ─────────────────────────────────────────────────────────────────
;; DSL Macros (Coming soon)
;; ─────────────────────────────────────────────────────────────────

;; Placeholder for future DSL:
;;
;; (define-scenario diamond-dybvig
;;   (seed "bank-run-1")
;;   (metadata
;;     #:title "Diamond-Dybvig Bank Run"
;;     #:description "Classic bank run dynamics in payment channels")
;;
;;   (at 0
;;     (title "Setup: Hub Provides Liquidity")
;;     (open-account 'hub 'user-1 #:collateral 1000)
;;     (open-account 'hub 'user-2 #:collateral 1000)
;;     (open-account 'hub 'user-3 #:collateral 1000))
;;
;;   (at 5
;;     (title "First Withdrawal: Panic Begins")
;;     (withdraw 'user-1 800))
;;
;;   (at 8
;;     (title "Cascade: Others Follow")
;;     (withdraw 'user-2 800))
;;
;;   (at 12
;;     (title "Collapse: Hub Out of Reserves")
;;     (withdraw 'user-3 800))  ; This will fail
;;
;;   (repeat every: 1
;;     (pay-random #:amount 10)))

;; ─────────────────────────────────────────────────────────────────
;; Why This Matters
;; ─────────────────────────────────────────────────────────────────

;; Economic scenarios as first-class data structures:
;; - Inspectable (scenarios are S-expressions)
;; - Composable (include/merge scenarios)
;; - Deterministic (seeded randomness)
;; - Shareable (serialize to file, URL encode)
;; - Version-controllable (git-friendly text format)
;;
;; Use cases:
;; - Economic research (bank runs, liquidity crises)
;; - Visual demos (cinematic camera control)
;; - Testing (reproducible edge cases)
;; - Documentation (executable specifications)
;; - Education (interactive economic models)
