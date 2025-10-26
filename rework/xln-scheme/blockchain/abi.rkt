#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN ABI Encoding - Ethereum Contract Interface
;; ═══════════════════════════════════════════════════════════════════
;;
;; Minimal ABI encoding for XLN contract calls.
;; Implements subset needed for EntityProvider and Depository.
;;
;; Reference: https://docs.soliditylang.org/en/latest/abi-spec.html
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/match
         racket/string
         "../core/crypto.rkt")

(provide encode-function-call
         encode-uint256
         encode-address
         encode-bytes32
         encode-bytes
         encode-string
         function-selector

         ;; Contract-specific encoders
         encode-register-numbered-entity
         encode-get-entity-info
         encode-fund-reserves
         encode-get-reserve)

;; ─────────────────────────────────────────────────────────────────
;; Function Selector
;; ─────────────────────────────────────────────────────────────────

(define/contract (function-selector sig)
  (-> string? bytes?)
  ;; Keccak256(sig)[0:4]
  (define hash (keccak256 (string->bytes/utf-8 sig)))
  (subbytes hash 0 4))

;; ─────────────────────────────────────────────────────────────────
;; Type Encoding
;; ─────────────────────────────────────────────────────────────────

(define/contract (encode-uint256 n)
  (-> exact-nonnegative-integer? bytes?)
  ;; Convert integer to 32-byte big-endian representation
  (define (int->bytes-32 num)
    (define result (make-bytes 32 0))
    (for ([i (in-range 32)])
      (bytes-set! result (- 31 i) (bitwise-and (arithmetic-shift num (* -8 i)) #xFF)))
    result)
  (int->bytes-32 n))

(define/contract (encode-address addr)
  (-> string? bytes?)
  ;; Remove "0x" prefix if present, pad left to 32 bytes
  (define hex (if (string-prefix? addr "0x")
                  (substring addr 2)
                  addr))
  (define addr-bytes (hex-string->bytes hex))
  (bytes-append (make-bytes (- 32 (bytes-length addr-bytes)) 0)
                addr-bytes))

(define/contract (encode-bytes32 b)
  (-> bytes? bytes?)
  ;; Pad or truncate to 32 bytes
  (cond
    [(= (bytes-length b) 32) b]
    [(< (bytes-length b) 32)
     (bytes-append b (make-bytes (- 32 (bytes-length b)) 0))]
    [else (subbytes b 0 32)]))

(define/contract (encode-bytes b)
  (-> bytes? bytes?)
  ;; Dynamic bytes: length (32 bytes) + data (padded to 32-byte multiple)
  (define len (bytes-length b))
  (define padded-len (* 32 (ceiling (/ len 32))))
  (define padded-data (bytes-append b (make-bytes (- padded-len len) 0)))
  (bytes-append (encode-uint256 len) padded-data))

(define/contract (encode-string s)
  (-> string? bytes?)
  (encode-bytes (string->bytes/utf-8 s)))

(define (hex-string->bytes hex)
  (define clean (string-replace hex " " ""))
  (list->bytes
    (for/list ([i (in-range 0 (string-length clean) 2)])
      (string->number (substring clean i (+ i 2)) 16))))

;; ─────────────────────────────────────────────────────────────────
;; Function Call Encoding
;; ─────────────────────────────────────────────────────────────────

(define/contract (encode-function-call sig . args)
  (-> string? bytes? ... bytes?)
  (bytes-append (function-selector sig)
                (apply bytes-append args)))

;; ─────────────────────────────────────────────────────────────────
;; Contract-Specific Encoders
;; ─────────────────────────────────────────────────────────────────

;; EntityProvider.registerNumberedEntity(bytes32 boardHash) returns (uint256)
(define/contract (encode-register-numbered-entity board-hash)
  (-> bytes? bytes?)
  (encode-function-call "registerNumberedEntity(bytes32)"
                        (encode-bytes32 board-hash)))

;; EntityProvider.getEntityInfo(bytes32 entityId) returns (...)
(define/contract (encode-get-entity-info entity-id)
  (-> bytes? bytes?)
  (encode-function-call "getEntityInfo(bytes32)"
                        (encode-bytes32 entity-id)))

;; Depository.debugFundReserves(bytes32 entity, uint token, uint amount)
(define/contract (encode-fund-reserves entity-id token-id amount)
  (-> bytes?
      exact-nonnegative-integer?
      exact-nonnegative-integer?
      bytes?)
  (encode-function-call "debugFundReserves(bytes32,uint256,uint256)"
                        (encode-bytes32 entity-id)
                        (encode-uint256 token-id)
                        (encode-uint256 amount)))

;; Depository._reserves(bytes32 entity, uint token) returns (uint256)
(define/contract (encode-get-reserve entity-id token-id)
  (-> bytes?
      exact-nonnegative-integer?
      bytes?)
  (encode-function-call "_reserves(bytes32,uint256)"
                        (encode-bytes32 entity-id)
                        (encode-uint256 token-id)))

;; ═══════════════════════════════════════════════════════════════════
;; Testing
;; ═══════════════════════════════════════════════════════════════════
;;
;; (function-selector "getEntityNumber(bytes32)")
;; => #"\xa5\xfc\x95\x92" (4 bytes)
;;
;; (encode-uint256 42)
;; => 32 bytes with value 42 (big-endian)
;;
;; ═══════════════════════════════════════════════════════════════════
