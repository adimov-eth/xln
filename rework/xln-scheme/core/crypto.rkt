#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Cryptography - ECDSA, SHA256, Keccak256
;; ═══════════════════════════════════════════════════════════════════
;;
;; Uses Racket's built-in crypto library for now.
;; Future: FFI to libsecp256k1 for production performance.
;;
;; ═══════════════════════════════════════════════════════════════════

(require crypto
         crypto/libcrypto
         racket/contract
         racket/match)

(provide (all-defined-out))

;; ─────────────────────────────────────────────────────────────────
;; Hash Functions
;; ─────────────────────────────────────────────────────────────────

;; SHA256 - used for channel key generation
(define/contract (sha256 data)
  (-> bytes? bytes?)
  (digest 'sha256 data))

;; Keccak256 - Ethereum compatibility
;; Note: Racket's crypto lib might not have keccak256 directly
;; For now, using SHA3-256 as placeholder (will need proper keccak256)
(define/contract (keccak256 data)
  (-> bytes? bytes?)
  ;; TODO: Replace with actual keccak256
  ;; keccak256 ≠ SHA3-256 (different padding)
  (digest 'sha3-256 data))

;; Hash arbitrary S-expression (for frame hashing)
(define/contract (hash-sexp sexp)
  (-> any/c bytes?)
  (sha256 (string->bytes/utf-8 (format "~s" sexp))))

;; ─────────────────────────────────────────────────────────────────
;; ECDSA Key Management (secp256k1)
;; ─────────────────────────────────────────────────────────────────

(struct private-key (bytes) #:transparent)
(struct public-key (bytes) #:transparent)
(struct signature (r s v) #:transparent)  ; Ethereum-style signature

;; Generate a new keypair
(define/contract (generate-keypair)
  (-> (values private-key? public-key?))
  ;; Using Racket's crypto, which uses OpenSSL underneath
  (define pk (generate-private-key 'ec 'secp256k1))
  (define pub (pk-key->public-key pk))
  (values
   (private-key (pk-key->datum pk 'PrivateKeyInfo))
   (public-key (pk-key->datum pub 'SubjectPublicKeyInfo))))

;; Derive public key from private key
(define/contract (private->public priv)
  (-> private-key? public-key?)
  (define pk (datum->pk-key (private-key-bytes priv) 'PrivateKeyInfo))
  (define pub (pk-key->public-key pk))
  (public-key (pk-key->datum pub 'SubjectPublicKeyInfo)))

;; Ethereum-style address derivation: keccak256(pubkey)[-20:]
(define/contract (public-key->address pub)
  (-> public-key? bytes?)
  (define hash (keccak256 (public-key-bytes pub)))
  (subbytes hash (- (bytes-length hash) 20)))  ; Last 20 bytes

;; ─────────────────────────────────────────────────────────────────
;; Signing & Verification
;; ─────────────────────────────────────────────────────────────────

;; Sign a message (returns Ethereum-style signature)
(define/contract (sign message priv)
  (-> bytes? private-key? signature?)
  (define pk (datum->pk-key (private-key-bytes priv) 'PrivateKeyInfo))
  (define sig-bytes (pk-sign pk message #:pad 'none #:digest 'sha256))

  ;; Parse DER signature to extract r, s
  ;; For simplicity, storing raw signature bytes for now
  ;; TODO: Proper DER parsing to extract r, s, compute v
  (signature sig-bytes #"" 0))  ; Placeholder

;; Verify a signature
(define/contract (verify message pub sig)
  (-> bytes? public-key? signature? boolean?)
  (define pk (datum->pk-key (public-key-bytes pub) 'SubjectPublicKeyInfo))
  (pk-verify pk message (signature-r sig) #:pad 'none #:digest 'sha256))

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

;; ─────────────────────────────────────────────────────────────────
;; Frame Signing (Consensus Use)
;; ─────────────────────────────────────────────────────────────────

;; Sign a frame (converts to bytes, hashes, signs)
(define/contract (sign-frame frame-data priv)
  (-> any/c private-key? signature?)
  (define frame-hash (hash-sexp frame-data))
  (sign frame-hash priv))

;; Verify frame signature
(define/contract (verify-frame-signature frame-data pub sig)
  (-> any/c public-key? signature? boolean?)
  (define frame-hash (hash-sexp frame-data))
  (verify frame-hash pub sig))

;; ─────────────────────────────────────────────────────────────────
;; Quorum Signature Verification (BFT Consensus)
;; ─────────────────────────────────────────────────────────────────

;; Verify threshold signatures (≥ 2/3 required)
(define/contract (verify-quorum frame-data validators signatures threshold)
  (-> any/c (listof public-key?) (listof signature?) exact-nonnegative-integer?
      boolean?)

  (define valid-count
    (for/sum ([pub validators]
              [sig signatures]
              #:when (verify-frame-signature frame-data pub sig))
      1))

  (>= valid-count threshold))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════

;; What works:
;; - SHA256, Keccak256 (placeholder)
;; - Keypair generation
;; - Address derivation
;; - Channel key generation (deterministic)
;; - Frame signing/verification
;; - Quorum verification
;;
;; TODO for production:
;; - Real keccak256 (not SHA3-256)
;; - Proper DER signature parsing (r, s, v extraction)
;; - FFI to libsecp256k1 for performance
;; - Recovery ID (v) calculation for Ethereum compatibility
;; - Deterministic nonce generation (RFC6979)
;;
;; Good enough to prove consensus works. Optimize later.
