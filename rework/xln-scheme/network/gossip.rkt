#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Gossip Layer - CRDT Lattice for Entity Profiles
;; ═══════════════════════════════════════════════════════════════════
;;
;; Implements timestamp-based CRDT for profile propagation.
;; Profiles announce entity capabilities, fees, and account capacities.
;;
;; Profile Structure:
;;   (profile entity-id capabilities hubs metadata accounts timestamp)
;;
;; Where:
;;   - entity-id: string identifier
;;   - capabilities: (listof string) e.g. ("router" "swap:memecoins")
;;   - hubs: (listof string) connected hub entity-ids
;;   - metadata: hash with name, avatar, fees, region, etc.
;;   - accounts: (listof account-capacity) for routing
;;   - timestamp: unix-ms for CRDT convergence
;;
;; CRDT Property: Newer timestamp wins (last-write-wins)
;;
;; Usage:
;;   (define layer (create-gossip-layer))
;;   (gossip-announce! layer profile)
;;   (gossip-get-profiles layer)
;;   (gossip-get-profile layer "alice")
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/hash
         racket/list
         racket/format)

(provide (struct-out profile)
         (struct-out account-capacity)
         (struct-out gossip-layer)
         create-gossip-layer
         gossip-announce!
         gossip-get-profiles
         gossip-get-profile
         gossip-layer-profiles)

;; ─────────────────────────────────────────────────────────────────
;; Data Structures
;; ─────────────────────────────────────────────────────────────────

(struct account-capacity (counterparty-id token-capacities) #:transparent)
;; token-capacities: hash tokenId → (in-capacity . out-capacity)

(struct profile (entity-id
                 capabilities
                 hubs
                 metadata
                 accounts
                 timestamp) #:transparent)

(struct gossip-layer (profiles) #:mutable #:transparent)
;; profiles: hash entity-id → profile

;; ─────────────────────────────────────────────────────────────────
;; Gossip Layer Creation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-gossip-layer)
  (-> gossip-layer?)

  (gossip-layer (make-hash)))

;; ─────────────────────────────────────────────────────────────────
;; Profile Announcement (CRDT Update)
;; ─────────────────────────────────────────────────────────────────

(define/contract (gossip-announce! layer prof)
  (-> gossip-layer? profile? void?)

  (define entity-id (profile-entity-id prof))
  (define new-timestamp (profile-timestamp prof))
  (define existing (hash-ref (gossip-layer-profiles layer) entity-id #f))

  (cond
    [(not existing)
     ;; No existing profile - accept
     (hash-set! (gossip-layer-profiles layer) entity-id prof)
     (displayln (format "[ANTENNA] Gossip added ~a (timestamp: ~a)" entity-id new-timestamp))]

    [(> new-timestamp (profile-timestamp existing))
     ;; Newer timestamp - update
     (hash-set! (gossip-layer-profiles layer) entity-id prof)
     (displayln (format "[ANTENNA] Gossip updated ~a (timestamp: ~a)" entity-id new-timestamp))]

    [else
     ;; Older timestamp - ignore
     (displayln (format "[ANTENNA] Gossip ignored older update for ~a (~a <= ~a)"
                        entity-id
                        new-timestamp
                        (profile-timestamp existing)))]))

;; ─────────────────────────────────────────────────────────────────
;; Profile Queries
;; ─────────────────────────────────────────────────────────────────

(define/contract (gossip-get-profiles layer)
  (-> gossip-layer? (listof profile?))

  (hash-values (gossip-layer-profiles layer)))

(define/contract (gossip-get-profile layer entity-id)
  (-> gossip-layer? string? (or/c profile? #f))

  (hash-ref (gossip-layer-profiles layer) entity-id #f))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
