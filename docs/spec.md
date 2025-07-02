### XLN Platform — Unified Technical Specification

**Version 1.3 · July 2025**

---

#### Table of Contents

1. Purpose & Scope
2. Design Principles
3. Layered Architecture
4. Canonical Data Model (TypeScript)
5. Consensus & Frame Life‑cycle
6. Persistence, Storage & Replay
7. Hashing & Merkle Roots
8. Security Model & Threat Matrix
9. Scalability & Performance Targets
10. Configuration Knobs (defaults)
11. Wire‑Encoding & RPC Conventions
12. Edge‑Cases & Known Limitations
13. Clock‑tick Walk‑through ("hello" chat)
14. Reference Code Skeleton
15. Roadmap & Milestones
16. Glossary

---

## 1  Purpose & Scope

This document merges **all authoritative fragments**—Core‑Layer 0.9 draft, v3.2 edits, engineering chat distillations, and every uploaded edge‑case memo—into a *single* self‑consistent specification of the **Minimal‑Viable XLN network**.
*In scope:* pure business logic of the **Server → Signer → Entity** stack, state‑persistence rules, and the message/consensus flow.
*Out of scope:* cryptography primitives, networking adapters, access‑control layers, on‑chain Jurisdiction (JL) details, and the future Channel layer (listed only for context).&#x20;

---

## 2  Design Principles

| Principle                  | Rationale                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Pure Functions**         | Every layer reduces `(prevState, inputBatch)` → `{nextState, outbox}`; side‑effects live in thin adapters.      |
| **Fractal Interface**      | The same reducer signature repeats for Server, Entity, and—later—Channel layers, easing reasoning and testing.  |
| **Local Data Sovereignty** | Each participant can keep a *full* copy of the shards they care about; no sequencer or DA committees.           |
| **Audit‑grade Replay**     | Dual snapshot + immutable CAS blobs guarantee deterministic re‑execution from genesis or any checkpoint.        |
| **Linear Scalability**     | Channels (phase 2) add TPS linearly with hubs; core layers have no global bottleneck.                           |

---

## 3  Layered Architecture

| Layer                             | Pure? | Responsibility                                                                          | Key Objects                                 |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Jurisdiction (JL)**             | ✘     | On‑chain root of trust, collateral & dispute contracts.                                 | `Depositary.sol`                            |
| **Server**                        | ✔︎    | Routes `Input` packets every 100 ms, seals `ServerFrame`, maintains global Merkle root. | `ServerFrame`, `ServerTx`, mempool          |
| **Signer slot**                   | ✔︎    | Holds *replicas* of each Entity for which its signer is in the quorum.                  | `Replica = Map<entityId, EntityState>`      |
| **Entity**                        | ✔︎    | BFT‑replicated state‑machine; builds & finalises `Frame`s.                              | `EntityInput`, `EntityTx`, `Frame`, `Hanko` |
| **Account / Channel** *(phase 2)* | ✔︎    | Two‑party mini‑ledgers; HTLC / credit logic.                                            | `AccountProof`, sub‑contracts               |

*Fractal rule:* every layer exposes the same pure reducer interface.

---

## 4  Canonical Data Model (TypeScript‑style)

```ts
/* ─── 4.1  Wire envelope ─── */
export type Input = [signerIdx: number, entityId: string, cmd: Command];

/* ─── 4.2  Consensus‑level commands ─── */
export type Command =
  | { type: 'importEntity'; snapshot: EntityState }
  | { type: 'addTx';        tx: EntityTx }
  | { type: 'proposeFrame' }
  | { type: 'signFrame';    sig: string }
  | { type: 'commitFrame';  frame: Frame; hanko: string };

/* ─── 4.3  Application‑level transaction ─── */
export type EntityTx = {
  kind: string;     // e.g. 'chat', 'transfer'
  data: any;
  nonce: bigint;    // per‑signer replay protection
  sig: string;      // mocked in MVP
};

/* ─── 4.4  Frame (≃ block at Entity level) ─── */
export type Frame = {
  height: bigint;
  timestamp: bigint;
  txs: EntityTx[];
  postState: EntityState;
};

/* ─── 4.5  Entity state ─── */
export type EntityState = {
  height: bigint;
  quorum: Quorum;
  signerRecords: Record<string, { nonce: bigint }>;
  domainState: any;       // chat log, wallet balances, etc.
  mempool: EntityTx[];
  proposal?: { frame: Frame; sigs: Record<string, string> };
};

/* ─── 4.6  Quorum definition ─── */
export type Quorum = {
  threshold: bigint;                     // Hanko power required
  members: { address: string; shares: bigint }[];
};
```

All structures are serialised with **RLP**; hashes use `keccak256`. Terminology and invariants follow the consensus table in §5.

---

## 5  Consensus & Frame Life‑cycle

1. **ADD\_TX** – any signer injects a signed `EntityTx` into the target replica's mempool.
2. **PROPOSE** – current proposer packs queued txs into a *Proposed Frame*, signs its hash, and emits `proposeFrame`.
3. **SIGN** – other quorum members deterministically verify and respond with `signFrame`.
4. **COMMIT** – when collected signature‑weight ≥ `threshold`, proposer aggregates a **Hanko** (48‑byte BLS aggregate sig) and sends `commitFrame`.
5. Replicas verify `hash(frame) ⟂ hanko`, adopt `postState`, clear mempool, advance height.

**Edge‑cases handled**

| Scenario            | Behaviour                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| *Stuck proposer*    | Any member may re‑propose after `TIMEOUT_PROPOSAL_MS` (default 30 s).                            |
| *Duplicate vote*    | `signerRecords[addr].nonce` prevents replay of old `signFrame`.                                  |
| *Quorum rotation*   | Nonces of ex‑members are retained, blocking replay if they later re‑join.                        |
| *Dry‑run execution* | Validators simulate the proposed frame but do **not** mutate state until `commitFrame` arrives.  |

---

## 6  Persistence, Storage & Replay

| Store                           | Medium                | Trigger                          | Purpose                                  |
| ------------------------------- | --------------------- | -------------------------------- | ---------------------------------------- |
| **Write‑Ahead Log** (`wal/`)    | LevelDB CF            | every 100 ms tick                | Crash‑consistency & deterministic replay |
| **Mutable snapshot** (`state/`) | LevelDB CF            | every *N* frames or ≥ 20 MB diff | Fast cold‑start                          |
| **Immutable CAS** (`cas/`)      | LevelDB CF            | on every `commitFrame`           | Audit‑grade history                      |
| **Entity Frames**               | `entity_blocks/<id>/` | on commit                        | End‑user proofs                          |
| **ServerFrames**                | `server_blocks/`      | every tick                       | Global state‑hash timeline               |

*Dual snapshot model:* replay = *latest snapshot* + *all WAL segments > snapshot* → verify Merkle root.&#x20;

**LevelDB key‑scheme**
A flat 96‑byte prefix = `SignerID ∥ EntityID ∥ StoreType` aligns on‑disk ordering with in‑memory maps, enabling range scans without extra buckets.&#x20;

---

## 7  Hashing & Merkle Roots

* **Frame hash** = `keccak256(rlp(frameHeader ‖ txs))`.
* **Server root** = binary Merkle over each `[signerIdx, entityId] → rlp(snapshot)` pair, sorted lexicographically. Stored in every `ServerFrame` for divergence detection.&#x20;

---

## 8  Security Model & Threat Matrix

| Layer      | Honest‑party assumption    | Main threats               | Mitigations                            |
| ---------- | -------------------------- | -------------------------- | -------------------------------------- |
| **Entity** | ≥ ⅔ weighted shares honest | forged frames, vote replay | BLS aggregate check; per‑signer nonce  |
| **Server** | crash‑only failures        | WAL corruption             | hash‑assert on replay                  |
| **JL**     | single systemic contract   | contract bug / exploit     | formal verification (future milestone) |

*Remaining gaps (MVP)* – signature authenticity mocked, no Byzantine detection at Server layer, unbounded mempool, networking adapters TBD.&#x20;

---

## 9  Scalability & Performance Targets

| Metric               | Target                | Note                              |
| -------------------- | --------------------- | --------------------------------- |
| **Server tick**      | 100 ms (configurable) |                                   |
| **Off‑chain TPS**    | unbounded             | each Entity & Channel independent |
| **Jurisdiction TPS** | ≈ 10                  | only deposits / disputes touch JL |
| **Roadmap capacity** | > 10⁹ TPS             | linear with hubs & channels       |

Design rationale and comparative claims vs. roll‑ups & Lightning are detailed in the edge‑case memos.&#x20;

---

## 10  Configuration Knobs (defaults)

| Key                       | Default | Description         |
| ------------------------- | ------- | ------------------- |
| `FRAME_INTERVAL_MS`       | 100     | Server tick cadence |
| `SNAPSHOT_EVERY_N_FRAMES` | 100     | Snapshot frequency  |
| `TIMEOUT_PROPOSAL_MS`     | 30 000  | Liveness guard      |
| `OUTBOX_DEPTH_LIMIT`      | ∞       | Recursion guard     |

---

## 11  Wire‑Encoding & RPC Conventions

* **External packet** = RLP‑encoded `Input` (`[signerIdx, entityId, command]`).
* First field inside `command` is its *type*; the executor aggregates **all** packets received during the current tick into one `ServerInput` batch.&#x20;
* Addresses carried in lowercase hex; binary keys must not be used directly in JS `Map` due to object‑identity pitfalls.&#x20;

---

## 12  Edge‑Cases & Known Limitations

* Binary map keys in JS – store as lower‑case hex strings.&#x20;
* Single‑signer optimisation – still wrap self‑signed txs into frames for identical history.&#x20;
* Message mis‑routing – inputs to outdated proposer queued locally, retried post‑rotation.&#x20;
* Dual snapshot integrity – mismatch between snapshot hash & WAL hash halts replay.&#x20;
* Channels, order‑book map, insurance cascade — specified but *disabled* until Milestone 2+.

---

## 13  Clock‑tick Walk‑through ("hello" chat)

An executable end‑to‑end example lives in `spec/walkthrough.md` and demonstrates:
`ADD_TX("hello") → propose → sign → commit → ServerFrame` evolution, with exact hashes and Merkle roots.&#x20;

---

## 14  Reference Code Skeleton (extract)

```ts
/* core.ts — runnable PoC */
export function applyServerFrame(
  state: ServerState,
  batch: Input[]
): ServerState {
  const outbox: Input[] = [];

  for (const [signerIdx, entityId, cmd] of batch) {
    const replica = state.signers.get(signerIdx)?.get(entityId);
    if (!replica) continue;

    const next = applyCommand(replica, cmd, outbox);
    state.signers.get(signerIdx)!.set(entityId, next);
  }

  return {
    ...state,
    height: state.height + 1n,
    signers: state.signers,
  };
}
```

Full TS scaffolding with LevelDB adapters is in `src/` per the storage layout table.&#x20;

---

## 15  Roadmap & Milestones

1. **M1 – "DAO‑only"**
   *Entities with quorum governance, chat/wallet demo, no channels.*
2. **M2 – Channel layer**
   Bidirectional payment channels, collateral & credit logic.
3. **M3 – Hub & Order‑book entities**
   Liquidity routing, on‑channel AMM snippets.
4. **M4 – Multi‑jurisdiction deployment**
   JL adapters for several L1s, fiat on/off‑ramp partnerships.&#x20;

---

## 16  Glossary (quick reference)

| Term                       | Concise definition                                             |       |              |           |               |
| -------------------------- | -------------------------------------------------------------- | ----- | ------------ | --------- | ------------- |
| **Input**                  | RLP envelope `[signerIdx, entityId, command]`                  |       |              |           |               |
| **Command**                | \`importEntity                                                 | addTx | proposeFrame | signFrame | commitFrame\` |
| **Transaction (EntityTx)** | Signed atomic state mutation                                   |       |              |           |               |
| **Frame**                  | Ordered batch of txs + post‑state snapshot                     |       |              |           |               |
| **Hanko**                  | 48‑byte BLS aggregate signature proving quorum approval        |       |              |           |               |
| **Replica**                | In‑memory copy of an Entity under a specific signer            |       |              |           |               |
| **ServerFrame**            | Batch of Inputs processed in one tick + new global Merkle root |       |              |           |               |
| **Snapshot**               | Last serialised state of every replica                         |       |              |           |               |
| **CAS blob**               | Immutable, content‑addressed store of historic frames          |       |              |           |               |
| **Channel frame**          | Off‑chain batch inside a two‑party channel (phase 2)           |       |              |           |               |

---

**Status:** Version 1.3 supersedes earlier drafts (v0.9, v1.0, v1.2). It is the *single source of truth* for all further coding, test‑vector generation, audits, and external documentation of XLN.