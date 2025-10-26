#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Blockchain RPC Client - Real Ethereum Integration
;; ═══════════════════════════════════════════════════════════════════
;;
;; JSON-RPC client for connecting to real Ethereum nodes.
;; Replaces simulated chain-state with actual blockchain interaction.
;;
;; Target: Local Hardhat (http://localhost:8545)
;; Future: Ethereum, Polygon, Arbitrum via Alchemy/Infura
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/match
         racket/string
         racket/port
         net/url
         net/http-client
         json)

(provide rpc-endpoint
         rpc-call
         eth-block-number
         eth-get-balance
         eth-call
         eth-send-transaction
         eth-get-transaction-receipt
         eth-get-logs
         eth-get-transaction-count)

;; ─────────────────────────────────────────────────────────────────
;; Configuration
;; ─────────────────────────────────────────────────────────────────

(define rpc-endpoint "http://localhost:8545")

;; ─────────────────────────────────────────────────────────────────
;; Low-Level JSON-RPC
;; ─────────────────────────────────────────────────────────────────

(define/contract (rpc-call method params)
  (-> string? (listof any/c) jsexpr?)

  (define request
    (hasheq 'jsonrpc "2.0"
            'method method
            'params params
            'id 1))

  (define u (string->url rpc-endpoint))
  (define host (url-host u))
  (define port (or (url-port u) 80))
  (define path (string-join (map path/param-path (url-path u)) "/"))

  (define request-body (jsexpr->bytes request))

  (define-values (status headers in)
    (http-sendrecv host
                   (string-append "/" path)
                   #:ssl? #f
                   #:port port
                   #:method #"POST"
                   #:headers (list "Content-Type: application/json")
                   #:data request-body))

  (define response (bytes->jsexpr (port->bytes in)))
  (close-input-port in)

  (cond
    [(hash-has-key? response 'error)
     (error 'rpc-call "RPC error: ~a" (hash-ref response 'error))]
    [else
     (hash-ref response 'result)]))

;; ─────────────────────────────────────────────────────────────────
;; ETH Methods
;; ─────────────────────────────────────────────────────────────────

(define/contract (eth-block-number)
  (-> string?)
  (rpc-call "eth_blockNumber" '()))

(define/contract (eth-get-balance address [block "latest"])
  (->* (string?) (string?) string?)
  (rpc-call "eth_getBalance" (list address block)))

(define/contract (eth-call tx-object [block "latest"])
  (->* (hash?) (string?) string?)
  (rpc-call "eth_call" (list tx-object block)))

(define/contract (eth-send-transaction tx-object)
  (-> hash? string?)
  (rpc-call "eth_sendTransaction" (list tx-object)))

(define/contract (eth-get-transaction-receipt tx-hash)
  (-> string? (or/c hash? #f))
  (rpc-call "eth_getTransactionReceipt" (list tx-hash)))

(define/contract (eth-get-logs filter-object)
  (-> hash? (listof hash?))
  (rpc-call "eth_getLogs" (list filter-object)))

(define/contract (eth-get-transaction-count address block-tag)
  (-> string? string? string?)
  (rpc-call "eth_getTransactionCount" (list address block-tag)))

;; ═══════════════════════════════════════════════════════════════════
;; Testing
;; ═══════════════════════════════════════════════════════════════════
;;
;; Manual test:
;;   (require "blockchain/rpc.rkt")
;;   (eth-block-number)  ; => "0x8"
;;
;; ═══════════════════════════════════════════════════════════════════
