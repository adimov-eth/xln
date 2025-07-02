# Hashing & Merkle Roots

XLN uses cryptographic hashing extensively for integrity verification, content addressing, and consensus.

## Hash Functions

### Primary: Keccak-256

All primary hashing uses Keccak-256 (Ethereum's SHA3 variant):

```typescript
import { keccak256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';

export function hash(data: Uint8Array): string {
  return '0x' + bytesToHex(keccak256(data));
}
```

**Properties**:
- 32-byte output
- Collision resistant
- Ethereum compatible
- Hardware accelerated

### Frame Hashing

Frames are hashed deterministically:

```typescript
export const encFrame = (f: Frame<EntityState>): Uint8Array =>
  rlp.encode([
    bnToBuf(f.height),
    f.ts,
    f.txs.map(encTx) as any,
    encEntityState(f.state),
  ]) as Uint8Array;

export function hashFrame(frame: Frame): string {
  const encoded = encFrame(frame);
  return '0x' + bytesToHex(keccak256(encoded));
}
```

**Design Choice**: `state` is included in the hash. This enforces that all validators agree on the exact same state transition and resulting state, making validation a simple hash comparison rather than requiring re-execution.

## Merkle Tree Construction

### Server State Root

The global Merkle root captures all entity states:

```typescript
export function computeServerRoot(state: ServerState): string {
  // Collect leaf nodes
  const leaves: Array<[string, string]> = [];
  
  for (const [addr, replica] of state.replicas) {
    const leaf = hash(RLP.encode([addr, replica.height]));
    leaves.push([addr, leaf]);
  }
  
  // Sort for determinism
  leaves.sort((a, b) => a[0].localeCompare(b[0]));
  
  // Build tree
  return buildMerkleRoot(leaves.map(l => l[1]));
}
```

### Binary Merkle Tree

```typescript
function buildMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return EMPTY_ROOT;
  if (leaves.length === 1) return leaves[0];
  
  // Pad to power of 2
  while (!isPowerOfTwo(leaves.length)) {
    leaves.push(EMPTY_LEAF);
  }
  
  // Build layers
  let layer = leaves;
  while (layer.length > 1) {
    const nextLayer = [];
    for (let i = 0; i < layer.length; i += 2) {
      const combined = concat(layer[i], layer[i + 1]);
      nextLayer.push(hash(combined));
    }
    layer = nextLayer;
  }
  
  return layer[0];
}
```

## Merkle Proofs

### Inclusion Proof

Prove an entity exists in the global state:

```typescript
export type MerkleProof = {
  leaf: string;
  path: Array<{
    hash: string;
    isLeft: boolean;
  }>;
};

export function verifyProof(
  proof: MerkleProof,
  root: string
): boolean {
  let current = proof.leaf;
  
  for (const node of proof.path) {
    if (node.isLeft) {
      current = hash(concat(node.hash, current));
    } else {
      current = hash(concat(current, node.hash));
    }
  }
  
  return current === root;
}
```

### Proof Generation

```typescript
export function generateProof(
  addr: string,
  state: ServerState
): MerkleProof {
  const leaves = sortedLeaves(state);
  const index = leaves.findIndex(l => l.addr === addr);
  
  const path = [];
  let currentIndex = index;
  let levelSize = leaves.length;
  
  while (levelSize > 1) {
    const siblingIndex = currentIndex ^ 1; // XOR flips last bit
    path.push({
      hash: leaves[siblingIndex].hash,
      isLeft: siblingIndex < currentIndex
    });
    
    currentIndex = Math.floor(currentIndex / 2);
    levelSize = Math.ceil(levelSize / 2);
  }
  
  return { leaf: leaves[index].hash, path };
}
```

## Hash-Based Storage

### Content Addressing

Frames stored by hash enable:

```typescript
// Store
const frameHash = hashFrame(frame);
await storage.put(`cas:${frameHash}`, frame);

// Retrieve with integrity check
const stored = await storage.get(`cas:${frameHash}`);
if (hashFrame(stored) !== frameHash) {
  throw new Error('Frame corrupted');
}
```

### Deduplication

Identical frames share storage:

```typescript
// Both entities store same frame
await storeFrame(entityA, frame); // Writes to disk
await storeFrame(entityB, frame); // Already exists, no-op
```

## Special Hashes

### Empty Values

```typescript
export const EMPTY_ROOT = '0x' + '00'.repeat(32);
export const EMPTY_LEAF = keccak256(new Uint8Array(0));
```

### Genesis Block

```typescript
export const GENESIS_HASH = hash(RLP.encode({
  height: 0n,
  timestamp: 0n,
  txs: []
}));
```

## Hash Lists vs Trees

Different structures for different uses:

| Structure | Use Case | Proof Size | Update Cost |
|-----------|----------|------------|-------------|
| Hash List | Transaction ordering | O(n) | O(1) |
| Merkle Tree | State proofs | O(log n) | O(log n) |
| Patricia Trie | Key-value proofs | O(k) | O(k) |

XLN uses:
- **Hash Lists**: For transaction ordering within frames
- **Merkle Trees**: For global state roots
- **Direct Hashing**: For frame integrity

## Security Considerations

### Collision Resistance

Keccak-256 provides 128-bit collision resistance:
- Birthday attacks require 2^128 operations
- Current Bitcoin hashrate: 2^67 hashes/second
- Time to collision: 2^61 seconds ≈ 73 billion years

### Preimage Resistance

Finding input for given hash requires 2^256 operations.

### Length Extension

Keccak uses sponge construction, immune to length extension attacks.

## Performance

### Optimization Techniques

1. **Incremental Hashing**
```typescript
class IncrementalHasher {
  private hasher = keccak256.create();
  
  update(data: Uint8Array) {
    this.hasher.update(data);
  }
  
  digest(): string {
    return '0x' + bytesToHex(this.hasher.digest());
  }
}
```

2. **Cached Hashes**
```typescript
const frameHashCache = new WeakMap<Frame, string>();

export function hashFrameCached(frame: Frame): string {
  if (frameHashCache.has(frame)) {
    return frameHashCache.get(frame)!;
  }
  const hash = hashFrame(frame);
  frameHashCache.set(frame, hash);
  return hash;
}
```

3. **Parallel Hashing**
```typescript
async function hashFramesParallel(frames: Frame[]): Promise<string[]> {
  return Promise.all(frames.map(f => 
    crypto.subtle.digest('SHA-256', encodeFrame(f))
  ));
}
```

## Future Enhancements

1. **STARK-Friendly Hashes**: Poseidon for ZK proofs
2. **Verkle Trees**: Smaller proofs than Merkle
3. **Hash-Based Signatures**: Post-quantum security
4. **Incremental Merkle Trees**: O(1) updates

For the security model built on these primitives, see [Security](./security.md).