#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN BFT Entity Consensus - Byzantine Fault Tolerant State Machine
;; ═══════════════════════════════════════════════════════════════════
;;
;; Implements Byzantine Fault Tolerant (BFT) consensus among validators.
;; Based on TypeScript runtime/entity-consensus.ts patterns.
;;
;; States: idle → propose → precommit → commit
;; Transitions:
;;   Non-proposer: Forward txs to proposer
;;   Proposer: Create frame, broadcast
;;   Validators: Lock frame, send precommit to proposer
;;   Proposer: Collect precommits, check quorum (≥2/3), commit
;;   All: Apply committed frame
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/match
         racket/list
         "../../core/crypto.rkt"
         "../../core/rlp.rkt"
         "../../core/merkle.rkt")

(provide (struct-out consensus-config)
         (struct-out entity-state)
         (struct-out proposed-entity-frame)
         (struct-out entity-replica)
         (struct-out entity-tx)
         (struct-out entity-input)

         create-entity-replica
         propose-entity-frame
         handle-entity-input
         calculate-quorum-power)

;; ─────────────────────────────────────────────────────────────────
;; Data Types
;; ─────────────────────────────────────────────────────────────────

;; Consensus configuration (validators, voting power, threshold)
(struct consensus-config (
  mode              ; 'proposer-based or 'gossip-based
  threshold         ; Minimum shares needed for quorum (≥2/3 of total)
  validators        ; List of validator IDs (first is proposer)
  shares            ; Hash table: validatorId → voting power
) #:transparent)

;; Entity state (committed state at current height)
(struct entity-state (
  entity-id         ; Entity ID this state belongs to
  height            ; Current height
  timestamp         ; Unix milliseconds
  nonces            ; Hash table: signerId → nonce
  messages          ; List of strings (chat messages)
  config            ; consensus-config
) #:transparent)

;; Proposed entity frame (what's being voted on)
(struct proposed-entity-frame (
  height            ; Frame height
  txs               ; List of entity-tx
  hash              ; Frame hash (RLP + SHA256)
  new-state         ; Entity-state after applying txs
  signatures        ; Hash table: signerId → signature
) #:transparent)

;; Entity replica (validator state)
(struct entity-replica (
  entity-id         ; Entity being validated
  signer-id         ; This validator's ID
  state             ; Current committed entity-state
  mempool           ; List of pending entity-tx
  proposal          ; Current proposed-entity-frame (or #f)
  locked-frame      ; Frame locked to (CometBFT locking) (or #f)
  is-proposer       ; Boolean - are we the proposer?
) #:mutable #:transparent)

;; Entity transaction
(struct entity-tx (
  type              ; Transaction type ("message", "vote", etc.)
  data              ; Transaction data (bytes/integers/lists for RLP)
) #:transparent)

;; Entity input message (BFT communication)
(struct entity-input (
  entity-id         ; Entity ID
  signer-id         ; Sender's validator ID
  entity-txs        ; List of entity-tx (or #f)
  proposed-frame    ; Proposed-entity-frame (or #f)
  precommits        ; Hash table: signerId → signature (or #f)
) #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; Entity Replica Creation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-entity-replica entity-id signer-id validators shares threshold)
  (-> string? string? (listof string?) hash? exact-nonnegative-integer? entity-replica?)

  (define config
    (consensus-config
     'proposer-based
     threshold
     validators
     shares))

  (define initial-state
    (entity-state
     entity-id
     0                    ; Initial height
     0                    ; Initial timestamp
     (make-hash)          ; Empty nonces
     '()                  ; Empty messages
     config))

  (define is-proposer (equal? signer-id (car validators)))

  (entity-replica
   entity-id
   signer-id
   initial-state
   '()                    ; Empty mempool
   #f                     ; No proposal
   #f                     ; No locked frame
   is-proposer))

;; ─────────────────────────────────────────────────────────────────
;; Helper Functions
;; ─────────────────────────────────────────────────────────────────

;; Calculate quorum power (sum of shares for given signers)
(define/contract (calculate-quorum-power config signers)
  (-> consensus-config? (listof string?) exact-nonnegative-integer?)

  (foldl (lambda (signer-id total)
           (define shares (hash-ref (consensus-config-shares config) signer-id #f))
           (cond
             [(not shares)
              (error 'calculate-quorum-power "Unknown validator: ~a" signer-id)]
             [else
              (+ total shares)]))
         0
         signers))

;; Compute entity frame hash (RLP encode → SHA256)
(define/contract (compute-entity-frame-hash frame)
  (-> proposed-entity-frame? bytes?)

  (define frame-data
    (list
     (proposed-entity-frame-height frame)
     ;; Encode transactions
     (map (lambda (tx)
            (list (string->bytes/utf-8 (entity-tx-type tx))
                  (entity-tx-data tx)))
          (proposed-entity-frame-txs frame))
     ;; Frame hash and signatures omitted (computed after)
     ))

  (define frame-rlp (rlp-encode frame-data))
  (sha256 frame-rlp))

;; ─────────────────────────────────────────────────────────────────
;; Frame Proposal (Proposer creates frame from mempool)
;; ─────────────────────────────────────────────────────────────────

(define/contract (propose-entity-frame replica timestamp)
  (-> entity-replica? exact-nonnegative-integer? (or/c entity-input? #f))

  (cond
    [(not (entity-replica-is-proposer replica))
     (displayln "[X] Not proposer, cannot propose frame")
     #f]

    [(null? (entity-replica-mempool replica))
     (displayln "[X] No transactions in mempool")
     #f]

    [(entity-replica-proposal replica)
     (displayln "[WAIT] Waiting for current proposal to commit")
     #f]

    [else
     (displayln (format "[OK] Proposer creating frame with ~a transactions"
                        (length (entity-replica-mempool replica))))

     (define current-state (entity-replica-state replica))
     (define new-height (+ (entity-state-height current-state) 1))

     ;; Apply transactions to compute new state
     ;; (Simplified for MVP - just copy state, real impl would process txs)
     (define new-state
       (struct-copy entity-state current-state
                    [height new-height]
                    [timestamp timestamp]))

     (define proposed-frame
       (proposed-entity-frame
        new-height
        (entity-replica-mempool replica)
        #""                       ; Hash computed below
        new-state
        (make-hash)))             ; Empty signatures initially

     (define frame-hash (compute-entity-frame-hash proposed-frame))
     (define frame-with-hash
       (struct-copy proposed-entity-frame proposed-frame
                    [hash frame-hash]))

     ;; Set proposal and clear mempool
     (set-entity-replica-proposal! replica frame-with-hash)
     (set-entity-replica-mempool! replica '())

     (displayln (format "[LAUNCH] Proposed frame ~a with ~a transactions"
                        new-height
                        (length (proposed-entity-frame-txs frame-with-hash))))

     ;; Proposer signs their own proposal immediately
     (define proposer-signature
       (bytes-append #"sig_"
                     (string->bytes/utf-8 (entity-replica-signer-id replica))
                     #"_"
                     frame-hash))

     (hash-set! (proposed-entity-frame-signatures frame-with-hash)
                (entity-replica-signer-id replica)
                proposer-signature)

     ;; Broadcast proposal to all validators
     (entity-input
      (entity-replica-entity-id replica)
      (entity-replica-signer-id replica)
      '()                         ; No txs in broadcast
      frame-with-hash             ; The proposed frame
      #f)]))                      ; No precommits yet

;; ─────────────────────────────────────────────────────────────────
;; Handle Entity Input (Main BFT processor)
;; ─────────────────────────────────────────────────────────────────

(define/contract (handle-entity-input replica input timestamp)
  (-> entity-replica? entity-input? exact-nonnegative-integer?
      (listof entity-input?))

  (displayln (format "[MAIL] Received EntityInput from ~a"
                     (entity-input-signer-id input)))

  (define outbox '())

  ;; Add transactions to mempool
  (when (and (entity-input-entity-txs input)
             (not (null? (entity-input-entity-txs input))))
    (displayln (format "[OK] Adding ~a txs to mempool"
                       (length (entity-input-entity-txs input))))
    (set-entity-replica-mempool! replica
                                 (append (entity-replica-mempool replica)
                                         (entity-input-entity-txs input))))

  ;; If not proposer and have txs, forward to proposer
  (when (and (not (entity-replica-is-proposer replica))
             (not (null? (entity-replica-mempool replica))))
    (define proposer-id (car (consensus-config-validators
                              (entity-state-config (entity-replica-state replica)))))
    (displayln (format "[RIGHTWARDS] Forwarding ~a txs to proposer ~a"
                       (length (entity-replica-mempool replica))
                       proposer-id))
    (set! outbox
          (cons (entity-input
                 (entity-replica-entity-id replica)
                 proposer-id
                 (entity-replica-mempool replica)
                 #f
                 #f)
                outbox))
    (set-entity-replica-mempool! replica '()))

  ;; Handle proposed frame (PROPOSE phase)
  (when (and (entity-input-proposed-frame input)
             (not (entity-replica-proposal replica)))
    (define frame (entity-input-proposed-frame input))
    (displayln (format "[OK] Received proposal for frame ~a"
                       (proposed-entity-frame-height frame)))

    ;; Lock to this frame (CometBFT locking)
    (set-entity-replica-locked-frame! replica frame)

    ;; Create precommit signature
    (define frame-signature
      (bytes-append #"sig_"
                    (string->bytes/utf-8 (entity-replica-signer-id replica))
                    #"_"
                    (proposed-entity-frame-hash frame)))

    ;; Send precommit to proposer
    (define config (entity-state-config (entity-replica-state replica)))
    (define proposer-id (car (consensus-config-validators config)))

    (displayln (format "[LOCK] Locked to frame, sending precommit to ~a" proposer-id))

    (define precommits (make-hash))
    (hash-set! precommits (entity-replica-signer-id replica) frame-signature)

    (set! outbox
          (cons (entity-input
                 (entity-replica-entity-id replica)
                 proposer-id
                 '()
                 #f
                 precommits)
                outbox)))

  ;; Handle precommits (PRECOMMIT collection phase)
  ;; Proposer: has proposal, collects precommits
  ;; Non-proposer: has locked-frame, receives commit notification
  (when (and (entity-input-precommits input)
             (or (entity-replica-proposal replica)
                 (entity-replica-locked-frame replica)))
    (define proposal (or (entity-replica-proposal replica)
                        (entity-replica-locked-frame replica)))
    (define config (entity-state-config (entity-replica-state replica)))

    ;; Collect signatures
    (for ([(signer-id signature) (entity-input-precommits input)])
      (hash-set! (proposed-entity-frame-signatures proposal)
                 signer-id
                 signature))

    (displayln (format "[OK] Collected precommits, total signatures: ~a"
                       (hash-count (proposed-entity-frame-signatures proposal))))

    ;; Check quorum
    (define signers (hash-keys (proposed-entity-frame-signatures proposal)))
    (define total-power (calculate-quorum-power config signers))
    (define threshold (consensus-config-threshold config))

    (displayln (format "[FIND] Quorum check: ~a / ~a threshold"
                       total-power
                       threshold))

    (when (>= total-power threshold)
      (displayln "[LOCK] COMMIT: Quorum reached, committing frame!")

      ;; Apply new state (already has correct height from proposal)
      (define committed-state (proposed-entity-frame-new-state proposal))
      (set-entity-replica-state! replica committed-state)

      ;; Clear proposal state
      (set-entity-replica-proposal! replica #f)
      (set-entity-replica-locked-frame! replica #f)
      (set-entity-replica-mempool! replica '())

      (displayln (format "[OK] Frame committed, new height: ~a"
                         (entity-state-height (entity-replica-state replica))))

      ;; Send commit notifications to other validators
      (define committed-frame (entity-input-proposed-frame input))
      (for ([validator-id (consensus-config-validators config)])
        (when (not (equal? validator-id (entity-replica-signer-id replica)))
          (displayln (format "[RIGHTWARDS] Sending commit notification to ~a" validator-id))
          (set! outbox
                (cons (entity-input
                       (entity-replica-entity-id replica)
                       validator-id
                       '()
                       committed-frame
                       (entity-input-precommits input))
                      outbox))))))

  outbox)

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
