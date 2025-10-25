#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Blockchain Types - Chain State & Events
;; ═══════════════════════════════════════════════════════════════════
;;
;; Defines data structures for blockchain interaction.
;; Simulated EVM for demo purposes (no actual FFI).
;;
;; Key structures:
;;   - Chain state (entity registry, reserves, events)
;;   - Events (EntityRegistered, ReserveUpdated, SettlementProcessed)
;;   - Batch operations (processBatch structure)
;;
;; Future: Replace simulation with actual JSON-RPC FFI
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/hash)

(provide (struct-out chain-state)
         (struct-out entity-record)
         (struct-out event-log)
         (struct-out settlement-diff)
         create-chain-state
         register-entity!
         update-reserve!
         process-settlement!
         get-entity-number
         get-reserve
         get-events)

;; ─────────────────────────────────────────────────────────────────
;; Data Structures
;; ─────────────────────────────────────────────────────────────────

(struct entity-record (entity-id entity-number board-hash status activation-time) #:transparent)
;; status: 0=inactive, 1=active

(struct event-log (type timestamp data) #:transparent)
;; type: 'entity-registered | 'reserve-updated | 'settlement-processed

(struct settlement-diff (token-id left-diff right-diff collateral-diff) #:transparent)

(struct chain-state (entity-registry   ; hash: entity-id → entity-record
                     reserves          ; hash: (entity-id . token-id) → amount
                     next-number       ; counter for entity numbers
                     events            ; (listof event-log)
                     block-height      ; current block
                     block-timestamp)  ; current timestamp
  #:mutable #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; Chain State Creation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-chain-state)
  (-> chain-state?)

  (chain-state (make-hash)      ; entity-registry
               (make-hash)      ; reserves
               1                ; next-number starts at 1
               '()              ; events
               0                ; block-height
               0))              ; block-timestamp

;; ─────────────────────────────────────────────────────────────────
;; Entity Registration
;; ─────────────────────────────────────────────────────────────────

(define/contract (register-entity! state entity-id board-hash)
  (-> chain-state? string? bytes? exact-nonnegative-integer?)

  (define number (chain-state-next-number state))
  (define record (entity-record entity-id number board-hash 1 (chain-state-block-timestamp state)))

  ;; Update registry
  (hash-set! (chain-state-entity-registry state) entity-id record)

  ;; Increment next number
  (set-chain-state-next-number! state (+ number 1))

  ;; Log event
  (define event (event-log 'entity-registered
                           (chain-state-block-timestamp state)
                           (hash 'entity-id entity-id
                                 'entity-number number
                                 'board-hash board-hash)))
  (set-chain-state-events! state (cons event (chain-state-events state)))

  (displayln (format "[CHAIN] EntityRegistered: ~a → #~a" entity-id number))

  number)

;; ─────────────────────────────────────────────────────────────────
;; Reserve Management
;; ─────────────────────────────────────────────────────────────────

(define/contract (update-reserve! state entity-id token-id amount)
  (-> chain-state? string? exact-nonnegative-integer? exact-nonnegative-integer? void?)

  (define key (cons entity-id token-id))
  (hash-set! (chain-state-reserves state) key amount)

  ;; Log event
  (define event (event-log 'reserve-updated
                           (chain-state-block-timestamp state)
                           (hash 'entity-id entity-id
                                 'token-id token-id
                                 'new-balance amount)))
  (set-chain-state-events! state (cons event (chain-state-events state)))

  (displayln (format "[CHAIN] ReserveUpdated: ~a token ~a → ~a" entity-id token-id amount)))

(define/contract (get-reserve state entity-id token-id)
  (-> chain-state? string? exact-nonnegative-integer? exact-nonnegative-integer?)

  (define key (cons entity-id token-id))
  (hash-ref (chain-state-reserves state) key 0))

;; ─────────────────────────────────────────────────────────────────
;; Settlement Processing
;; ─────────────────────────────────────────────────────────────────

(define/contract (process-settlement! state left-entity right-entity diffs)
  (-> chain-state? string? string? (listof settlement-diff?) void?)

  (for ([diff diffs])
    (define token-id (settlement-diff-token-id diff))
    (define left-reserve (get-reserve state left-entity token-id))
    (define right-reserve (get-reserve state right-entity token-id))

    ;; Apply diffs (simplified - no collateral tracking for now)
    (define new-left (+ left-reserve (settlement-diff-left-diff diff)))
    (define new-right (+ right-reserve (settlement-diff-right-diff diff)))

    (update-reserve! state left-entity token-id new-left)
    (update-reserve! state right-entity token-id new-right)

    ;; Log settlement event
    (define event (event-log 'settlement-processed
                             (chain-state-block-timestamp state)
                             (hash 'left-entity left-entity
                                   'right-entity right-entity
                                   'token-id token-id
                                   'left-diff (settlement-diff-left-diff diff)
                                   'right-diff (settlement-diff-right-diff diff))))
    (set-chain-state-events! state (cons event (chain-state-events state))))

  (displayln (format "[CHAIN] SettlementProcessed: ~a ↔ ~a (~a diffs)"
                     left-entity
                     right-entity
                     (length diffs))))

;; ─────────────────────────────────────────────────────────────────
;; Queries
;; ─────────────────────────────────────────────────────────────────

(define/contract (get-entity-number state entity-id)
  (-> chain-state? string? (or/c exact-nonnegative-integer? #f))

  (define record (hash-ref (chain-state-entity-registry state) entity-id #f))
  (if record (entity-record-entity-number record) #f))

(define/contract (get-events state [event-type #f])
  (->* (chain-state?) ((or/c symbol? #f)) (listof event-log?))

  (define events (reverse (chain-state-events state))) ; Chronological order
  (if event-type
      (filter (lambda (e) (eq? (event-log-type e) event-type)) events)
      events))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
