XLN Reference Engine (Clojure)

Purpose
- Pure, deterministic reference for the XLN consensus and channel deltas.
- Serves as a formal spec to validate the TypeScript implementation.

Key ideas
- Pure function core: apply-entity-input -> {:next-state .. :outbox [...]}
- Property-based tests for determinism and invariants.
- JSON schemas for state/input/output for cross‑lang interoperability.
- Differential testing harness stub to compare against the TS engine.

Structure
- deps.edn — Clojure CLI project file
- src/xln_reference/engine.clj — core pure engine
- src/xln_reference/schema.clj — specs and validation helpers
- src/xln_reference/runner.clj — CLI to run vectors
- schema/*.schema.json — JSON Schemas for I/O
- vectors/*.json — Example vectors (initial, inputs, expected)
- test/xln_reference/* — clojure.test + test.check specs

Run
- clj -M:test — run tests
- clj -M -m xln-reference.runner xln-reference/vectors/basic-reserve-transfer.json
- clj -M -m xln-reference.runner xln-reference/vectors/invoice-basic.json

Differential testing (stub)
- The test/differential_test.clj compares the reference engine against a TS runner.
- CI sets TEST_TS_CMD to `node scripts/ts-vector-runner.mjs` which validates
  vector inputs/outputs against JSON Schemas and executes the TS side.

Notes
- The engine models commonly referenced J-events:
  reserveToReserve, TransferReserveToCollateral, DisputeStarted, CooperativeClose,
  ControlSharesReceived, GovernanceEnabled.
- Extend incrementally; keep I/O stable via the JSON schemas.
