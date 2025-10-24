#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Bilateral Consensus - Account Layer
;; ═══════════════════════════════════════════════════════════════════
;;
;; Implements bilateral (2-of-2) consensus between two entities.
;; Based on TypeScript runtime/account-consensus.ts patterns.
;;
;; States: idle → pending → committed
;; Transitions:
;;   propose: Create frame from mempool, sign it
;;   ack: Receive counterparty signature, commit frame
;;   simultaneous: Both propose → left wins (deterministic tiebreaker)
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/match
         "../../core/crypto.rkt"
         "../../core/rlp.rkt"
         "../../core/merkle.rkt")

(provide (struct-out account-machine)
         (struct-out account-tx)
         (struct-out account-frame)
         (struct-out account-input)

         create-account-machine
         propose-frame
         handle-account-input
         is-left?
         derive-channel-key)

;; ─────────────────────────────────────────────────────────────────
;; Data Types
;; ─────────────────────────────────────────────────────────────────

;; Account transaction
(struct account-tx (type data) #:transparent)

;; Account frame (like TypeScript AccountFrame)
(struct account-frame (
  height              ; Frame number
  timestamp           ; Unix milliseconds
  prev-frame-hash     ; Chain linkage
  account-txs         ; List of account-tx
  token-ids           ; List of token IDs
  deltas              ; List of delta sums (ondelta + offdelta)
  state-hash          ; Keccak256 of frame
) #:transparent)

;; Account machine state
(struct account-machine (
  entity-id           ; Our entity ID
  counterparty-id     ; Their entity ID
  height              ; Current height
  mempool             ; List of pending account-tx
  pending-frame       ; Frame waiting for ACK (or #f)
  current-frame       ; Last committed frame (or #f)
  deltas              ; Map<token-id, delta>
  counter             ; Message counter (replay protection)
  sent-transitions    ; Number of txs sent in pending frame
) #:mutable #:transparent)

;; Account input message (bilateral communication)
(struct account-input (
  from-entity-id
  to-entity-id
  height
  new-account-frame   ; Proposed frame (or #f)
  new-signatures      ; Our signature on proposed frame
  prev-signatures     ; Their signature on our pending frame (ACK)
  counter             ; Message counter
) #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; Account Machine Creation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-account-machine entity-id counterparty-id)
  (-> string? string? account-machine?)
  (account-machine
   entity-id
   counterparty-id
   0                           ; Initial height
   '()                         ; Empty mempool
   #f                          ; No pending frame
   #f                          ; No current frame
   (make-hash)                 ; Empty deltas map
   0                           ; Initial counter
   0))                         ; No sent transitions

;; ─────────────────────────────────────────────────────────────────
;; Helper Functions
;; ─────────────────────────────────────────────────────────────────

;; Check if we're the left entity (canonical ordering)
(define/contract (is-left? entity-id counterparty-id)
  (-> string? string? boolean?)
  (string<? entity-id counterparty-id))

;; Compute frame hash (RLP encode → SHA256)
(define/contract (compute-frame-hash frame)
  (-> account-frame? bytes?)
  (define frame-data
    (list
     (account-frame-height frame)
     (account-frame-timestamp frame)
     (account-frame-prev-frame-hash frame)  ; Already bytes
     ;; Encode transactions
     (map (lambda (tx)
            (list (string->bytes/utf-8 (account-tx-type tx))
                  (account-tx-data tx)))
          (account-frame-account-txs frame))
     ;; Token IDs and deltas (as integers)
     (account-frame-token-ids frame)
     (account-frame-deltas frame)))

  (define frame-rlp (rlp-encode frame-data))
  (sha256 frame-rlp))

;; ─────────────────────────────────────────────────────────────────
;; Frame Proposal (like TypeScript proposeAccountFrame)
;; ─────────────────────────────────────────────────────────────────

(define/contract (propose-frame machine timestamp)
  (-> account-machine? exact-nonnegative-integer? (or/c account-input? #f))

  (cond
    [(null? (account-machine-mempool machine))
     (displayln "[X] No transactions in mempool")
     #f]

    [(account-machine-pending-frame machine)
     (displayln "[WAIT] Waiting for ACK on pending frame")
     #f]

    [else
     (displayln (format "[OK] Creating frame with ~a transactions"
                        (length (account-machine-mempool machine))))

     (define prev-hash
       (if (= (account-machine-height machine) 0)
           #"genesis"  ; Use bytes for genesis too
           (account-frame-state-hash (account-machine-current-frame machine))))

     (define new-height (+ (account-machine-height machine) 1))

     (define new-frame
       (account-frame
        new-height
        timestamp
        prev-hash
        (account-machine-mempool machine)
        '()           ; Token IDs (empty for MVP)
        '()           ; Deltas (empty for MVP)
        #""))         ; State hash (computed below)

     (define state-hash (compute-frame-hash new-frame))
     (define frame-with-hash
       (struct-copy account-frame new-frame [state-hash state-hash]))

     (set-account-machine-pending-frame! machine frame-with-hash)
     (set-account-machine-sent-transitions! machine (length (account-machine-mempool machine)))
     (set-account-machine-mempool! machine '())

     (define new-counter (+ (account-machine-counter machine) 1))
     (set-account-machine-counter! machine new-counter)

     (displayln (format "[LAUNCH] Proposed frame ~a with ~a transactions"
                        new-height
                        (length (account-frame-account-txs frame-with-hash))))

     (account-input
      (account-machine-entity-id machine)
      (account-machine-counterparty-id machine)
      new-height
      frame-with-hash
      (list state-hash)
      '()
      new-counter)]))

;; ─────────────────────────────────────────────────────────────────
;; Handle Account Input (like TypeScript handleAccountInput)
;; ─────────────────────────────────────────────────────────────────

(define/contract (handle-account-input machine input timestamp)
  (-> account-machine? account-input? exact-nonnegative-integer?
      (or/c account-input? #f))

  (displayln (format "[MAIL] Received AccountInput from ~a"
                     (account-input-from-entity-id input)))

  (define expected-counter (+ (account-machine-counter machine) 1))

  (cond
    ;; Replay check failed
    [(not (= (account-input-counter input) expected-counter))
     (displayln (format "[X] Replay attack: counter ~a vs expected ~a"
                        (account-input-counter input)
                        expected-counter))
     #f]

    ;; Valid counter - process message
    [else
     (set-account-machine-counter! machine (account-input-counter input))

     ;; Check for ACK
     (define ack-handled?
       (and (account-machine-pending-frame machine)
            (not (null? (account-input-prev-signatures input)))
            (let* ([pending (account-machine-pending-frame machine)]
                   [their-sig (car (account-input-prev-signatures input))]
                   [our-hash (account-frame-state-hash pending)])
              (when (and (= (account-input-height input) (account-frame-height pending))
                         (equal? their-sig our-hash))
                (displayln "[LOCK] COMMIT: Frame signed by both parties")
                (set-account-machine-current-frame! machine pending)
                (set-account-machine-height! machine (account-frame-height pending))
                (set-account-machine-pending-frame! machine #f)
                (set-account-machine-sent-transitions! machine 0)
                (displayln (format "[OK] Frame ~a committed" (account-input-height input))))
              #t)))

     ;; If ACK only (no new frame), we're done
     (if (and ack-handled? (not (account-input-new-account-frame input)))
         #f
         ;; Handle new frame proposal
         (if (account-input-new-account-frame input)
             (let* ([received-frame (account-input-new-account-frame input)]
                    [expected-prev-hash
                     (if (= (account-machine-height machine) 0)
                         #"genesis"
                         (account-frame-state-hash (account-machine-current-frame machine)))])
               (cond
                 ;; Chain broken
                 [(not (equal? (account-frame-prev-frame-hash received-frame) expected-prev-hash))
                  (displayln "[X] Frame chain broken")
                  #f]

                 ;; Simultaneous proposals - left wins
                 [(and (account-machine-pending-frame machine)
                       (= (account-frame-height received-frame)
                          (account-frame-height (account-machine-pending-frame machine))))
                  (displayln "[ANTICLOCKWISE] SIMULTANEOUS-PROPOSALS")
                  (if (is-left? (account-machine-entity-id machine)
                               (account-machine-counterparty-id machine))
                      (begin
                        (displayln "[OK] We are LEFT, we win")
                        #f)
                      (begin
                        (displayln "[ANTICLOCKWISE] We are RIGHT, rolling back")
                        (set-account-machine-mempool! machine
                                                     (account-frame-account-txs (account-machine-pending-frame machine)))
                        (set-account-machine-pending-frame! machine #f)
                        ;; Fall through to sign their frame
                        (let ([frame-hash (account-frame-state-hash received-frame)]
                              [our-signature (account-frame-state-hash received-frame)])
                          (displayln (format "[OK] Signing frame ~a" (account-frame-height received-frame)))
                          (account-input
                           (account-machine-entity-id machine)
                           (account-machine-counterparty-id machine)
                           (account-frame-height received-frame)
                           #f
                           '()
                           (list our-signature)
                           (+ (account-machine-counter machine) 1)))))]

                 ;; Normal case - sign their frame
                 [else
                  (displayln "[OK] Frame chain verified")
                  (define frame-hash (account-frame-state-hash received-frame))
                  (define our-signature frame-hash)
                  (displayln (format "[OK] Signing frame ~a" (account-frame-height received-frame)))
                  (account-input
                   (account-machine-entity-id machine)
                   (account-machine-counterparty-id machine)
                   (account-frame-height received-frame)
                   #f
                   '()
                   (list our-signature)
                   (+ (account-machine-counter machine) 1))]))
             ;; No new frame
             #f))]))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
