# XLN — Protocol Specification  
**Version 1.4 (2025‑07‑03)**  

---

## 1  Scope & Rationale
XLN is a deterministic, multi‑jurisdiction ledger that achieves consensus through **entity‑centric frames** signed by flexible quorums.  
This document defines the **canonical data model**, frame life‑cycle, security guarantees and glossary. It supersedes v1.3.

---

## 2  Top‑Level Batch (`ServerInput`)

| Field | Type | Description |
|-------|------|-------------|
| `inputId` | `string` | Unique UUID‑v7 for the batch. |
| `frameId` | `bigint` | Monotonically increasing frame number. |
| `timestamp` | `bigint` | UNIX epoch ms when batch was assembled (used only for drift checks). |
| `serverTxs` | `ServerTx[]` | Governance‑level operations processed once per batch. |
| `entityInputs` | `EntityInput[]` | Parallel per‑entity blobs; order **irrelevant**. |

```ts
export interface ServerInput {
  inputId: string;
  frameId: bigint;
  timestamp: bigint;
  serverTxs: ServerTx[];
  entityInputs: EntityInput[];
}
````

---

## 3  Governance Operations (`ServerTx`)

```ts
export type ServerTx =
  | ImportEntityTx
  | UpgradeEntityTx
  | RotateKeyTx
  | SlashSignerTx;

interface BaseServerTx {
  entityId: string;
  nonce: bigint;
}

export interface ImportEntityTx extends BaseServerTx {
  type: 'importEntity';
  data: unknown;            // full entity definition
}

export interface UpgradeEntityTx extends BaseServerTx {
  type: 'upgradeEntity';
  codeHash: string;         // new WASM hash
}

export interface RotateKeyTx extends BaseServerTx {
  type: 'rotateKey';
  newSigner: string;
}

export interface SlashSignerTx extends BaseServerTx {
  type: 'slashSigner';
  badSigner: string;
  evidence: string;
}
```

---

## 4  Canonical Data Model

### 4.1  EntityInput

| Field               | Type                | Notes                                                          |
| ------------------- | ------------------- | -------------------------------------------------------------- |
| `jurisdictionId`    | `string`            | Governing jurisdiction.                                        |
| `signerId`          | `string`            | Signer assembling this blob.                                   |
| `entityId`          | `string`            | Target entity.                                                 |
| `blockHeight`       | `bigint`            | Parent height.                                                 |
| `prevBlockHash`     | `string`            | Hash of parent proposed block.                                 |
| `quorumCertificate` | `QuorumCertificate` | ≥ threshold signatures on parent frame.                        |
| `entityTxs`         | `EntityTx[]`        | Includes **jurisdiction events** (`type:'jurisdictionEvent'`). |
| `precommits`        | `string[]`          | Hashes of prevotes (> ⅔ weight).                               |
| `proposedBlock`     | `string`            | Hash of candidate block at `blockHeight + 1`.                  |
| `observedInbox`     | `InboxMessage[]`    | Deterministically delivered cross‑entity messages.             |
| `accountInputs`     | `AccountInput[]`    | See 4.3.                                                       |

```ts
export interface EntityInput {
  jurisdictionId: string;
  signerId: string;
  entityId: string;
  blockHeight: bigint;
  prevBlockHash: string;
  quorumCertificate: QuorumCertificate;
  entityTxs: EntityTx[];
  precommits: string[];
  proposedBlock: string;
  observedInbox: InboxMessage[];
  accountInputs: AccountInput[];
}
```

### 4.2  QuorumCertificate

```ts
export interface QuorumCertificate {
  hash: string;             // hash being certified
  structure: unknown;       // signer weights etc.
  signatures: string[];     // raw sigs
}
```

### 4.3  AccountInput & AccountTx

```ts
export interface AccountInput {
  accountId: string;             // stream identifier inside the entity
  counterpartyEntityId: string;  // remote entity
  accountTxs: AccountTx[];
}

export interface AccountTx {
  type: 'AddPaymentSubcontract' | string;
  paymentId: string;
  amount: number;
  nonce: bigint;
}
```

### 4.4  EntityTx & InboxMessage

```ts
export interface EntityTx {
  type: 'jurisdictionEvent' | 'entityUpdate' | string;
  data: unknown;
  nonce: bigint;
}

export interface InboxMessage {
  fromEntityId: string;
  message: unknown;
}
```

---

## 5  Consensus & Frame Life‑Cycle

1. **Prevote phase** – signers emit `precommits` for `prevBlockHash`.
2. **Precommit aggregation** – when > ⅔ weight collected, a proposer may build `proposedBlock`.
3. **Proposal** – proposer embeds `proposedBlock` in the next `EntityInput`.
4. **QuorumCertificate** – next frame must carry signatures (> ⅔) on the previous block hash.
5. **Parent linkage** – mismatch in `blockHeight` or `prevBlockHash` causes **immediate rejection**.

---

## 6  Security

* **Replay protection** – every signed object (`ServerTx`, `EntityTx`, `AccountTx`) includes a **monotone `nonce` per signer**. Duplicate or out‑of‑order nonce ⇒ reject.
* **Weight drift** – `quorumCertificate.structure` pins the weight map; any change requires an **explicit `rotateKey`** governance op.
* **Tamper evident chain** – `prevBlockHash` forms a Merkle‑linked chain of proposed blocks.

---

## 7  Validation Rules (non‑exhaustive)

| Check        | Reject if                                       |
| ------------ | ----------------------------------------------- |
| Frame drift  | `frameId` ≤ previous processed frame.           |
| Timestamp    | Abs(`now − timestamp`) > `MAX_DRIFT_MS`.        |
| QC           | Signatures < threshold *or* invalid weight map. |
| Parent hash  | `prevBlockHash` ≠ hash(parent `proposedBlock`). |
| Nonce reuse  | Same signer + same nonce reappears.             |
| AccountInput | Duplicate `accountId` within same batch.        |

---

## 8  Glossary

| Term                     | Meaning                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| **AccountInput**         | Batch of account‑level transactions addressed to one counter‑party.    |
| **CounterpartyEntityId** | Remote entity on the other side of an account stream.                  |
| **Frame**                | Atomic simulation step across **all** entities sharing same `frameId`. |
| **InboxMessage**         | Deterministically delivered cross‑entity message.                      |
| **Quorum Certificate**   | Object proving ≥ threshold weight signed a specific hash.              |
| **Signer**               | Off‑chain agent authorised to submit `EntityInput`s for an entity.     |

---

## 9  Changelog

* **v1.4 (2025‑07‑03)**

  * Added `blockHeight`, `prevBlockHash` to `EntityInput`.
  * Introduced `QuorumCertificate` (renamed from `quorumProof`).
  * Added `AccountInput`, `AccountTx`, `InboxMessage`.
  * Added `nonce` to every signed tx.
  * Expanded `ServerTx` union (`upgradeEntity`, `rotateKey`, `slashSigner`).
  * Replaced separate `jurisdictionEvents` array with `EntityTx{ type:'jurisdictionEvent' }`.
  * Renamed `counterEntityId` → `counterpartyEntityId`.

* **v1.3 (2025‑05‑19)** – Initial public release.

---

## 10  Reference Implementation

See `packages/runtime/src/frame-validator.ts` for canonical validation logic reflecting this spec.

```

---

### Next Steps / TODOs
1. **Update runtime code →** adjust type imports & validation to match v1.4.  
2. **Regenerate OpenAPI schema** used by client SDK.  
3. **Write migration script** converting stored v1.3 frames to v1.4 (rename fields, move jurisdiction events).  
4. **Publish v1.4 tag** across all packages (`@xln2/core`, `@xln2/runtime`, docs).
```
