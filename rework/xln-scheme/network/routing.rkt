#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Routing - PathFinder with Dijkstra + Capacity Constraints
;; ═══════════════════════════════════════════════════════════════════
;;
;; Implements payment routing using modified Dijkstra algorithm.
;; Finds optimal routes considering:
;;   - Channel capacity constraints
;;   - Fee calculations (baseFee + feePPM)
;;   - Backward fee accumulation (target → source)
;;   - Success probability based on utilization
;;
;; Network Graph:
;;   (network-graph nodes edges)
;;   - nodes: (setof string) entity-ids
;;   - edges: hash entity-id → (listof channel-edge)
;;
;; Channel Edge:
;;   (channel-edge from to token-id capacity base-fee fee-ppm disabled?)
;;
;; Payment Route:
;;   (payment-route path hops total-fee total-amount probability)
;;
;; Usage:
;;   (define graph (build-network-graph profiles token-id))
;;   (define routes (find-routes graph "alice" "charlie" 1000 token-id))
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/hash
         racket/list
         racket/set
         racket/match
         racket/format
         "gossip.rkt")

(provide (struct-out network-graph)
         (struct-out channel-edge)
         (struct-out payment-route)
         (struct-out hop-info)
         (struct-out queue-entry)
         build-network-graph
         find-routes
         get-edge)

;; ─────────────────────────────────────────────────────────────────
;; Data Structures
;; ─────────────────────────────────────────────────────────────────

(struct channel-edge (from to token-id capacity base-fee fee-ppm disabled?) #:transparent)

(struct network-graph (nodes edges) #:transparent)
;; nodes: (setof string)
;; edges: hash string → (listof channel-edge)

(struct hop-info (from to fee fee-ppm) #:transparent)

(struct payment-route (path hops total-fee total-amount probability) #:transparent)
;; path: (listof string) - entity-ids from source to target
;; hops: (listof hop-info) - per-hop details
;; total-fee: integer - sum of all fees
;; total-amount: integer - amount + fees
;; probability: real 0-1 - success estimate

(struct queue-entry (cost node path total-fee) #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; Graph Construction from Gossip Profiles
;; ─────────────────────────────────────────────────────────────────

(define/contract (build-network-graph profiles token-id)
  (-> (listof profile?) exact-nonnegative-integer? network-graph?)

  (define nodes (list->set (map profile-entity-id profiles)))
  (define edges (make-hash))

  ;; Build edges from profile accounts
  (for ([prof profiles])
    (define from-entity (profile-entity-id prof))
    (define from-edges '())

    (when (profile-accounts prof)
      (for ([account (profile-accounts prof)])
        (define to-entity (account-capacity-counterparty-id account))

        ;; Only add if counterparty exists in network
        (when (set-member? nodes to-entity)
          ;; Get capacities for this token
          (define token-caps (hash-ref (account-capacity-token-capacities account) token-id #f))

          (when (and token-caps (> (cdr token-caps) 0))
            ;; Extract fee configuration from metadata
            (define metadata (profile-metadata prof))
            (define base-fee (hash-ref metadata 'base-fee 0))
            (define fee-ppm (hash-ref metadata 'routing-fee-ppm 100)) ; Default 100 PPM (0.01%)

            ;; Create edge
            (define edge (channel-edge from-entity
                                       to-entity
                                       token-id
                                       (cdr token-caps) ; out-capacity
                                       base-fee
                                       fee-ppm
                                       #f)) ; not disabled

            (set! from-edges (cons edge from-edges))))))

    (when (not (null? from-edges))
      (hash-set! edges from-entity (reverse from-edges))))

  (network-graph nodes edges))

;; ─────────────────────────────────────────────────────────────────
;; Edge Lookup Helper
;; ─────────────────────────────────────────────────────────────────

(define/contract (get-edge graph from to token-id)
  (-> network-graph? string? string? exact-nonnegative-integer? (or/c channel-edge? #f))

  (define edges (hash-ref (network-graph-edges graph) from '()))
  (findf (lambda (e)
           (and (equal? (channel-edge-to e) to)
                (= (channel-edge-token-id e) token-id)))
         edges))

;; ─────────────────────────────────────────────────────────────────
;; Fee Calculation
;; ─────────────────────────────────────────────────────────────────

(define (calculate-fee edge amount)
  ;; Fee = baseFee + (amount * feePPM / 1,000,000)
  (+ (channel-edge-base-fee edge)
     (quotient (* amount (channel-edge-fee-ppm edge)) 1000000)))

;; ─────────────────────────────────────────────────────────────────
;; Required Amount Calculation (Backwards from Target)
;; ─────────────────────────────────────────────────────────────────

(define (calculate-required-amount graph final-amount path target token-id)
  ;; Work backwards from target to source, accumulating fees
  (define amount final-amount)

  (for ([i (in-range (- (length path) 1) 0 -1)])
    (define current-node (list-ref path i))
    (when (not (equal? current-node target))
      (define prev-node (list-ref path (- i 1)))
      (define edge (get-edge graph prev-node current-node token-id))

      (when edge
        ;; Add fee that this hop will charge
        (set! amount (+ amount (calculate-fee edge amount))))))

  amount)

;; ─────────────────────────────────────────────────────────────────
;; Success Probability Estimation
;; ─────────────────────────────────────────────────────────────────

(define (calculate-probability graph path amount token-id)
  ;; Probability decays exponentially with channel utilization
  (define prob 1.0)

  (for ([i (in-range (- (length path) 1))])
    (define from (list-ref path i))
    (define to (list-ref path (+ i 1)))
    (define edge (get-edge graph from to token-id))

    (when (and edge (> (channel-edge-capacity edge) 0))
      (define utilization (/ (exact->inexact amount)
                            (exact->inexact (channel-edge-capacity edge))))
      ;; Exponential decay: e^(-2 * utilization)
      (set! prob (* prob (exp (* -2 utilization))))))

  (max 0.01 (min 1.0 prob)))

;; ─────────────────────────────────────────────────────────────────
;; Route Building from Path
;; ─────────────────────────────────────────────────────────────────

(define (build-route graph path amount token-id)
  (if (< (length path) 2)
      #f
      (let ([hops '()]
            [total-fee 0]
            [current-amount amount])

        ;; Build hops forward, calculating fees
        (for ([i (in-range (- (length path) 1))])
          (define from (list-ref path i))
          (define to (list-ref path (+ i 1)))
          (define edge (get-edge graph from to token-id))

          (when (not edge)
            (error 'build-route "Missing edge: ~a → ~a" from to))

          (define fee (calculate-fee edge current-amount))
          (set! hops (cons (hop-info from to fee (channel-edge-fee-ppm edge)) hops))
          (set! total-fee (+ total-fee fee))
          (set! current-amount (+ current-amount fee)))

        ;; Calculate success probability
        (define prob (calculate-probability graph path amount token-id))

        (payment-route path
                       (reverse hops)
                       total-fee
                       (+ amount total-fee)
                       prob))))

;; ─────────────────────────────────────────────────────────────────
;; PathFinder - Modified Dijkstra
;; ─────────────────────────────────────────────────────────────────

(define/contract (find-routes graph source target amount token-id [max-routes 100])
  (->* (network-graph? string? string? exact-nonnegative-integer? exact-nonnegative-integer?)
       (exact-nonnegative-integer?)
       (listof payment-route?))

  ;; Early exits
  (cond
    ((equal? source target) '())
    ((not (set-member? (network-graph-nodes graph) source)) '())
    ((not (set-member? (network-graph-nodes graph) target)) '())
    (else
     (define routes '())
     (define visited (make-hash)) ; node → (setof prev-node)

     ;; Priority queue: sort by cost
     (define queue (list (queue-entry 0 source (list source) 0)))

     (let loop ()
       (when (and (not (null? queue)) (< (length routes) max-routes))
         ;; Sort queue by cost
         (set! queue (sort queue < #:key queue-entry-cost))
         (define current (car queue))
         (set! queue (cdr queue))

         ;; Check if visited from this previous node
         (define prev-node (if (>= (length (queue-entry-path current)) 2)
                               (list-ref (queue-entry-path current)
                                        (- (length (queue-entry-path current)) 2))
                               "START"))
         (define visited-from (hash-ref visited (queue-entry-node current) (set)))

         (unless (set-member? visited-from prev-node)
           (hash-set! visited (queue-entry-node current) (set-add visited-from prev-node))

           (cond
             ;; Found target - build route
             [(equal? (queue-entry-node current) target)
              (define route (build-route graph (queue-entry-path current) amount token-id))
              (when route
                (set! routes (cons route routes)))
              (loop)]

             ;; Explore neighbors
             [else
              (define edges (hash-ref (network-graph-edges graph) (queue-entry-node current) '()))

              (for ([edge edges])
                ;; Skip if wrong token or disabled
                (unless (or (not (= (channel-edge-token-id edge) token-id))
                           (channel-edge-disabled? edge)
                           ;; Skip if already in path (no loops)
                           (member (channel-edge-to edge) (queue-entry-path current)))

                  ;; Calculate required amount at this hop (working backwards)
                  (define required-amount
                    (calculate-required-amount graph
                                              amount
                                              (append (queue-entry-path current) (list (channel-edge-to edge)))
                                              target
                                              token-id))

                  ;; Skip if insufficient capacity
                  (when (<= required-amount (channel-edge-capacity edge))
                    ;; Calculate fee for this edge
                    (define edge-fee (calculate-fee edge required-amount))
                    (define new-total-fee (+ (queue-entry-total-fee current) edge-fee))

                    ;; Add to queue
                    (set! queue (cons (queue-entry new-total-fee
                                                   (channel-edge-to edge)
                                                   (append (queue-entry-path current) (list (channel-edge-to edge)))
                                                   new-total-fee)
                                     queue)))))
              (loop)])))

     ;; Sort routes by total fee
     (sort routes < #:key payment-route-total-fee)))))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
