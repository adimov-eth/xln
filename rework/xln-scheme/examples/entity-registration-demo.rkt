#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Entity Registration Demo - Real On-Chain Registration
;; ═══════════════════════════════════════════════════════════════════

(require "../blockchain/rpc.rkt"
         "../blockchain/abi.rkt"
         "../core/crypto.rkt")

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Entity Registration via Real Blockchain")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")

;; Contract addresses
(define entity-provider "0x5FbDB2315678afecb367f032d93F642f64180aa3")
(define test-account "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")  ; Hardhat default

;; Helper: bytes to hex string
(define (bytes->hex b)
  (string-append "0x"
                 (apply string-append
                        (for/list ([byte (bytes->list b)])
                          (format "~a" (~r byte #:base 16 #:min-width 2 #:pad-string "0"))))))

(displayln "=== Step 1: Create Board Hash ===")
(define board-hash (make-bytes 32 42))  ; Simple board hash for testing
(displayln (format "[OK] Board hash: ~a" (bytes->hex board-hash)))
(displayln "")

(displayln "=== Step 2: Encode Registration Call ===")
(define call-data (encode-register-numbered-entity board-hash))
(displayln (format "[OK] Call data: ~a" (bytes->hex call-data)))
(displayln (format "[OK] Length: ~a bytes" (bytes-length call-data)))
(displayln "")

(displayln "=== Step 3: Register Entity (eth_sendTransaction) ===")
(define tx-object
  (hasheq 'from test-account
          'to entity-provider
          'data (bytes->hex call-data)
          'gas "0x100000"))  ; 1M gas

(displayln "[FIND] Sending transaction...")
(displayln (format "  From: ~a" test-account))
(displayln (format "  To: ~a" entity-provider))

(with-handlers ([exn:fail? (lambda (e)
                              (displayln (format "[X] Transaction failed: ~a" (exn-message e)))
                              (displayln "[IDEA] This might need transaction signing (not implemented yet)"))])
  (define tx-hash (eth-send-transaction tx-object))
  (displayln (format "[OK] Transaction hash: ~a" tx-hash))
  (displayln "")

  (displayln "=== Step 4: Wait for Receipt ===")
  (sleep 2)
  (define receipt (eth-get-transaction-receipt tx-hash))
  (displayln (format "[OK] Receipt: ~a" receipt))
  (displayln "")

  (displayln "[OK] Entity registered on-chain!"))

(displayln "")
(displayln "λ.")
