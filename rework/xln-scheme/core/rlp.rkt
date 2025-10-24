#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN RLP Encoding - Ethereum-compatible serialization
;; ═══════════════════════════════════════════════════════════════════
;;
;; Recursive Length Prefix (RLP) encoding for deterministic serialization.
;; Used for frame hashing, state roots, and Ethereum compatibility.
;;
;; Spec: https://ethereum.org/en/developers/docs/data-structures-and-encoding/rlp/
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/match)

(provide rlp-encode
         rlp-decode
         rlp-encode-list
         rlp-encode-bytes
         rlp-encode-integer)

;; ─────────────────────────────────────────────────────────────────
;; Integer Encoding
;; ─────────────────────────────────────────────────────────────────

;; Convert integer to big-endian bytes (no leading zeros)
(define/contract (integer->bytes-be n)
  (-> exact-nonnegative-integer? bytes?)
  (cond
    [(zero? n) #""]
    [else
     (let loop ([n n] [acc '()])
       (if (zero? n)
           (list->bytes acc)
           (loop (quotient n 256) (cons (modulo n 256) acc))))]))

;; Convert big-endian bytes to integer
(define/contract (bytes-be->integer bs)
  (-> bytes? exact-nonnegative-integer?)
  (for/fold ([result 0])
            ([b (in-bytes bs)])
    (+ (* result 256) b)))

;; ─────────────────────────────────────────────────────────────────
;; RLP Encoding
;; ─────────────────────────────────────────────────────────────────

;; Encode a single byte (0x00 - 0x7f) => itself
;; Encode bytes (length 0-55) => [0x80 + length, ...bytes]
;; Encode bytes (length > 55) => [0xb7 + length-of-length, ...length, ...bytes]
(define/contract (rlp-encode-bytes bs)
  (-> bytes? bytes?)
  (define len (bytes-length bs))
  (cond
    ;; Single byte [0x00, 0x7f] => itself
    [(and (= len 1) (< (bytes-ref bs 0) #x80))
     bs]

    ;; Short string [0-55 bytes] => [0x80 + len, ...bytes]
    [(<= len 55)
     (bytes-append (bytes (+ #x80 len)) bs)]

    ;; Long string [>55 bytes] => [0xb7 + len_of_len, ...len_bytes, ...bytes]
    [else
     (define len-bytes (integer->bytes-be len))
     (define len-of-len (bytes-length len-bytes))
     (bytes-append (bytes (+ #xb7 len-of-len)) len-bytes bs)]))

;; Encode integer (convert to bytes first, then encode)
(define/contract (rlp-encode-integer n)
  (-> exact-nonnegative-integer? bytes?)
  (cond
    [(zero? n) (rlp-encode-bytes #"")]
    [else (rlp-encode-bytes (integer->bytes-be n))]))

;; Encode list of RLP-encoded items
(define/contract (rlp-encode-list items)
  (-> (listof bytes?) bytes?)
  (define payload (apply bytes-append items))
  (define len (bytes-length payload))
  (cond
    ;; Short list [0-55 bytes] => [0xc0 + len, ...items]
    [(<= len 55)
     (bytes-append (bytes (+ #xc0 len)) payload)]

    ;; Long list [>55 bytes] => [0xf7 + len_of_len, ...len_bytes, ...items]
    [else
     (define len-bytes (integer->bytes-be len))
     (define len-of-len (bytes-length len-bytes))
     (bytes-append (bytes (+ #xf7 len-of-len)) len-bytes payload)]))

;; Main RLP encoder - dispatch based on type
(define/contract (rlp-encode data)
  (-> (or/c bytes? exact-nonnegative-integer? (listof (or/c bytes? exact-nonnegative-integer? list?))) bytes?)
  (match data
    [(? bytes? bs) (rlp-encode-bytes bs)]
    [(? exact-nonnegative-integer? n) (rlp-encode-integer n)]
    [(? list? lst) (rlp-encode-list (map rlp-encode lst))]
    [_ (error 'rlp-encode "Unsupported data type: ~a" data)]))

;; ─────────────────────────────────────────────────────────────────
;; RLP Decoding
;; ─────────────────────────────────────────────────────────────────

;; Decode RLP-encoded bytes
(define/contract (rlp-decode bs)
  (-> bytes? (or/c bytes? (listof any/c)))
  (define (decode-at offset)
    (define first-byte (bytes-ref bs offset))
    (cond
      ;; Single byte [0x00, 0x7f] => itself
      [(< first-byte #x80)
       (values (bytes first-byte) (+ offset 1))]

      ;; Short string [0x80, 0xb7] => [0x80 + len, ...bytes]
      [(<= first-byte #xb7)
       (define len (- first-byte #x80))
       (define payload (subbytes bs (+ offset 1) (+ offset 1 len)))
       (values payload (+ offset 1 len))]

      ;; Long string [0xb8, 0xbf] => [0xb7 + len_of_len, ...len_bytes, ...bytes]
      [(<= first-byte #xbf)
       (define len-of-len (- first-byte #xb7))
       (define len-bytes (subbytes bs (+ offset 1) (+ offset 1 len-of-len)))
       (define len (bytes-be->integer len-bytes))
       (define payload (subbytes bs (+ offset 1 len-of-len) (+ offset 1 len-of-len len)))
       (values payload (+ offset 1 len-of-len len))]

      ;; Short list [0xc0, 0xf7] => [0xc0 + len, ...items]
      [(<= first-byte #xf7)
       (define len (- first-byte #xc0))
       (define-values (items _) (decode-list (+ offset 1) (+ offset 1 len)))
       (values items (+ offset 1 len))]

      ;; Long list [0xf8, 0xff] => [0xf7 + len_of_len, ...len_bytes, ...items]
      [else
       (define len-of-len (- first-byte #xf7))
       (define len-bytes (subbytes bs (+ offset 1) (+ offset 1 len-of-len)))
       (define len (bytes-be->integer len-bytes))
       (define-values (items _) (decode-list (+ offset 1 len-of-len) (+ offset 1 len-of-len len)))
       (values items (+ offset 1 len-of-len len))]))

  ;; Decode list items until end position
  (define (decode-list start end)
    (let loop ([pos start] [acc '()])
      (if (>= pos end)
          (values (reverse acc) end)
          (let-values ([(item next-pos) (decode-at pos)])
            (loop next-pos (cons item acc))))))

  (define-values (result _) (decode-at 0))
  result)

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════

;; What works:
;; - Integer → big-endian bytes (no leading zeros)
;; - Bytes encoding (short/long strings)
;; - List encoding (short/long lists)
;; - Nested list support
;; - Round-trip decode
;;
;; Tested with:
;; - Empty bytes, single byte, short strings, long strings
;; - Integers (0, 1, 127, 128, 256, 0x400, 0xffff)
;; - Lists (empty, flat, nested)
;;
;; Ethereum-compatible for:
;; - Transaction encoding
;; - State root computation
;; - Frame hashing
;; - Merkle tree leaves
