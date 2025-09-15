# XLN‑Codex Handoff Report — 2025‑09‑15

This report summarizes all changes performed in this session, why they were made, and how to continue. It is intended to onboard the next agent quickly and provide a clear, verifiable path forward.

## Executive Summary

- Focus pivoted to creating a pure Clojure reference implementation (xln-reference/) that acts as a living, testable specification for the TypeScript engine.
- Differential testing is enabled in CI: the Clojure spec runs against a TypeScript runner that validates JSON Schemas and executes equivalent logic.
- Solidity improvements landed in EntityProvider.sol: reverse index for O(1) entity lookup and EIP‑712 typed action verification with per‑entity nonces and deadlines.
- Repo hygiene improved: debug/demo/legacy files organized under examples/ and scripts/, and docs updated.

## Changes Overview

### 1) Clojure Reference Engine (xln-reference/)
- New Clojure CLI project (deps.edn) under `xln-reference/`.
- Core module: `src/xln_reference/engine.clj`
  - Pure function: `(apply-entity-input state input) -> {:next-state .. :outbox [...]}`
  - Implemented handlers:
    - governance-enabled
    - control-shares-received
    - reserve-to-reserve
    - transfer-reserve-to-collateral
    - dispute-start
    - cooperative-close
    - invoice-issued (new trade credit primitive)
    - invoice-accepted (new trade credit primitive)
- Specs: `src/xln_reference/schema.clj` (Clojure specs mirroring JSON Schemas)
- JSON Schemas: `xln-reference/schema/{state,input,output}.schema.json`
- Runner: `src/xln_reference/runner.clj` (executes a vector JSON and prints JSON)
- Tests:
  - `test/xln_reference/engine_test.clj`: property-based determinism with test.check
  - `test/xln_reference/differential_test.clj`: compares Clojure vs TS runner (via TEST_TS_CMD)
- Vectors:
  - `vectors/basic-reserve-transfer.json`
  - `vectors/invoice-basic.json`
- README: `xln-reference/README.md` with quick commands

### 2) TypeScript Differential Runner + Adapter
- `scripts/ts-reference-adapter.mjs`
  - Exposes `applyOne` and `runVector` and can run as CLI.
  - Mirrors the Clojure engine semantics for the implemented inputs (including invoices).
- `scripts/ts-vector-runner.mjs`
  - Validates vector inputs/outputs against JSON Schemas using AJV.
  - Executes the adapter logic (pluggable; future step is to call the real consensus engine).
  - Emits JSON expected by the Clojure differential test.
- package.json: added dependencies `ajv` and `ajv-formats` for schema validation.

### 3) CI Integration
- `.github/workflows/build-and-test.yml`
  - Added “Reference Tests (Clojure)” job.
  - Installs Java + Clojure CLI and runs `clojure -M:test`.
  - Sets `TEST_TS_CMD="node scripts/ts-vector-runner.mjs"` to run differential tests with schema validation.

### 4) Solidity: EntityProvider Enhancements
- File: `contracts/contracts/EntityProvider.sol`
  - Reverse index for fast lookup: `mapping(bytes32 => uint256) public boardHashToEntity;`
    - Set in constructor for foundation, `registerNumberedEntity`, `foundationRegisterEntity`.
    - Maintained in `activateBoard` (clears old, sets new; best-effort single mapping noted in comments).
    - `recoverEntity` now fast‑paths via reverse index, falls back to linear scan.
  - EIP‑712 typed data for entity actions:
    - `DOMAIN_SEPARATOR`, domain/type hashes, and `mapping(address => uint256) public entityNoncesEIP712`.
    - `entityTransferTokens` and `releaseControlShares` now take `(nonce, deadline)` and verify typed digest instead of using `block.timestamp` in the signed hash.
  - Tests updated: `contracts/test/ControlShares.test.cjs` adjusted for new function signature (nonce/deadline and encoded signatures array).
- TypeScript helper: `src/eip712-entity-actions.ts` to build EIP‑712 typed data and action hashes (transfer/release).

Notes:
- Local Hardhat compile failed due to Node 23; CI still runs; use Node 22 LTS locally for contracts.
- Other tests that call `releaseControlShares` or `entityTransferTokens` may require parameter updates (nonce/deadline) if present elsewhere.

### 5) Repo Hygiene & Organization
- Debug scripts moved under `scripts/debug/`:
  - `scripts/debug/debug.js`, `scripts/debug/debug-repl.js` (imports updated)
  - `scripts/debug/debug-simple.js`, `scripts/debug/debug-reserves.js` (screenshots now saved to `docs/assets/`)
- Visualization/demo:
  - `examples/visualization/hubspokes.html` (moved; references `../../visualization.js`)
  - Consider moving `visualization.js` under `examples/visualization/` in a follow‑up
- Legacy HTML:
  - `examples/legacy/legacy.html` (moved)
- Tools/benchmarks:
  - `scripts/tools/gpt.js` (outputs to `dist/llm-source.txt`)
  - `scripts/bench/enc.js` (moved)
- Docs & metadata:
  - `AGENTS.md` updated (added xln-reference and scripts layout)
  - `readme.md` updated with reference engine section
  - `docs/assets/.gitkeep` added (debug outputs land here)

## How To Run & Validate

Prereqs:
- Node 18+ (prefer Node 22 LTS for Hardhat), Bun installed for existing scripts
- Clojure CLI for reference tests (CI installs automatically)

Reference tests locally:
```bash
npm run ref:test
# or
clj -M:test
```

Run a sample vector via Clojure runner:
```bash
clj -M -m xln-reference.runner xln-reference/vectors/basic-reserve-transfer.json
clj -M -m xln-reference.runner xln-reference/vectors/invoice-basic.json
```

Differential test (manual):
```bash
TEST_TS_CMD="node scripts/ts-vector-runner.mjs" clj -M:test
```

Contracts (requires Node 22 LTS locally):
```bash
npm run env:build
npm run test:contracts
```

## Trade Credit Direction (MVP Outline)

Why: XLN’s comparative advantage is digitizing Net 30/60/90 trade credit using bilateral sovereignty and progressive trust—not competing with Lightning as a payments rail.

Current additions:
- New reference handlers and schemas for `invoice-issued` and `invoice-accepted`.
- Vector `invoice-basic.json` demonstrates lifecycle start.

Next steps (spec‑first + incremental):
1) Add handlers/schemas: payment‑committed, payment‑settled, past‑due, dispute‑opened/closed.
2) P2P invoice sharing protocol: messages with seq/nonce/ACK, signed bodies, WAL persistence, optional encryption.
3) Reputation model: rolling on‑time %, average delay, exposure; publish as signed digest; drive progressive collateralization.
4) USDC support in channels for settlement; minimal on‑chain escrow on disputes.

## Open Items & Risks

- Hardhat + Node 23: use Node 22 LTS locally to compile contracts.
- EntityProvider function signature changes: update any remaining tests or app code that call `releaseControlShares`/`entityTransferTokens`.
- Reverse index is best‑effort single map: risk of clearing for shared hashes noted; acceptable for now; consider multi‑map later.
- TS runner currently mirrors semantics; replace with a real TS vector runner that executes `src/entity-consensus.ts` to remove duplication risk.
- Visualization asset at repo root (`visualization.js`): consider moving under `examples/visualization/` and updating references.
- Root PNG debug images remain; new outputs go to `docs/assets/`. Consider relocating/deleting old binaries to reduce clutter.

## Immediate Next Steps (suggested order)

1) Replace adapter semantics with a true TS vector runner that applies vectors via the real consensus code (or a minimal pure TS reference core).
2) Extend reference engine and schemas for trade credit lifecycle (settlements, past‑due, disputes) + vectors.
3) Add JSON Schema validation to the Clojure runner as well (double‑sided enforcement).
4) Update any remaining tests to new EntityProvider signatures; run contracts tests on Node 22 LTS.
5) Optionally move `visualization.js` and old root PNGs into examples/docs.

## File Map (added/modified)

Added (high‑level):
- `xln-reference/**` (engine, schemas, tests, vectors, README)
- `scripts/ts-vector-runner.mjs`
- `src/eip712-entity-actions.ts`
- `docs/session-report-2025-09-15.md` (this file)

Modified/Relocated (selected):
- `contracts/contracts/EntityProvider.sol` (reverse index + EIP‑712 + nonces)
- `contracts/test/ControlShares.test.cjs` (new params)
- `scripts/ts-reference-adapter.mjs` (exports + invoice handlers)
- `AGENTS.md`, `readme.md`, `.github/workflows/build-and-test.yml`, `package.json`
- Moved: debug/legacy/visualization files under `scripts/**` and `examples/**`

## Hand‑off Checklist

- Run `npm run ref:test` (should pass; CI runs it too)
- If working on contracts, switch to Node 22 LTS and run `npm run env:build`
- For demo/debug, use scripts in `scripts/debug/` (screenshots saved to `docs/assets/`)
- To extend spec, add to `xln-reference/schema/input.schema.json`, implement in `engine.clj`, mirror in `ts-reference-adapter.mjs`, add a vector, and update CI if needed

— End of report —

