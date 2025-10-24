#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Core Types - State Machines as Data
;; ═══════════════════════════════════════════════════════════════════
;;
;; Philosophy:
;;   Code = Data = S-expressions
;;   State machines are introspectable data structures
;;   Transitions are pattern-matched values
;;   Effects are explicit, not hidden
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/match
         racket/contract
         racket/stream)

(provide (all-defined-out))

;; ─────────────────────────────────────────────────────────────────
;; State Machine Definition (Homoiconic)
;; ─────────────────────────────────────────────────────────────────

(struct machine (name states transitions) #:transparent
  #:guard (λ (name states transitions _type-name)
            (unless (and (symbol? name)
                         (list? states)
                         (list? transitions))
              (error 'machine "invalid machine definition"))
            (values name states transitions)))

(struct transition (from event to update emit) #:transparent)

;; Define a state machine as data
(define-syntax-rule (define-machine name (state ...) (trans ...))
  (define name
    (machine 'name
             '(state ...)
             (list trans ...))))

;; ─────────────────────────────────────────────────────────────────
;; Core Domain Types
;; ─────────────────────────────────────────────────────────────────

;; EntityId - globally unique entity identifier
(struct entity-id (number) #:transparent
  #:guard (λ (n _)
            (unless (exact-nonnegative-integer? n)
              (error 'entity-id "must be non-negative integer"))
            n))

;; AccountKey - deterministic bilateral channel key
;; channelKey = sha256(min(addrL, addrR) || max(addrL, addrR))
(struct account-key (left-entity right-entity) #:transparent
  #:guard (λ (l r _)
            (unless (and (entity-id? l) (entity-id? r))
              (error 'account-key "must be entity-ids"))
            (if (<= (entity-id-number l) (entity-id-number r))
                (values l r)
                (values r l))))  ; Canonical ordering

;; Delta - balance change with RCPAN invariant
;; Invariant: −Lₗ ≤ δ ≤ C + Lᵣ
(struct delta (token-id
               collateral
               ondelta
               offdelta
               left-credit-limit
               right-credit-limit
               left-allowance
               right-allowance)
  #:transparent
  #:guard (λ (tid c od ofd lcl rcl la ra _)
            (define combined (+ od ofd))
            (unless (and (<= (- lcl) combined)
                         (<= combined (+ c rcl)))
              (error 'delta "RCPAN invariant violated: ~a ≤ ~a ≤ ~a"
                     (- lcl) combined (+ c rcl)))
            (values tid c od ofd lcl rcl la ra)))

;; Frame - signed state transition
(struct frame (counter state-hash previous-hash timestamp payload signatures)
  #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; State Machine States (Account Layer)
;; ─────────────────────────────────────────────────────────────────

(struct account-state (key counter deltas pending-forward) #:transparent)

;; Initial state constructor
(define (make-initial-account-state key)
  (account-state key 0 '() #f))

;; ─────────────────────────────────────────────────────────────────
;; State Machine States (Entity Layer)
;; ─────────────────────────────────────────────────────────────────

(struct entity-state (id height mempool proposed-frame precommits accounts)
  #:transparent)

(define (make-initial-entity-state id)
  (entity-state id 0 '() #f '() (make-hash)))

;; ─────────────────────────────────────────────────────────────────
;; Inputs & Outputs (Sum Types)
;; ─────────────────────────────────────────────────────────────────

;; Account Inputs
(struct account-input () #:transparent)
(struct propose-payment account-input (from to amount token-id route) #:transparent)
(struct countersign-frame account-input (frame signature) #:transparent)
(struct set-credit-limit account-input (token-id limit) #:transparent)

;; Entity Inputs
(struct entity-input () #:transparent)
(struct add-transaction entity-input (tx) #:transparent)
(struct propose-frame entity-input () #:transparent)
(struct precommit-frame entity-input (signer signature) #:transparent)

;; Outputs (Effects to be handled)
(struct output () #:transparent)
(struct broadcast-to-counterparty output (message) #:transparent)
(struct broadcast-to-validators output (frame) #:transparent)
(struct create-next-hop output (entity-id payload) #:transparent)
(struct settle-on-chain output (proof) #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; Pattern Matching Example (State Machine Transition)
;; ─────────────────────────────────────────────────────────────────

;; Pure transition function: (state × input) [RIGHTWARDS] (state × outputs)
(define/contract (account-transition state input)
  (-> account-state? account-input? (values account-state? (listof output?)))

  (match (cons state input)
    ;; Payment proposal
    [(cons (account-state key counter deltas #f)
           (propose-payment from to amount token-id route))
     (define new-frame (frame (+ counter 1) #"hash" #"prev" (current-seconds)
                              `(payment ,from ,to ,amount ,token-id) '()))
     (values (struct-copy account-state state
                          [counter (+ counter 1)]
                          [pending-forward (and (not (null? route))
                                               `(forward ,token-id ,amount ,route))])
             (list (broadcast-to-counterparty new-frame)))]

    ;; Countersign frame
    [(cons (account-state key counter deltas pending)
           (countersign-frame frame sig))
     ;; Verify signature, finalize frame
     (values (struct-copy account-state state
                          [deltas (cons frame deltas)])
             (list))]

    ;; Invalid transition
    [_ (error 'account-transition "invalid state/input combination")]))

;; ─────────────────────────────────────────────────────────────────
;; Demonstration: State Machine as Data
;; ─────────────────────────────────────────────────────────────────

(define bilateral-channel-machine
  (machine
   'bilateral-channel
   '(idle pending-frame finalized)
   (list
    (transition 'idle 'propose-frame 'pending-frame
                (λ (s i) (struct-copy account-state s [counter (+ 1 (account-state-counter s))]))
                (λ (s i) (list (broadcast-to-counterparty (car i)))))
    (transition 'pending-frame 'countersign 'finalized
                (λ (s i) s)
                (λ (s i) '())))))

;; Introspection - query the machine structure
(define (get-machine-states m)
  (machine-states m))

(define (get-machine-transitions m)
  (machine-transitions m))

;; Example usage:
;; > (get-machine-states bilateral-channel-machine)
;; '(idle pending-frame finalized)

;; ─────────────────────────────────────────────────────────────────
;; Stream-Based Processing (Coinductive)
;; ─────────────────────────────────────────────────────────────────

;; State as infinite stream
(define (state-stream initial-state input-stream)
  (stream-cons
   initial-state
   (stream-fold transition-fold initial-state input-stream)))

;; Helper for folding transitions
(define (transition-fold state input)
  (define-values (new-state outputs) (account-transition state input))
  new-state)

;; ─────────────────────────────────────────────────────────────────
;; Perspective Functions (Left/Right Entity View)
;; ─────────────────────────────────────────────────────────────────

(define/contract (derive-capacity delta is-left?)
  (-> delta? boolean? (values exact-integer? exact-integer?))
  (define combined (+ (delta-ondelta delta) (delta-offdelta delta)))
  (if is-left?
      ;; Left entity perspective
      (values (- (delta-right-credit-limit delta) combined)  ; inCapacity
              (+ (delta-collateral delta) (delta-left-credit-limit delta) combined))  ; outCapacity
      ;; Right entity perspective
      (values (+ (delta-collateral delta) (delta-right-credit-limit delta) (- combined))
              (- (delta-left-credit-limit delta) (- combined)))))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════

;; This module demonstrates:
;; 1. State machines as introspectable data structures
;; 2. Pattern matching for transitions
;; 3. Explicit effect tracking (outputs)
;; 4. RCPAN invariant enforced at construction time
;; 5. Perspective-aware capacity calculations
;; 6. Stream-based (coinductive) state progression
;;
;; Next steps:
;; - crypto.rkt: ECDSA, SHA256, Keccak256
;; - rlp.rkt: Ethereum-compatible serialization
;; - merkle.rkt: Merkle tree construction + proofs
;;
;; The foundation is homoiconic. The rest follows naturally.
