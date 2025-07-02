# Walkthrough: Hello Chat

This walkthrough demonstrates XLN's consensus mechanism through a simple chat application.

## Overview

We'll create a multi-signer chat entity and send a "hello" message through the complete consensus cycle:

1. **Setup**: Create entity with 3 signers
2. **Submit**: Add chat message to mempool  
3. **Propose**: Create frame from mempool
4. **Sign**: Collect validator signatures
5. **Commit**: Finalize with aggregated signature
6. **Verify**: Check state and Merkle roots

## Prerequisites

```bash
# Clone and install
git clone https://github.com/xln/xln
cd xln
bun install

# Run tests to verify setup
bun test
```

## Step 1: Initialize System

```typescript
import { initServer, importEntity } from './src/core/server';
import { createChatEntity } from './src/examples/chat';

// Create server with 3 signers
const server = initServer(3);

// Create chat entity with 2-of-3 multisig
const chatEntity = createChatEntity({
  quorum: {
    threshold: 67n,  // 67%
    members: [
      { address: '0xalice...', shares: 33n },
      { address: '0xbob...', shares: 33n },
      { address: '0xcarol...', shares: 34n }
    ]
  }
});

// Import entity to all signers
for (let i = 0; i < 3; i++) {
  server = importEntity(server, i, 'chatRoom', chatEntity);
}
```

## Step 2: Submit Transaction

```typescript
// Alice sends "hello" message
const chatTx: EntityTx = {
  kind: 'chat',
  data: {
    author: 'Alice',
    message: 'hello',
    timestamp: 1234567890n
  },
  nonce: 1n,
  sig: 'alice_sig_mock'
};

const input: Input = [
  0,                    // Alice's signer index
  'chatRoom',          // Entity ID
  { type: 'addTx', tx: chatTx }
];

server = applyInput(server, input);
```

**State after submission**:
```
Entity mempool: [chatTx]
Entity height: 0
Server height: 1
```

## Step 3: Propose Frame

```typescript
// Bob (proposer) creates frame
const proposeInput: Input = [
  1,                    // Bob's signer index
  'chatRoom',
  { type: 'proposeFrame' }
];

server = applyInput(server, proposeInput);
```

**Proposed frame**:
```typescript
{
  height: 1n,
  timestamp: 1234567890n,
  txs: [chatTx],
  postState: {
    messages: [{
      author: 'Alice',
      message: 'hello',
      timestamp: 1234567890n
    }]
  }
}
```

**Frame hash**: `0x3f2a8b9c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a`

## Step 4: Collect Signatures

```typescript
// Carol signs the frame
const signInput: Input = [
  2,                    // Carol's signer index
  'chatRoom',
  { 
    type: 'signFrame', 
    sig: 'carol_sig_on_frame_hash' 
  }
];

server = applyInput(server, signInput);
```

**Signature weight**:
- Bob (proposer): 33%
- Carol (validator): 34%
- **Total**: 67% ✓ (meets threshold)

## Step 5: Commit Frame

```typescript
// Bob aggregates signatures and commits
const hanko = aggregateSignatures([
  'bob_sig_on_frame_hash',
  'carol_sig_on_frame_hash'
]); // = '0x48_byte_bls_aggregate...'

const commitInput: Input = [
  1,                    // Bob's signer index
  'chatRoom',
  {
    type: 'commitFrame',
    frame: proposedFrame,
    hanko: hanko
  }
];

server = applyInput(server, commitInput);
```

## Step 6: Verify Final State

```typescript
// Check entity state
const finalEntity = server.replicas.get('0:chatRoom:0xalice...');
console.log({
  height: finalEntity.height,           // 1n
  messages: finalEntity.state.messages, // ['hello']
  status: finalEntity.status            // 'idle'
});

// Verify Merkle root
const root = computeServerRoot(server);
console.log(`Server root: ${root}`);
// 0xf1e2d3c4b5a6978685746352413f2e1d0c9b8a7f
```

## Complete Execution Trace

```
Tick 0: Server height=0
  └─ Process ADD_TX
     └─ Entity mempool=[chat_tx]

Tick 1: Server height=1  
  └─ Process PROPOSE_FRAME
     └─ Create frame hash=0x3f2a...
     └─ Entity status='proposed'

Tick 2: Server height=2
  └─ Process SIGN_FRAME
     └─ Add Carol's signature
     └─ Weight=67% (threshold met)

Tick 3: Server height=3
  └─ Process COMMIT_FRAME
     └─ Verify hanko
     └─ Apply state changes
     └─ Entity height=1
     └─ Clear mempool
     └─ Entity status='idle'

Final: Server root=0xf1e2...
```

## Key Observations

1. **Deterministic Execution**: Same inputs always produce same hashes
2. **Byzantine Tolerance**: System works with 2-of-3 signers
3. **Fast Finality**: 4 ticks (400ms) from submission to finality
4. **Audit Trail**: Every state change is recorded

## Testing Variations

### Single-Signer Mode

```typescript
// Personal chat (no consensus needed)
const personalChat = createChatEntity({
  quorum: {
    threshold: 100n,
    members: [{ address: '0xalice...', shares: 100n }]
  }
});
// Commits immediately, 1 tick latency
```

### Network Partition

```typescript
// Carol goes offline
// Bob (33%) + Alice (33%) = 66% < 67% threshold
// Frame cannot be committed
// System remains live but cannot progress
```

### Invalid State Transition

```typescript
// Malicious proposer creates invalid frame
const badFrame = {
  ...validFrame,
  postState: { messages: ['forged message'] }
};

// Validators compute expected state
// Mismatch detected
// Validators refuse to sign
// Frame rejected
```

## Running the Walkthrough

```bash
# Run interactive demo
bun run examples/chat-walkthrough.ts

# Run with debug logging
DEBUG=xln:* bun run examples/chat-walkthrough.ts

# Run automated test
bun test walkthrough.test.ts
```

## Next Steps

1. **Modify the chat app**: Add reactions, edits, threads
2. **Try different quorums**: 3-of-5, weighted voting
3. **Benchmark performance**: How many messages/second?
4. **Build your own app**: Payments, voting, games

## Code Repository

Full implementation available at:
- Chat entity: `src/examples/chat.ts`
- Walkthrough test: `tests/walkthrough.test.ts`
- Core logic: `src/core/`

For more examples, see the [examples/](https://github.com/xln/xln/tree/main/examples) directory.