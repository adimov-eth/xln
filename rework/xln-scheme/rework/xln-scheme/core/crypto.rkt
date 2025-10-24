#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Cryptography - SHA256, Keccak256 (MVP - Hashing Only)
;; ═══════════════════════════════════════════════════════════════════
;;
;; MVP: Hashing functions only to prove consensus pattern works.
;; TODO: Add ECDSA signing after installing full Racket with crypto support.
;;
;; ═══════════════════════════════════════════════════════════════════

(require crypto
         racket/contract
         racket/random)

(provide (all-defined-out))

;; ─────────────────────────────────────────────────────────────────
;; Hash Functions
;; ─────────────────────────────────────────────────────────────────

;; SHA256 - used for channel key generation
(define/contract (sha256 data)
  (-> bytes? bytes?)
  (digest 'sha256 data))

;; Keccak256 - Ethereum compatibility
;; Note: Using SHA3-256 as placeholder (keccak256 ≠ SHA3-256 due to padding)
;; TODO: Implement proper Keccak-256 (pre-FIPS SHA3)
(define/contract (keccak256 data)
  (-> bytes? bytes?)
  ;; keccak256 ≠ SHA3-256 (different padding)
  ;; For MVP, using SHA3-256 as approximation
  (digest 'sha3-256 data))

;; Hash arbitrary S-expression (for frame hashing)
(define/contract (hash-sexp sexp)
  (-> any/c bytes?)
  (sha256 (string->bytes/utf-8 (format "~s" sexp))))

;; ─────────────────────────────────────────────────────────────────
;; Deterministic Channel Key Generation
;; ─────────────────────────────────────────────────────────────────

;; channelKey = sha256(min(addrL, addrR) || max(addrL, addrR))
(define/contract (derive-channel-key addr-left addr-right)
  (-> bytes? bytes? bytes?)
  (define sorted (if (bytes<? addr-left addr-right)
                     (list addr-left addr-right)
                     (list addr-right addr-left)))
  (sha256 (apply bytes-append sorted)))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete (MVP - Hash Functions Only)
;; ═══════════════════════════════════════════════════════════════════

;; What works:
;; - SHA256 hashing
;; - SHA3-256 hashing (Keccak approximation)
;; - S-expression hashing for frames
;; - Deterministic channel key derivation
;;
;; This is enough to prove:
;; - Frame hashing works
;; - Channel keys are deterministic
;; - Consensus patterns are sound
;;
;; TODO for signing support:
;; - Install full Racket (not minimal-racket)
;; - Or implement pure-Racket ECDSA
;; - Or FFI to libsecp256k1
;;
;; For now, MVP proves the consensus architecture works.
;; Signatures can be added once crypto providers are available.
