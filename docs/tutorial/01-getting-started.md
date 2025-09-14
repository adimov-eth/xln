# XLN Tutorial: Getting Started

Welcome to XLN - the organizational layer for digital finance. This tutorial will guide you through understanding and using the XLN protocol to create programmable organizations with bilateral sovereignty.

## What is XLN?

XLN is **not** another blockchain. It's a trilayer architecture where:
- **J-machines** (Jurisdictions) provide collateral enforcement and dispute resolution
- **E-machines** (Entities) enable organizational governance and consensus
- **A-machines** (Accounts/Channels) handle bilateral relationships and payments

Think of it as "state channels for organizations" - each entity maintains its own sovereign ledger, interacting with others through cryptographically-secured bilateral channels.

## Core Concepts

### 1. No Global Consensus
Unlike traditional blockchains, XLN doesn't require global consensus. Each entity advances when its own quorum signs. This means:
- **Instant finality** for your organization
- **No waiting** for network confirmation
- **Bilateral sovereignty** - you and your counterparty decide your shared reality

### 2. Three-Zone Capacity Model
Channels in XLN use a unique credit model:
```
[---Your Credit---|====Collateral====|---Peer Credit---]
                   ^
                   Delta (net position)
```
- **Collateral**: Backed by real assets in J-machine
- **Credit Limits**: Unsecured but bounded exposure
- **Delta**: Your net position, can slide anywhere in the range

### 3. Ondelta vs Offdelta
XLN tracks two types of position changes:
- **Ondelta**: On-chain movements (slow, final, through J-machine)
- **Offdelta**: Off-chain movements (instant, bilateral, through transformers)
- **Total Delta = Ondelta + Offdelta**

This gives you billion+ TPS locally with cryptographic finality when needed.

## Your First Entity

### Step 1: Install Dependencies

```bash
# Clone the repository
git clone https://github.com/yourusername/xln.git
cd xln

# Install dependencies
bun install

# Build contracts
cd contracts && npx hardhat compile && cd ..

# Start local network
npx hardhat node
```

### Step 2: Create Your Entity

```typescript
import { ethers } from 'ethers';
import { EntityProvider } from './contracts/EntityProvider.sol';

// Connect to network
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const wallet = ethers.Wallet.createRandom().connect(provider);

// Get EntityProvider contract
const entityProvider = new ethers.Contract(
  ENTITY_PROVIDER_ADDRESS,
  EntityProviderABI,
  wallet
);

// Register your entity
const boardHash = ethers.id('my-organization-v1');
const tx = await entityProvider.registerNumberedEntity(boardHash);
const receipt = await tx.wait();

// Extract your entity number
const event = receipt.logs.find(log => log.fragment?.name === 'EntityRegistered');
const entityNumber = event.args.entityNumber;
console.log(`✅ Entity registered: #${entityNumber}`);
```

### Step 3: Setup Governance

```typescript
import { processEntityInput } from './src/entity-consensus';

// Define your consensus configuration
const config = {
  mode: 'proposer-based',
  threshold: 51n, // 51% threshold
  validators: [wallet.address],
  shares: { [wallet.address]: 100n }
};

// Create entity replica
const replica = {
  entityId: entityNumber,
  signerId: wallet.address,
  state: {
    height: 0,
    timestamp: Date.now(),
    nonces: new Map(),
    messages: [],
    proposals: new Map(),
    config
  },
  mempool: [],
  isProposer: true
};

// Process transactions
const input = {
  entityId: entityNumber,
  signerId: wallet.address,
  entityTxs: [{
    type: 'chat',
    data: { message: 'Entity initialized!' }
  }]
};

const result = await processEntityInput(input, env);
console.log(`✅ Entity state updated to height ${result.replica.state.height}`);
```

## Opening Your First Channel

Channels are bilateral relationships between entities. They enable instant, free transactions with cryptographic guarantees.

### Step 1: Find a Peer

```typescript
// Get another entity to connect with
const peerEntityId = 'entity-id-of-peer';

// Define channel parameters
const channelParams = {
  peerId: peerEntityId,
  initialDeposit: 1000000, // 1M units of collateral
  creditLimit: 500000      // 500K credit limit
};
```

### Step 2: Open the Channel

```typescript
import { EntityChannelBridge } from './src/EntityChannelBridge';

// Initialize bridge
const bridge = new EntityChannelBridge(env);
await bridge.initialize(entityNumber, replica);

// Open channel
await bridge.processEntityTx(entityNumber, {
  type: 'channel_open',
  data: channelParams
});

console.log(`✅ Channel opened with ${peerEntityId}`);
```

### Step 3: Make Payments

```typescript
// Update channel with payment (offdelta - instant)
await bridge.processEntityTx(entityNumber, {
  type: 'channel_update',
  data: {
    channelKey,
    delta: 10000,     // Send 10K units
    isOndelta: false  // Off-chain (instant)
  }
});

// Check capacity
const capacity = await bridge.getChannelCapacity(channelKey, true);
console.log(`Inbound capacity: ${capacity.inCapacity}`);
console.log(`Outbound capacity: ${capacity.outCapacity}`);
```

## Executing Swaps

XLN supports atomic cross-asset swaps within channels using "transformers" - pure functions that modify channel state.

### Simple Swap

```typescript
import { SwapTransformer } from './src/transformers/SwapTransformer';

// Define swap parameters
const swapParams = {
  tokenIdA: 1,      // Token you're selling
  amountA: 100n,    // Amount to sell
  tokenIdB: 2,      // Token you're buying
  amountB: 50n,     // Amount to buy
  nonce: 1,
  expiry: Date.now() + 3600000 // 1 hour
};

// Execute swap
const result = SwapTransformer.executeSwap(
  channel.subchannels,
  swapParams,
  true // You are left side
);

if (result.success) {
  console.log(`✅ Swap executed: ${result.proof.swapId}`);
}
```

### Multi-Hop Swaps

```typescript
import { MultiHopSwapTransformer } from './src/transformers/SwapTransformer';

// Define path through multiple channels
const hops = [
  { channelKey: channel1Key, subchannels: channel1.subchannels, isLeft: true },
  { channelKey: channel2Key, subchannels: channel2.subchannels, isLeft: false }
];

// Execute multi-hop swap
const result = MultiHopSwapTransformer.executeMultiHop(hops, {
  tokenPath: [1, 2, 3], // token1 -> token2 -> token3
  amounts: [100n, 95n], // Amount at each hop
  nonce: 1,
  expiry: Date.now() + 3600000
});

console.log(`✅ Multi-hop swap completed with ${result.proofs.length} hops`);
```

## Handling Disputes

While most operations are cooperative, XLN provides robust dispute resolution through J-machines.

### Cooperative Close

```typescript
// Both parties agree to close
await bridge.processEntityTx(entityNumber, {
  type: 'channel_close',
  data: {
    channelKey,
    finalState: 'cooperative'
  }
});
```

### Dispute Resolution

```typescript
// Submit latest proof to J-machine
const disputeProof = {
  channelKey,
  seq: latestSequence,
  stateHash: latestStateHash,
  signatures: {
    left: leftSignature,
    right: rightSignature
  }
};

await bridge.processEntityTx(entityNumber, {
  type: 'channel_dispute',
  data: {
    channelKey,
    disputeProof
  }
});

// J-machine handles:
// 1. Challenge period (allows counter-proofs)
// 2. Validation of signatures
// 3. Final settlement based on latest valid proof
```

## Best Practices

### 1. State Management
- Take snapshots regularly: `await storage.createSnapshot('backup-001')`
- Use offdelta for frequent updates, ondelta for checkpoints
- Keep local mempool small (< 1000 transactions)

### 2. Security
- Never share private keys
- Validate all incoming proofs
- Monitor for Byzantine faults
- Set appropriate credit limits

### 3. Performance
- Batch operations when possible
- Use dry-run validation before execution
- Cache frequently accessed channel states
- Consider using PostgreSQL for production

## Next Steps

Now that you understand the basics:

1. **[Tutorial 2: Building a DAO](./02-building-dao.md)** - Create multi-signer entities
2. **[Tutorial 3: Advanced Channels](./03-advanced-channels.md)** - Credit limits, allowances, HTLCs
3. **[Tutorial 4: Writing Transformers](./04-transformers.md)** - Custom business logic
4. **[Tutorial 5: Production Deployment](./05-production.md)** - Scale to millions of channels

## Common Issues

### "Entity not found"
Make sure you've registered your entity on the J-machine first.

### "Insufficient capacity"
Check your credit limits and collateral. You might need to add more collateral or wait for incoming payments.

### "Byzantine fault detected"
You (or your peer) tried to double-sign. This is a serious issue that may result in slashing.

## Support

- GitHub Issues: [github.com/xln/issues](https://github.com/xln/issues)
- Documentation: [docs.xln.org](https://docs.xln.org)
- Discord: [discord.gg/xln](https://discord.gg/xln)

---

Remember: XLN is about **bilateral sovereignty**. You don't need permission from the network - just agreement with your counterparty. Build freely!