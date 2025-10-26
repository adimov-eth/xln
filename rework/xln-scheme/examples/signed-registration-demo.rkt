#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Signed Entity Registration Demo
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates:
;; 1. ECDSA transaction signing via ethers.js
;; 2. Sending signed transactions to blockchain
;; 3. Registering entity on-chain with signatures
;; 4. Verifying registration via RPC
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../blockchain/rpc.rkt"
         "../blockchain/abi.rkt"
         "../blockchain/signing.rkt"
         json)

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Signed Entity Registration Demo")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")

;; Contract addresses
(define entity-provider "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9")

;; Hardhat test account
(define private-key "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
(define from-address "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")

;; Helper: bytes to hex
(define (bytes->hex b)
  (string-append "0x"
                 (apply string-append
                        (for/list ([byte (bytes->list b)])
                          (format "~a" (~r byte #:base 16 #:min-width 2 #:pad-string "0"))))))

;; Helper: hex to uint256
(define (hex->uint256 hex)
  (string->number (substring hex 2) 16))

;; ═══════════════════════════════════════════════════════════════════
;; Step 1: Get Current Nonce
;; ═══════════════════════════════════════════════════════════════════

(displayln "=== Step 1: Get Transaction Nonce ===")
(define nonce-hex (eth-get-transaction-count from-address "latest"))
(define nonce (hex->uint256 nonce-hex))
(displayln (format "[OK] Current nonce: ~a" nonce))
(displayln "")

;; ═══════════════════════════════════════════════════════════════════
;; Step 2: Encode Registration Call
;; ═══════════════════════════════════════════════════════════════════

(displayln "=== Step 2: Encode Registration Call ===")
(define board-hash (make-bytes 32 0))
(bytes-set! board-hash 31 #x42)  ; Board hash = 0x...42

(define call-data (encode-register-numbered-entity board-hash))
(displayln (format "[OK] Call data: ~a" (bytes->hex call-data)))
(displayln (format "[OK] Length: ~a bytes" (bytes-length call-data)))
(displayln "")

;; ═══════════════════════════════════════════════════════════════════
;; Step 3: Sign Transaction
;; ═══════════════════════════════════════════════════════════════════

(displayln "=== Step 3: Sign Transaction ===")

(define tx-params
  (hasheq 'to entity-provider
          'data (bytes->hex call-data)
          'gasLimit "0x100000"    ; 1M gas (use gasLimit for ethers.js)
          'gasPrice "0x3b9aca00"  ; 1 gwei
          'nonce (format "0x~a" (~r nonce #:base 16))
          'chainId "0x539"        ; 1337 (Hardhat)
          'value "0x0"))

(displayln "[FIND] Signing transaction...")
(define signed-tx (sign-transaction private-key tx-params))
(displayln (format "[OK] Signed tx: ~a..." (substring signed-tx 0 20)))
(displayln "")

;; ═══════════════════════════════════════════════════════════════════
;; Step 4: Send Raw Transaction
;; ═══════════════════════════════════════════════════════════════════

(displayln "=== Step 4: Send Signed Transaction ===")
(displayln "[FIND] Broadcasting to network...")

(with-handlers ([exn:fail? (lambda (e)
                             (displayln (format "[X] Failed: ~a" (exn-message e))))])
  (define tx-hash (eth-send-raw-transaction signed-tx))
  (displayln (format "[OK] Transaction hash: ~a" tx-hash))
  (displayln "")

  ;; Wait for mining
  (displayln "=== Step 5: Wait for Confirmation ===")
  (sleep 2)

  (define receipt (eth-get-transaction-receipt tx-hash))
  (displayln "[OK] Transaction mined!")
  (displayln (format "    Block: ~a" (hash-ref receipt 'blockNumber)))
  (displayln (format "    Gas used: ~a" (hash-ref receipt 'gasUsed)))
  (displayln (format "    Status: ~a" (hash-ref receipt 'status)))
  (displayln "")

  (displayln "═══════════════════════════════════════════════════════════")
  (displayln "  Entity registered on-chain via signed transaction!")
  (displayln "═══════════════════════════════════════════════════════════")
  (displayln "")
  (displayln "λ."))
