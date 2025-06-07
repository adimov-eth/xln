## XLN Core: Technical Specification & Implementation Plan

**Document Version:** 1.1 (Core MVP)
**Author:** Marvin, Principal Software Architect
**Status:** Final Draft for Approval

### 1. Guiding Philosophy: The Kalashnikov Principle

The core of XLN is designed with the same principles as a Kalashnikov rifle: ultimate reliability, simplicity of operation, and fault tolerance. Every architectural decision is weighed against these tenets.

*   **Simplicity:** We use a minimal set of abstractions. The system is composed of pure functions operating on immutable data structures. There are no classes, no `this` context, and no hidden state.
*   **Reliability:** The system is deterministic. The same sequence of inputs will always produce the same state. Fault tolerance is achieved via a simple Write-Ahead Log (WAL) and state snapshotting, allowing the system to be stopped and restarted at any point, resuming its exact previous state.
*   **Clarity:** The code should be self-explanatory. This is achieved through descriptive naming and a strong central metaphor that makes the system's operation intuitive.

### 2. The Mental Model: A Post Office Simulation

To ensure clarity, we will use a consistent analogy for the system's components:

*   **The Server:** A central **Post Office Sorting Room**. Its only job is to receive incoming mail (`ServerTx`), log it, and route it to the correct recipient's mailbox. It has a master clock (`height`) but is otherwise stateless regarding the mail's content.
*   **A Signer:** An individual **Board Member** of several companies, identified by their seat number (`signerIndex`). They maintain their own copy of the official records for each company (`Entity`) they are a part of.
*   **An Entity:** A **Tradeable Digital Corporation** with shares, flexible governance (ShareholderPriority or QuorumPriority), and the ability to be bought, sold, or inherited. It has financial records (`data`), a list of pending agenda items (`mempool`), automatic share issuance, and can represent any system component (protocols, contracts, wallets).
*   **An `EntityInput`:** A formal **Memo** sent to a company, containing a specific instruction (e.g., `add_tx`, `propose_block`).
*   **An `EntityTx`:** A single, atomic **Agenda Item** within a memo (e.g., "Mint 100 shares").
*   **An `EntityBlock`:** The official, signed **Minutes of a Board Meeting**. It is a finalized set of agenda items that permanently alters the company's records.
*   **The `Outbox`:** A temporary **"To-Do" Tray**. During a board meeting, actions that require communicating with other companies (e.g., sending a payment proposal) result in memos being placed in this tray. At the end of the day, the Post Office collects everything from this tray and routes it for the next cycle.

### 3. Core Architecture & Execution Flow

The system is a deterministic, single-threaded loop that simulates a distributed consensus environment.

#### 3.1 Component Hierarchy

```
Server (The Post Office)
 │
 ├── Signer 0 (Board Member #0)
 │    ├── Entity A Replica (Company A records)
 │    └── Entity C Replica (Company C records)
 │
 ├── Signer 1 (Board Member #1)
 │    ├── Entity A Replica (Company A records)
 │    └── Entity B Replica (Company B records)
 │
 └── Signer 2 (Board Member #2)
      ├── Entity B Replica (Company B records)
      └── Entity C Replica (Company C records)
```

#### 3.2 The Server Tick (Execution Loop)

The server operates in discrete "ticks" or "blocks". Each tick is a pure function `(ServerState) => ServerState`.

1.  **Snapshot Mempool:** The current `mempool` of `ServerTx` is snapshotted for processing. The main `mempool` is cleared.
2.  **Process Inputs:** Each `ServerTx` in the snapshot is processed sequentially.
    *   The server locates the target `Signer` and `Entity` replica.
    *   It calls the pure function `applyEntityInput`, passing the entity's current state and the input.
    *   `applyEntityInput` returns a *new, updated* entity state. It may also add `OutboxMessage`s to a temporary `outbox` array as a side effect passed by reference.
    *   The server updates its state map with the new entity state.
3.  **Record History:** The list of processed `ServerTx`s is serialized and saved as the server block for the current `height`. This is our WAL.
4.  **Process Outbox:** The temporary `outbox` is processed. Each `OutboxMessage` is transformed into a new `ServerTx`.
5.  **Cycle:** These new `ServerTx`s become the `mempool` for the *next* server tick. The server's `height` is incremented. The loop is complete.

This recursive `mempool -> outbox -> mempool` design creates a self-contained, testable, and deterministic message-passing system.

### 4. Data Structures (Types)

These are the canonical, immutable data structures for the XLN Core. They will be centralized in `src/types.ts`.

```typescript
// src/types.ts

// --- Core Naming Convention ---
// Server*: The highest level of abstraction (The Post Office).
// Entity*: The business logic container (The Company).
// Tx: An atomic, state-changing operation (An Agenda Item).
// Input: A command or message to a machine (A Memo).
// Block: A finalized set of transactions.

// A transaction at the highest level, routed by the server.
// Analogy: A package arriving at the Post Office.
export type ServerTx = {
  readonly signerIndex: number;
  readonly entityId: string;
  readonly input: EntityInput;
};

// A command directed at a specific Entity machine.
// Analogy: A memo sent to a specific Company.
export type EntityInput =
  | { readonly kind: 'addTx'; readonly tx: EntityTx }
  | { readonly kind: 'importState'; readonly state: EntityState }
  | { readonly kind: 'proposeBlock' } // Proposer asks to form a block from its mempool
  | { readonly kind: 'confirmBlock'; readonly block: EntityBlock }; // A signer confirms a proposed block

// An atomic, state-changing operation within an Entity.
// Analogy: A single agenda item in the memo.
export type EntityTx = {
  readonly op: string; // e.g., 'MINT', 'DELEGATE_QUORUM'
  readonly data: unknown;
};

// A finalized, self-contained set of transactions for an Entity.
// Analogy: The signed minutes of a board meeting.
export type EntityBlock = {
  readonly height: number;
  readonly txs: readonly EntityTx[];
  // In a real system, this would be a cryptographic hash. For now, a simple string.
  readonly hash: string; 
};

// The complete, self-contained state of a single Entity replica.
// Analogy: A tradeable digital corporation with shares and governance.
export type EntityState = {
  readonly entityId: string; // Unique identifier
  readonly height: number; // The block height of this entity
  readonly data: any; // The actual business state (e.g., { balance: 1000 })
  readonly mempool: readonly EntityTx[]; // Pending transactions for the next block
  readonly quorum: readonly number[]; // List of signer indices participating in this entity
  readonly proposer: number; // The designated proposer for this entity
  readonly governanceMode: 'ShareholderPriority' | 'QuorumPriority'; // Who has ultimate control
  readonly shares: { readonly totalSupply: bigint; readonly name: string }; // Auto-issued shares
  readonly lastActivity?: bigint; // For inheritance detection
  readonly observers?: readonly number[]; // Signers in standby mode
};

// A message generated by one Entity to be sent to another.
// Analogy: A memo placed in the 'To-Do' tray to be mailed out.
export type OutboxMessage = {
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly toSignerIndex: number; // The proposer of the target entity
  readonly payload: EntityInput;
};

// The entire state of the server simulation.
// Analogy: The state of the entire Post Office building.
export type ServerState = {
  readonly height: number; // The server's block height
  // A map of signers, each holding a map of their entity replicas.
  readonly signers: ReadonlyMap<number, ReadonlyMap<string, EntityState>>;
  readonly mempool: readonly ServerTx[];
};
```

### 5. Core Logic (Functions)

These are the pure functions that drive the system.

#### 5.1 `entity.ts`

This file contains all logic specific to an `Entity`.

```typescript
// src/entity.ts

import type { EntityState, EntityInput, EntityTx, OutboxMessage, EntityBlock } from './types';

// A placeholder for a deterministic hashing function.
const createHash = (data: any): string => JSON.stringify(data);

/**
 * The Entity's core reducer. Applies a list of transactions to a state object. Pure function.
 * Analogy: Executing the approved agenda items to update the company records.
 */
export function reduceEntityState(state: any, txs: readonly EntityTx[]): any {
  // This is a simple example. A real implementation would have a switch/case for tx.op.
  return txs.reduce((currentState, tx) => {
    if (tx.op === 'MINT') {
      const amount = (tx.data as { amount: number }).amount || 0;
      return { ...currentState, balance: (currentState.balance || 0) + amount };
    }
    return currentState;
  }, state);
}

/**
 * Processes a single input for an entity, returning the new state. This is the main
 * entry point for all entity-level state changes. It is a pure function.
 * Analogy: The Company's board processing a memo.
 */
export function applyEntityInput({ entity, input, outbox }: {
  entity: EntityState;
  input: EntityInput;
  outbox: OutboxMessage[]; // Mutable array for collecting side-effects
}): EntityState {
  switch (input.kind) {
    case 'addTx':
      return { ...entity, mempool: [...entity.mempool, input.tx] };

    case 'importState':
      // Directly replaces the state. Used for genesis or syncing.
      return input.state;

    case 'proposeBlock': {
      // Only the designated proposer can propose a block.
      // In a real system, the proposer's identity would be part of the input.
      // For now, we assume the caller has verified this.
      if (entity.mempool.length === 0) return entity; // Nothing to propose

      const newBlock: EntityBlock = {
        height: entity.height + 1,
        txs: entity.mempool,
        hash: createHash(entity.mempool),
      };

      // The proposer sends the proposed block to all other quorum members for confirmation.
      for (const signerIndex of entity.quorum) {
        // In a real system, the proposer wouldn't send to itself, but this is simpler.
        outbox.push({
          fromEntityId: 'self', // Placeholder
          toEntityId: 'self',   // Placeholder
          toSignerIndex: signerIndex,
          payload: { kind: 'confirmBlock', block: newBlock },
        });
      }
      
      // Clear the mempool after proposing
      return { ...entity, mempool: [] };
    }

    case 'confirmBlock': {
      // A quorum member receives a block proposal to confirm.
      // In a real system, they would validate it against their mempool.
      // Here, we simplify: if a block is proposed, we accept it.
      const newData = reduceEntityState(entity.data, input.block.txs);
      return {
        ...entity,
        data: newData,
        height: input.block.height,
      };
    }

    default:
      return entity;
  }
}
```

#### 5.2 `server.ts`

This file contains the top-level server logic.

```typescript
// src/server.ts

import type { ServerState, ServerTx, OutboxMessage, EntityState } from './types';
import { applyEntityInput } from './entity';

/**
 * Processes all transactions in the mempool for one server block. This is the
 * main "tick" function of the entire system. It is a pure function.
 * Analogy: The end-of-day sorting process at the Post Office.
 */
export function applyServerBlock(state: ServerState): ServerState {
  const outbox: OutboxMessage[] = [];
  const processedTxs = state.mempool;

  // 1. Create a mutable copy of the signers map to update.
  const newSigners = new Map(
    [...state.signers.entries()].map(([signerIndex, entities]) => 
      [signerIndex, new Map(entities)] as const
    )
  );

  // 2. Process all incoming transactions sequentially.
  for (const tx of processedTxs) {
    const signer = newSigners.get(tx.signerIndex);
    if (!signer) continue;

    const entity = signer.get(tx.entityId);
    if (!entity) continue;

    const updatedEntity = applyEntityInput({ entity, input: tx.input, outbox });
    signer.set(tx.entityId, updatedEntity);
  }

  // 3. Route all generated outbox messages back into the mempool for the next cycle.
  const newMempoolTxs: ServerTx[] = outbox.map(msg => ({
    signerIndex: msg.toSignerIndex,
    entityId: msg.toEntityId, // In this simulation, entity IDs are not yet distinct in messages.
    input: msg.payload,
  }));

  // 4. Return the new, immutable server state.
  return {
    height: state.height + 1,
    signers: newSigners,
    mempool: newMempoolTxs,
  };
}
```

### 6. Persistence & Fault Tolerance

The system's reliability hinges on its ability to recover from a crash.

*   **State (Snapshot):** The complete `ServerState` object will be serialized (e.g., to JSON or a more efficient binary format) and saved to a known location (e.g., `/state/server.json`) after every N blocks. This is the fast-recovery snapshot.
*   **History (Write-Ahead Log):** Each processed `ServerBlock` (i.e., the `processedTxs` array from `applyServerBlock`) is serialized and appended to a log file (e.g., `/history/wal.log`). This provides a durable, replayable history of all inputs.
*   **Recovery Sequence:**
    1.  On startup, check for the state snapshot.
    2.  If it exists, load it into memory.
    3.  Read the WAL from the point corresponding to the snapshot's height.
    4.  Replay each subsequent `ServerBlock` from the WAL by running it through `applyServerBlock`.
    5.  The system is now in the exact state it was in before the crash.
    6.  If no snapshot exists, start from a genesis state.

### 7. Project Structure

```
.
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── src/
    ├── types.ts         # Centralized, immutable type definitions.
    ├── entity.ts        # Pure functions for Entity logic.
    ├── server.ts        # Pure functions for Server logic.
    ├── persistence.ts   # Functions for saving/loading state and WAL.
    └── main.ts          # Main application loop, timers, and wiring.
```

### 8. Entity Governance & Trading

#### 8.1 Governance Modes

Entities support two fundamental governance models:

* **ShareholderPriority**: Shareholders can vote to replace the quorum (traditional corporate model)
* **QuorumPriority**: Quorum is sovereign and cannot be replaced by shareholders (protocol model)

This enables both traditional companies and uncapturable infrastructure.

#### 8.2 Inheritance Tokens

In QuorumPriority mode, shares become inheritance tokens:
* Owner maintains full control while active
* Shareholders can only act after prolonged inactivity
* Enables trustless crypto inheritance
* Heirs can trade their future rights

#### 8.3 Entity Handover Protocol

When ownership changes:
1. New signers join as observers (hot standby)
2. Old signers have 2 weeks to transfer state
3. Cooperation maintains reserve access
4. Non-cooperation freezes reserves
5. Entity continues operating throughout

#### 8.4 Universal Entity Model

Everything becomes a tradeable entity:
* XLN Foundation itself
* Smart contracts (EntityProvider.sol, Depositary.sol)
* Wallet software
* Protocol extensions
* Audit firms

This creates a self-governing ecosystem where market forces determine control.

### 9. Next Steps & Future Considerations

This specification covers the core, in-memory simulation. The following have been intentionally deferred to ensure the foundation is solid first:

*   **Cryptography:** Introducing real hashing and digital signatures.
*   **Networking:** Replacing the in-memory `outbox` with a real networking layer (e.g., WebSockets) to communicate between actual server processes.
*   **Entity Directory:** Implementing the gossip protocol for discovering and syncing entity quorum information.
*   **Performance:** The current single-threaded loop is for correctness. Parallel processing of independent entities will be explored later.
*   **Error Handling:** Robustly handling invalid inputs and state transitions.

This blueprint is now complete. It is a direct translation of our discussions into a concrete, actionable plan. I am confident it provides the robust and simple foundation required for the XLN project. I await your final approval to begin the implementation phase.