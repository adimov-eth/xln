# xln Protocol Readiness Audit

**Date:** 2026-02-09
**Auditor:** Independent protocol review (automated)
**Scope:** Determinism, HTLC completeness, cryptographic integrity, contract readiness, technical debt, server decomposition
**Codebase:** main branch @ commit 84420a5

---

## 1. DETERMINISM AUDIT

**Claim under test:** `(prevEnv, inputs) -> nextEnv` -- same inputs produce same outputs, always.

### 1.1 Consensus-Path Files (CLEAN)

The following files contain zero non-deterministic patterns (no Date.now, Math.random, setTimeout, setInterval, crypto.randomBytes, or ambient I/O):

| File | Lines | Status |
|------|-------|--------|
| `runtime/entity-consensus.ts` | 1,408 | CLEAN |
| `runtime/account-consensus.ts` | 1,264 | CLEAN |
| `runtime/account-crypto.ts` | 427 | CLEAN |
| `runtime/hanko-signing.ts` | 485 | CLEAN |
| `runtime/entity-tx/handlers/*.ts` (all) | ~1,200 | CLEAN |
| `runtime/account-tx/handlers/*.ts` (all) | ~800 | CLEAN |
| `runtime/validation-utils.ts` | 468 | CLEAN |

**Methodology:** Grep for `Date.now|Math.random|setTimeout|setInterval|crypto.random|randomBytes` across all `runtime/**/*.ts` files, then manually verified every hit.

### 1.2 R-Layer (Runtime) Non-Determinism -- Contained, Not in Consensus

Hits in `runtime/runtime.ts` (1,300+ lines):

| Line | Pattern | Context | Severity |
|------|---------|---------|----------|
| 551 | `Date.now()` | `seenAt` field in gossip hint cache | INFO -- routing optimization, not state |
| 562 | `Date.now()` | `seenAt` in `registerEntityRuntimeHint` | INFO -- same |
| 608 | `Date.now()` | `nowMs` in `planEntityOutputs` for defer timeout | INFO -- output routing, not consensus state |
| 223 | `setTimeout` | `sleep()` utility for infrastructure loop | INFO -- not in consensus path |
| 397 | `setTimeout` | `sleep` in runtime loop | INFO -- infrastructure |
| 1290 | `Date.now()` | `getWallClockMs()` for `env.timestamp` | IMPORTANT -- see note below |

**Critical note on env.timestamp (runtime.ts:1290):**
```
if (!env.scenarioMode) { env.timestamp = getWallClockMs(); }
```
Wall-clock time is injected into `env.timestamp` ONLY in non-scenario (production) mode. In scenarios, timestamp is controlled. This is the single injection point where real-world time enters the deterministic state machine. This is architecturally correct -- the timestamp becomes an *input* to the pure function, not a side effect within it. Entity and account consensus read from `env.timestamp`, never from `Date.now()` directly.

### 1.3 Encryption Nonce (crypto-noble.ts:45)

`crypto-noble.ts:45` uses `crypto.getRandomValues()` for ChaCha20-Poly1305 nonce generation. This is used exclusively for HTLC onion envelope encryption (privacy layer), NOT for consensus state transitions. The nonce is ephemeral and never enters the frame hash. Architecturally sound.

### 1.4 Verdict

**PASS.** The consensus path (`entity-consensus.ts`, `account-consensus.ts`, all `entity-tx/` and `account-tx/` handlers) is deterministic. Non-determinism exists only in the R-layer routing/infrastructure code and the encryption privacy layer, both of which are outside the `(prevEnv, inputs) -> nextEnv` boundary. The single wall-clock injection point (`env.timestamp`) is correctly treated as an input parameter.

---

## 2. HTLC PAYMENT FLOW TRACE (Alice -> Hub -> Bob)

### 2.1 Initiation -- Entity Layer

**File:** `runtime/entity-tx/handlers/htlc-payment.ts`

1. Alice's entity creates an HTLC payment via `htlcPayment` handler (line 31)
2. Requires `secret` and `hashlock` in `tx.data` (line 44-46) -- determinism enforced, no runtime secret generation
3. Route discovery via gossip network graph (line 75+)
4. Onion envelope created with X25519 per-hop encryption (`crypto-noble.ts`) so intermediaries only see next hop
5. HTLC route tracked in `state.htlcRoutes` Map (line 130+)
6. Lock aggregated in `state.lockBook` for settlement proofs

### 2.2 Lock -- Account Layer

**File:** `runtime/account-tx/handlers/htlc-lock.ts`

1. `htlc_lock` handler (line 15) creates bilateral lock on Alice<->Hub account
2. Capacity validation: checks available balance against lock amount (line 55+)
3. Amount bounds checked against `FINANCIAL` constants (min/max)
4. Timelock and height expiry validation (line 70+)
5. Hold accounting: increments `leftHtlcHold` or `rightHtlcHold` on the delta (line 95+)
6. Lock stored in account's `htlcLocks` array

### 2.3 Forwarding -- Intermediary (Hub)

**File:** `runtime/entity-tx/handlers/account.ts` (lines 201-540+)

1. Hub receives locked HTLC on Alice<->Hub account
2. `pendingForward` mechanism queues the forwarding action (line 230+)
3. Hub decrypts onion layer to discover next hop (Bob)
4. Fee calculation via `calculateHtlcFee` (line 310+)
5. Timelock decremented per hop (standard HTLC safety)
6. New `htlc_lock` created on Hub<->Bob account with reduced amount (fees) and reduced timelock

### 2.4 Reveal -- Account Layer

**File:** `runtime/account-tx/handlers/htlc-reveal.ts`

1. Bob reveals secret via `htlc_reveal` handler (line 14)
2. Secret verified against hashlock via `hashHtlcSecret()` (line 35)
3. Delta application is canonical: left sends decreases offdelta, right sends increases (line 60+)
4. Hold released with underflow guard (line 75)
5. Returns `{ secret, hashlock }` for backward propagation through `revealedSecrets` array

### 2.5 Resolution -- Account Layer

**File:** `runtime/account-tx/handlers/htlc-resolve.ts`

1. Unified handler for success (secret reveal), timeout, and cancel (line 10)
2. Success path: applies delta change, releases hold
3. Timeout path: reverses hold, returns funds to sender
4. Both paths deterministic -- outcome determined by secret presence and timelock expiry

### 2.6 Backward Propagation

Secret propagates backward through the route via `revealedSecrets` array returned from account-layer handlers. Each intermediary hub receives the secret and reveals on its upstream account, collecting fees at each hop.

### 2.7 Gaps and Stubs

| Item | File:Line | Severity |
|------|-----------|----------|
| Cooperative dispute settlement | `entity-tx/handlers/dispute.ts:279` | MEDIUM -- "not implemented yet" for cooperative sig path; unilateral timeout path works |
| BrowserVM collateral getter | `scenarios/ahb.ts:1690` | LOW -- scenario-only, not protocol |
| Dual-sig cooperative disputes | `scenarios/ahb.ts:2745` | MEDIUM -- skipped in scenario, needs implementation for production dispute resolution |

### 2.8 Verdict

**PASS with caveats.** The complete HTLC multi-hop path (lock, forward, reveal, resolve, backward propagation) is implemented with real logic, not stubs. The onion routing with X25519 encryption provides genuine privacy. Two gaps exist: (1) cooperative dispute settlement is not yet implemented (unilateral timeout path works), (2) no evidence of HTLC timeout cascade testing across multi-hop (though the per-hop timelock decrement logic exists).

---

## 3. CRYPTOGRAPHIC INTEGRITY

### 3.1 Signing -- Real secp256k1

**File:** `runtime/account-crypto.ts`

- Imports `@noble/secp256k1` (line 7) -- real, audited library
- `signAccountFrame()` (line 331): signs keccak256 hash with secp256k1, requires `env.runtimeSeed`
- `verifyAccountSignature()` (line 366): calls `secp256k1.verify()` -- actual cryptographic verification, not a stub
- Key derivation for numeric signer IDs: BIP-39 HD path (`m/44'/60'/0'/0/{signerId}`) via `@scure/bip32` + `@scure/bip39` (line 104-109)
- Key derivation for named signers: HMAC-SHA256 of `runtimeSeed + signerId` (line 126)
- `registerTestKeys()` (line 314): **throws error** -- disabled, no test bypass

### 3.2 Entity Consensus Signatures -- Hanko System

**File:** `runtime/hanko-signing.ts`

- `signEntityHashes()` (line 75): builds real ABI-encoded hanko with secp256k1 signatures
- `buildQuorumHanko()` (line 152): combines M-of-N validator signatures into composite hanko
- `verifyHankoForHash()` (line 297): full verification pipeline:
  - Requires at least 1 EOA signature (line 332)
  - Recovers signer addresses from secp256k1 signatures
  - Validates board membership against entity replicas or gossip profiles (lines 373-471)
  - Computes voting power and checks against quorum threshold

### 3.3 Envelope Encryption

**File:** `runtime/crypto-noble.ts` (100 lines)

- X25519 key exchange via `@noble/curves/ed25519`
- ChaCha20-Poly1305 AEAD via `@noble/ciphers/chacha`
- Ephemeral keys per encryption (unlinkable)
- Used for HTLC onion envelope privacy, not consensus

### 3.4 Frame Hashing

- Entity frames: `createEntityFrameHash()` at `entity-consensus.ts:62` -- keccak256 over reserves, accounts, HTLC routes, governance state
- Account frames: `createFrameHash()` at `account-consensus.ts:125` -- keccak256 over full delta states, height, timestamp, prevFrameHash

### 3.5 Anti-Bypass Verification

| Check | Result |
|-------|--------|
| `registerTestKeys` callable? | NO -- throws error (account-crypto.ts:314) |
| `if (testMode)` conditionals in crypto? | NONE found |
| Signature verification actually called? | YES -- `verifyAccountSignature` called in `handleAccountInput` (account-consensus.ts:847-960) |
| Validator recomputes hash? | YES -- `entity-consensus.ts:455-473` recomputes from own state, rejects proposer hash mismatch |
| Validator stores own state? | YES -- `entity-consensus.ts:496` stores validator-computed state, not proposer-supplied |

### 3.6 Verdict

**PASS.** Cryptography is real, not placeholder. secp256k1 via @noble (audited library), BIP-39 HD derivation, X25519+ChaCha20 for privacy. No test key bypasses. Signature verification is enforced in consensus paths. Validators independently recompute state hashes.

---

## 4. CONTRACT READINESS

### 4.1 Contract Inventory

| Contract | Lines | Purpose |
|----------|-------|---------|
| `Depository.sol` | 1,210 | Core settlement, reserves, collateral, dispute, flashloan |
| `EntityProvider.sol` | 1,180 | Entity registration, BCD governance, Hanko verification |
| `Account.sol` | 441 | Settlement library for bilateral accounts |
| `Types.sol` | 197 | Shared type definitions |
| `DeltaTransformer.sol` | ~200+ | HTLC/swap transformer (imports console.sol) |
| `ECDSA.sol` | ~50 | Signature recovery utility |
| `IDepository.sol` | ~100 | Interface |
| `IEntityProvider.sol` | ~80 | Interface |
| `IDeltaTransformer.sol` | ~30 | Interface |
| Mock contracts (ERC20/721/1155) | ~300 | Test-only |
| **Total production Solidity** | **~3,500** | |

### 4.2 Depository.sol Assessment

**Implemented:**
- `processBatch()` (line 253): Hanko-authorized batch processing
- `_processBatch()` (line 376): Core batch execution with flashloan mechanism
- Flashloan aggregation with per-tokenId checks (lines 377-511)
- Settlement with delta application (lines 1082-1131)
- Debt/insurance FIFO system (lines 538-1008)
- Dispute start/finalize (lines 1010-1079)
- ReentrancyGuard, emergency pause, admin controls
- ERC20/ERC721/ERC1155 token support

**Concerns:**
- `unsafeProcessBatch()` (line 299): Admin bypass of Hanko authorization. Comment says "for admin/test flows." **Must be removed or access-controlled before mainnet.** Currently `public` -- any caller can use it (guarded only by `whenNotPaused` and `nonReentrant`).
- No `console.sol` import in Depository.sol (CLEAN)

### 4.3 EntityProvider.sol Assessment

**Implemented:**
- Entity registration (numbered + lazy modes)
- BCD governance (Board/Control/Dividend with time-locked transitions)
- Hanko signature verification with flashloan governance (line 737)
- `_detectSignatureCount()` (line 569): signature count from byte length
- `_buildBoardHash()` (line 641): board reconstruction
- `verifyHankoSignature()` (line 737): full verification requiring EOA voting power to meet threshold (line 842)

**Concerns:**
- `import "hardhat/console.sol"` (line 7): Adds ~2KB to deployed bytecode. Must be removed for production.
- `DeltaTransformer.sol` also imports console.sol (lines 8-9): same issue.

### 4.4 EIP-170 Size Concern

Both `Depository.sol` (1,210 LOC) and `EntityProvider.sol` (1,180 LOC) are large contracts. EIP-170 limits deployed bytecode to 24,576 bytes. Without compilation data available, this is a **risk flag** -- these contracts should be compiled and checked. The `console.sol` imports in EntityProvider.sol and DeltaTransformer.sol add unnecessary bytecode.

**Recommendation:** Compile with `--optimize --runs 200`, check bytecode sizes, remove all console.sol imports.

### 4.5 Test Coverage

| Test File | Lines | Type |
|-----------|-------|------|
| `test/Depository.ts` | 144 | Unit |
| `test/Depository.integration.ts` | 187 | Integration |
| `test/HankoAuthorization.test.ts` | 134 | Unit |
| `test/HankoAuthorization.test.cjs` | 6 | Stub (re-export) |
| `test/EntityProvider.test.cjs` | 289 | Unit |
| `test/ControlShares.test.cjs` | 554 | Unit |
| **Total test code** | **1,314** | |

**Test-to-contract ratio: 1,314 test lines / 3,500 contract lines = 0.38x**

For fintech-grade contracts handling real funds, this is **critically low**. Industry standard for DeFi is 2-5x test-to-contract ratio. Key missing test coverage:

- No fuzz testing
- No invariant testing (Foundry/Echidna)
- No formal verification
- Dispute resolution flow: minimal test coverage
- Flashloan attack vectors: not tested
- Multi-token settlement edge cases: not tested
- `unsafeProcessBatch` access control: not tested

### 4.6 Verdict

**CONDITIONAL PASS.** Contracts are substantial implementations, not stubs. Core settlement, Hanko verification, dispute, and flashloan mechanisms are implemented. However, three blockers before mainnet: (1) `unsafeProcessBatch` is publicly callable, (2) console.sol imports inflate bytecode, (3) test coverage at 0.38x is insufficient for fund-holding contracts.

---

## 5. TODOs / HACKs / FIXMEs IN CONSENSUS PATH

### 5.1 Consensus-Critical (Entity + Account Layer)

| Severity | File:Line | Content |
|----------|-----------|---------|
| MEDIUM | `entity-consensus.ts:287` | Comment "IMMUTABILITY: Clone replica at function start (fintech-safe, hacker-proof)" -- not a TODO but indicates awareness of clone-first pattern |
| LOW | `entity-consensus.ts:997` | `// TODO: Pass all rpcs for failover` -- J-layer RPC failover not implemented, single-RPC dependency |
| MEDIUM | `entity-tx/j-events.ts:103` | `// TODO: For multi-signer production, add appliedJBlockHashes: Set<string>` -- J-event deduplication missing for multi-signer setups |
| LOW | `account-tx/handlers/swap-resolve.ts:22` | `// TODO(liquidation): Add solvency check after delta updates` -- no post-swap solvency validation |
| LOW | `account-tx/handlers/swap-resolve.ts:28` | `// TODO(fees): Add fee collection on matched trades` -- swap fees not implemented |
| MEDIUM | `entity-tx/handlers/dispute.ts:279` | `// Cooperative: use cooperative settlement sig (not implemented yet)` -- only unilateral dispute path works |

### 5.2 Infrastructure / R-Layer

| Severity | File:Line | Content |
|----------|-----------|---------|
| LOW | `jurisdiction-factory.ts:122` | `throw new Error('RPC EVM not implemented')` -- throws, not silently broken |
| LOW | `jurisdiction-factory.ts:248` | `// TODO: Restore VM state from snapshot` -- persistence not implemented |
| LOW | `jurisdiction-factory.ts:269` | `// TODO: Save to Level storage` |
| LOW | `jurisdiction-factory.ts:279` | `// TODO: Load from Level storage` |
| LOW | `evm.ts:282` | `// TODO: Implement fundReserves function` |
| LOW | `evm.ts:648-649` | `throw new Error('Name transfer not implemented')` -- throws, not silently broken |
| INFO | `health.ts:97` | `status: 'healthy', // TODO: Add health check` -- hardcoded health response |
| INFO | `health.ts:130` | `database: true, // TODO: Check actual DB connection` |
| INFO | `networking/gossip.ts:201` | `// TODO: Wire to PathFinder class` -- using simple BFS instead |
| INFO | `proof-builder.ts:145` | `allowances: [], // Phase 2: Stub with empty array` -- allowance proof generation stubbed |

### 5.3 Scenarios (Non-Critical)

| Severity | File:Line | Content |
|----------|-----------|---------|
| INFO | `scenarios/ahb.ts:345` | `// TODO: Re-implement with correct bilateral consensus understanding` |
| INFO | `scenarios/ahb.ts:2745` | Cooperative disputes skipped |
| INFO | `scenarios/grid.ts:252,273` | `// TODO: Actually open accounts` |
| INFO | `scenarios/executor.ts:1005,1028,1051,1071` | Deposit/withdraw/transfer/chat not implemented in executor |
| INFO | `scenarios/parser.ts:75` | `// TODO: Actually load and merge included scenarios` |
| INFO | `entity-id-utils.ts:60` | Provider-scoped entity format defined but not used |
| INFO | `orderbook/core.ts:8` | TypedArray serialization perf note |

### 5.4 Verdict

**ACCEPTABLE for current stage.** No hacks or workarounds in the consensus path. The 6 consensus-path TODOs are genuine feature gaps (cooperative disputes, swap fees, J-event dedup, RPC failover), not broken logic. Functions that are not implemented throw errors rather than silently returning bad data. The `proof-builder.ts:145` allowance stub is a known Phase 2 item.

---

## 6. server.ts DECOMPOSITION (2,392 LOC)

### 6.1 Current Structure

`runtime/server.ts` is a monolith combining 6 distinct concerns:

### 6.2 Classification

#### Protocol API (KEEP) -- ~350 lines

Core runtime orchestration that must exist in any deployment:

| Function | Lines | Purpose |
|----------|-------|---------|
| `drainJWatcherQueue` | 69-96 | Process J-layer events |
| `applyJEventsToEnv` | 98-139 | Group and apply J-events |
| `startJWatcherProcessingLoop` | 141-149 | 100ms J-event drain loop |
| `hasPendingRuntimeWork` | 151-167 | Check for pending state transitions |
| `startRuntimeTickLoop` | 204-219 | Core runtime tick (TIMING.TICK_INTERVAL_MS) |
| `settleRuntimeFor` | 297-302 | Run N ticks for settlement |
| `waitForJBatchClear` | 169-182 | Wait for J-mempool drain |
| `waitForReserveUpdate` | 184-202 | Poll for reserve changes |
| `startXlnServer` (init portion) | 1870-2020 | Runtime + J-adapter initialization |

#### WebSocket Relay (KEEP, EXTRACT) -- ~250 lines

P2P message relay, gossip profile caching, encrypted message routing:

| Function | Lines | Purpose |
|----------|-------|---------|
| `handleRelayMessage` | 883-1139 | WebSocket message routing |
| `storeGossipProfile` | 755-763 | Profile cache |
| `seedHubProfilesInRelayCache` | 767-807 | Hub bootstrap |
| Client/profile state | 588-625 | Connection tracking |

#### Frontend Serving (CUT) -- ~80 lines

Static file serving that Vite/nginx should handle:

| Function | Lines | Purpose |
|----------|-------|---------|
| `serveStatic` | 858-881 | Static file server with MIME types |
| `MIME_TYPES` | 838-851 | MIME type map |
| `getMimeType` | 852-856 | Extension lookup |
| SPA fallback | in fetch handler | index.html fallback |

**Recommendation:** Remove entirely. Use Vite dev server in development, nginx/Cloudflare in production.

#### Faucet / Dev Tooling (CUT for production) -- ~500 lines

Development-only token faucets:

| Endpoint | Lines | Purpose |
|----------|-------|---------|
| `/api/faucet/erc20` | 1429-1579 | ERC20 token faucet |
| `/api/faucet/gas` | 1581-1642 | Gas faucet |
| `/api/faucet/reserve` | 1644-1800 | Reserve faucet |
| `/api/faucet/offchain` | 1800-1860 | Offchain credit faucet |
| `faucetLock` | 809-836 | Mutex for nonce management |
| `deployDefaultTokensOnRpc` | 410-445 | Token deployment |

**Recommendation:** Extract to `runtime/dev/faucet.ts`. Disable entirely in production builds via environment flag.

#### Debug API (EVALUATE) -- ~120 lines

| Endpoint | Lines | Purpose |
|----------|-------|---------|
| `/api/debug/events` | 1295-1324 | Relay event timeline |
| `/api/debug/reset` | 1326-1360 | State reset (token-guarded) |
| `/api/debug/entities` | 1363-1405 | Gossip entity listing |
| `resetServerDebugState` | 626-724 | Full state reset |
| `pushRelayDebugEvent` | 614-624 | Event logging |

**Recommendation:** Keep `/api/debug/events` and `/api/debug/entities` (useful for monitoring). Remove `/api/debug/reset` in production or restrict to admin auth.

#### RPC Proxy (EVALUATE) -- ~70 lines

| Endpoint | Lines | Purpose |
|----------|-------|---------|
| `/api/rpc` and `/rpc` | 1192-1249 | JSON-RPC forwarding |

**Recommendation:** Keep if nodes serve as RPC gateways. Otherwise, extract to separate service.

#### Hub Mesh Credit Bootstrap -- ~120 lines

| Function | Lines | Purpose |
|----------|-------|---------|
| `ensureHubPairMeshCredit` | 304-383 | Auto-credit between hub pairs |
| `bootstrapHubMeshCredit` | 385-408 | Bootstrap credit for hub mesh |
| Hub config in `startXlnServer` | 2029-2090 | Hub entity registration |

**Recommendation:** Keep -- core to network topology. Could extract to `runtime/hub-bootstrap.ts`.

### 6.3 Decomposition Summary

| Category | Lines (est.) | Action |
|----------|-------------|--------|
| Protocol API | ~350 | KEEP in server.ts |
| WebSocket Relay | ~250 | EXTRACT to `runtime/relay.ts` |
| Frontend Serving | ~80 | CUT -- use Vite/nginx |
| Faucet/Dev Tooling | ~500 | EXTRACT to `runtime/dev/faucet.ts`, disable in production |
| Debug API | ~120 | KEEP monitoring, CUT reset in production |
| RPC Proxy | ~70 | EVALUATE -- extract if not core |
| Hub Bootstrap | ~120 | EXTRACT to `runtime/hub-bootstrap.ts` |
| Startup/Config | ~300 | KEEP in server.ts |
| Shared State/Types | ~200 | Distribute to extracted modules |

**After decomposition, server.ts would be ~650 lines** (Protocol API + startup + shared state).

---

## 7. OVERALL ASSESSMENT

### Strengths

1. **Determinism discipline is real.** The consensus path is genuinely free of non-deterministic patterns. The architecture correctly treats wall-clock time as an input, not a side effect.

2. **Cryptography is production-grade.** Real secp256k1 via @noble, real BIP-39 HD derivation, real X25519+ChaCha20 for privacy. No test key bypasses. Validators independently verify state.

3. **HTLC multi-hop is complete.** Lock, forward, reveal, resolve, and backward secret propagation are all implemented with real logic. Onion routing provides genuine privacy.

4. **Consensus safety properties are sound.** Both entity (BFT) and account (bilateral 2-of-2) consensus enforce hash recomputation, signature verification, and frame chain integrity.

5. **Fail-fast philosophy.** Unimplemented features throw errors rather than silently returning incorrect data.

### Risks

1. **Contract test coverage (0.38x ratio) is the single biggest risk.** For contracts holding real funds, this must be 2-5x with fuzz testing and invariant checks before mainnet.

2. **`unsafeProcessBatch` is publicly callable** in Depository.sol. Any address can bypass Hanko authorization. This is a mainnet blocker.

3. **Cooperative dispute settlement is not implemented.** Only unilateral (timeout-based) dispute resolution works. This means dispute resolution is slower than it needs to be.

4. **J-event deduplication for multi-signer** (`j-events.ts:103`) is noted as a TODO. In a multi-signer production deployment, duplicate J-event processing could cause state divergence.

5. **server.ts monolith (2,392 LOC)** mixes protocol, infrastructure, and dev tooling. The faucet code could inadvertently be deployed to production.

6. **console.sol imports** in EntityProvider.sol and DeltaTransformer.sol add unnecessary bytecode and could push contracts past EIP-170 limits.

### Maturity Rating

| Component | Rating | Notes |
|-----------|--------|-------|
| Entity Consensus (E-layer) | ALPHA | Sound design, needs multi-signer production testing |
| Account Consensus (A-layer) | ALPHA | Bilateral protocol complete, dispute path partial |
| Cryptography | BETA | Real libraries, real verification, no bypasses |
| HTLC Routing | ALPHA | Complete flow, needs cascade timeout testing |
| Smart Contracts | PRE-ALPHA | Substantial code, insufficient tests, unsafe public functions |
| Runtime Infrastructure | ALPHA | Works end-to-end, needs decomposition |
| Overall Protocol | ALPHA | Core protocol is sound, needs hardening for mainnet |

---

## Appendix: File Reference

All paths relative to repository root (`/Users/adimov/Developer/xln/`).

### Core Consensus
- `runtime/entity-consensus.ts` (1,408 lines) -- Entity BFT consensus
- `runtime/account-consensus.ts` (1,264 lines) -- Bilateral 2-of-2 consensus
- `runtime/entity-tx/handlers/` -- Entity transaction handlers
- `runtime/account-tx/handlers/` -- Account transaction handlers

### Cryptography
- `runtime/account-crypto.ts` (427 lines) -- secp256k1 signing, key derivation
- `runtime/hanko-signing.ts` (485 lines) -- Multi-signer hanko system
- `runtime/crypto-noble.ts` (100 lines) -- X25519 + ChaCha20 envelope encryption

### Smart Contracts
- `jurisdictions/contracts/Depository.sol` (1,210 lines)
- `jurisdictions/contracts/EntityProvider.sol` (1,180 lines)
- `jurisdictions/contracts/Account.sol` (441 lines)
- `jurisdictions/contracts/Types.sol` (197 lines)
- `jurisdictions/test/` (1,314 lines total across 6 files)

### Infrastructure
- `runtime/runtime.ts` (~1,300 lines) -- Core runtime loop
- `runtime/server.ts` (2,392 lines) -- Unified server (monolith)
- `runtime/validation-utils.ts` (468 lines) -- Type validation system
