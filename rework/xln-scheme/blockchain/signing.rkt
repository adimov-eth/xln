#lang racket

;; ═══════════════════════════════════════════════════════════════════
;; Transaction Signing - ECDSA via ethers.js FFI
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/format
         racket/system
         racket/string
         racket/path
         json
         "rpc.rkt")

(provide sign-transaction
         eth-send-raw-transaction)

;; ─────────────────────────────────────────────────────────────────
;; Transaction Signing
;; ─────────────────────────────────────────────────────────────────

(define/contract (sign-transaction private-key tx-params)
  (-> string? jsexpr? string?)
  ;; tx-params is a hash with: to, data, value (optional), gas, gasPrice, nonce, chainId

  (define script-path
    (build-path (current-directory) "blockchain" "sign-tx.js"))

  ;; Convert tx-params to JSON string
  (define tx-json (jsexpr->string tx-params))

  ;; Call Node.js signing script
  (define output
    (with-output-to-string
      (lambda ()
        (system* (find-executable-path "node")
                 script-path
                 private-key
                 tx-json))))

  (define clean-output (string-trim output))

  (if (string-prefix? clean-output "Error:")
      (error 'sign-transaction "Signing failed: ~a" clean-output)
      (string-append "0x" clean-output)))

;; ─────────────────────────────────────────────────────────────────
;; Send Raw Transaction
;; ─────────────────────────────────────────────────────────────────

(define/contract (eth-send-raw-transaction signed-tx-hex)
  (-> string? string?)
  ;; Uses RPC client from rpc.rkt
  (define result (rpc-call "eth_sendRawTransaction" (list signed-tx-hex)))
  result)

;; ═══════════════════════════════════════════════════════════════════
;; Testing
;; ═══════════════════════════════════════════════════════════════════
;;
;; Example usage:
;;
;; (define private-key "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
;; (define tx-params
;;   (hasheq 'to "0x5FbDB2315678afecb367f032d93F642f64180aa3"
;;           'data "0x..."
;;           'gas "0x100000"
;;           'gasPrice "0x3b9aca00"
;;           'nonce "0x0"
;;           'chainId "0x539"))  ; 1337 for Hardhat
;;
;; (define signed-tx (sign-transaction private-key tx-params))
;; (define tx-hash (eth-send-raw-transaction signed-tx))
;;
;; ═══════════════════════════════════════════════════════════════════
