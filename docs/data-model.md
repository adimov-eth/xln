# Data Model

XLN uses a carefully designed type system that balances simplicity with expressiveness. All types are designed for efficient RLP encoding and deterministic hashing.

## Core Types

### Wire Envelope

The fundamental message format for all communication:

```typescript
export interface Input {
  from: Address;
  to:   Address;
  cmd:  Command;
}
```

**Implementation**: [`src/types.ts`](../src/types.ts)

### Commands

Commands drive state transitions at the consensus level:

```typescript
export type Command =
  | { type: 'IMPORT';  replica: Replica }
  | { type: 'ADD_TX';  addrKey: string; tx: Transaction }
  | { type: 'PROPOSE'; addrKey: string; ts: TS }
  | { type: 'SIGN';    addrKey: string; signer: Address; frameHash: Hex; sig: Hex }
  | { type: 'COMMIT';  addrKey: string; hanko: Hanko; frame: Frame<EntityState> };
```

**Implementation**: [`src/types.ts`](../src/types.ts)

### Transaction

Application-level operations within an entity:

```typescript
export type Transaction = ChatTx; // In MVP, only 'chat' transactions exist

export type ChatTx = BaseTx<'chat'> & { body: { message: string } };

export interface BaseTx<K extends TxKind = TxKind> {
  kind:  K;
  nonce: Nonce;
  from:  Address;
  body:  unknown;
  sig:   Hex;
}
```

**Key Properties**:
- `kind`: Determines processing logic
- `nonce`: Per-signer replay protection
- `sig`: Ensures authenticity

### Frame

The entity-level block structure:

```typescript
export interface Frame<T = unknown> {
  height: UInt64;
  ts:     TS;
  txs:    Transaction[];
  state:  T;
};
```

**Design Note**: Including `state` in the frame enables instant verification without replay. The hash of the frame includes this state, ensuring deterministic validation.

### Entity State

Complete state of an autonomous entity:

```typescript
export interface EntityState {
  quorum: Quorum;
  chat:   { from: Address; msg: string; ts: TS }[];
}
```

### Quorum Definition

Defines consensus requirements:

```typescript
export type Quorum = {
  threshold: bigint;                              // Required voting power
  members: { address: string; shares: bigint }[]; // Weighted membership
};
```

**Example**: 2-of-3 multisig:
```typescript
const quorum: Quorum = {
  threshold: 67n,  // 67%
  members: [
    { address: '0xabc...', shares: 33n },
    { address: '0xdef...', shares: 33n },
    { address: '0x123...', shares: 34n }
  ]
};
```

## Derived Types

### Server State

The global system state:

```typescript
export type ServerState = {
  height: bigint;
  replicas: Map<string, Replica>;  // address → entity state
  mempool: Input[];
};
```

### Replica

A signer's copy of an entity:

```typescript
export type Replica = EntityState & {
  lastSync: bigint;  // Server height when last updated
};
```

### Hanko

BLS aggregate signature (48 bytes):

```typescript
export type Hanko = string;  // '0x' + 96 hex chars
```

### Address

Composite entity address:

```typescript
export type Address = string;  // 'jurisdiction:entityId:signerAddr'
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
    frame.txs.map(tx => [tx.kind, tx.data, tx.nonce, tx.sig]),
    encodeEntityState(frame.postState)
  ]);
}
```

## Hashing

All hashes use Keccak-256:

```typescript
import { keccak256 } from '@noble/hashes/sha3';

export function hashFrame(frame: Frame): string {
  const encoded = encodeFrame(frame);
  return '0x' + bytesToHex(keccak256(encoded));
}
```

## Type Safety

TypeScript branded types prevent mixing:

```typescript
// Planned enhancement
export type FrameHash = string & { readonly brand: unique symbol };
export type Address = string & { readonly brand: unique symbol };
```

## Domain-Specific States

Applications define their own state shapes:

### Chat Application
```typescript
type ChatState = {
  messages: Array<{
    author: string;
    content: string;
    timestamp: bigint;
  }>;
};
```

### Token Ledger
```typescript
type TokenState = {
  balances: Record<string, bigint>;
  totalSupply: bigint;
};
```

### Governance
```typescript
type GovernanceState = {
  proposals: Map<string, Proposal>;
  votes: Map<string, Map<string, boolean>>;
};
```

## Validation

All types are validated on input:

```typescript
export function validateCommand(cmd: unknown): Command {
  if (!isObject(cmd) || !('type' in cmd)) {
    throw new Error('Invalid command');
  }
  
  switch (cmd.type) {
    case 'addTx':
      return validateAddTx(cmd);
    case 'proposeFrame':
      return validateProposeFrame(cmd);
    // ... other cases
  }
}
```

## Migration

Types can evolve with versioning:

```typescript
export type EntityStateV2 = EntityStateV1 & {
  version: 2;
  newField: string;
};

function migrateEntity(state: EntityStateV1): EntityStateV2 {
  return { ...state, version: 2, newField: 'default' };
}
```

For consensus mechanisms using these types, see [Consensus](./consensus.md).