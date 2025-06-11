
**MEMORANDUM**

This memo outlines the architectural decisions and simplifications that have been discussed and agreed upon, forming the foundation for the initial implementation of the XLN core system. This reflects a refined understanding based on our detailed conversations.

**Core Architectural Model & Hierarchy**

1.  **Machine Hierarchy:** The system is built upon a clear hierarchy of autonomous machines: Jurisdiction → Entities → Channels.
2.  **Current Focus:** For the MVP, we are focusing on implementing the **Server** and **Entity** layers first, proceeding layer by layer, and **skipping channels** for now.
3.  **Entity-Signer Relationship:** An Entity is static and bound to a specific jurisdiction, like a domain name. The quorum represents the current managers/board, like an IP address, indicating where to route messages for this entity. A Signer controls multiple quorums.
4.  **Signer Replicas:** Each Signer involved in an Entity's quorum must hold its **own local replica** of that Entity's state. This is essential for simulating consensus behavior (like Tendermint precommit/commit) and handling time discrepancies, offline signers, and conflicts. These replicas are complete copies living in different Signer "trees" in memory/storage.
5.  **Server Role:** The Server is primarily a **"postal station"** or event router. It aggregates incoming transactions (`ServerTx`), processes them periodically, and distributes them to the relevant Entity replicas held by its Signers. The server itself is **not a state machine** with complex internal logic for this initial implementation. It acts as a **pure function** from incoming data for testing purposes.

**Processing Flow**

1.  **Server Mempool:** Incoming requests arrive at the Server and are added to its mempool. This mempool is global per server for simulation purposes.
2.  **Processing Loop:** The Server processes its mempool periodically, applying the inputs to the relevant Entity replicas hosted by its Signers. We agreed on a **100 ms processing cycle** for the server initially.
3.  **Server Blocks:** A **Server Block** represents the collection of `EntityInput[]` processed by the server during one processing cycle. It includes the server height and is **RLP-encoded**.
4.  **Apply Pipeline:** Inputs are processed sequentially. A `ServerInput` (or `ServerTx`) routes to a specific `EntityInput`, which is applied by the Entity machine logic (`applyEntityInput`). If Channels are added later, `applyEntityInput` would call `applyChannelInput`. This creates a **rigid, traceable pipeline**.
5.  **Outbox Mechanism:** During the application of `EntityInput` (or `EntityTx` internally), **Outbox messages** can be generated as side effects. These messages are **not applied immediately** but are buffered temporarily (e.g., in a mutable array passed to the apply function).
6.  **Outbox Flush:** After the `ServerBlock` is applied and saved to the history log, the buffered Outbox messages are processed. These messages are transformed into new `ServerTx` (or `ServerInput`) and added back to the server's mempool, **simulating network delivery**. This is a **best-effort fire-and-forget** mechanism for now, without explicit acknowledgments, as those belong at the Channel level later. There is **no limit** on the number of Outbox messages an Entity can generate per block.
7.  **Self-Routing:** Outbox messages can be routed back to the same server/signer/entity, creating a possibility for internal reactivity. A **depth limit** for this self-routing is needed to prevent infinite loops.
8.  **Entity Block Creation:** Entities (specifically the Proposer Signer for an entity) aggregate `EntityTx[]` received via `add_tx EntityInput` into an **Entity Mempool**. When ready, the Proposer creates an **Entity Block** (potentially via a dry-run), proposes it to other signers via Outbox, and waits for signatures. Once a **quorum (e.g., 67%)** of signatures is collected, the block is **finalized** and applied to the Entity's state.
9.  **Signer Participation:** When receiving an `EntityInput`, the system should **check if the signer is in the current quorum** of the target entity. This basic check is necessary even without full ACL.
10. **No Empty Blocks:** Empty blocks are **not needed** in this architecture, as there is no public chain requirement for liveness simulation. Blocks are created only when there are transactions/inputs to process.

**State Management and Persistence**

1.  **In-Memory First:** The system operates primarily **in-memory**, loading everything from persistent storage on startup.
2.  **LevelDB for Persistence:** **LevelDB** is used for persistent storage.
3.  **Storage Structure:**
    *   **History Log:** A **Write-Ahead Log (WAL)** (e.g., `history_log/` or `/server_blocks/`) stores the **Server Blocks** sequentially. This ensures crash recovery by allowing replay of inputs.
    *   **State Snapshots:** A separate database (e.g., `entity_state/`) stores **snapshots** of Entity states (and potentially Signer/Server states). This allows for faster startup than replaying the entire history. Snapshots can be periodic, not necessarily every block.
    *   **Entity Block History:** Entity Blocks are stored separately from Server Blocks and state snapshots (e.g., `/entity_blocks/{id}/`). This facilitates efficient **synchronization/import** by new or desynced signers, who can request blocks from a specific height. This can be served via simple files or a dedicated LevelDB.
4.  **Flat LevelDB Key Structure:** The underlying LevelDB storage for snapshots uses a **flat key-value structure**. Keys are formed by concatenating machine IDs/prefixes (e.g., `signerId + entityId + storageTypeByte + ...`). This allows working with the database directly in memory.
5.  **In-Memory Map Representation:** While LevelDB is flat, the **in-memory representation** can use nested maps or objects (e.g., `Map<signerIndex, Map<entityId, EntityState>>`) for logical structure. Modifications happen directly in this memory structure.
6.  **Deterministic Execution:** The system relies on **deterministic execution** of logic. Randomness should be derived from an initial seed, not `Math.random` or `crypto.random`, to ensure reproducible simulations and state consistency across replicas.
7.  **State Integrity Hash:** The **Server State Hash** is calculated periodically (e.g., during flush). It is the hash (e.g., RLP encoding) of the entire in-memory state structure (entities grouped by signers). This hash serves as an **integrity root** for testing and verification, although it is **not distributed** to other servers in the MVP. A full Merkle tree is **not required for MVP**; a simple hash of the serialized state is sufficient.
8.  **Replay Protection:** A mechanism is needed to prevent applying the same `ServerBlock` or `EntityInput` multiple times. Storing `lastAppliedBlockNumber` in `EntityState` or similar is a possible solution.
9.  **Mempool Management:** The mempool should **not be infinite**. It should be cleared after processing, potentially tied to the Entity's proposer status.

**Transaction and Input Types (Refined Naming)**

We agreed on a clear naming convention based on the machine level:

*   **`ServerInput`**: Commands arriving at the Server (`{ signerIndex, entityId, input: EntityInput }`). (Initially called `ServerTx`).
*   **`EntityInput`**: Commands directed at an Entity machine (`{ kind: 'add_tx' | 'propose_block' | 'commit_block', ... }`). (Initially considered `InputEntity`).
*   **`EntityTx`**: Atomic business actions performed *within* an Entity, included in an Entity Block (`{ op: string; data: any }`). (Initially considered `EntityTransaction`, also analogous to `TxPayload`, `StateChange`, `EventOp`).
*   **`ChannelInput` / `ChannelTx` / `ChannelBlock`**: (For future implementation).

**MVP Scope Exclusions & Simplifications**

1.  **No Payment Channels (Yet):** Explicitly skipped for initial implementation to focus on core reliability. Channel complexities like subscriptions, rollbacks, and ACL are deferred. Disputes and credits are handled *inside* channels via the Depositary contract in the full vision, but this layer is skipped for MVP.
2.  **No Real Networking:** All entities and signers live on a single server, simulating network interactions via internal mempool routing and Outbox loops. Actual p2p networking (like libp2p) is not part of the core MVP.
3.  **No Signatures, Hashing (Initially), or ACL:** The very first implementation focuses on pure business logic and fault tolerance, **without cryptographic security**. Signatures, hashing (except for integrity checks), and Access Control Lists are excluded or postponed.
4.  **Single-Signer Focus (Initial Step):** While the architecture supports multi-signer entities, initial implementation might start with a simplified **single-signer Entity** (like a personal wallet) where actions are applied instantly without complex consensus rounds.
5.  **Simplified Consensus (Tendermint-like):** The core consensus for multi-signer entities is a simplified model analogous to Tendermint, but **without the prevote stage**. The proposer sends a block directly for signature, and 67% (configurable quorum threshold) constitutes finality. Validation involves automatic code execution and state hash comparison.
6.  **Minimal Transaction/Input Types:** Focus on basic `EntityInput` types like `add_tx` and `propose_block`, and minimal `EntityTx` types (e.g., a simple counter increment, `mint`).
7.  **No Rollback/Reorgs:** The MVP assumes optimistic apply.
8.  **No CLI/RPC:** The initial core will be unit-testable functional code.
9.  **No Entity Parallelism:** MVP assumes single-threaded application of inputs within an Entity.
10. **No Multi-Outbox Routing:** Initial Outbox implementation is just self-routing for simulation.
11. **No MetaState/MetaSnapshot:** These extra abstraction levels are not needed for MVP.

**Key Data Structures & Storage Concepts**

1.  **EntityState:** Includes height, state data, mempool (`EntityTx[]`), proposed block data, and quorum information.
2.  **OutboxMessage:** Contains routing information (`fromEntity`, `toEntity`, `toSigner`) and the payload (`EntityInput`).
3.  **ServerState:** Includes the server height, nested maps/objects representing signer-entity states (`Map<signerIndex, Map<entityId, EntityState>>`), and the Server mempool (`ServerInput[]`).
4.  **Entity Storage Types:** Within an Entity's storage, different data structures (like channel states, orderbooks, proposals) are organized by a **first byte indicating the storage type**, branching into separate maps/trees/buffers. This allows modular storage and encoding.
5.  **RLP Encoding:** Used for serializing complex data structures like Server Blocks and potentially Entity states/blocks for storage and transmission. Acknowledged as fast and native to Ethereum.
6.  **Entity Directory:** A global, replicated (e.g., via Gossip/SitNode in the future), read-only structure mapping `entityId` to public information like its current quorum and proposer. It's checked for integrity via jurisdiction lookups.

**Final Confirmed Flow**

`ServerTx` (now `ServerInput`) arrives at the Server Mempool -> Periodically, Server processes its mempool (`applyServerBlock`) -> ServerBlock is formed and inputs are routed to appropriate Signer Entity replicas -> Entity receives `EntityInput` (e.g., `add_tx`, `propose_block`, `commit_block`) -> `applyEntityInput` is called on Entity state, potentially generating `OutboxMessage[]` in a mutable array -> ServerBlock is saved to the history WAL -> Outbox messages are extracted from the array, converted back to `ServerInput`, and added to the Server Mempool, looping for simulation.

This memo captures the core agreements and simplifications identified to begin implementing the XLN core logic functionally, with persistence and deterministic simulation, while deferring complexities like real networking, multi-signer consensus details, channel logic, and full security.