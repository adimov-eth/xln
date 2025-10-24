#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Merkle Tree - Efficient state root computation
;; ═══════════════════════════════════════════════════════════════════
;;
;; Merkle trees for:
;; - A-root (account state commitment)
;; - Transaction batching
;; - Proof generation/verification
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/match
         "crypto.rkt")

(provide merkle-root
         merkle-proof
         verify-merkle-proof
         merkle-tree-from-leaves
         merkle-proof-data
         merkle-proof-data?
         merkle-proof-data-leaf-index
         merkle-proof-data-siblings)

;; ─────────────────────────────────────────────────────────────────
;; Merkle Tree Construction
;; ─────────────────────────────────────────────────────────────────

;; Merkle tree node
(struct merkle-node (hash left right) #:transparent)

;; Hash a pair of nodes (concatenate hashes, then hash)
(define/contract (hash-pair left right)
  (-> bytes? bytes? bytes?)
  (sha256 (bytes-append left right)))

;; Build Merkle tree from list of leaf hashes
(define/contract (merkle-tree-from-leaves leaves)
  (-> (listof bytes?) (or/c bytes? merkle-node?))
  (cond
    ;; Empty tree => empty hash
    [(null? leaves)
     (sha256 #"")]

    ;; Single leaf => return it
    [(null? (cdr leaves))
     (car leaves)]

    ;; Multiple leaves => build tree recursively
    [else
     (define (pair-up lst)
       (cond
         [(null? lst) '()]
         [(null? (cdr lst))
          ;; Odd number of nodes => duplicate last one
          (list (hash-pair (car lst) (car lst)))]
         [else
          (cons (hash-pair (car lst) (cadr lst))
                (pair-up (cddr lst)))]))

     ;; Recursively hash pairs until we get to root
     (let loop ([level leaves])
       (if (null? (cdr level))
           (car level)
           (loop (pair-up level))))]))

;; Compute Merkle root from list of leaf hashes
(define/contract (merkle-root leaves)
  (-> (listof bytes?) bytes?)
  (define tree (merkle-tree-from-leaves leaves))
  (if (bytes? tree)
      tree
      (merkle-node-hash tree)))

;; ─────────────────────────────────────────────────────────────────
;; Merkle Proof Generation
;; ─────────────────────────────────────────────────────────────────

;; Merkle proof: list of (sibling-hash . is-right?) pairs
;; is-right? = #t means sibling is on the right, #f means left
(struct merkle-proof-data (leaf-index siblings) #:transparent)

;; Generate Merkle proof for a leaf at given index
(define/contract (merkle-proof leaves index)
  (-> (listof bytes?) exact-nonnegative-integer? (or/c #f merkle-proof-data?))
  (cond
    [(>= index (length leaves)) #f]  ; Invalid index
    [(null? leaves) #f]

    [else
     ;; Build proof by tracking sibling hashes at each level
     (let loop ([level leaves] [idx index] [proof-path '()])
       (cond
         [(null? (cdr level))
          ;; Reached root
          (merkle-proof-data index (reverse proof-path))]

         [else
          ;; Find sibling at current level
          (define sibling-idx (if (even? idx) (+ idx 1) (- idx 1)))
          (define is-right? (even? idx))

          ;; Handle odd number of nodes (duplicate last)
          (define sibling-hash
            (if (>= sibling-idx (length level))
                (list-ref level idx)  ; Duplicate self
                (list-ref level sibling-idx)))

          ;; Compute parent hashes
          (define (pair-up lst)
            (cond
              [(null? lst) '()]
              [(null? (cdr lst))
               (list (hash-pair (car lst) (car lst)))]
              [else
               (cons (hash-pair (car lst) (cadr lst))
                     (pair-up (cddr lst)))]))

          (define next-level (pair-up level))
          (define parent-idx (quotient idx 2))

          (loop next-level
                parent-idx
                (cons (cons sibling-hash is-right?) proof-path))]))]))

;; ─────────────────────────────────────────────────────────────────
;; Merkle Proof Verification
;; ─────────────────────────────────────────────────────────────────

;; Verify that a leaf is part of a Merkle tree with given root
(define/contract (verify-merkle-proof leaf-hash root proof)
  (-> bytes? bytes? merkle-proof-data? boolean?)
  (define siblings (merkle-proof-data-siblings proof))

  ;; Compute root by hashing up the tree
  (define computed-root
    (foldl
     (lambda (sibling-pair current-hash)
       (define sibling-hash (car sibling-pair))
       (define is-right? (cdr sibling-pair))
       (if is-right?
           (hash-pair current-hash sibling-hash)
           (hash-pair sibling-hash current-hash)))
     leaf-hash
     siblings))

  (bytes=? computed-root root))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════

;; What works:
;; - Merkle root computation
;; - Proof generation
;; - Proof verification
;; - Handles odd number of leaves (duplicate last)
;;
;; Used for:
;; - A-root (account state commitment)
;; - Transaction batching
;; - Light client verification
;; - Fraud proofs
;;
;; Properties:
;; - Deterministic (same leaves => same root)
;; - Efficient verification (O(log n))
;; - Tamper-proof (changing any leaf changes root)
