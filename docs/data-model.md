# Data Model

XLN uses a carefully designed type system that balances simplicity with expressiveness. All types are designed for efficient RLP encoding and deterministic hashing.

## Core Types

### Wire Envelope

The fundamental message format for all communication:

```typescript
export type Input = [
  signerIdx: number,   // lexicographic index of signerId present this tick
  entityId: string,    // target Entity
  cmd: Command         // consensus-level command
]
```

**Implementation**: [`src/types.ts`](../src/types.ts)

### Commands

Commands drive state transitions at the consensus level:

```typescript
export type Command =
  | { type: 'importEntity'; snapshot: EntityState }
  | { type: 'addTx'; tx: EntityTx }
  | { type: 'proposeFrame'; header: FrameHeader } // A2: now carries FrameHeader
  | { type: 'signFrame'; sig: string }
  | { type: 'commitFrame'; frame: Frame; hanko: string }
```

**Implementation**: [`src/types.ts`](../src/types.ts)

### Transaction

Application-level operations within an entity:

```typescript
export interface EntityTx {
  kind: string;    // e.g. 'chat', 'transfer', 'jurisdictionEvent'
  data: unknown;   // domain payload; must be type-checked by application logic
  nonce: bigint;   // strictly increasing per-signer
  sig: string;     // signer's signature over RLP(tx)
}
```

**Key Properties**:

- `kind`: Determines processing logic
- `nonce`: Per-signer replay protection (A3: incremented before adding to mempool)
- `sig`: Ensures authenticity

### Frame

The entity-level block structure:

```typescript
export interface Frame {
  height: bigint;           // sequential frame number
  timestamp: bigint;        // unix-ms at creation (bigint for 64-bit safety)
  header: FrameHeader;      // static fields hashed for propose/sign
  txs: EntityTx[];          // ordered transactions
  postStateRoot: string;    // keccak256 of EntityState after txs (A4: was postState)
}

export interface FrameHeader {
  entityId: string;
  height: bigint;
  memRoot: string;          // Merkle root of *sorted* tx list (see Y-2 rule)
  prevStateRoot: string;
  proposer: string;         // signerId that built the frame
}
```

**Design Note**: The frame hash (R-1) is computed as `keccak256(rlp(header ‖ txs))`. Transactions are sorted by the Y-2 rule: nonce → sender → kind → index.

### Entity State

Complete state of an autonomous entity:

```typescript
export interface EntityState {
  height: bigint;                              // last committed height
  quorum: Quorum;                              // active quorum
  signerRecords: Record<string, { nonce: bigint }>;
  domainState: unknown;                        // application domain data
  mempool: EntityTx[];                         // pending txs
  proposal?: { header: FrameHeader; sigs: Record<string, string> };
}
```

### Quorum Definition

Defines consensus requirements:

```typescript
export type Quorum = {
  threshold: bigint // Required voting power
  members: { address: string; shares: bigint }[] // Weighted membership
}
```

**Example**: 2-of-3 multisig:

```typescript
const quorum: Quorum = {
  threshold: 67n, // 67%
  members: [
    { address: '0xabc...', shares: 33n },
    { address: '0xdef...', shares: 33n },
    { address: '0x123...', shares: 34n },
  ],
}
```

## Derived Types

### Server State

The global system state:

```typescript
export type ServerState = Map<`${SignerIdx}:${string}`, Replica>

// A5: Server Frame (global timeline)
export interface ServerFrame {
  frameId: number;
  timestamp: bigint;
  root: string;                 // Merkle root of replica state hashes
  inputsRoot: string;           // Merkle root of RLP(ServerInput)
}
```

### Replica

A signer's copy of an entity:

```typescript
export type Replica = {
  attached: boolean;
  state: EntityState;
}
```

### Hanko

BLS aggregate signature (48 bytes):

```typescript
export type Hanko = string // '0x' + 96 hex chars
```

### Server Input Batch

Server-level input batch for each tick:

```typescript
export interface ServerInput {
  inputId: string;              // UID for the batch
  frameId: number;              // monotone tick counter
  timestamp: bigint;            // unix-ms
  metaTxs: ServerMetaTx[];      // network-wide cmds (renamed per Y-1)
  entityInputs: EntityInput[];  // per-entity signed inputs
}

export interface ServerMetaTx { // was ServerTx
  type: 'importEntity';
  entityId: string;
  data: unknown;                // snapshot / metadata
}

export interface EntityInput {
  jurisdictionId: string;       // format chainId:contractAddr
  signerId: string;             // BLS public key (hex)
  entityId: string;
  quorumProof: {
    quorumHash: string;
    quorumStructure: string;    // reserved – must be '0x' until Phase 3
  };
  entityTxs: EntityTx[];        // includes jurisdictionEvent txs
  precommits: string[];         // BLS sigs over header hash
  proposedBlock: string;        // keccak256(rlp(header ‖ txs))
  observedInbox: InboxMessage[];
  accountInputs: AccountInput[];
}

export interface InboxMessage {
  msgHash: string;              // keccak256(message) (A6)
  fromEntityId: string;
  message: unknown;
}

export interface AccountInput {
  counterEntityId: string;
  channelId?: bigint;           // reserved for phase 2 multi-channel support (A6)
  accountTxs: AccountTx[];
}

export interface AccountTx {
  type: 'AddPaymentSubcontract';
  paymentId: string;
  amount: number;
}
```

### Address

Ethereum-style address:

```typescript
export type Address = `0x${string}` // Ethereum-style BLS public key
```

## Encoding Rules

All data structures use RLP (Recursive Length Prefix) encoding:

### Basic Types

- `string`: UTF-8 bytes
- `bigint`: Big-endian bytes, no leading zeros
- `boolean`: 0x00 (false) or 0x01 (true)
- `null`: Empty string

### Complex Types

- Arrays: `[len, item1, item2, ...]`
- Objects: Encoded as arrays with fixed field order
- Maps: Encoded as sorted key-value pairs

### Example: Frame Encoding

```typescript
function encodeFrame(frame: Frame): Uint8Array {
  return RLP.encode([
    frame.height,
    frame.timestamp,
    frame.header,
    frame.txs.map((tx) => [tx.kind, tx.data, tx.nonce, tx.sig]),
    frame.postStateRoot,
  ])
}
```

## Hashing

All hashes use Keccak-256:

```typescript
import { keccak256 } from '@noble/hashes/sha3'

// R-1: Frame hash = keccak256(rlp(header ‖ txs))
export function hashFrame(header: FrameHeader, txs: EntityTx[]): string {
  const encoded = RLP.encode([header, txs])
  return '0x' + bytesToHex(keccak256(encoded))
}

// Y-2: Transactions are sorted before hashing
export function computeMemRoot(txs: EntityTx[]): string {
  const sortedTxs = sortTransactions(txs) // nonce → sender → kind → index
  const leaves = sortedTxs.map(tx => RLP.encode(tx))
  return '0x' + bytesToHex(keccak256(merkle(leaves)))
}
```

## Type Safety

TypeScript branded types prevent mixing:

```typescript
// Planned enhancement
export type FrameHash = string & { readonly brand: unique symbol }
export type Address = string & { readonly brand: unique symbol }
```

## Domain-Specific States

Applications define their own state shapes:

### Chat Application

```typescript
type ChatState = {
  messages: Array<{
    author: string
    content: string
    timestamp: bigint
  }>
}
```

### Token Ledger

```typescript
type TokenState = {
  balances: Record<string, bigint>
  totalSupply: bigint
}
```

### Governance

```typescript
type GovernanceState = {
  proposals: Map<string, Proposal>
  votes: Map<string, Map<string, boolean>>
}
```

## Validation

All types are validated on input:

```typescript
export function validateCommand(cmd: unknown): Command {
  if (!isObject(cmd) || !('type' in cmd)) {
    throw new Error('Invalid command')
  }

  switch (cmd.type) {
    case 'importEntity':
      return validateImportEntity(cmd)
    case 'addTx':
      return validateAddTx(cmd)
    case 'proposeFrame':
      return validateProposeFrame(cmd)
    case 'signFrame':
      return validateSignFrame(cmd)
    case 'commitFrame':
      return validateCommitFrame(cmd)
  }
}
```

## Migration

Types can evolve with versioning:

```typescript
export type EntityStateV2 = EntityStateV1 & {
  version: 2
  newField: string
}

function migrateEntity(state: EntityStateV1): EntityStateV2 {
  return { ...state, version: 2, newField: 'default' }
}
```

For consensus mechanisms using these types, see [Consensus](./consensus.md).
