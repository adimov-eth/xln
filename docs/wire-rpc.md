# Wire Protocol & RPC

XLN uses RLP encoding for all network communication and storage, ensuring consistent serialization across the system.

## Wire Encoding

### Input Format

The fundamental message format is a 3-tuple:

```typescript
export type Input = [signerIdx: number, entityId: string, cmd: Command];
```

**RLP Encoding**:
```typescript
const encoded = RLP.encode([
  signerIdx,           // Encoded as integer
  entityId,            // Encoded as UTF-8 string
  [cmd.type, ...args]  // Command as array
]);
```

**Example**:
```typescript
// Input message
const input: Input = [
  0,
  'myEntity',
  { type: 'addTx', tx: { kind: 'transfer', data: { to: 'alice', amount: 100n } } }
];

// Encoded (hex)
// 0xd383886d79456e74697479ce8461646454789874...
```

### Command Encoding

Commands are encoded with type as first element:

```typescript
// addTx command
['addTx', [tx.kind, tx.data, tx.nonce, tx.sig]]

// proposeFrame command
['proposeFrame']

// commitFrame command
['commitFrame', encodedFrame, hanko]
```

## RPC Interface

### JSON-RPC 2.0

XLN exposes a JSON-RPC interface for client interaction:

```typescript
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: any[];
  id: string | number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}
```

### Core Methods

#### `xln_submitTransaction`

Submit a transaction to an entity:

```json
{
  "jsonrpc": "2.0",
  "method": "xln_submitTransaction",
  "params": [{
    "signerIdx": 0,
    "entityId": "0x123...",
    "tx": {
      "kind": "transfer",
      "data": {
        "to": "0x456...",
        "amount": "1000000000000000000"
      },
      "nonce": "1",
      "sig": "0xabc..."
    }
  }],
  "id": 1
}
```

#### `xln_getEntityState`

Query current entity state:

```json
{
  "jsonrpc": "2.0",
  "method": "xln_getEntityState",
  "params": ["entityId"],
  "id": 2
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "height": "100",
    "state": { /* domain-specific */ },
    "quorum": {
      "threshold": "67",
      "members": [
        { "address": "0x...", "shares": "33" }
      ]
    }
  },
  "id": 2
}
```

#### `xln_getFrame`

Retrieve a specific frame:

```json
{
  "jsonrpc": "2.0",
  "method": "xln_getFrame",
  "params": ["entityId", "42"],
  "id": 3
}
```

#### `xln_subscribe`

Subscribe to entity updates (WebSocket only):

```json
{
  "jsonrpc": "2.0",
  "method": "xln_subscribe",
  "params": ["entityUpdates", { "entityId": "0x123..." }],
  "id": 4
}
```

### Error Codes

Standard JSON-RPC errors plus XLN-specific:

| Code | Message | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid request | Invalid method |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Invalid parameters |
| -32603 | Internal error | Server error |
| -40001 | Entity not found | Unknown entity ID |
| -40002 | Invalid nonce | Nonce mismatch |
| -40003 | Not authorized | Not in quorum |
| -40004 | Mempool full | Try again later |

## Binary Protocol (Future)

For performance-critical applications:

### Frame Format

```
[4 bytes] Magic number (0x584C4E00)
[4 bytes] Version
[4 bytes] Message length
[N bytes] RLP-encoded payload
[32 bytes] Checksum (Keccak-256)
```

### Message Types

```typescript
enum MessageType {
  INPUT = 0x01,
  FRAME = 0x02,
  STATE = 0x03,
  PROOF = 0x04
}
```

## Encoding Rules

### Type Mappings

| TypeScript | RLP | Notes |
|------------|-----|-------|
| `string` | UTF-8 bytes | No null terminator |
| `number` | Variable-length integer | Big-endian |
| `bigint` | Variable-length integer | No leading zeros |
| `boolean` | 0x00 or 0x01 | Single byte |
| `null` | Empty string | Zero length |
| `undefined` | Error | Not encodable |
| `Array` | List | Recursive encoding |
| `Object` | List of values | Fixed field order |

### Address Encoding

Addresses use lowercase hex without checksums:

```typescript
// Correct
"0xabcdef1234567890abcdef1234567890abcdef12"

// Incorrect (checksummed)
"0xAbCdEf1234567890aBcDeF1234567890AbCdEf12"
```

**Rationale**: Prevents object identity issues in JavaScript Maps.

### BigInt Handling

```typescript
// Encoding
const encoded = RLP.encode(123n); // Removes leading zeros

// JSON serialization
JSON.stringify({ value: 123n }, (k, v) => 
  typeof v === 'bigint' ? v.toString() : v
);
```

## Batching

Multiple operations can be batched:

```json
{
  "jsonrpc": "2.0",
  "method": "xln_submitBatch",
  "params": [{
    "inputs": [
      [0, "entity1", { "type": "addTx", "tx": {...} }],
      [0, "entity2", { "type": "addTx", "tx": {...} }],
      [1, "entity1", { "type": "proposeFrame" }]
    ]
  }],
  "id": 5
}
```

## Compression

Large messages can be compressed:

```typescript
// Client indicates support
headers: {
  'Accept-Encoding': 'gzip, deflate',
  'Content-Encoding': 'gzip'
}

// Server response
headers: {
  'Content-Encoding': 'gzip',
  'X-Uncompressed-Length': '10485760'
}
```

## Rate Limiting

Requests include signer proof for rate limiting:

```json
{
  "jsonrpc": "2.0",
  "method": "xln_submitTransaction",
  "params": [...],
  "auth": {
    "signer": "0x123...",
    "signature": "0xabc...",
    "timestamp": "1234567890"
  },
  "id": 6
}
```

## WebSocket Protocol

### Connection

```javascript
const ws = new WebSocket('wss://xln-node.com/ws');

ws.on('open', () => {
  // Subscribe to updates
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'xln_subscribe',
    params: ['newFrames', { entityId: '0x...' }],
    id: 1
  }));
});
```

### Subscription Management

```typescript
// Subscribe response
{
  "jsonrpc": "2.0",
  "result": "0x1234...", // Subscription ID
  "id": 1
}

// Updates
{
  "jsonrpc": "2.0",
  "method": "xln_subscription",
  "params": {
    "subscription": "0x1234...",
    "result": { /* frame data */ }
  }
}

// Unsubscribe
{
  "jsonrpc": "2.0",
  "method": "xln_unsubscribe",
  "params": ["0x1234..."],
  "id": 2
}
```

## Client Libraries

### TypeScript SDK

```typescript
import { XlnClient } from '@xln/client';

const client = new XlnClient('https://xln-node.com');

// Submit transaction
const receipt = await client.submitTransaction({
  signerIdx: 0,
  entityId: 'myEntity',
  tx: {
    kind: 'transfer',
    data: { to: 'alice', amount: 100n },
    nonce: 1n,
    sig: await wallet.sign(txHash)
  }
});

// Query state
const state = await client.getEntityState('myEntity');
```

## Implementation Notes

1. **Idempotency**: Include client-generated ID for retry safety
2. **Versioning**: Use headers for protocol version negotiation
3. **Timeouts**: Default 30s timeout for all requests
4. **Retries**: Exponential backoff with jitter
5. **Circuit Breaking**: Fail fast after repeated errors

For specific edge cases, see [Edge Cases](./edge-cases.md).