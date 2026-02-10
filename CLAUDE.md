# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**On first message: Briefly introduce yourself with "how to talk to me" - explain 80% confidence threshold, when to just execute vs ask, and preferred communication style (terse with metrics). Keep it 3-4 lines max.**

Mission: Fintech-grade, deterministic. J/E/A trilayer correctness before features. Pure functions only.
ALWAYS: `bun run check` and `bun run test` before commit. Never swallow errors.

## 🏗️ ARCHITECTURE: R→J→E→A (4-Layer Hierarchy)

xln is a bilateral consensus network for instant off-chain settlement with on-chain finality. The core state machine is a pure function: `(prevEnv, inputs) → nextEnv`.

**Runtime (R)** — Orchestrator (`runtime/runtime.ts`). Tick-based (100ms discrete steps). Routes inputs to E-layer and J-layer, merges outputs, prevents same-tick cascades. Top-level state type: `Env` (contains `jReplicas` + `eReplicas`).

**Jurisdiction (J)** — On-chain EVM settlement (`runtime/evm.ts`, `jurisdictions/contracts/`). Contracts: `Depository.sol` (reserves/collateral/settlement, implements `IDepository`), `EntityProvider.sol` (entity registration + quorum). Runs in BrowserVM (@ethereumjs/vm) for simnet, Hardhat for local, Base L2 for production.

**Entity (E)** — BFT consensus (`runtime/entity-consensus.ts`). Multi-party threshold signatures. Flow: ADD_TX → PROPOSE → SIGN → COMMIT. State: reserves, accounts, governance. Deterministic frame hashing via Merkle roots.

**Account (A)** — Bilateral 2-of-2 channels (`runtime/account-consensus.ts`). Both entities must sign every frame. Per-token delta table (collateral, ondelta, offdelta, credit limits, HTLC holds). Instant settlement, no on-chain needed.

**Key types:** `runtime/types/` — R/J/E/A type definitions split by domain (account, entity, env, jurisdiction, settlement, governance, core). `runtime/ids.ts` — strict type guards for entityId, signerId, jId.

**Path aliases:** `@xln/runtime/*` → `./runtime/*`, `@xln/brainvault/*` → `./brainvault/*`

## 📦 COMMANDS

```bash
# Development (anvil + runtime server + relay)
bun run dev                    # localhost:8080 (runtime), :9000 (relay), :8545 (anvil)

# Type checking
bun run check                  # tsc --noEmit via tsconfig.core.json — ZERO errors
# Test files (*.test.ts) excluded from type-checking (intentional)

# Run individual scenario
bun runtime/scenarios/lock-ahb.ts    # HTLC multi-hop (Alice-Hub-Bob)
bun runtime/scenarios/grid.ts        # Multi-entity settlement

# Contracts
bun run env:build              # Compile Solidity (hardhat compile)
bun run env:run                # Local hardhat node on :8545
bun run env:deploy             # Deploy via Hardhat Ignition

# Testing
bun run test                   # All tests (171 tests, 2434 assertions)
bun test runtime/__tests__/ids.test.ts           # Single test file
bun test runtime/__tests__/invariants.test.ts    # Property-based invariant tests

# Formatting
bun run format                 # Prettier on /runtime
```

**Ports:** Runtime server :8080, WebSocket relay :9000, Anvil :8545

## 🧪 TEST SUITE

7 test files, 171 tests total. All use real BrowserVM — no mocks.

| File                 | Tests | What it covers                                                                                                             |
| -------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| `ids.test.ts`        | 16    | Branded type constructors, entity/signer/token/lock ID validation                                                          |
| `invariants.test.ts` | 43    | Property-based: conservation law, tiebreaker, capacity, hash determinism, monotonic heights                                |
| `htlc.test.ts`       | 48    | Pure unit tests for HTLC lock/resolve/payment handlers, fee calc, hashlock generation                                      |
| `account.test.ts`    | 14    | Bilateral account consensus: open, pay, sync, bidirectional, frame chain integrity                                         |
| `entity.test.ts`     | 34    | Entity BFT: single-signer fast path, multi-signer 2-of-3, frame hash, mempool, crontab, quorum power, input merging        |
| `consensus.test.ts`  | 16    | E2E multi-entity: conservation law, 3-entity routing, bilateral tiebreaker, HTLC multi-hop Alice→Hub→Bob, entity isolation |

**Test helpers** (`runtime/__tests__/helpers.ts`):

- `createTestEnv()` — real Env with BrowserVM, JAdapter, gossip
- `createEntity(t, name, opts?)` — single-signer entity via importReplica
- `createMultiSignerEntity(t, name, count, threshold)` — N-validator entity with separate replicas
- `openAccount(t, A, B, opts?)` — bilateral account with credit (uses `extendCredit` for second entity)
- `pay(t, from, to, amount, opts?)` — directPayment + bilateral convergence
- `converge(maxCycles?)` — process until all work queues drain
- State accessors: `findReplica`, `findAllReplicas`, `getOffdelta`, `getAccountHeight`, `getEntityHeight`, `getAccount`, `getDelta`, `getLocks`

**Known test quirks:**

- BrowserVM init ~200ms — amortize via `beforeAll` per describe block
- `accountKey` ABI error in `syncAllCollaterals` is pre-existing (caught, logged as warning)
- `structuredClone failed` warnings for AccountMachines — pre-existing, handled by fallback
- Multi-signer consensus needs 20-40 converge cycles (propose→precommit→commit→notify)

## 🚫 ZERO TOLERANCE: NO HACKS, NO WORKAROUNDS

**ABSOLUTE RULE - violation = stop and report immediately:**

1. **NO "temporary" solutions** - if you write a stub/hack/workaround, STOP and tell user explicitly
2. **NO silent compromises** - if proper fix is unclear/hard, ASK before making shortcuts
3. **NO "it works for now"** - either fix properly or document limitation + get approval
4. **NO hiding uncertainty** - if confidence <80% on implementation approach, STOP and discuss

**Examples of BANNED patterns:**

```typescript
// ❌ NEVER: Stub that "returns fake data but works for testMode"
async registerEntities() { return [2,3,4]; }  // Not actually registering!

// ❌ NEVER: Conditional skip of broken logic
if (value !== '0') { updateState(); }  // Hiding root cause!

// ❌ NEVER: "I'll fix this later" comments
// TODO: Implement proper state persistence  // No! Fix now or ask.
```

**What TO do instead:**

- Stop coding
- Explain the blocker clearly: "EntityProvider registration fails because @ethereumjs/vm state doesn't persist after runTx"
- Present options: "A) Debug VM state, B) Workaround in contract, C) Different approach"
- Get user decision
- Then implement properly

**Remembered from 2025-12-29 session:** Spent 2+ hours on hacks (fake registration, event patches, ownReserve='0' conditionals) instead of stopping and asking. User found out from Opus review. Never again.

## 🎲 DETERMINISM: NO RANDOMNESS IN RJEA FLOW

**PROHIBITED in Runtime/Entity/Account/Jurisdiction cascade:**

- `Date.now()` - use env.timestamp (controlled)
- `Math.random()` - use deterministic PRNG with seed
- `setInterval/setTimeout` - use tick-based delays (env.timestamp checks)
- `crypto.randomBytes()` - use seeded generator

**Only allowed in:**

- Initial setup (before any frames)
- External I/O (user input timestamps)

**RJEA flow must be pure:** `(prevEnv, inputs) → nextEnv` - same inputs = same outputs, always.

# CRITICAL OVERRIDES

Do not create mocks/stubs unless asked. Use real integration. When debugging consensus/state-machines, dump entire data/JSON. Use bun everywhere (not npm/node).

ALWAYS run `bun run check` and `bun run test` before reporting completion.
NEVER create .md files in /runtime - documentation goes in /docs.

## 🎯 AGENTIC MODE (80% Confidence Threshold)

Before starting ANY task, rate confidence (0-100%):

- **≥80%**: Proceed autonomously (clear spec, obvious approach)
- **<80%**: Stop and ask (multiple valid paths, UX unclear, architectural choice)

Break rules: Always ask even if >80% for consensus/crypto/smart-contract changes.

Quick iteration signals (full autonomy):

- "slow/sluggish" → profile + fix, report metrics
- "ugly/meh" → polish matching past aesthetic
- "go/just try" → full send, zero questions

## 📋 RESPONSE FORMAT (ADHD-Optimized)

- ASCII headers to separate sections visually
- Bullets only, max 3-5 per section, no paragraphs >3 lines
- Cut preamble/postamble/hedging
- Always end with clear next steps: **NEXT:** A) B) C)

## 🎯 TOKEN EFFICIENCY

- Grep/offset before reading files >300 lines
- Filter command output: `grep -E "error|FAIL"`, never dump full output
- Agents for architecture, not verification
- Terse confirmations with metrics: "Fixed. 0.2→45 FPS"
- Check imports before reading (no imports = delete, don't analyze)

## ✅ VERIFICATION PROTOCOL

Everywhere in code: fail-fast and loud (full stop + throw popup on error).

Before claiming anything works:

1. `bun run check` — must be 0 errors
2. `bun run test` — must be 171+ pass, 0 fail
3. `bun run format` — must run clean
4. Show command output, not descriptions ("Fixed" → show passing tests)
5. Reproduce user's error before fixing
6. Never commit untested code

## 🎯 TYPESCRIPT

Validate at source. Fail fast. Trust at use. No defensive `?.` in UI if validated upstream.

## 📝 COMMUNICATION MODE

When I ask "why/how/what do you think" or say "let's discuss" - give full analysis with reasoning. Default to conversation over terse responses. Thinking out loud is the task, not overhead.

---

## 🏗️ CODING PRINCIPLES

Functional/declarative paradigm. Pure functions. Immutability. Small composable modules (<30 lines/func, <300 lines/file). DRY via abstraction. Bun everywhere (never npm/node/pnpm).

## 🔧 Critical Bug Prevention

**BigInt serialization:** Use `safeStringify()` from `serialization-utils.ts` (never raw JSON.stringify)
**Buffer comparison:** Use `buffersEqual()` from `serialization-utils.ts` (not Buffer.compare)
**Contract addresses:** Use `getAvailableJurisdictions()` from `evm.ts` (never hardcode)
**Bilateral consensus:** Study `.archive/2024_src/app/Channel.ts` for state verification patterns
**EntityInput vs RoutedEntityInput:** `EntityInput` = deterministic consensus fields only. `RoutedEntityInput extends EntityInput` adds signerId/runtimeId as routing hints. runtime.ts strips routing at R→E boundary. All output arrays use `RoutedEntityInput`.
**exactOptionalPropertyTypes:** Use `delete obj.prop` not `obj.prop = undefined`. Use `...(val ? {prop: val} : {})` not `prop: val ?? undefined`.

## 📁 STRUCTURE

- `/runtime/` — Core consensus engine, state machines, networking, scenarios
- `/runtime/__tests__/` — Test files (7 files, 171 tests) + `helpers.ts` test harness
- `/runtime/types/` — All type definitions, split by R/J/E/A domain
- `/runtime/scenarios/` — Runnable integration scenarios (lock-ahb, grid, settle, multi-sig)
- `/jurisdictions/` — Solidity contracts (Depository.sol, EntityProvider.sol), Hardhat config
- `/docs/` — All documentation, audit reports, protocol specs (never create .md in /runtime)
- `/brainvault/` — HD wallet derivation (frozen)
- `/scripts/` — Operational scripts (deploy, bootstrap, dev workflow)
- `.archive/2024_src/app/Channel.ts` — Reference implementation for bilateral consensus

## 🛠️ PATTERNS

Auto-rebuild: `bun run dev`. Time-travel: read from `env` not live stores. Bilateral: left=lower entityId (lexicographic).

## 🔍 DEBUGGING RUNTIME STATE

**Two-mode debugging system (ASCII + JSON):**

### ASCII Mode (Quick Scan)

```bash
# Run scenario with full output
bun runtime/scenarios/lock-ahb.ts > /tmp/debug.log

# Grep for specific info
grep "Entity.*Alice" /tmp/debug.log        # Find Alice's state
grep "HTLC.*Pending" /tmp/debug.log        # Find pending locks
grep "Frame 65" /tmp/debug.log             # Find specific frame
```

**ASCII functions** (runtime/runtime-ascii.ts):

- `formatRuntime(env)` - Full env with hierarchical boxes
- `formatEntity(state)` - Single entity with accounts
- `formatAccount(account, myId)` - Bilateral account detail
- On assert fail: auto-dumps full runtime state

### JSON Mode (Deep Analysis)

```bash
# Scenarios auto-dump JSON to /tmp/ on completion:
# - /tmp/{scenario}-frames.json (all history frames)
# - /tmp/{scenario}-final.json (final state)

# Query with jq
jq '.eReplicas[0][1].state | {entityId, height, lockBook: (.lockBook | length)}' /tmp/lock-ahb-final.json

# Find entities with fees
jq '.eReplicas[] | select(.[1].state.htlcFeesEarned != "BigInt(0)")' /tmp/lock-ahb-final.json

# Extract specific account deltas
jq '.eReplicas[0][1].state.accounts | to_entries[0].value.deltas' /tmp/lock-ahb-final.json

# Compare frames (diff two states)
diff <(jq '.eReplicas[0][1].state.lockBook' /tmp/frame-65.json) <(jq ... /tmp/frame-70.json)
```

**When debugging consensus issues:** Dump both sides, diff the JSON to find divergence point.

## 💾 Conventions

- "xln" lowercase always, never "XLN"
- "tx" shortcut acceptable in crypto context
- lowercase .md filenames (next.md, readme.md)
- localhost:8080 is the runtime server entry point

## 🔍 EXTERNAL AUDIT RULE

**Never blindly trust subagent or external audit findings.**

Before accepting any finding:

1. Verify the claim against actual code paths
2. Check if "vulnerability" is actually intentional design
3. Verify exploit is possible given XLN's specific nonce/state model
4. Ask: does this finding understand XLN's bilateral consensus model?

Example bullshit patterns:

- "Signature malleability → double spend" (ignores nonces)
- "State transfer without verification" (ignores hash = state binding)
- "Single-signer bypasses X" (that's the design for threshold=1)
- Generic ECDSA/BFT concerns that don't apply to XLN's specific flow

**Rule: 80% of audit findings are noise. Find the 20% that matter.**
