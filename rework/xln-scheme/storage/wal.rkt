#lang racket/base

;; ═══════════════════════════════════════════════════════════════════
;; XLN Write-Ahead Log (WAL) - Append-Only Persistent Log
;; ═══════════════════════════════════════════════════════════════════
;;
;; Provides crash recovery and deterministic replay.
;;
;; WAL Entry Format:
;;   (entry-id timestamp input-data checksum)
;;
;; File Format:
;;   - Append-only S-expressions (one per line)
;;   - Each entry is a list: (id timestamp data checksum)
;;   - Checksum = SHA256(id + timestamp + data)
;;
;; Usage:
;;   (define wal (create-wal "path/to/log.wal"))
;;   (wal-append! wal input)
;;   (define entries (wal-read-all wal))
;;   (wal-close! wal)
;;
;; ═══════════════════════════════════════════════════════════════════

(require racket/contract
         racket/port
         racket/list
         racket/match
         "../core/crypto.rkt")

(provide (struct-out wal-handle)
         create-wal
         wal-append!
         wal-read-all
         wal-close!
         wal-verify-integrity)

;; ─────────────────────────────────────────────────────────────────
;; WAL Handle
;; ─────────────────────────────────────────────────────────────────

(struct wal-handle (
  file-path         ; Path to WAL file
  port              ; Output port for appending
  next-entry-id     ; Next sequential entry ID
) #:mutable #:transparent)

;; ─────────────────────────────────────────────────────────────────
;; WAL Creation
;; ─────────────────────────────────────────────────────────────────

(define/contract (create-wal file-path)
  (-> path-string? wal-handle?)

  ;; Check if file exists to determine next entry ID
  (define next-id
    (if (file-exists? file-path)
        (let ([entries (read-wal-entries-from-file file-path)])
          (if (null? entries)
              0
              (+ 1 (car (last entries)))))  ; Last entry's ID + 1
        0))

  ;; Open file for appending
  (define out-port (open-output-file file-path
                                     #:mode 'text
                                     #:exists 'append))

  (displayln (format "[WAL] Opened ~a (next entry: ~a)" file-path next-id))

  (wal-handle file-path out-port next-id))

;; ─────────────────────────────────────────────────────────────────
;; WAL Append
;; ─────────────────────────────────────────────────────────────────

(define/contract (wal-append! wal input timestamp)
  (-> wal-handle? any/c exact-nonnegative-integer? exact-nonnegative-integer?)

  (define entry-id (wal-handle-next-entry-id wal))

  ;; Compute checksum: SHA256(id + timestamp + input)
  (define checksum-data
    (string->bytes/utf-8
     (format "~a:~a:~s" entry-id timestamp input)))
  (define checksum (sha256 checksum-data))

  ;; Create entry: (id timestamp input checksum)
  (define entry (list entry-id timestamp input checksum))

  ;; Write entry to file
  (fprintf (wal-handle-port wal) "~s\n" entry)
  (flush-output (wal-handle-port wal))

  ;; Increment entry ID
  (set-wal-handle-next-entry-id! wal (+ entry-id 1))

  (displayln (format "[WAL] Appended entry ~a" entry-id))

  entry-id)

;; ─────────────────────────────────────────────────────────────────
;; WAL Read
;; ─────────────────────────────────────────────────────────────────

(define (read-wal-entries-from-file file-path)
  (cond
    [(not (file-exists? file-path)) '()]
    [else
     (define in-port (open-input-file file-path #:mode 'text))
     (define entries
       (let loop ([acc '()])
         (define line (read-line in-port))
         (cond
           [(eof-object? line)
            (close-input-port in-port)
            (reverse acc)]
           [else
            (define entry (read (open-input-string line)))
            (loop (cons entry acc))])))
     entries]))

(define/contract (wal-read-all wal)
  (-> wal-handle? (listof list?))

  (displayln (format "[WAL] Reading all entries from ~a"
                     (wal-handle-file-path wal)))

  (define entries (read-wal-entries-from-file (wal-handle-file-path wal)))

  (displayln (format "[WAL] Read ~a entries" (length entries)))

  entries)

;; ─────────────────────────────────────────────────────────────────
;; WAL Verification
;; ─────────────────────────────────────────────────────────────────

(define/contract (wal-verify-integrity wal)
  (-> wal-handle? boolean?)

  (displayln "[WAL] Verifying integrity...")

  (define entries (wal-read-all wal))
  (define all-valid?
    (for/and ([entry entries]
              [expected-id (in-naturals)])
      (match entry
        [(list entry-id timestamp input checksum)
         ;; Verify sequential IDs
         (define id-ok? (= entry-id expected-id))

         ;; Recompute checksum
         (define checksum-data
           (string->bytes/utf-8
            (format "~a:~a:~s" entry-id timestamp input)))
         (define computed-checksum (sha256 checksum-data))
         (define checksum-ok? (equal? checksum computed-checksum))

         (when (not id-ok?)
           (displayln (format "[X] Entry ID mismatch: expected ~a, got ~a"
                              expected-id entry-id)))
         (when (not checksum-ok?)
           (displayln (format "[X] Checksum mismatch for entry ~a" entry-id)))

         (and id-ok? checksum-ok?)]
        [_
         (displayln (format "[X] Invalid entry format: ~a" entry))
         #f])))

  (displayln (format "[WAL] Integrity: ~a" (if all-valid? "OK ✓" "FAILED ✗")))

  all-valid?)

;; ─────────────────────────────────────────────────────────────────
;; WAL Close
;; ─────────────────────────────────────────────────────────────────

(define/contract (wal-close! wal)
  (-> wal-handle? void?)

  (close-output-port (wal-handle-port wal))

  (displayln (format "[WAL] Closed ~a" (wal-handle-file-path wal))))

;; ═══════════════════════════════════════════════════════════════════
;; Module Complete
;; ═══════════════════════════════════════════════════════════════════
