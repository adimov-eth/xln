#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Simple Query Demo - Read-Only Contract Calls
;; ═══════════════════════════════════════════════════════════════════

(require "../blockchain/rpc.rkt"
         "../blockchain/abi.rkt")

(displayln "═══════════════════════════════════════════════════════════")
(displayln "  Simple Contract Queries (Read-Only)")
(displayln "═══════════════════════════════════════════════════════════")
(displayln "")

(define depository "0x5FbDB2315678afecb367f032d93F642f64180aa3")

;; Helper
(define (bytes->hex b)
  (string-append "0x"
                 (apply string-append
                        (for/list ([byte (bytes->list b)])
                          (format "~a" (~r byte #:base 16 #:min-width 2 #:pad-string "0"))))))

(displayln "=== Test 1: Query Reserve (bytes32 entity) ===")
(define entity-1 (make-bytes 32 0))
(bytes-set! entity-1 31 1)  ; entity ID = 0x...01

(define call-data-reserves (encode-get-reserve entity-1 1))  ; entity 1, token 1
(displayln (format "[DATA] Call: ~a" (bytes->hex call-data-reserves)))

(define tx-reserves
  (hasheq 'to depository
          'data (bytes->hex call-data-reserves)))

(with-handlers ([exn:fail? (lambda (e)
                              (displayln (format "[X] Failed: ~a" (exn-message e))))])
  (define result (eth-call tx-reserves))
  (displayln (format "[OK] Reserve for entity 1, token 1: ~a" result)))

(displayln "")
(displayln "λ.")
