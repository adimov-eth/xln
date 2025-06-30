
Here's the English translation:

### What Yegor Wanted to Say

| Term                                              | Essence in one phrase                                                                                                               | Analog in "class-crypt"                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Signer account / signer record**                | Personal "sub-account" of a specific **signer** *inside* Entity state: stores their nonce, voting history, personal limits. | "EVM-account" (externally owned) in shared storage slot of contract |
| **Channel account (counter-party / inter-party)** | Bilateral account-channel **between two Entities** (or Entity ↔ Hub). Requires ACK from second party.                                      | Lightning HTLC / debit channel                                 |
| **duality frame ≃ tx**                            | For a single signer, frame and transaction coincide: signature + nonce already provide final state-transition without shared consensus.    | Block with single tx in single-sig roll-up                           |

---

## What We're Changing in the Data Model

```ts
/* 0. Basic IDs (keeping provider, but defaulting to 'default') */
export interface ReplicaAddr {
  jurisdiction : string;   // eg. 'eth'
  entityId     : string;   // eg. 'dao-chat'
  signerId?    : string;   // optional – only needed for direct SignerMsg
  providerId?  : string;   // = 'default' for now
}

/* 1. SignerRecord – new "sub-state" */
export interface SignerRecord {
  nonce : UInt64;          // aka personal frame-height
  // future: votes, delegation, personal balances …
}

/* 2. Updating EntityState */
export interface EntityState {
  quorum   : Quorum;                               // as before
  records  : Record<Address, SignerRecord>;        // instead of `nonces`
  chat     : { from: Address; msg: string; ts: TS }[];
}

/* 3. Transaction remains the same, but nonce is now
      taken from EntityState.records[tx.from].nonce              */

/* 4. Replica gets composite address and removes 'id' */
export interface Replica {
  address   : ReplicaAddr;        // ← unified addressing point
  quorum    : Quorum;
  proposer  : Address;
  stage     : Stage;
  mempool   : Transaction[];
  last      : Frame<EntityState>;
  proposal? : ProposedFrame<EntityState>;
}
```

### Behavior

* **Signer-side action**
  1. Take `records[myAddr].nonce`, increment, sign tx.
  2. Send `ADD_TX` (or single "personal frame").
  3. Propagates → gets into shared Entity Frame.

* **Channel account** (later) — will be stored separately from `records` and will have bilateral ACK confirmation.

---

## How to Patch Current Code

1. **schema.ts**
   * Add `SignerRecord` interface and replace `nonces` field with `records` (see above).
   * Replace `id: string` inside `Replica` with `address: ReplicaAddr`.

2. **state.ts**
   * When validating tx, take/update `state.records[tx.from].nonce`.
   * Create genesis state like this:
     ```ts
     records : Object.fromEntries(
       quorum.members.map((m)=>[m.address,{ nonce:0n }])
     )
     ```

3. **codec.ts / server.ts**
   * Serialize `ReplicaAddr` as `[jurisdiction, entityId, signerId??'', providerId??'']`.
   * Everywhere that previously used `entityId`, now pass `address.entityId`.

> ⚠️ **Backward compatibility:** In the first patch, you can keep the old `entityId` field as an alias to avoid rewriting all tests; gradually remove it.

---

### Why This Is Sufficient

* **Signer-record** closes the question "where to store nonce / votes / personal limits" — in one predictable slot inside Entity-state.
* Clear separation emerges:
  - *intra-entity* (`records` → one-party, instant)
  - *inter-entity* (channel → two-party, needs ACK).
* Composite `ReplicaAddr` removes "magic id" and immediately provides routing like
  `dao-chat@alice.eth` ⇒ `{ entityId:'dao-chat', signerId:'alice', jurisdiction:'eth' }`.

---

### What to Do Next

1. **Test migration** – In fixture genesis, replace `nonces` with `records`.
2. **ChannelAccount spec** – When designing, keep the same formula: `nonce + dual-sig = frame`.
3. **ProviderId** – Leave `providerId:'default'`; full support can be easily added later.

This is a minimal, non-breaking patch that reflects the agreement about *signer record vs channel account* and the new addressing scheme.