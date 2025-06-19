**XLN Core Design Principles
― A Living Reference for All Contributors**

> *“Architecture is the code you can’t refactor in a weekend;
> principles are the compass that stops you walking in circles.”*

---

## 1. Immutability & Functional Purity

| Rule                                                       | Why it matters                                                                                | Manifestation in code                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| State objects are **never** mutated in‑place.              | Enables simple reasoning, time‑travel debugging, safe concurrency and straightforward replay. | All helpers return `{ …state, field: newValue }`; Maps are replaced via `assoc` (not `.set`). |
| Pure functions (no I/O, no `Date.now()`) drive core logic. | Guarantees determinism and unit‑testability.                                                  | `server/Server.tick` and `engine/processor.*` accept the current time as a parameter.         |
| Side‑effects are quarantined.                              | Keeps impurity visible and auditable.                                                         | Only `infra/runner.ts` performs WAL, snapshot, block writes or logging.                       |

---

## 2. Strict Separation of Concerns (Layered Architecture)

1. **Pure Core** (`server/`, `engine/`)
   *Deterministic state transitions; no I/O.*

2. **Engine Helpers** (`router/`, `commands/`, `blocks/`)
   *Protocol‑agnostic utilities; still pure.*

3. **Infrastructure** (`infra/`, `storage/`)
   *Persistence, clocks, logging, recovery.*

4. **Adapters / Protocols** (`protocols/…`)
   *Domain‑specific rules; plug‑and‑play.*

> **One‑way dependency rule:** layers may depend **only on layers above** them in the list.

---

## 3. Determinism Is King

* The same `<initial‑state, input‑batch, timestamp>` must **always** yield the same `<next‑state, outputs>`.
* All hashes (`computeStateHash`, Merkle root) are derived solely from **encoded** data to avoid JS object ordering quirks.
* Clock dependency is explicit; pass `now` as an argument, never call `Date.now()` inside pure code.
* `eventBus` contains every outbound side‑effect in a typed, serialisable form so replays can verify equivalence.

---

## 4. Explicit, Type‑Safe Code

* **Branded types** (`EntityId`, `SignerIdx`) prevent accidental mixing.
* Never use `any` unless crossing an untyped boundary (e.g., RLP decoding) – and immediately cast to a safer type.
* RO‑RO (Receive‑Object / Return‑Object) signature pattern for functions with >2 logical parameters.
* Exhaustive `switch` with `// @ts-expect-error` on default to catch future enum growth.

---

## 5. Actor‑Centric Model with Asynchronous Messaging

* Each **Entity** behaves like an actor / smart‑contract.
  It owns its state and communicates via `OutboxMsg`.
* `router.routeMessages` is a pure fan‑out → `ServerTx[]`.
* `eventBus` captures emitted messages; they are routed on the next tick, preventing re‑entrancy bugs.

---

## 6. Robustness through Recovery (WAL + Snapshots)

* **Write‑Ahead Log** (WAL) records the *inputs* that led to each block **before** state mutation.
* **Snapshots** every *N* blocks cut recovery time; older WAL segments are truncated after a successful snapshot.
* Recovery algorithm:

  1. Load latest snapshot.
  2. Replay subsequent WAL batches through the **same pure tick** function.
  3. Verify computed hashes against stored `stateHash`.

---

## 7. Designed for Testability

* Unit tests focus on **pure functions** – no mocks required.
* Property‑based tests ensure determinism (`f(a) === f(a)`).
* Fluent scenario DSL (`test/fluent‑api.ts`) permits readable end‑to‑end simulations.
* CI must run with `NODE_ENV=test` enabling extra validations (e.g., WAL encoding check).

---

## 8. Performance without Sacrificing Correctness

* Immutable data structures are replaced wholesale, but hot‑path helpers (`assoc`) short‑circuit when no change.
* Merkle tree caches hashes per level; `batchInsert` avoids per‑item rebuilds.
* WAL validation can be toggled; in production, encode once and stream to disk for throughput.

---

## 9. Incremental Evolution

* **Protocol plug‑in registry** (`ProtocolRegistry`) lets new business logic live outside the core.
* Serialization format versions are bumped only when encoder/decoder tuples change; snapshot migration scripts accompany each bump.
* Deprecations follow a two‑release grace period with feature flags.

---

### Usage Checklist for Contributors

* [ ] Does your new function mutate anything? If yes, move it to an infra layer or refactor.
* [ ] Are you calling `Date.now()` inside core code? Inject a `Clock`.
* [ ] Will a replay with identical inputs produce byte‑identical outputs? Test it.
* [ ] Are you adding a new side‑effect? Represent it as an `OutboxMsg` variant.
* [ ] Have you updated RLP encoders/decoders and the snapshot format if you changed state shape?
* [ ] Did you add at least one property‑based test and one scenario‑based test?

---

**Keep this document close** – every line of code should be defensible by (at least) one principle above.
