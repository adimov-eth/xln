Perfect. I’ll compile a complete RFC-style technical specification for XLN, tailored for protocol engineers. It will prioritize core state machines, the input cascade, and consensus, and include type definitions and annotated example flows. Storage and CLI will be omitted for now.

I’ll let you know as soon as the draft is ready for your review.


# XLN Protocol Core Specification (v1.4.1-RC2)

## 1. Purpose & Scope

This document specifies the core **XLN protocol** for version **1.4.1-RC2**, focusing on the **Server–Signer–Entity** state machines and their consensus logic. It covers the pure business logic of these core layers, including the **input cascade** (how inputs flow from `ServerInput` down to `EntityInput` and ultimately into transactions) and the **frame lifecycle** (the consensus process of proposing, signing, and committing frames). The goal is to provide a clear, formal description suitable for protocol engineers (RFC style), with full TypeScript-like definitions of key data structures and an example tick flow.

*In scope:* The reducer logic of the **Server, Signer, and Entity** state machines, consensus workflow, and data model (commands, transactions, frames, etc.).
*Out of scope:* Low-level cryptographic primitives, storage/persistence formats, CLI interfaces, and external network/RPC details. (These are addressed in separate documents.)

## 2. Architecture Overview

XLN is structured in **layers**, each implementing a state machine that processes inputs and produces deterministic state changes (**pure functions**). The core layers are **Server, Signer,** and **Entity**, which together implement a **Byzantine Fault Tolerant** consensus for each independent Entity’s state. Each layer follows a *fractal interface* pattern – they all expose a similar reducer function `(prevState, inputBatch) → { nextState, outbox }`. This means each layer processes a batch of inputs and updates its state in a pure, deterministic manner (no side effects in the core logic).

**Core State Machines:**

| **Layer**       | **Pure?** | **Responsibility**                                                                                                                       | **Key Objects**                                                     |
| --------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Server**      | ✔️        | Aggregates and routes `Input` packets each tick; seals a `ServerFrame` with a global Merkle root of state.                               | `ServerFrame`, `ServerMetaTx`, mempool                              |
| **Signer slot** | ✔️        | Maintains replicas of each Entity state for which the signer is in the quorum. Each signer node holds its own copy of relevant Entities. | `Replica = Map<entityId, EntityState>`                              |
| **Entity**      | ✔️        | Independent BFT-replicated state machine; builds and finalizes `Frame` blocks via consensus.                                             | `EntityInput`, `EntityTx`, `Frame`, **Hanko** (aggregate signature) |

<!-- CITATION for above table: [16†L89-L97] -->

Each Entity (e.g. an application-specific chain or shard) has an **active quorum** of signers. These signers collectively run a consensus protocol to produce sequential **Frames** (entity-level blocks) for that Entity’s state. Every signer node also runs the **Server** logic which synchronizes inputs across Entities and maintains a **global state Merkle tree** for all Entity replicas known to the network. This global view is updated every **tick** (a fixed time-step, e.g. 100 ms) when the Server composes a new `ServerFrame`.

*Reducer Logic:* At each tick, the Server layer collects all incoming input commands and produces a **`ServerInput` batch** which is then delivered to the Entity layer. Each Entity state machine, in turn, processes the commands relevant to it (from the batch) and may output a new Frame and other messages (outbox). The Server then finalizes the tick by recording a `ServerFrame` (containing a new global state root and input Merkle root). All state transitions are deterministic pure functions – given the same prior state and the same batch of inputs, every honest replica will compute the same results.

## 3. Canonical Data Model

We define all XLN data structures in a **TypeScript-like pseudocode** for clarity. All structures are serialized with RLP (Recursive Length Prefix encoding), and all hashes use `keccak256`. Timestamps are represented as 64-bit Unix milliseconds (`bigint`).

### 3.1 Wire Envelope and Consensus Commands

The smallest unit of input is an **Input** tuple (also called a *wire envelope*), which represents a single action by a signer targeting a specific Entity. On the network, each `Input` is an RLP-encoded triple: **`[signerIdx, entityId, cmd]`**. Here, `signerIdx` is the lexicographic index of the signer's ID (address) among those *present* in the current tick – this indexing ensures every node can map inputs to signers consistently each tick. `entityId` is a unique identifier of the target Entity (e.g. a UUID or address), and `cmd` is a **Command** object describing the action.

**Consensus-level commands (`Command`):** The protocol defines a small set of commands that drive the consensus. These commands can be thought of as the "operational codes" that Signers use to interact with Entities. The available Command types are:

* **`importEntity`** – Introduce a new Entity into the network (carries an initial state snapshot).
* **`addTx`** – Submit a new transaction (`EntityTx`) into the Entity’s mempool (pending transactions).
* **`proposeFrame`** – Propose a new Frame (block) for the Entity. Only the designated proposer uses this, and it carries a `FrameHeader` for the block being proposed.
* **`signFrame`** – Vote to approve a proposed Frame; carries the signer's BLS signature (`sig`) on the proposed frame’s hash.
* **`commitFrame`** – Finalize and commit a Frame; used by the proposer once enough signatures have been collected. It carries the full `Frame` and the aggregated signature (**Hanko**) over that frame.

```ts
/* --- Wire Envelope and Command Types --- */
export type Input = [
  signerIdx: number,     // index of signer in lexicographically sorted list for this tick:contentReference[oaicite:24]{index=24}
  entityId: string,      // target Entity unique ID:contentReference[oaicite:25]{index=25}
  cmd: Command           // one of the consensus commands:contentReference[oaicite:26]{index=26}
];

export type Command =
  | { type: 'importEntity'; snapshot: EntityState }
  | { type: 'addTx'; tx: EntityTx }
  // Proposer sends only the header to save bandwidth; replicas reconstruct the tx list:contentReference[oaicite:27]{index=27}
  | { type: 'proposeFrame'; header: FrameHeader }
  | { type: 'signFrame'; sig: string }
  | { type: 'commitFrame'; frame: Frame; hanko: string };
```



### 3.2 Entity Transaction and Frame Structure

**Application-level Transactions (`EntityTx`):** Transactions are domain-specific operations that will be executed on the Entity's state (for example, a chat message, a token transfer, or a jurisdiction event). Every `EntityTx` includes a `nonce` (a monotonically increasing sequence number per signer for replay protection), a `kind` string to categorize the transaction, a `data` field for arbitrary payload, and a `sig` which is the signer's signature over the RLP encoding of the transaction. The `nonce` ensures that no transaction can be replayed or reordered out-of-sequence for a given signer.

**Frame:** A **Frame** is the fundamental *block* of the Entity’s ledger, analogous to a block in a blockchain. It groups a set of ordered transactions and represents a new state transition for the Entity. A Frame has a sequential `height` (block number), a `timestamp` (when it was created), a `header` (static metadata about the frame), the list of `txs` (transactions included), and a `postStateRoot` which is the hash of the Entity’s state after applying these transactions. The header is included separately (and hashed for signing) because it contains the critical fields that define the frame without the bulky transaction list.

**Frame Header:** The `FrameHeader` contains the fields that identify a frame and are used in consensus to generate the frame hash. It includes the `entityId` (which entity this frame is for), the frame `height`, the `memRoot` (Merkle root of the sorted transaction list for this frame), the `prevStateRoot` (hash of the Entity’s state prior to this frame, i.e., after the last committed frame), and the `proposer` (the signerId of the member who constructed/proposed this frame).

```ts
/* --- Transaction and Frame Structures --- */
export interface EntityTx {
  kind: string;       // e.g. 'chat', 'transfer', 'jurisdictionEvent':contentReference[oaicite:35]{index=35}
  data: unknown;      // payload for application logic:contentReference[oaicite:36]{index=36}
  nonce: bigint;      // strictly increasing per signer:contentReference[oaicite:37]{index=37}
  sig: string;        // signer's signature over RLP(tx):contentReference[oaicite:38]{index=38}
}

export interface Frame {
  height: bigint;         // sequential frame number:contentReference[oaicite:39]{index=39}
  timestamp: bigint;      // unix timestamp (ms) at creation:contentReference[oaicite:40]{index=40}
  header: FrameHeader;    // static fields hashed for propose/sign:contentReference[oaicite:41]{index=41}
  txs: EntityTx[];        // ordered list of transactions in this frame:contentReference[oaicite:42]{index=42}
  postStateRoot: string;  // keccak256 hash of EntityState after applying txs:contentReference[oaicite:43]{index=43}
}

export interface FrameHeader {
  entityId: string;
  height: bigint;
  memRoot: string;    // Merkle root of sorted tx list (see sorting rule):contentReference[oaicite:44]{index=44}
  prevStateRoot: string;
  proposer: string;   // signerId of the frame's proposer:contentReference[oaicite:45]{index=45}
}
```



### 3.3 Entity State and Quorum

**EntityState:** Each Entity’s current state is tracked in an `EntityState` object. This includes the last committed `height` of the Entity’s frame sequence, the active `quorum` definition (the set of signers and their voting weights for consensus), a map of `signerRecords` (tracking metadata per signer, such as the last used nonce for that signer), the application-specific `domainState` (e.g., the chat log, account balances, or other domain data of the Entity), and a `mempool` of pending transactions. Optionally, if a frame proposal is in progress, the `EntityState` may have a `proposal` field containing the current `FrameHeader` being proposed and a map of collected signatures (`sigs`) from signers.

**Quorum:** The `Quorum` object defines the BFT consensus group for an Entity. It lists the members (each with an address and a weight in shares) and a `threshold` which is the minimum total weight required to achieve consensus (typically > 2/3 of total shares). Only signers in the `members` list are authorized to participate in consensus for that Entity, and the threshold dictates how many signatures (weighted) are needed to finalize a frame.

```ts
/* --- Entity State and Quorum --- */
export interface EntityState {
  height: bigint;    // last committed frame height:contentReference[oaicite:52]{index=52}
  quorum: Quorum;    // active quorum for BFT consensus:contentReference[oaicite:53]{index=53}
  signerRecords: Record<string, { nonce: bigint }>; 
                     // per-signer info (last nonce used, etc.):contentReference[oaicite:54]{index=54}
  domainState: unknown;   // application-specific state (data managed by this Entity):contentReference[oaicite:55]{index=55}
  mempool: EntityTx[];    // list of pending transactions not yet committed:contentReference[oaicite:56]{index=56}
  proposal?: { 
    header: FrameHeader; 
    sigs: Record<string, string> 
  };                 // current pending proposal and collected sigs (if any):contentReference[oaicite:57]{index=57}
}

export interface Quorum {
  threshold: bigint;    // required weight for consensus (e.g. 2/3 of total):contentReference[oaicite:58]{index=58}
  members: { address: string; shares: bigint }[];  // list of signer addresses and their voting power:contentReference[oaicite:59]{index=59}
}
```



### 3.4 Server Input Batch and Entity Inputs

During each tick, the Server collects all `Input` commands received from signers and composes a **`ServerInput` batch**. This `ServerInput` is a composite structure that encapsulates everything that happened in the network during that tick. It contains: (a) a unique `inputId` (unique identifier for the batch), (b) the global `frameId` (tick number, which increments every tick), (c) the current timestamp, (d) a list of `metaTxs` (special network-wide operations outside individual Entities), and (e) a list of `entityInputs`. The `ServerInput` is essentially the **input cascade’s root**, faning out into per-Entity commands.

* **ServerMetaTx:** These are *server-level transactions* (now renamed to **ServerMetaTx** to avoid confusion with entity-level txs) that apply globally. Currently, the main meta transaction type is `'importEntity'` which signals adding a new Entity (with an initial snapshot of its state) to the network. (Other kinds of meta operations could be defined in the future.)

* **EntityInput:** Each Entity that receives any input during the tick will have an `EntityInput` entry in the batch. An `EntityInput` aggregates all relevant data for a particular Entity from the perspective of one signer for that tick. It includes the `signerId` (the BLS public key or address of the signer who contributed this input), the `entityId` (which Entity this is for), and a **`quorumProof`** that validates the signer's membership in the Entity’s quorum (basically containing a `quorumHash` that must match the hash of the Entity’s current quorum definition, plus a reserved `quorumStructure` field for future use).

  Within `EntityInput` are several important fields:

  * `entityTxs`: an array of **EntityTx** objects contributed by this signer for this Entity in the tick. These could come from `addTx` commands (the new transactions the signer wants to include) or from system events (like jurisdiction events).
  * `precommits`: an array of BLS signatures from this signer over a proposed frame’s hash (if this signer is voting on a frame this tick). Typically, if a `signFrame` command was issued by the signer, their signature appears here.
  * `proposedBlock`: the hash of the proposed frame (`FrameHeader || txs`) that the signer saw or created. For a proposer, this is the frame they proposed; for a voter, this should match the hash they signed. This ties together the propose/sign commands in the batch.
  * `observedInbox`: any cross-entity messages observed (for future cross-entity communication).
  * `accountInputs`: any bilateral channel/account inputs (reserved for Phase 2 of the protocol).

```ts
/* --- Server Input Batch and EntityInput --- */
export interface ServerInput {
  inputId: string;          // unique ID for this input batch (tick):contentReference[oaicite:72]{index=72}
  frameId: number;          // global tick counter (monotonic):contentReference[oaicite:73]{index=73}
  timestamp: bigint;        // unix-ms timestamp of the tick:contentReference[oaicite:74]{index=74}
  metaTxs: ServerMetaTx[];  // network-wide meta commands (e.g. importEntity):contentReference[oaicite:75]{index=75}
  entityInputs: EntityInput[]; // list of per-entity inputs from signers:contentReference[oaicite:76]{index=76}
}

export interface ServerMetaTx {
  // (formerly called ServerTx):contentReference[oaicite:77]{index=77}
  type: 'importEntity';
  entityId: string;
  data: unknown;    // metadata or snapshot for the new entity:contentReference[oaicite:78]{index=78}
}

export interface EntityInput {
  jurisdictionId: string;  // Jurisdiction/chain context (chainId:contractAddr):contentReference[oaicite:79]{index=79}
  signerId: string;        // signer's BLS public key (or address):contentReference[oaicite:80]{index=80}
  entityId: string;        // target Entity ID:contentReference[oaicite:81]{index=81}
  quorumProof: {
    quorumHash: string;       // must equal keccak256(rlp(activeQuorum)):contentReference[oaicite:82]{index=82}
    quorumStructure: string;  // reserved (unused until Phase 3):contentReference[oaicite:83]{index=83}
  };
  entityTxs: EntityTx[];   // transactions from this signer (if any):contentReference[oaicite:84]{index=84}
  precommits: string[];    // BLS signatures over proposed block hash:contentReference[oaicite:85]{index=85}
  proposedBlock: string;   // keccak256(rlp(header ‖ txs)) of proposed frame:contentReference[oaicite:86]{index=86}
  observedInbox: InboxMessage[];  // cross-entity messages (if any):contentReference[oaicite:87]{index=87}
  accountInputs: AccountInput[];  // channel/account inputs (Phase 2, optional):contentReference[oaicite:88]{index=88}
}

/* Supporting types for completeness */
export interface InboxMessage {
  msgHash: string;       // keccak256(message)
  fromEntityId: string;
  message: unknown;
}
export interface AccountInput {
  counterEntityId: string;
  channelId?: bigint;    // reserved for multi-channel support
  accountTxs: AccountTx[];
}
export interface AccountTx {
  type: 'AddPaymentSubcontract';
  paymentId: string;
  amount: number;
}
```



**Input Cascade:** In summary, the **input cascade** flows as follows: external `Input` messages from signers (each carrying a Command) are ingested every tick. The Server combines all these into one `ServerInput` batch. Each relevant Entity extracts its portion of the batch via one or more `EntityInput` records. For example, if two signers each sent an `addTx` to the same Entity in a tick, the `ServerInput` will contain two `EntityInput` entries for that Entity (one per signer), each with its own `entityTxs`. The Entity’s state machine will process those inputs (adding the transactions to its mempool, etc.), then process any **`proposeFrame`** or **`signFrame`** inputs to advance consensus, and finally apply a **`commitFrame`** if one is present. At the end of the tick, after all EntityInputs are processed and any new frame(s) are committed, the Server computes a new global state Merkle root and emits a `ServerFrame` to seal the tick.

### 3.5 ServerFrame (Global Timeline)

The **ServerFrame** represents a global snapshot of the system at the end of a tick. It contains the `frameId` (which tick number this is), the `timestamp`, and two Merkle roots: `root` and `inputsRoot`. The `root` is the Merkle root of all **replica state hashes** across the network, providing a single commitment to the state of every Entity (as known to every signer) at this tick. The `inputsRoot` is the Merkle root of the RLP-encoded `ServerInput` batch for this tick, which commits to all inputs processed. By comparing `ServerFrame` roots, participants can detect any divergence in state (if any signer’s replica state differs, the Merkle root would differ, flagging an inconsistency). In normal operation, all honest nodes will compute identical `ServerFrame` roots each tick.

```ts
export interface ServerFrame {
  frameId: number;      // tick index (increments every tick):contentReference[oaicite:96]{index=96}
  timestamp: bigint;
  root: string;         // Merkle root of all [signerIdx, entityId] → snapshot hashes:contentReference[oaicite:97]{index=97}
  inputsRoot: string;   // Merkle root of RLP(ServerInput) for this tick
}
```



*Note:* The ServerFrame does **not** contain the full state or inputs themselves, only cryptographic commitments. The actual state changes are determined by the Entity frames and transactions, which are logged separately (e.g., in per-Entity frame logs).

## 4. Consensus & Frame Lifecycle

Each Entity’s signers run a consensus protocol (inspired by Tendermint-style BFT) to agree on each new Frame. This process occurs over one or more ticks, but ideally completes within a single tick for fast finality. The sequence of steps in the consensus state machine is as follows:

1. **ADD\_TX – Transaction Injection:** Any signer can submit a new transaction to an Entity by sending an `addTx` command. This will result in the transaction being added to that signer's local mempool for the Entity. The receiving replica (the Entity state on that signer’s node) **validates** the transaction before adding: it checks that the transaction’s signature is valid and that `tx.nonce === signerRecords[signerId].nonce + 1n` (i.e. the nonce is exactly one greater than the last nonce seen from that signer). If valid, the replica increments the stored nonce for that signer and places the `EntityTx` into its mempool. (This step does not yet produce a frame; it just queues transactions. Multiple `addTx` commands from different signers can happen concurrently.)

2. **PROPOSE – Frame Proposal:** When it’s time to create a new frame (block), the **designated proposer for the current height** will initiate a proposal. Proposer selection is **deterministic** and typically rotates each frame height among the quorum members (e.g., `proposer = members[height % members.length]` in round-robin order). The proposer gathers transactions from its mempool to include in the frame. To ensure a canonical order, the mempool transactions are sorted by **nonce, then signer (sender) address, then transaction kind, then insertion order** (this is the **Sorting Rule** – patch **Y-2** in v1.4.1). The proposer then takes the first N transactions (up to a protocol constant `MAX_TXS_PER_FRAME`, e.g. 1000) from this sorted list and forms a new `FrameHeader` for the next height (with `height = currentHeight + 1`). The header’s `memRoot` is the Merkle root of the sorted tx list, and `prevStateRoot` is the hash of the Entity state prior to this frame (from the last committed frame). The proposer computes the **proposed block hash** as `proposedBlock = keccak256(rlp(header, txs))` and *signs this hash* with its BLS key. It then broadcasts a `proposeFrame { header }` command to the other signers. (Only the header is sent in the propose command to save bandwidth; since all replicas have the same mempool contents, they can reconstruct the tx list themselves.)

3. **SIGN – Voting on the Proposal:** When other signer replicas receive the `proposeFrame` command, they independently perform the same steps to verify the proposal. Each replica **reconstructs** the sorted transaction list from its own mempool (using the same deterministic sort) and computes what the `FrameHeader` and `proposedBlock` hash *should* be. If the hash matches the one in the proposal (meaning the proposal is consistent with their mempool and no tampering occurred), the replica signs the `proposedBlock` hash with its BLS private key. It then responds by sending a `signFrame { sig }` command back to the proposer (and/or to the network). This signature is a *pre-commit vote* for the frame. Each signer uses a unique per-frame nonce (the same one incremented with addTx) to ensure that duplicate or stale `signFrame` votes can be detected and ignored (replay protection via nonces).

4. **COMMIT – Frame Finalization:** The proposer collects signatures from the quorum. Once the total weight of signatures meets or exceeds the `threshold` defined in the quorum (e.g., ≥ 2/3 of voting power), the frame is considered *approved*. At this point, the proposer assembles the full `Frame` object: it takes the `FrameHeader` it proposed, attaches the full sorted `txs` list, and calculates the `postStateRoot` by executing all those transactions on its current state (simulating the state transition). It then aggregates all the received BLS signatures into a single **aggregate signature** known as a **Hanko** (48-byte BLS aggregate proving quorum approval). Finally, the proposer broadcasts a `commitFrame { frame, hanko }` command to all replicas. This commit message contains everything needed for others to finalize the frame: the header and transactions (so others can apply them if they haven't already) and the Hanko signature proving that the quorum agreed.

5. **VERIFY & APPLY – State Update:** When a replica receives the `commitFrame`, it performs final verification before applying it. First, it recomputes the hash of the frame’s header and tx list and checks that it matches the `proposedBlock` hash that was originally signed. Next, it verifies the aggregate BLS signature (`hanko`) against the quorum’s public keys to ensure that a sufficient number of the correct signers indeed signed that hash. In pseudo-code:

   ```ts
   assert(keccak256(rlp(frame.header, frame.txs)) === proposedBlock);    // integrity of frame:contentReference[oaicite:120]{index=120}
   assert(verifyAggregate(hanko, proposedBlock, quorum) === true);       // BLS aggregate sig check:contentReference[oaicite:121]{index=121}
   ```

   If both checks pass, the replica accepts the frame as valid. It then **applies all transactions** in the frame to its local state, thereby moving the Entity’s state forward. It updates the EntityState’s `height` to the new frame’s height, replaces the EntityState’s root hash with the `postStateRoot` from the frame (as a correctness assertion), and clears from the mempool any transactions that were included in the frame (since they are now committed). At this point, the Entity’s state is updated and in sync across all honest replicas.

6. **SEAL – Global Commit:** After an Entity frame is committed, the final step is to update the global state tracking. The Server layer takes the new snapshot of the Entity’s state (typically the hash of the EntityState after commit, often called the **snapshot hash**) and inserts it into the global Merkle tree of all replicas. The Server then produces a `ServerFrame` for this tick, which includes the updated global `root` hash and the `inputsRoot` for this tick’s batch. In effect, the Server “seals” the tick: it records that at tick *N*, the network agreed on new state for certain Entities. This ServerFrame is broadcast or logged so that all participants have a consistent timeline of changes.

**Additional Consensus Rules & Guarantees:**

* **Quorum Validation:** Any `EntityInput` included in the ServerInput batch must carry a valid `quorumProof`. In practice, this means `entityInput.quorumProof.quorumHash` must equal `keccak256(rlp(activeQuorum))` of that Entity. This prevents a rogue signer from pretending to be part of a quorum they aren’t; all replicas can verify the signer’s claimed quorum membership before processing their inputs.

* **Deterministic Signer Ordering:** To ensure every node processes inputs in the same order, the Server sorts all incoming inputs by the signers’ IDs (lexicographically, as lowercase hex) each tick. The sorted order defines the numeric `signerIdx` used in each Input. This deterministic mapping guarantees that if two signers send commands in the same tick, every replica will apply them in the same order, avoiding divergence.

* **Proposer Liveness (Re-proposal Rule):** If the designated proposer fails to send a valid proposal in a timely manner (e.g., due to crash or network issue), the protocol allows for any other signer in the quorum to step in and **re-propose** the same transactions list for that frame height. The re-proposal must use an identical tx list in identical order to the one that should have been proposed, and it can occur after a timeout (`TIMEOUT_PROPOSAL_MS`, e.g., 30 seconds) has elapsed without a commit. This ensures liveness – the system can progress even if a leader is unresponsive.

* **Byzantine Safety:** Signers use their `signerRecords.nonce` to prevent double-voting or replay of old votes. Once a signer has used a nonce for a `signFrame` at a given height, that vote cannot be reused or duplicated later. Nonces of even departed members are retained to prevent a Byzantine actor from leaving and rejoining to replay old signatures. Combined with the aggregate signature check (Hanko) and deterministic state update, this provides Byzantine fault tolerance (safety and consistency) as long as at least a threshold of signers (e.g., ≥⅔ by weight) are honest.

## 5. Example Tick Workflow

To illustrate the above mechanisms, consider a simple scenario with an **Entity** `E` that has two signers: **Alice** and **Bob**. Suppose the quorum threshold requires both (for simplicity, threshold = 2 out of 2 shares). We will walk through a single **tick** where a new transaction is added and a frame is proposed, signed, and committed, resulting in a new ServerFrame. The sequence is annotated step-by-step:

* **Tick N start:** No frame has been proposed yet for this tick. Alice and Bob both have the last committed frame height = 42 in their local state for Entity E.

* **Alice injects a transaction:** Alice wants to send a message transaction on Entity E. She creates an `EntityTx` (with `nonce = 5n` say, one higher than her last used nonce 4) and sends an `addTx` command targeting Entity E. This appears as an `Input` tuple `(signerIdx=0, entityId=E, cmd={type: 'addTx', tx: ...})` – assume Alice’s address is lexicographically smaller, so she is `signerIdx 0` this tick. Her local replica of E validates the tx and adds it to the mempool, updating Alice’s nonce to 5. Bob does not submit any transactions this tick.

* **Server aggregates inputs:** The XLN Server layer collects inputs from all signers. In this tick, it sees Alice’s `addTx` and no other Entity inputs (no inputs from Bob, and no other Entities involved). The Server creates a `ServerInput` batch for tick N with: `frameId = N`, containing one `EntityInput` for Entity E (from Alice). Alice’s EntityInput includes her `signerId`, the quorumProof (hash of E’s quorum), and the one `entityTx` she submitted; since she’s not proposer yet, `precommits` is empty and `proposedBlock` is empty at this moment.

* **Proposer selection:** For frame height 43, suppose the deterministic proposer selection algorithm chooses **Alice** as the proposer (e.g., based on round-robin and height 43 mod 2 signers = 1 → Alice; adjust as needed). Alice’s node sees that it is proposer and that there is at least one transaction (her own) in the mempool.

* **Alice proposes Frame 43:** Alice sorts Entity E’s mempool (only her one tx is there) and prepares Frame 43. She builds a `FrameHeader` with `entityId = E`, `height = 43`, `prevStateRoot = H42` (the hash of state after frame 42), `memRoot` = hash of the tx list (just one tx), and `proposer = Alice`. She computes the `proposedBlock = keccak256(rlp(header, [tx]))` hash and signs it with her BLS key. She then broadcasts a `proposeFrame { header }` Input. This is included in the same tick’s `EntityInput` for Alice (now the `EntityInput` has `proposedBlock` = that hash, and still no precommits yet). The Server relays this to Bob as well.

* **Bob signs the proposal:** Bob’s replica receives the `proposeFrame` command (via the Server’s broadcast). Bob reconstructs the tx list (he also had Alice’s tx because the addTx was part of the tick’s inputs delivered, so he added it to his mempool too at validation time). He builds the same FrameHeader 43 and computes `proposedBlock` hash. It matches the hash Alice sent. Bob then creates a BLS signature on that hash. He sends a `signFrame { sig: <Bob’s signature> }` Input. This arrives at Alice (the proposer) and is recorded in Bob’s `EntityInput` for E for tick N (the Server now includes an `EntityInput` for Bob as well, containing his `signFrame` precommit signature in the `precommits` field, matching the `proposedBlock`). Now tick N’s `ServerInput` has two EntityInputs for E: one from Alice (with the propose) and one from Bob (with the sign).

* **Commit threshold reached:** Alice sees that she has collected Bob’s signature. With two out of two signatures (100% weight) received, the threshold is met. Still within tick N, Alice proceeds to finalize. She executes the pending transaction in a sandbox to get the new state of Entity E and calculates the `postStateRoot` (say, H43). She then forms the full `Frame 43` object (header, the \[tx], postStateRoot = H43). Alice aggregates her signature and Bob’s into the BLS aggregate **Hanko**. She broadcasts a `commitFrame { frame: Frame43, hanko }` command.

* **Replicas commit the frame:** Bob’s replica (and Alice’s own) receive the `commitFrame`. They verify that `keccak256(rlp(header, txs))` equals the hash they signed (it does), and verify the Hanko against their quorum’s public keys (valid, as it’s Alice+Bob’s signatures). Now both apply Frame 43: the transaction is executed on Entity E’s state (updating whatever the tx was supposed to do), the Entity’s height becomes 43, and both Alice’s and Bob’s mempools drop the committed transaction. The Entity’s state hash is now H43 for both.

* **Server seals tick N:** To conclude the tick, the Server takes the new state hash of Entity E (H43). It updates the global Merkle tree of states: for each signer and entity pair, one leaf is the hash of that replica’s EntityState. In this case, both Alice’s and Bob’s replica of E have state hash H43, so the leaves for (Alice,E) and (Bob,E) are H43. The Server recomputes the global Merkle root (which might be just a combination of those two if no other entities). It then creates a `ServerFrame` for tick N with `frameId = N`, `timestamp = now`, `root = G` (the Merkle root of all replica states), and `inputsRoot = I` (the Merkle root of the RLP-encoded ServerInput batch that contained Alice’s addTx, Alice’s proposeFrame, Bob’s signFrame, etc.). This ServerFrame is output to all nodes. All participants now have a record that at tick N, Entity E advanced to frame 43 with state root H43, and the global state root G commits to this fact.

This example demonstrates the full cascade: Alice’s initial `addTx` went into the `ServerInput` (as an `EntityTx` in EntityInput), then into the Entity’s mempool; the propose and sign commands were exchanged and also recorded in the `ServerInput`; finally, commit led to an updated Entity state and a new ServerFrame. Throughout, the system maintained determinism and consensus: both Alice and Bob followed the same steps and reached the same resulting state and ServerFrame.

```mermaid
sequenceDiagram
    participant A as Signer A (Proposer)
    participant B as Signer B (Peer)
    participant E as Entity E State
    participant S as Server (Tick N)
    %% Step 1: A adds a transaction
    A->>E: **1.** addTx(tx):contentReference[oaicite:137]{index=137}
    note over E: Validate nonce & sig;<br/>tx added to mempool:contentReference[oaicite:138]{index=138}
    %% Step 2: Proposer A sends proposeFrame
    A->>B: **2.** proposeFrame(header):contentReference[oaicite:139]{index=139}
    note over B: Reconstruct tx list;<br/>compute hash; matches? Yes.
    B-->>A: **3.** signFrame(sig)
    note over A: Signature received; threshold reached.
    A->>B: **4.** commitFrame(frame, hanko):contentReference[oaicite:142]{index=142}
    note over E: Both replicas verify hash & aggregate sig:contentReference[oaicite:143]{index=143},<br/>then apply txs, update state:contentReference[oaicite:144]{index=144}.
    E-->>S: **5.** New state hash included<br/>in ServerFrame for tick N:contentReference[oaicite:145]{index=145}.
```

*(Mermaid sequence diagram: A complete tick from transaction injection to ServerFrame seal)*

## 6. Conclusion

This specification has detailed the core state machines of the XLN protocol and their interactions in the consensus process. By adhering to pure function design and a fractal layered architecture, XLN ensures that every state transition – from a single signer's input up to the globally sealed frame – is deterministic and auditable. The input cascade (`ServerInput → EntityInput → EntityTx`) provides a clear pathway for data through the system, while the consensus and frame lifecycle guarantee that each Entity’s state advances securely with Byzantine fault tolerance. This RFC-style description of XLN v1.4.1-RC2 can serve as a reference for protocol engineers implementing or verifying the XLN core logic, ensuring all terminology and semantics are applied consistently with the intended design.

**References:**

* XLN Unified Technical Specification, **v1.4.1-RC2**
* XLN Consensus and Architecture Design Documents
