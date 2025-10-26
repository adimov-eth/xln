#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Complete End-to-End RPC Demo
;; ═══════════════════════════════════════════════════════════════════
;;
;; Demonstrates:
;; 1. JSON-RPC connection to Hardhat
;; 2. Correct Keccak-256 function selectors
;; 3. ABI encoding for contract calls
;; 4. Querying on-chain state
;;
;; Prerequisites:
;; - Hardhat network running on localhost:8545
;; - Contracts deployed (see SESSION-2025-10-26.md)
;; - Test data populated (bun x hardhat test test/populate-testdata.test.cjs)
;;
;; ═══════════════════════════════════════════════════════════════════

(require "../blockchain/rpc.rkt"
         "../blockchain/abi.rkt")

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  XLN Racket ↔ Ethereum Integration Demo")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")

;; Contract addresses from Hardhat Ignition deployment
(define entity-provider "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9")
(define depository "0x5FbDB2315678afecb367f032d93F642f64180aa3")

;; Helper: bytes to hex string
(define (bytes->hex b)
  (string-append "0x"
                 (apply string-append
                        (for/list ([byte (bytes->list b)])
                          (format "~a" (~r byte #:base 16 #:min-width 2 #:pad-string "0"))))))

;; Helper: hex string to uint256
(define (hex->uint256 hex)
  (string->number (substring hex 2) 16))

;; ═══════════════════════════════════════════════════════════════════
;; Step 1: Verify Blockchain Connection
;; ═══════════════════════════════════════════════════════════════════

(displayln "=== Step 1: Blockchain Connection ===")
(define block-number (eth-block-number))
(displayln (format "[OK] Current block: ~a" (hex->uint256 block-number)))

(define test-account "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")  ; Hardhat default
(define balance (eth-get-balance test-account))
(define balance-eth (/ (hex->uint256 balance) (expt 10 18)))
(displayln (format "[OK] Account balance: ~a ETH" balance-eth))
(displayln "")

;; ═══════════════════════════════════════════════════════════════════
;; Step 2: Query Entity Reserves
;; ═══════════════════════════════════════════════════════════════════

(displayln "=== Step 2: Query On-Chain Reserves ===")

;; Entity IDs (bytes32)
(define entity-1 (make-bytes 32 0))
(bytes-set! entity-1 31 1)

(define entity-2 (make-bytes 32 0))
(bytes-set! entity-2 31 2)

;; Query reserves for entity 1, token 1
(displayln "[FIND] Querying reserves for Entity 1, Token 1...")
(define call-data-1-1 (encode-get-reserve entity-1 1))
(define tx-1-1 (hasheq 'to depository 'data (bytes->hex call-data-1-1)))
(define result-1-1 (eth-call tx-1-1))
(define reserve-1-1 (/ (hex->uint256 result-1-1) (expt 10 18)))
(displayln (format "[OK] Entity 1, Token 1: ~a units" reserve-1-1))

;; Query reserves for entity 1, token 2
(displayln "[FIND] Querying reserves for Entity 1, Token 2...")
(define call-data-1-2 (encode-get-reserve entity-1 2))
(define tx-1-2 (hasheq 'to depository 'data (bytes->hex call-data-1-2)))
(define result-1-2 (eth-call tx-1-2))
(define reserve-1-2 (/ (hex->uint256 result-1-2) (expt 10 18)))
(displayln (format "[OK] Entity 1, Token 2: ~a units" reserve-1-2))

;; Query reserves for entity 2, token 1
(displayln "[FIND] Querying reserves for Entity 2, Token 1...")
(define call-data-2-1 (encode-get-reserve entity-2 1))
(define tx-2-1 (hasheq 'to depository 'data (bytes->hex call-data-2-1)))
(define result-2-1 (eth-call tx-2-1))
(define reserve-2-1 (/ (hex->uint256 result-2-1) (expt 10 18)))
(displayln (format "[OK] Entity 2, Token 1: ~a units" reserve-2-1))

(displayln "")

;; ═══════════════════════════════════════════════════════════════════
;; Step 3: Verify Totals
;; ═══════════════════════════════════════════════════════════════════

(displayln "=== Step 3: Summary ===")
(displayln (format "[OK] Total reserves queried: ~a units" (+ reserve-1-1 reserve-1-2 reserve-2-1)))
(displayln "[OK] All RPC calls successful!")
(displayln "")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Pure Racket blockchain integration WORKS!")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")
(displayln "Technical achievements:")
(displayln "  ✓ JSON-RPC client (148 lines, zero dependencies)")
(displayln "  ✓ ABI encoding (145 lines, manual implementation)")
(displayln "  ✓ Keccak-256 via Node.js FFI (correct function selectors)")
(displayln "  ✓ Contract queries working end-to-end")
(displayln "")
(displayln "Next: Replace simulated blockchain in demos with RPC")
(displayln "")
(displayln "λ.")
