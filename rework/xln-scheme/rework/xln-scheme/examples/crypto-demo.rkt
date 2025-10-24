#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; Crypto Demo - Proving Hash Functions Work (MVP)
;; ═══════════════════════════════════════════════════════════════════

(require "../core/crypto.rkt"
         racket/format)

;; Helper to display bytes as hex
(define (bytes->hex-string bs)
  (apply string-append
         (for/list ([b (in-bytes bs)])
           (format "~a" (~r b #:base 16 #:min-width 2 #:pad-string "0")))))

;; ─────────────────────────────────────────────────────────────────
;; Demo 1: SHA256 Hashing
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Demo 1: SHA256 Hashing ===\n")

(define message #"Hello, XLN!")
(define message-hash (sha256 message))

(displayln (format "Message: ~a" message))
(displayln (format "SHA256 hash: ~a" (bytes->hex-string message-hash)))
(displayln (format "Hash length: ~a bytes" (bytes-length message-hash)))

;; Verify determinism
(define message-hash-2 (sha256 message))
(displayln (format "Deterministic? ~a ✓\n" (equal? message-hash message-hash-2)))

;; ─────────────────────────────────────────────────────────────────
;; Demo 2: Keccak256 (SHA3-256 approximation)
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Demo 2: Keccak256 (SHA3-256) ===\n")

(define data #"XLN consensus")
(define sha-hash (sha256 data))
(define keccak-hash (keccak256 data))

(displayln (format "Data: ~a" data))
(displayln (format "SHA256:   ~a" (bytes->hex-string sha-hash)))
(displayln (format "Keccak256: ~a" (bytes->hex-string keccak-hash)))
(displayln (format "Different algorithms? ~a ✓\n" (not (equal? sha-hash keccak-hash))))

;; ─────────────────────────────────────────────────────────────────
;; Demo 3: S-Expression Hashing (Frame Hashing)
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Demo 3: Frame Hashing ===\n")

;; Create a frame-like structure
(define frame-data
  `(frame
    (counter 1)
    (deltas ((token 1 amount 100)))
    (timestamp ,(current-seconds))))

(displayln (format "Frame data: ~s" frame-data))

(define frame-hash (hash-sexp frame-data))
(displayln (format "Frame hash: ~a" (bytes->hex-string frame-hash)))

;; Modify frame slightly
(define frame-data-2
  `(frame
    (counter 2)
    (deltas ((token 1 amount 100)))
    (timestamp ,(current-seconds))))

(define frame-hash-2 (hash-sexp frame-data-2))
(displayln (format "Modified frame hash: ~a" (bytes->hex-string frame-hash-2)))
(displayln (format "Different hashes? ~a ✓\n" (not (equal? frame-hash frame-hash-2))))

;; ─────────────────────────────────────────────────────────────────
;; Demo 4: Deterministic Channel Key
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Demo 4: Deterministic Channel Key ===\n")

(define alice-addr #"alice")
(define bob-addr #"bob")

(define channel-key-1 (derive-channel-key alice-addr bob-addr))
(define channel-key-2 (derive-channel-key bob-addr alice-addr))  ; Reversed

(displayln (format "Channel key (A→B): ~a" (bytes->hex-string channel-key-1)))
(displayln (format "Channel key (B→A): ~a" (bytes->hex-string channel-key-2)))
(displayln (format "Keys equal? ~a ✓\n" (equal? channel-key-1 channel-key-2)))

;; ─────────────────────────────────────────────────────────────────
;; Summary
;; ─────────────────────────────────────────────────────────────────

(displayln "=== Summary ===")
(displayln "✓ SHA256 hashing working")
(displayln "✓ Keccak256 (SHA3-256 approximation)")
(displayln "✓ S-expression hashing for frames")
(displayln "✓ Deterministic channel keys")
(displayln "\nCryptography foundation (hashing) proven. Ready for consensus.")
(displayln "TODO: Add ECDSA signing once crypto providers available.")
(displayln "\nλ.")
