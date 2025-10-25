# Production Deployment Guide

From proof-of-concept to production: blockchain integration, deployment, monitoring, and scaling.

---

## Current Status: Proof-of-Concept

**What XLN Racket currently is:**
- ✓ Complete implementation of all 5 layers
- ✓ Bilateral consensus (2-of-2 signatures)
- ✓ BFT consensus (≥2/3 quorum)
- ✓ Multi-hop routing
- ✓ Crash recovery (WAL + snapshots)
- ✓ 17/17 demos passing

**What's simulated:**
- Blockchain layer (no real RPC)
- Network I/O (no WebSocket server)
- Cryptography (signatures via racket/crypto, not secp256k1)
- Time (explicit timestamps in demos, not real clock)

**Production readiness:** 🟡 Core logic verified, I/O layer needs implementation

---

## Production Roadmap

### Phase 1: Real Blockchain Integration

**Current:**
```scheme
;; blockchain/types.rkt - simulated
(define chain (create-chain-state))
(register-entity! chain "alice" #"board-hash")
```

**Production:**
```scheme
;; blockchain/rpc.rkt - real Ethereum RPC
(define chain (connect-to-chain "https://eth-mainnet.alchemyapi.io/v2/..."))
(register-entity-tx! chain "alice" #"board-hash")  ; Returns tx hash, wait for confirmation
```

**Implementation checklist:**

**1. Replace simulated chain-state with JSON-RPC client**

Options:
- **ethers-ffi:** Call ethers.js via FFI (requires Node.js)
- **web3-racket:** Native Racket JSON-RPC (slower but pure)
- **Hybrid:** Racket consensus + TypeScript I/O layer

**2. Handle asynchronous operations**

```scheme
;; Current: synchronous
(process-settlement! chain "alice" "bob" diffs)

;; Production: async with confirmation
(define tx-hash (submit-settlement-tx! chain "alice" "bob" diffs))
(wait-for-confirmation tx-hash [confirmations 12])
```

**3. Add retry logic for network failures**

```scheme
(define (retry-rpc-call proc [max-attempts 3] [backoff-ms 1000])
  (let loop ([attempts 0])
    (with-handlers ([exn:fail:network?
                     (lambda (e)
                       (if (< attempts max-attempts)
                           (begin
                             (sleep (/ backoff-ms 1000))
                             (loop (+ attempts 1)))
                           (raise e)))])
      (proc))))
```

**4. Gas estimation and management**

```scheme
(define (estimate-settlement-gas diffs)
  (+ 21000  ; Base tx cost
     (* 20000 (length diffs))  ; Per-diff processing
     5000))  ; Safety buffer

(define (submit-with-gas-limit tx gas-limit)
  (rpc-call "eth_sendTransaction"
            (hash 'to contract-address
                  'data tx-data
                  'gas gas-limit)))
```

**5. Event monitoring**

```scheme
;; Listen for on-chain events
(define (start-event-listener contract-address)
  (define filter
    (make-filter
      #:address contract-address
      #:topics '("SettlementProcessed" "EntityRegistered")))

  (poll-events filter
    (lambda (event)
      (match (event-name event)
        ["SettlementProcessed"
         (handle-settlement-event event)]
        ["EntityRegistered"
         (handle-registration-event event)]))))
```

---

### Phase 2: Network I/O Layer

**Current:** No network communication (all in-memory)

**Production:** WebSocket server for entity-to-entity messaging

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│  WebSocket Server (I/O Shell)                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Pure Consensus Core (XLN Racket)                      │  │
│  │  - Bilateral consensus                                 │  │
│  │  - BFT consensus                                       │  │
│  │  - Routing                                             │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ↑                                    ↑
         │                                    │
   Entity A                              Entity B
```

**Implementation options:**

**Option 1: Racket web-server**

```scheme
#lang racket
(require web-server/websocket
         web-server/servlet-env)

(define (handle-ws-connection ws)
  (let loop ()
    (define msg (ws-recv ws))
    (cond
      [(eof-object? msg) (void)]  ; Client disconnected
      [else
       (define input (deserialize-input msg))
       (define-values (new-state outputs) (consensus-transition state input))
       (for ([output outputs])
         (ws-send! ws (serialize-output output)))
       (loop)])))

(serve/servlet
  (lambda (req) (response/xexpr '(html (body "XLN Node"))))
  #:port 8080
  #:servlet-path "/ws"
  #:extra-files-paths (list (build-path "static")))
```

**Option 2: Hybrid approach (recommended)**

- **Racket:** Consensus core (pure functions)
- **TypeScript:** WebSocket server, RPC client, monitoring
- **Interface:** FFI or HTTP API between layers

```typescript
// server.ts (TypeScript)
import WebSocket from 'ws';
import { execSync } from 'child_process';

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    // Deserialize input
    const input = JSON.parse(data.toString());

    // Call Racket consensus core
    const result = execSync(
      `racket -e '(require "consensus/core.rkt") (process-input (quote ${JSON.stringify(input)}))'`
    );

    // Send outputs back
    const outputs = JSON.parse(result.toString());
    outputs.forEach((output) => ws.send(JSON.stringify(output)));
  });
});
```

**Why hybrid:**
- TypeScript ecosystem (WebSocket libraries, deployment tools)
- Racket strengths (deterministic consensus, homoiconicity)
- Clear boundary between I/O (impure) and consensus (pure)

---

### Phase 3: Real Cryptography

**Current:** Racket's built-in crypto (for hashing only)

**Production:** secp256k1 signatures (Ethereum-compatible)

**Options:**

**1. FFI to libsecp256k1**

```scheme
#lang racket
(require ffi/unsafe)

(define libsecp (ffi-lib "libsecp256k1"))

(define secp256k1-ecdsa-sign
  (get-ffi-obj "secp256k1_ecdsa_sign" libsecp
    (_fun _pointer _pointer _pointer _pointer _pointer _pointer -> _int)))

(define (sign-message privkey msg-hash)
  (define context (secp256k1-context-create))
  (define signature (make-bytes 64))
  (secp256k1-ecdsa-sign context signature msg-hash privkey #f #f)
  signature)
```

**2. Hybrid: TypeScript for crypto, Racket for consensus**

```typescript
// crypto-service.ts
import { ethers } from 'ethers';

export function signMessage(privateKey: string, msgHash: string): string {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.signMessage(msgHash);
}

export function recoverAddress(msgHash: string, signature: string): string {
  return ethers.utils.recoverAddress(msgHash, signature);
}
```

```scheme
;; consensus/crypto-bridge.rkt
(require ffi/unsafe)

(define (sign-via-typescript privkey msg-hash)
  (define result
    (system* "node" "crypto-service.js" "sign" privkey msg-hash))
  (read-signature result))
```

**Recommendation:** Hybrid approach until Racket gets mature secp256k1 bindings.

---

## Deployment Options

### Option 1: Single-Node Deployment

**Use case:** Single entity running own XLN node

**Architecture:**

```
┌─────────────────────────────────────────┐
│  Docker Container                        │
│  ┌───────────────────────────────────┐  │
│  │  Racket XLN Consensus             │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  TypeScript I/O Layer             │  │
│  │  - WebSocket server (port 8080)   │  │
│  │  - Blockchain RPC client          │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Persistence                       │  │
│  │  - /data/wal.log                  │  │
│  │  - /data/snapshots/               │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Dockerfile:**

```dockerfile
FROM racket/racket:8.12

# Install dependencies
RUN raco pkg install --auto sha

# Install Node.js for I/O layer
RUN apt-get update && apt-get install -y nodejs npm

# Copy XLN code
WORKDIR /app
COPY . .

# Install TypeScript dependencies
WORKDIR /app/io-layer
RUN npm install

# Expose WebSocket port
EXPOSE 8080

# Start services
CMD ["./start.sh"]
```

**start.sh:**

```bash
#!/bin/bash

# Start Racket consensus core (background)
racket consensus/server.rkt &

# Start TypeScript I/O layer (foreground)
cd io-layer && npm start
```

---

### Option 2: Replicated Deployment (BFT Entities)

**Use case:** Entity with 3+ validators for Byzantine fault tolerance

**Architecture:**

```
                    Client
                      ↓
              ┌───────────────┐
              │  Load Balancer │
              └───────────────┘
                      ↓
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
   Replica 1      Replica 2     Replica 3
   (Proposer)    (Validator)   (Validator)
```

**Each replica:**
- Full XLN node (consensus + I/O)
- Connects to same blockchain RPC
- Communicates via gossip (entity inputs)
- Independent WAL + snapshots

**Deployment:**

```bash
# Deploy 3 replicas with different signer keys
docker run -d \
  -e ENTITY_ID=entity-1 \
  -e SIGNER_ID=alice \
  -e SIGNER_KEY=0x123... \
  -e IS_PROPOSER=true \
  -e VALIDATORS=alice,bob,charlie \
  -e QUORUM_THRESHOLD=2 \
  -v /data/alice:/app/data \
  xln-node:latest

docker run -d \
  -e ENTITY_ID=entity-1 \
  -e SIGNER_ID=bob \
  -e SIGNER_KEY=0x456... \
  -e IS_PROPOSER=false \
  -e VALIDATORS=alice,bob,charlie \
  -e QUORUM_THRESHOLD=2 \
  -v /data/bob:/app/data \
  xln-node:latest

docker run -d \
  -e ENTITY_ID=entity-1 \
  -e SIGNER_ID=charlie \
  -e SIGNER_KEY=0x789... \
  -e IS_PROPOSER=false \
  -e VALIDATORS=alice,bob,charlie \
  -e QUORUM_THRESHOLD=2 \
  -v /data/charlie:/app/data \
  xln-node:latest
```

---

### Option 3: Hybrid Cloud Deployment

**Use case:** Multi-region, high availability

**Components:**

**1. Consensus layer (Kubernetes pods)**

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: xln-consensus
spec:
  serviceName: xln
  replicas: 3
  template:
    spec:
      containers:
      - name: xln-node
        image: xln-racket:v1.0
        env:
        - name: ENTITY_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        volumeMounts:
        - name: data
          mountPath: /app/data
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 10Gi
```

**2. API layer (serverless functions)**

```typescript
// Cloudflare Worker or AWS Lambda
export default {
  async fetch(request: Request) {
    const { entity, action, payload } = await request.json();

    // Forward to consensus layer
    const ws = new WebSocket(`wss://xln-consensus-${entity}.example.com`);
    ws.send(JSON.stringify({ action, payload }));

    const response = await new Promise((resolve) => {
      ws.onmessage = (msg) => resolve(JSON.parse(msg.data));
    });

    return new Response(JSON.stringify(response));
  }
};
```

**3. Monitoring (Prometheus + Grafana)**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
data:
  prometheus.yml: |
    scrape_configs:
    - job_name: 'xln-nodes'
      static_configs:
      - targets:
        - xln-consensus-0:9090
        - xln-consensus-1:9090
        - xln-consensus-2:9090
```

---

## Monitoring and Observability

### Metrics to Track

**Consensus metrics:**

```scheme
;; consensus/metrics.rkt
(provide (all-defined-out))

(define consensus-metrics (make-hash))

(define (record-frame-committed! height latency-ms)
  (hash-set! consensus-metrics 'frames-committed
             (+ 1 (hash-ref consensus-metrics 'frames-committed 0)))
  (hash-set! consensus-metrics 'avg-latency-ms
             (/ (+ latency-ms (* (hash-ref consensus-metrics 'avg-latency-ms 0)
                                 (- (hash-ref consensus-metrics 'frames-committed 0) 1)))
                (hash-ref consensus-metrics 'frames-committed 0))))

(define (get-metrics)
  consensus-metrics)
```

**Expose via HTTP:**

```scheme
;; monitoring/http-server.rkt
(require web-server/servlet
         "consensus/metrics.rkt")

(define (metrics-handler req)
  (response/output
    (lambda (out)
      (fprintf out "# HELP xln_frames_committed Total committed frames\n")
      (fprintf out "# TYPE xln_frames_committed counter\n")
      (fprintf out "xln_frames_committed ~a\n"
               (hash-ref (get-metrics) 'frames-committed 0))
      (fprintf out "# HELP xln_avg_latency_ms Average commit latency\n")
      (fprintf out "# TYPE xln_avg_latency_ms gauge\n")
      (fprintf out "xln_avg_latency_ms ~a\n"
               (hash-ref (get-metrics) 'avg-latency-ms 0)))))
```

**Key metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `xln_frames_committed` | Counter | Total bilateral/BFT frames committed |
| `xln_frames_pending` | Gauge | Frames awaiting signatures |
| `xln_avg_latency_ms` | Gauge | Average time from propose → commit |
| `xln_byzantine_faults` | Counter | Detected signature/state mismatches |
| `xln_mempool_size` | Gauge | Pending transactions |
| `xln_wal_size_bytes` | Gauge | WAL file size |
| `xln_snapshot_age_seconds` | Gauge | Time since last snapshot |
| `xln_rpc_errors` | Counter | Blockchain RPC failures |
| `xln_network_peers` | Gauge | Connected gossip peers |

---

### Logging

**Structured logging:**

```scheme
;; logging/logger.rkt
(require json)

(define (log-structured level component msg [data #hash()])
  (define log-entry
    (hasheq 'timestamp (current-milliseconds)
            'level level
            'component component
            'message msg
            'data data))
  (displayln (jsexpr->string log-entry)))

;; Usage
(log-structured 'info 'bilateral-consensus "Frame committed"
                (hasheq 'height 42 'entity "alice"))
```

**Output:**
```json
{"timestamp":1234567890,"level":"info","component":"bilateral-consensus","message":"Frame committed","data":{"height":42,"entity":"alice"}}
```

**Log levels:**
- `debug`: Verbose internal state
- `info`: Normal operations (frame committed, transaction added)
- `warn`: Recoverable issues (RPC timeout, retry)
- `error`: Failures requiring intervention (Byzantine fault, WAL corruption)

---

### Alerting

**Prometheus alerts:**

```yaml
groups:
- name: xln-alerts
  rules:
  - alert: HighConsensusLatency
    expr: xln_avg_latency_ms > 5000
    for: 5m
    annotations:
      summary: "Consensus latency > 5s"

  - alert: ByzantineFaultDetected
    expr: rate(xln_byzantine_faults[5m]) > 0
    annotations:
      summary: "Byzantine fault detected"
      severity: critical

  - alert: WALSizeGrowing
    expr: rate(xln_wal_size_bytes[1h]) > 10000000  # 10MB/hour
    annotations:
      summary: "WAL not being pruned"
```

---

## Performance Optimization

### Baseline Performance

**Current (proof-of-concept):**
- Bilateral consensus: ~10ms (in-memory, no I/O)
- BFT consensus (3 validators): ~30ms
- Multi-hop routing (10 hops): ~5ms
- Merkle proof generation: ~2ms

**Production targets:**
- Bilateral consensus: <100ms (with network I/O)
- BFT consensus: <500ms
- Multi-hop routing: <50ms

---

### Optimization Strategies

**1. Batch transactions**

```scheme
;; Current: Process transactions one-by-one
(for ([tx txs])
  (add-transaction! machine tx))

;; Optimized: Batch processing
(define (add-transactions-batch! machine txs)
  (define sorted-txs (sort-transactions txs))
  (set-account-machine-mempool! machine
    (append sorted-txs (account-machine-mempool machine))))
```

**2. Parallelize validation**

```scheme
(require racket/async-channel)

(define (validate-frames-parallel frames)
  (define results (make-async-channel))
  (for ([frame frames])
    (thread
      (lambda ()
        (async-channel-put results (validate-frame frame)))))
  (for/list ([_ frames])
    (async-channel-get results)))
```

**3. Cache expensive computations**

```scheme
;; Merkle root caching
(define merkle-cache (make-hash))

(define (compute-merkle-root-cached hashes)
  (define key (sha256 (apply bytes-append hashes)))
  (hash-ref merkle-cache key
    (lambda ()
      (define root (compute-merkle-root hashes))
      (hash-set! merkle-cache key root)
      root)))
```

**4. Prune WAL aggressively**

```scheme
;; Keep only entries after last snapshot
(define (prune-wal! wal-path snapshot-height)
  (define entries (read-wal-entries wal-path))
  (define recent-entries
    (filter (lambda (e) (> (entry-height e) snapshot-height)) entries))
  (write-wal! wal-path recent-entries))
```

---

## Security Considerations

### Threat Model

**Assumptions:**
- ≥2/3 validators are honest (BFT)
- Both parties honest in bilateral (or disputes go on-chain)
- Blockchain is secure (Ethereum assumptions)

**Attack vectors:**

**1. Replay attack**
- **Mitigation:** Nonce-based ordering, frame height verification

**2. Double-spend**
- **Mitigation:** Balance checks, delta validation

**3. Byzantine proposer**
- **Mitigation:** Validator signature verification, ≥2/3 quorum

**4. Network partition**
- **Mitigation:** Timeouts, eventual consistency (gossip CRDT)

**5. WAL tampering**
- **Mitigation:** SHA256 checksums per entry

---

### Security Checklist

**Code:**
- [ ] All consensus functions are pure (no I/O)
- [ ] All inputs validated (contracts enforced)
- [ ] No secret data in logs
- [ ] Nonces prevent replay
- [ ] Signatures verified before state changes

**Deployment:**
- [ ] Private keys stored in HSM or encrypted keystore
- [ ] TLS for all network communication
- [ ] Firewall rules (only allow WebSocket port)
- [ ] Regular security audits
- [ ] Dependency scanning (npm audit, raco pkg update)

**Operations:**
- [ ] Access control (who can register entities?)
- [ ] Rate limiting (prevent DoS)
- [ ] Monitoring alerts configured
- [ ] Incident response plan documented
- [ ] Regular backups tested

---

## Disaster Recovery

### Backup Strategy

**What to backup:**
1. **WAL files** - Complete operation history
2. **Snapshots** - State at specific heights
3. **Private keys** - Entity signer keys (encrypted)

**Backup frequency:**
- WAL: Real-time replication (rsync every 5min)
- Snapshots: Daily
- Keys: Once (stored in vault)

**Backup script:**

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/xln/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

# Backup WAL
cp /app/data/*.wal "$BACKUP_DIR/"

# Backup latest snapshot
cp /app/data/snapshots/latest.ss "$BACKUP_DIR/"

# Upload to S3 (or other cloud storage)
aws s3 sync "$BACKUP_DIR" s3://xln-backups/$(hostname)/$(date +%Y-%m-%d)

# Prune old backups (keep 30 days)
find /backups/xln -type d -mtime +30 -exec rm -rf {} \;
```

---

### Recovery Procedures

**Scenario 1: Node crash (disk intact)**

```bash
# 1. Restart node
docker restart xln-node

# 2. Node automatically recovers from WAL
# (deterministic replay from last snapshot)

# 3. Verify state
curl http://localhost:9090/health
```

**Scenario 2: Disk corruption**

```bash
# 1. Stop node
docker stop xln-node

# 2. Restore from backup
aws s3 sync s3://xln-backups/node-1/2024-01-15 /app/data/

# 3. Restart with recovered data
docker start xln-node

# 4. Verify state hash matches other replicas
```

**Scenario 3: Complete data loss**

```bash
# 1. Deploy new node
docker run -d xln-node:latest

# 2. Sync from blockchain events
racket scripts/sync-from-chain.rkt \
  --entity-id entity-1 \
  --from-block 12345678

# 3. Verify state matches
```

---

### State Verification

**Compare state hashes across replicas:**

```scheme
;; scripts/verify-consensus.rkt
(require "consensus/entity/machine.rkt")

(define (verify-replicas replicas)
  (define state-hashes
    (for/list ([replica replicas])
      (cons (replica-id replica)
            (compute-state-hash (replica-state replica)))))

  (define unique-hashes (remove-duplicates (map cdr state-hashes)))

  (if (= (length unique-hashes) 1)
      (displayln "✓ All replicas in consensus")
      (begin
        (displayln "✗ State mismatch detected:")
        (for ([pair state-hashes])
          (displayln (format "  ~a: ~a" (car pair) (bytes->hex (cdr pair))))))))
```

---

## Scaling Strategies

### Vertical Scaling

**Single node limits:**
- CPU: Signature verification (parallelizable)
- Memory: WAL size, gossip profiles
- Disk I/O: WAL writes, snapshot reads

**Optimization:**
- Use SSD for WAL (NVMe preferred)
- Increase RAM for gossip cache
- Multi-core for parallel validation

---

### Horizontal Scaling

**BFT entities scale naturally:**
- Add more validators (increase quorum threshold)
- Each validator independent
- Byzantine fault tolerance improves

**Bilateral channels scale:**
- Independent (no coordination)
- Add channels = linear scaling
- Routing complexity: O(edges) in gossip graph

**Bottleneck:** Blockchain settlement (on-chain gas limits)

**Mitigation:** Batch settlements, use L2 (Optimism, Arbitrum)

---

## Production Checklist

### Before Launch

**Technical:**
- [ ] All 17 demos pass
- [ ] Blockchain RPC integration tested
- [ ] WebSocket server load tested
- [ ] Real cryptography (secp256k1) integrated
- [ ] WAL + snapshot recovery tested
- [ ] Byzantine fault scenarios tested
- [ ] Performance benchmarks meet targets

**Operational:**
- [ ] Monitoring dashboards configured
- [ ] Alerts set up (PagerDuty, Slack)
- [ ] Backup strategy implemented
- [ ] Disaster recovery tested
- [ ] Runbooks documented
- [ ] On-call rotation scheduled

**Security:**
- [ ] Security audit completed
- [ ] Penetration testing done
- [ ] Private keys in HSM
- [ ] Access control configured
- [ ] Incident response plan ready

**Documentation:**
- [ ] API documentation published
- [ ] Deployment guide written
- [ ] Troubleshooting guide available
- [ ] User onboarding materials ready

---

## Future Enhancements

### Short-term (3-6 months)

**1. Mobile client support**
- Lightweight consensus client
- Signature via mobile keystore
- Push notifications for frame proposals

**2. Privacy enhancements**
- Zero-knowledge proofs for balance checks
- Encrypted mempools
- Anonymity sets for routing

**3. Cross-chain support**
- Multi-chain settlement (Ethereum, Polygon, Arbitrum)
- Atomic swaps between chains
- Unified liquidity

---

### Long-term (6-12 months)

**1. Sharding**
- Partition entities into shards
- Cross-shard routing
- Scalability to 1M+ entities

**2. Formal verification**
- Verify consensus safety in Agda/Coq
- Machine-checked proofs
- Certified correctness

**3. L2 integration**
- Deploy XLN as Optimistic Rollup
- On-chain fraud proofs
- Low-cost settlement

---

## Getting Started with Production

**Recommended path:**

**Week 1-2:** Blockchain integration
- Integrate ethers.js or web3.js
- Test entity registration on testnet
- Implement settlement transactions

**Week 3-4:** Network layer
- Build WebSocket server
- Test entity-to-entity communication
- Implement gossip propagation

**Week 5-6:** Real cryptography
- Integrate secp256k1
- Test signature verification
- Migrate from simulated to real keys

**Week 7-8:** Deployment
- Create Docker images
- Deploy to staging environment
- Load testing and optimization

**Week 9-10:** Monitoring and ops
- Set up Prometheus + Grafana
- Configure alerts
- Test disaster recovery

**Week 11-12:** Security and launch
- Security audit
- Penetration testing
- Production launch

---

## Resources

**Ethereum Integration:**
- ethers.js: https://docs.ethers.org/v6/
- web3.js: https://web3js.readthedocs.io/
- Hardhat (testing): https://hardhat.org/

**Deployment:**
- Docker: https://docs.docker.com/
- Kubernetes: https://kubernetes.io/docs/
- Terraform: https://www.terraform.io/docs/

**Monitoring:**
- Prometheus: https://prometheus.io/docs/
- Grafana: https://grafana.com/docs/
- Loki (logs): https://grafana.com/docs/loki/

**Security:**
- OWASP: https://owasp.org/
- Trail of Bits (audits): https://www.trailofbits.com/
- OpenZeppelin: https://docs.openzeppelin.com/

---

## Support

**Commercial support:**
- Email: support@xln.network
- Slack: xln-community.slack.com
- Office hours: Fridays 2-4pm UTC

**Bug reports:**
- GitHub issues: https://github.com/xln/xln-scheme/issues
- Security issues: security@xln.network (GPG key available)

**Community:**
- Discord: discord.gg/xln
- Forum: forum.xln.network
- Twitter: @XLNNetwork

---

**Previous:** [← Contributing](07-contributing.md)

λ.
