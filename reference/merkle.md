# XLN LevelDB & Merkle Tree Implementation Specification

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Key Encoding Scheme](#2-key-encoding-scheme)
3. [Storage Hierarchy](#3-storage-hierarchy)
4. [Merkle Tree Design](#4-merkle-tree-design)
5. [Snapshot System](#5-snapshot-system)
6. [Implementation Details](#6-implementation-details)
7. [Performance Optimizations](#7-performance-optimizations)
8. [Migration Path](#8-migration-path)

## 1. Architecture Overview

### 1.1 Design Principles
- **Hierarchical Key Encoding**: Keys encode the full path (Server → Signer → Entity → Channel)
- **Entity Isolation**: Each entity has its own LevelDB instance for independent snapshots
- **Dual Snapshot System**: Mutable (fast restart) and immutable (audit trail)
- **Merkle Integration**: Every value update maintains merkle proofs
- **Buffer-First**: Use buffers for keys internally, strings at API boundary

### 1.2 Storage Layout
/data
├── /server
│   ├── state.ldb          # Server state, registry, and signer roots
│   ├── blocks.ldb         # Server block history
│   └── wal.ldb           # Write-ahead log for recovery
├── /entities
│   └── /{entityId}
│       ├── state.ldb      # Entity state with merkle nodes
│       ├── blocks.ldb     # Entity block history
│       └── channels.ldb   # Channel states (future)
└── /archive
    └── snapshots.ldb      # Immutable snapshots by hash


### 1.3 Component Architecture
typescript
┌─────────────────┐
│   Application   │
└────────┬────────┘
         │
┌────────▼────────┐
│   Storage API   │ (Your existing interface)
└────────┬────────┘
         │
┌────────▼────────┐
│  MerkleKV Layer │ (New: Maintains proofs)
└────────┬────────┘
         │
┌────────▼────────┐
│   BufferKV      │ (New: Binary key encoding)
└────────┬────────┘
         │
┌────────▼────────┐
│    LevelDB      │ (Persistent storage)
└─────────────────┘


## 2. Key Encoding Scheme

### 2.1 Path Components
typescript
// Path component identifiers (1 byte each)
export const PATH_TYPES = {
  SERVER: 0x00,
  SIGNER: 0x01,
  ENTITY: 0x02,
  CHANNEL: 0x03,
  
  // Storage types within each level
  STATE: 0x10,
  MEMPOOL: 0x11,
  PROPOSAL: 0x12,
  REGISTRY: 0x13,
  WAL: 0x14,
  BLOCK: 0x15,
  MERKLE: 0x16,
} as const;


### 2.2 Key Structure
typescript
// ============================================================================
// storage/keys.ts - Hierarchical key encoding
// ============================================================================

import { Buffer } from 'buffer';
import type { BlockHeight, EntityId, SignerId, ChannelId } from '../types';

export class KeyEncoder {
  // Component encoding
  private static encodeSignerId(id: SignerId): Buffer {
    // 32 bytes for signer
    return Buffer.from(id.padEnd(32, '\0'));
  }
  
  private static encodeEntityId(id: EntityId): Buffer {
    // 32 bytes for entity
    return Buffer.from(id.padEnd(32, '\0'));
  }
  
  private static encodeChannelId(id: ChannelId): Buffer {
    // 32 bytes for channel
    return Buffer.from(id.padEnd(32, '\0'));
  }
  
  private static encodeHeight(height: BlockHeight): Buffer {
    // 8 bytes for block height (up to 2^64)
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(height));
    return buf;
  }
  
  // Server-level keys (0 bytes path)
  static serverState(): Buffer {
    return Buffer.from([PATH_TYPES.SERVER, PATH_TYPES.STATE]);
  }
  
  static serverRegistry(): Buffer {
    return Buffer.from([PATH_TYPES.SERVER, PATH_TYPES.REGISTRY]);
  }
  
  static serverBlock(height: BlockHeight): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.SERVER, PATH_TYPES.BLOCK]),
      this.encodeHeight(height)
    ]);
  }
  
  // Signer-level keys (32 bytes path)
  static signerState(signerId: SignerId): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.SIGNER, PATH_TYPES.STATE]),
      this.encodeSignerId(signerId)
    ]);
  }
  
  static signerMempool(signerId: SignerId): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.SIGNER, PATH_TYPES.MEMPOOL]),
      this.encodeSignerId(signerId)
    ]);
  }
  
  // Entity-level keys (64 bytes path)
  static entityState(signerId: SignerId, entityId: EntityId): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.ENTITY, PATH_TYPES.STATE]),
      this.encodeSignerId(signerId),
      this.encodeEntityId(entityId)
    ]);
  }
  
  static entityProposal(signerId: SignerId, entityId: EntityId): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.ENTITY, PATH_TYPES.PROPOSAL]),
      this.encodeSignerId(signerId),
      this.encodeEntityId(entityId)
    ]);
  }
  
  // Channel-level keys (96 bytes path)
  static channelState(signerId: SignerId, entityId: EntityId, channelId: ChannelId): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.CHANNEL, PATH_TYPES.STATE]),
      this.encodeSignerId(signerId),
      this.encodeEntityId(entityId),
      this.encodeChannelId(channelId)
    ]);
  }
  
  // WAL keys include height for ordering
  static walEntry(height: BlockHeight, signerId: SignerId, entityId: EntityId): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.WAL]),
      this.encodeHeight(height),
      this.encodeSignerId(signerId),
      this.encodeEntityId(entityId)
    ]);
  }
  
  // Range query helpers
  static signerRange(signerId: SignerId): { start: Buffer; end: Buffer } {
    const base = Buffer.concat([
      Buffer.from([PATH_TYPES.SIGNER]),
      this.encodeSignerId(signerId)
    ]);
    
    return {
      start: base,
      end: Buffer.concat([base, Buffer.from([0xFF])])
    };
  }
  
  static entityRange(signerId: SignerId, entityId: EntityId): { start: Buffer; end: Buffer } {
    const base = Buffer.concat([
      Buffer.from([PATH_TYPES.ENTITY]),
      this.encodeSignerId(signerId),
      this.encodeEntityId(entityId)
    ]);
    
    return {
      start: base,
      end: Buffer.concat([base, Buffer.from([0xFF])])
    };
  }
}


### 2.3 Merkle Path Encoding
typescript
// ============================================================================
// storage/merkle-keys.ts - Merkle tree path encoding
// ============================================================================

export class MerkleKeyEncoder {
  // Merkle nodes are stored separately with special prefix
  static merkleNode(path: number[]): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.MERKLE]),
      Buffer.from(path)
    ]);
  }
  
  // Convert storage key to merkle path
  static keyToPath(key: Buffer): number[] {
    const path: number[] = [];
    
    // Each byte becomes part of the path
    for (const byte of key) {
      // Split byte into 2 nibbles for 4-bit branching
      path.push((byte >> 4) & 0x0F);
      path.push(byte & 0x0F);
    }
    
    return path;
  }
  
  // Store merkle proofs
  static merkleProof(entityId: EntityId, blockHeight: BlockHeight): Buffer {
    return Buffer.concat([
      Buffer.from([PATH_TYPES.MERKLE, 0xFF]), // Special proof
typescript
      KeyEncoder.encodeEntityId(entityId),
      KeyEncoder.encodeHeight(blockHeight)
    ]);
  }
}
## 3. Storage Hierarchy

### 3.1 BufferKV Interface
typescript
// ============================================================================
// storage/buffer-kv.ts - Buffer-based KV interface
// ============================================================================

export interface BufferKV {
  get(key: Buffer): Promise<Buffer | undefined>;
  put(key: Buffer, value: Buffer): Promise<void>;
  del(key: Buffer): Promise<void>;
  batch(ops: BufferBatchOp[]): Promise<void>;
  iterator(options?: BufferRangeOptions): AsyncIterable<[Buffer, Buffer]>;
  close(): Promise<void>;
}

export interface BufferBatchOp {
  type: 'put' | 'del';
  key: Buffer;
  value?: Buffer;
}

export interface BufferRangeOptions {
  gt?: Buffer;
  gte?: Buffer;
  lt?: Buffer;
  lte?: Buffer;
  reverse?: boolean;
  limit?: number;
}

// Bridge between string KV and buffer KV
export class BufferKVAdapter implements KV {
  constructor(private bufferKV: BufferKV) {}
  
  async get(key: string): Promise<string | undefined> {
    const value = await this.bufferKV.get(Buffer.from(key));
    return value ? value.toString('utf8') : undefined;
  }
  
  async put(key: string, value: string): Promise<void> {
    await this.bufferKV.put(
      Buffer.from(key),
      Buffer.from(value, 'utf8')
    );
  }
  
  async del(key: string): Promise<void> {
    await this.bufferKV.del(Buffer.from(key));
  }
  
  async batch(ops: { type: 'put' | 'del'; key: string; value?: string }[]): Promise<void> {
    const bufferOps: BufferBatchOp[] = ops.map(op => ({
      type: op.type,
      key: Buffer.from(op.key),
      value: op.value ? Buffer.from(op.value, 'utf8') : undefined
    }));
    await this.bufferKV.batch(bufferOps);
  }
  
  async *iterator(options?: { gte?: string; lt?: string }): AsyncIterable<[string, string]> {
    const bufferOptions: BufferRangeOptions = {};
    if (options?.gte) bufferOptions.gte = Buffer.from(options.gte);
    if (options?.lt) bufferOptions.lt = Buffer.from(options.lt);
    
    for await (const [key, value] of this.bufferKV.iterator(bufferOptions)) {
      yield [key.toString('utf8'), value.toString('utf8')];
    }
  }
}
### 3.2 LevelDB Implementation
typescript
// ============================================================================
// storage/leveldb-kv.ts - LevelDB implementation of BufferKV
// ============================================================================

import { Level } from 'level';
import type { BufferKV, BufferBatchOp, BufferRangeOptions } from './buffer-kv';

export class LevelDBKV implements BufferKV {
  private db: Level<Buffer, Buffer>;
  
  constructor(path: string, options?: {
    compression?: boolean;
    cacheSize?: number;
    writeBufferSize?: number;
    blockSize?: number;
  }) {
    this.db = new Level(path, {
      keyEncoding: 'buffer',
      valueEncoding: 'buffer',
      compression: options?.compression ?? true,
      cacheSize: options?.cacheSize ?? 8 * 1024 * 1024, // 8MB
      writeBufferSize: options?.writeBufferSize ?? 4 * 1024 * 1024, // 4MB
      blockSize: options?.blockSize ?? 4096, // 4KB
    });
  }
  
  async open(): Promise<void> {
    await this.db.open();
  }
  
  async close(): Promise<void> {
    await this.db.close();
  }
  
  async get(key: Buffer): Promise<Buffer | undefined> {
    try {
      return await this.db.get(key);
    } catch (err: any) {
      if (err.code === 'LEVEL_NOT_FOUND') {
        return undefined;
      }
      throw err;
    }
  }
  
  async put(key: Buffer, value: Buffer): Promise<void> {
    await this.db.put(key, value);
  }
  
  async del(key: Buffer): Promise<void> {
    await this.db.del(key);
  }
  
  async batch(ops: BufferBatchOp[]): Promise<void> {
    const batch = this.db.batch();
    
    for (const op of ops) {
      if (op.type === 'put' && op.value) {
        batch.put(op.key, op.value);
      } else if (op.type === 'del') {
        batch.del(op.key);
      }
    }
    
    await batch.write();
  }
  
  async *iterator(options?: BufferRangeOptions): AsyncIterable<[Buffer, Buffer]> {
    const iter = this.db.iterator(options);
    
    try {
      for await (const [key, value] of iter) {
        yield [key, value];
      }
    } finally {
      await iter.close();
    }
  }
}
### 3.3 Entity Storage Manager
typescript
// ============================================================================
// storage/entity-storage.ts - Per-entity storage management
// ============================================================================

import type { EntityId, SignerId } from '../types';
import { LevelDBKV } from './leveldb-kv';
import { MerkleTree } from '../merkle/tree';
import type { BufferKV } from './buffer-kv';

export class EntityStorageManager {
  private entityDBs: Map<string, EntityStorage> = new Map();
  
  constructor(
    private basePath: string,
    private options?: {
      cacheSize?: number;
      merkleConfig?: MerkleConfig;
    }
  ) {}
  
  async getOrCreate(signerId: SignerId, entityId: EntityId): Promise<EntityStorage> {
    const key = ${signerId}:${entityId};
    
    let storage = this.entityDBs.get(key);
    if (!storage) {
      const path = ${this.basePath}/entities/${signerId}/${entityId};
      storage = new EntityStorage(path, this.options);
      await storage.open();
      this.entityDBs.set(key, storage);
    }
    
    return storage;
  }
  
  async closeAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const storage of this.entityDBs.values()) {
      promises.push(storage.close());
    }
    
    await Promise.all(promises);
    this.entityDBs.clear();
  }
}

export class EntityStorage {
  private stateDB: LevelDBKV;
  private blocksDB: LevelDBKV;
  private merkleTree: MerkleTree;
  
  constructor(
    private path: string,
    private options?: {
      cacheSize?: number;
      merkleConfig?: MerkleConfig;
    }
  ) {
    // Separate databases for different data types
    this.stateDB = new LevelDBKV(${path}/state.ldb, {
      cacheSize: options?.cacheSize,
      compression: true
    });
    
    this.blocksDB = new LevelDBKV(${path}/blocks.ldb, {
      cacheSize: (options?.cacheSize ?? 8 * 1024 * 1024) / 4,
      compression: true,
      blockSize: 16384 // Larger blocks for historical data
    });
    
    this.merkleTree = new MerkleTree(options?.merkleConfig ?? {
      bitWidth: 4,
      leafThreshold: 16
    });
  }
  
  async open(): Promise<void> {
    await Promise.all([
      this.stateDB.open(),
      this.blocksDB.open()
    ]);
    
    // Load merkle tree from state
    await this.loadMerkleTree();
  }
  
  async close(): Promise<void> {
    await Promise.all([
      this.stateDB.close(),
      this.blocksDB.close()
    ]);
  }
  
  private async loadMerkleTree(): Promise<void> {
    // Load merkle nodes from state DB
    const merklePrefix = Buffer.from([PATH_TYPES.MERKLE]);
    
    for await (const [key, value] of this.stateDB.iterator({ gte: merklePrefix })) {
      if (key[0] !== PATH_TYPES.MERKLE) break;
      
      // Reconstruct path from key
      const path = Array.from(key.slice(1));
      const nodeData = decode<MerkleNodeData>(value);
      
      this.merkleTree.loadNode(path, nodeData);
    }
  }
  
  getStateDB(): BufferKV {
    return this.stateDB;
  }
  
  getBlocksDB(): BufferKV {
    return this.blocksDB;
  }
  
  getMerkleTree(): MerkleTree {
    return this.merkleTree;
  }
}
## 4. Merkle Tree Design

### 4.1 Merkle Tree Implementation
typescript
// ============================================================================
// merkle/tree.ts - Optimized Merkle tree for XLN
// ============================================================================

import { createHash } from 'crypto';
import type { MerkleNode, MerkleProof, MerkleConfig } from './types';

export class MerkleTree {
  private root: MerkleNode;
  private config: MerkleConfig;
  private dirtyNodes: Set<string> = new Set(); // Path strings of dirty nodes
  
  constructor(config: MerkleConfig) {
    this.config = {
      bitWidth: 4,
      leafThreshold: 16,
      hashAlgorithm: 'sha256',
      ...config
    };
    
    this.root = {
      values: new Map(),
      childrenMask: 0n // BigInt for unlimited children
    };
  }
  
  // Set a value at path
  setNode(path: number[], value: Buffer): void {
    let current = this.root;
    const pathStr = path.join(':');
    
    // Navigate to target node, creating as needed
    for (let i = 0; i < path.length; i++) {
      const chunk = path[i];
      const subPath = path.slice(0, i + 1).join(':');
      
      // Ensure children map exists
      if (!current.children) {
        current.children = new Map();
      }
      
      // Get or create child
      let child = current.children.get(chunk);
      if (!child) {
        child = {
          values: new Map(),
          childrenMask: 0n
        };
        current.children.set(chunk, child);
        current.childrenMask |= (1n << BigInt(chunk));
      }
      
      // Mark as dirty
      this.dirtyNodes.add(subPath);
      current.hash = undefined;
      
      current = child;
    }
    
    // Set the value
    current.values.set(pathStr, value);
    current.hash = undefined;
    this.dirtyNodes.add(pathStr);
    
    // Check if we should split
    this.checkSplit(current, path);
  }
  
  // Get value at path
  getNode(path: number[]): Buffer | undefined {
    let current = this.root;
    const pathStr = path.join(':');
    
    for (const chunk of path) {
      if (!current.children) {
        break;
      }
      
      const child = current.children.get(chunk);
      if (!child) {
        return undefined;
      }
      
      current = child;
    }
    
    return current.values.get(pathStr);
  }
  
  // Delete value at path
  deleteNode(path: number[]): void {
    const ancestors: { node: MerkleNode; chunk?: number }[] = [{ node: this.root }];
    let current = this.root;
    const pathStr = path.join(':');
    
    // Navigate to node
    for (let i = 0; i < path.length; i++) {
      if (!current.children) return;
      
      const chunk = path[i];
      const child = current.children.get(chunk);
      if (!child) return;
      
      ancestors.push({ node: child, chunk });
      current = child;
    }
    
    // Delete value
    current.values.delete(pathStr);
    this.dirtyNodes.add(pathStr);
    current.hash = undefined;
    
    // Clean up empty nodes
    for (let i = ancestors.length - 1; i > 0; i--) {
      const { node, chunk } = ancestors[i];
      
      if (node.values.size === 0 && (!node.children || node.children.size === 0)) {
        const parent = ancestors[i - 1].node;
        if (parent.children && chunk !== undefined) {
          parent.children.delete(chunk);
          parent.childrenMask &= ~(1n << BigInt(chunk));
          
          if (parent.children.size === 0) {
            delete parent.children;
          }
        }
      }
    }
  }
  
  // Check if node should split
  private checkSplit(node: MerkleNode, currentPath: number[]): void {
    if (node.values.size <= this.config.leafThreshold) {
      return;
    }
    
    // Don't split if already has children
    if (node.children && node.children.size > 0) {
      return;
    }
    
    // Split values into children based on next path element
    const depthIndex = currentPath.length;
    node.children = new Map();
    
    for (const [fullPath, value] of node.values) {
      const pathArray = fullPath.split(':').map(Number);
      
      if (pathArray.length > depthIndex) {
        const nextChunk = pathArray[depthIndex];
        
        let child = node.children.get(nextChunk);
        if (!child) {
          child = {
            values: new Map(),
            childrenMask: 0n
          };
          node.children.set(nextChunk, child);
          node.childrenMask |= (1n << BigInt(nextChunk));
        }
        
        child.values.set(fullPath, value);
        this.dirtyNodes.add(pathArray.slice(0, depthIndex + 1).join(':'));
      }
    }
    
    // Clear parent values that were distributed
    node.values.clear();
  }
  
  // Compute root hash
  computeRootHash(): Buffer {
    this.computeHashes();
    return this.root.hash || Buffer.alloc(32);
  }
  
  // Compute all dirty hashes
  private computeHashes(): void {
    // Sort dirty nodes by depth (deepest first)
    const sortedPaths = Array.from(this.dirtyNodes).sort((a, b) => {
      const depthA = a.split(':').length;
      const depthB = b.split(':').length;
      return depthB - depthA;
    });
    
    // Compute hashes bottom-up
    for (const pathStr of sortedPaths) {
      const path = pathStr ? pathStr.split(':').map(Number) : [];
      const node = this.getNodeByPath(path);
      
      if (node && !node.hash) {
        this.computeNodeHash(node);
      }
    }
    
    this.dirtyNodes.clear();
  }
  
  // Get node by path
  private getNodeByPath(path: number[]): MerkleNode | undefined {
    let current = this.root;
    
    for (const chunk of path) {
      if (!current.children) return undefined;
      
      const child = current.children.get(chunk);
      if (!child) return undefined;
      
      current = child;
    }
    
    return current;
  }
  
  // Compute hash for a single node
  private computeNodeHash(node: MerkleNode): Buffer {
    const hasher = createHash(this.config.hashAlgorithm);
    
    // Hash all values
    const sortedValues = Array.from(node.values.entries())
      .sort(([a], [b]) => a.localeCompare(b));
    
    for (const [key, value] of sortedValues) {
      hasher.update(Buffer.from(key));
      hasher.update(Buffer.from([0x00])); // Separator
      hasher.update(value);
    }
    
    // Hash all children
    if (node.children && node.children.size > 0) {
      hasher.update(Buffer.from([0xFF])); // Children marker
      
      // Use childrenMask for deterministic ordering
      const maxChild = Math.max(...Array.from(node.children.keys()));
      
      for (let i = 0; i <= maxChild; i++) {
        if (node.childrenMask & (1n << BigInt(i))) {
          const child = node.children.get(i)!;
          hasher.update(Buffer.from([i]));
          hasher.update(child.hash || this.computeNodeHash(child));
        }
      }
    }
    
    node.hash = hasher.digest();
    return node.hash;
  }
  
  // Generate merkle proof for a path
  generateProof(path: number[]): MerkleProof | null {
    const value = this.getNode(path);
    if (!value) return null;
    
    // Ensure all hashes are computed
    this.computeHashes();
    
    const siblings: MerkleProof['siblings'] = [];
    let current = this.root;
    
    // Collect sibling hashes along the path
    for (let i = 0; i < path.length; i++) {
      const chunk = path[i];
      
      if (current.children) {
        // Collect all sibling hashes at this level
        const levelSiblings: Array<{ position: number; hash: Buffer }> = [];
        
        for (const [sibChunk, sibNode] of current.children) {
          if (sibChunk !== chunk) {
            levelSiblings.push({
              position: sibChunk,
              hash: sibNode.hash || this.computeNodeHash(sibNode)
            });
          }
        }
        
        if (levelSiblings.length > 0) {
          siblings.push({
            level: i,
            siblings: levelSiblings
          });
        }
        
        current = current.children.get(chunk)!;
      }
    }
    
    // Include all values in the leaf node
    const leafValues = Array.from(current.values.entries());
    
    return {
      value,
      path: path.join(':'),
      siblings,
      rootHash: this.root.hash!,
      leafValues
    };
  }
  
  // Verify a merkle proof
  verifyProof(proof: MerkleProof): boolean {
    // Reconstruct the hash bottom-up
    let currentHash: Buffer;
    
    // Start with leaf node hash
    const leafHasher = createHash(this.config.hashAlgorithm);
    
    for (const [key, value] of proof.leafValues.sort(([a], [b]) => a.localeCompare(b))) {
      leafHasher.update(Buffer.from(key));
      leafHasher.update(Buffer.from([0x00]));
      leafHasher.update(value);
    }
    
    currentHash = leafHasher.digest();
    
    // Work up through the tree
    const pathArray = proof.path.split(':').map(Number);
    
    for (let level = pathArray.length - 1; level >= 0; level--) {
      const chunk = pathArray[level];
      const levelSiblings = proof.siblings.find(s => s.level === level);
      
      if (levelSiblings || level === 0) {
        const hasher = createHash(this.config.hashAlgorithm);
        hasher.update(Buffer.from([0xFF])); // Children marker
        
        // Combine with siblings
        const allNodes = [
          { position: chunk, hash: currentHash },
          ...(levelSiblings?.siblings || [])
        ].sort((a, b) => a.position - b.position);
        
        for (const node of allNodes) {
          hasher.update(Buffer.from([node.position]));
          hasher.update(node.hash);
        }
        
        currentHash = hasher.digest();
      }
    }
    
    return currentHash.equals(proof.rootHash);
  }
  
  // Save node for persistence
  saveNode(path: number[]): MerkleNodeData {
    const node = this.getNodeByPath(path);
    if (!node) throw new Error(Node not found at path: ${path.join(':')});
    
    return {
      values: Array.from(node.values.entries()),
      childrenMask: node.childrenMask.toString(),
      hash: node.hash
    };
  }
  
  // Load node from persistence
  loadNode(path: number[], data: MerkleNodeData): void {
    const node = this.ensureNodePath(path);
    
    node.values = new Map(data.values);
    node.childrenMask = BigInt(data.childrenMask);
    node.hash = data.hash;
    
    // Don't mark as dirty when loading
  }
  
  // Ensure node exists at path
  private ensureNodePath(path: number[]): MerkleNode {
    let current = this.root;
    
    for (const chunk of path) {
      if (!current.children) {
        current.children = new Map();
      }
      
      let child = current.children.get(chunk);
      if (!child) {
        child = {
          values: new Map(),
          childrenMask: 0n
        };
        current.children.set(chunk, child);
        current.childrenMask |= (1n << BigInt(chunk));
      }
      
      current = child;
    }
    
    return current;
  }
}
### 4.2 Merkle Types
typescript
// ============================================================================
// merkle/types.ts - Merkle tree type definitions
// ============================================================================

export interface MerkleConfig {
  bitWidth: number;          // Bits per tree level (1-8)
  leafThreshold: number;     // Max values before split
  hashAlgorithm: string;     // Hash algorithm to use
}

export interface MerkleNode {
  values: Map<string, Buffer>;       // Full path -> value
  children?: Map<number, MerkleNode>; // Chunk -> child node
  childrenMask: bigint;              // Bitmap of which children exist
  hash?: Buffer;                     // Cached hash of this node
}

export interface MerkleProof {
  value: Buffer;                     // The value being proved
  path: string;                      // Path to the value
  siblings: Array<{                  // Sibling hashes at each level
    level: number;
    siblings: Array<{
      position: number;
      hash: Buffer;
    }>;
  }>;
  rootHash: Buffer;                  // Expected root hash
  leafValues: Array<[string, Buffer]>; // All values in the leaf
}

export interface MerkleNodeData {
  values: Array<[string, Buffer]>;
  childrenMask: string;  // BigInt as string
  hash?: Buffer;
}
## 5. Snapshot System

### 5.1 Snapshot Manager
typescript
// ============================================================================
// storage/snapshots.ts - Dual snapshot system
// ============================================================================

import type { ServerState } from '../types';
import { encode, decode } from '../encoding';
import { createHash } from 'crypto';

export class SnapshotManager {
  constructor(
    private serverDB: BufferKV,
    private archiveDB: BufferKV,
    private entityManager: EntityStorageManager
  ) {}
  
  // Save mutable snapshot (overwrites previous)
  async saveMutableSnapshot(state: ServerState): Promise<void> {
    const batch: BufferBatchOp[] = [];
    
    // Save server metadata
    batch.push({
      type: 'put',
      key: KeyEncoder.serverState(),
      value: encode({
        height: state.height,
        timestamp: Date.now()
      })
    });
    
    // Save registry
    batch.push({
      type: 'put',
      key: KeyEncoder.serverRegistry(),
      value: encode(Array.from(state.registry.entries()))
    });
    
    // Save signer roots
    for (const [signerId, entities] of state.signers) {
      const entityRoots: Record<string, string> = {};
      
      for (const [entityId, entity] of entities) {
        // Get entity storage
        const storage = await this.entityManager.getOrCreate(signerId, entityId);
        const merkleTree = storage.getMerkleTree();
        
        // Save entity state in its own DB
        await this.saveEntityState(storage, entity);
        
        // Record merkle root
        entityRoots[entityId] = merkleTree.computeRootHash().toString('hex');
      }
      
      batch.push({
        type: 'put',
        key: KeyEncoder.signerState(signerId),
        value: encode(entityRoots)
      });
    }
    
    await this.serverDB.batch(batch);
  }
  
  // Save immutable snapshot (permanent archive)
  async saveImmutableSnapshot(state: ServerState): Promise<string> {
    const snapshot: ImmutableSnapshot = {
      height: state.height,
      timestamp: Date.now(),
      registry: Array.from(state.registry.entries()),
      entities: {}
    };
    
    // Collect all entity states and merkle roots
    for (const [signerId, entities] of state.signers) {
      snapshot.entities[signerId] = {};
      
      for (const [entityId, entity] of entities) {
        const storage = await this.entityManager.getOrCreate(signerId, entityId);
        const merkleTree = storage.getMerkleTree();
        
        snapshot.entities[signerId][entityId] = {
          state: entity,
          merkleRoot: merkleTree.computeRootHash().toString('hex'),
          merkleProof: merkleTree.generateProof([]) // Root proof
        };
      }
    }
    
    // Compute snapshot hash
    const hash = createHash('sha256')
      .update(encode(snapshot))
      .digest();
    
    // Save to archive
    await this.archiveDB.put(
      Buffer.concat([Buffer.from([0x00]), hash]), // 0x00 prefix for snapshots
      encode(snapshot)
    );
    
    return hash.toString('hex');
  }
  
  // Load latest mutable snapshot
  async loadMutableSnapshot(): Promise<ServerState | null> {
    try {
      // Load server metadata
      const metaData = await this.serverDB.get(KeyEncoder.serverState());
      if (!metaData) return null;
      
      const meta = decode<{ height: number; timestamp: number }>(metaData);
      
      // Load registry
      const registryData = await this.serverDB.get(KeyEncoder.serverRegistry());
      const registry = new Map(decode<Array<[string, any]>>(registryData));
      
      // Load signer states
      const signers = new Map();
      
      // Iterate through all signers
      const signerPrefix = Buffer.concat([
        Buffer.from([PATH_TYPES.SIGNER, PATH_TYPES.STATE])
      ]);
      
      for await (const [key, value] of this.serverDB.iterator({ gte: signerPrefix })) {
        if (key[0] !== PATH_TYPES.SIGNER || key[1] !== PATH_TYPES.STATE) break;
        
        // Extract signer ID from key
        const signerId = key.slice(2, 34).toString().replace(/\0+$/, '');
        const entityRoots = decode<Record<string, string>>(value);
        
        const entities = new Map();
        
        // Load each entity
        for (const [entityId, rootHash] of Object.entries(entityRoots)) {
          const storage = await this.entityManager.getOrCreate(signerId, entityId);
          const entity = await this.loadEntityState(storage);
          
          if (entity) {
            entities.set(entityId, entity);
          }
        }
        
        signers.set(signerId, entities);
      }
      
      return {
        height: meta.height,
        registry,
        signers,
        mempool: []
      };
    } catch (err) {
      return null;
    }
  }
  
  // Load immutable snapshot by hash
  async loadImmutableSnapshot(hash: string): Promise<ServerState | null> {
    try {
      const data = await this.archiveDB.get(
        Buffer.concat([Buffer.from([0x00]), Buffer.from(hash, 'hex')])
      );
      
      if (!data) return null;
      
      const snapshot = decode<ImmutableSnapshot>(data);
      
      // Reconstruct server state
      const registry = new Map(snapshot.registry);
      const signers = new Map();
      
      for (const [signerId, entities] of Object.entries(snapshot.entities)) {
        const entityMap = new Map();
        
        for (const [entityId, data] of Object.entries(entities)) {
          entityMap.set(entityId, data.state);
        }
        
        signers.set(signerId, entityMap);
      }
      
      return {
        height: snapshot.height,
        registry,
        signers,
        mempool: []
      };
    } catch (err) {
      return null;
    }
  }
  
  // Helper to save entity state
  private async saveEntityState(storage: EntityStorage, entity: any): Promise<void> {
    const stateDB = storage.getStateDB();
    const merkleTree = storage.getMerkleTree();
    const batch: BufferBatchOp[] = [];
    
    // Save entity data with merkle updates
    const entityKey = Buffer.from([PATH_TYPES.STATE]);
    const entityValue = encode(entity);
    
    batch.push({
      type: 'put',
      key: entityKey,
      value: entityValue
    });
    
    // Update merkle tree
    merkleTree.setNode([PATH_TYPES.STATE], entityValue);
    
    // Save merkle nodes
    await this.saveMerkleNodes(storage, merkleTree);
    
    await stateDB.batch(batch);
  }
  
  // Helper to load entity state
  private async loadEntityState(storage: EntityStorage): Promise<any | null> {
    const stateDB = storage.getStateDB();
    
    try {
      const data = await stateDB.get(Buffer.from([PATH_TYPES.STATE]));
      return data ? decode(data) : null;
    } catch (err) {
      return null;
    }
  }
  
  // Save merkle nodes to storage
  private async saveMerkleNodes(storage: EntityStorage, tree: MerkleTree): Promise<void> {
    const batch: BufferBatchOp[] = [];
    
    // This is a simplified version - in production you'd walk the tree
    // and save all dirty nodes
    const rootData = tree.saveNode([]);
    
    batch.push({
      type: 'put',
      key: MerkleKeyEncoder.merkleNode([]),
      value: encode(rootData)
    });
    
    await storage.getStateDB().batch(batch);
  }
}

interface ImmutableSnapshot {
  height: number;
  timestamp: number;
  registry: Array<[string, any]>;
  entities: Record<string, Record<string, {
    state: any;
    merkleRoot: string;
    merkleProof: MerkleProof | null;
  }>>;
}
## 6. Implementation Details

### 6.1 Complete Storage Implementation
typescript
// ============================================================================
// storage/xln-storage.ts - Main storage implementation
// ============================================================================

import type { Storage, ServerState, ServerTx, BlockHeight } from '../types';
import { LevelDBKV } from './leveldb-kv';
import { EntityStorageManager } from './entity-storage';
import { SnapshotManager } from './snapshots';
import { KeyEncoder } from './keys';
import { encode, decode } from '../encoding';

export class XLNStorage implements Storage {
  private serverStateDB: LevelDBKV;
  private serverWalDB: LevelDBKV;
  private serverBlocksDB: LevelDBKV;
  private archiveDB: LevelDBKV;
  private entityManager: EntityStorageManager;
  private snapshotManager: SnapshotManager;
  
  constructor(basePath: string, options?: XLNStorageOptions) {
    // Server-level databases
    this.serverStateDB = new LevelDBKV(${basePath}/server/state.ldb, {
      cacheSize: options?.serverCacheSize ?? 16 * 1024 * 1024,
      compression: true
    });
    
    this.serverWalDB = new LevelDBKV(${basePath}/server/wal.ldb, {
      cacheSize: options?.walCacheSize ?? 8 * 1024 * 1024,
      compression: true,
      writeBufferSize: 8 * 1024 * 1024 // Larger write buffer for WAL
    });
    
    this.serverBlocksDB = new LevelDBKV(${basePath}/server/blocks.ldb, {
      cacheSize: options?.blockCacheSize ?? 4 * 1024 * 1024,
      compression: true,
      blockSize: 16384 // Larger blocks for historical data
    });
    
    this.archiveDB = new LevelDBKV(${basePath}/archive/snapshots.ldb, {
      cacheSize: options?.archiveCacheSize ?? 4 * 1024 * 1024,
      compression: true
    });
    
    // Entity manager
    this.entityManager = new EntityStorageManager(basePath, {
      cacheSize: options?.entityCacheSize ?? 8 * 1024 * 1024,
      merkleConfig: options?.merkleConfig
    });
    
    // Snapshot manager
    this.snapshotManager = new SnapshotManager(
      this.serverStateDB,
      this.archiveDB,
      this.entityManager
    );
  }
  
  async open(): Promise<void> {
    await Promise.all([
      this.serverStateDB.open(),
      this.serverWalDB.open(),
      this.serverBlocksDB.open(),
      this.archiveDB.open()
    ]);
  }
  
  async close(): Promise<void> {
    await Promise.all([
      this.serverStateDB.close(),
      this.serverWalDB.close(),
      this.serverBlocksDB.close(),
      this.archiveDB.close(),
      this.entityManager.closeAll()
    ]);
  }
  
  // State operations
  state = {
    save: async (state: ServerState): Promise<void> => {
      await this.snapshotManager.saveMutableSnapshot(state);
    },
    
    load: async (): Promise<ServerState | null> => {
      return this.snapshotManager.loadMutableSnapshot();
    }
  };
  
  // WAL operations
  wal = {
    append: async (height: BlockHeight, txs: ServerTx[]): Promise<void> => {
      const batch: BufferBatchOp[] = [];
      
      for (let i = 0; i < txs.length; i++) {
        const key = Buffer.concat([
          KeyEncoder.walEntry(height, txs[i].signer, txs[i].entityId),
          Buffer.from([i]) // Transaction index within block
        ]);
        
        batch.push({
          type: 'put',
          key,
          value: encode(txs[i])
        });
      }
      
      await this.serverWalDB.batch(batch);
    },
    
    getFromHeight: async (height: BlockHeight): Promise<ServerTx[]> => {
      const txs: ServerTx[] = [];
      
      // Create range for WAL entries from height onwards
      const startKey = Buffer.concat([
        Buffer.from([PATH_TYPES.WAL]),
        KeyEncoder.encodeHeight(height)
      ]);
      
      for await (const [key, value] of this.serverWalDB.iterator({ gte: startKey })) {
        if (key[0] !== PATH_TYPES.WAL) break;
        
        const tx = decode<ServerTx>(value);
        txs.push(tx);
      }
      
      return txs;
    },
    
    truncateBefore: async (height: BlockHeight): Promise<void> => {
      const batch: BufferBatchOp[] = [];
      
      const endKey = Buffer.concat([
        Buffer.from([PATH_TYPES.WAL]),
        KeyEncoder.encodeHeight(height)
      ]);
      
      for await (const [key] of this.serverWalDB.iterator({ lt: endKey })) {
        if (key[0] !== PATH_TYPES.WAL) continue;
        batch.push({ type: 'del', key });
      }
      
      await this.serverWalDB.batch(batch);
    }
  };
  
  // Block operations
  blocks = {
    save: async (height: BlockHeight, data: any): Promise<void> => {
      await this.serverBlocksDB.put(
        KeyEncoder.serverBlock(height),
        encode(data)
      );
    },
    
    get: async (height: BlockHeight): Promise<any> => {
      const data = await this.serverBlocksDB.get(KeyEncoder.serverBlock(height));
      return data ? decode(data) : null;
    }
  };
  
  // Archive operations
  archive = {
    save: async (hash: string, snapshot: any): Promise<void> => {
      await this.archiveDB.put(
        Buffer.concat([Buffer.from([0x01]), Buffer.from(hash, 'hex')]),
        encode(snapshot)
      );
    },
    
    get: async (hash: string): Promise<any> => {
      const data = await this.archiveDB.get(
        Buffer.concat([Buffer.from([0x01]), Buffer.from(hash, 'hex')])
      );
      return data ? decode(data) : null;
    }
  };
  
  // Direct KV access for references
  refs = {
    get: async (key: string): Promise<string | undefined> => {
      const data = await this.serverStateDB.get(
        Buffer.concat([Buffer.from([0xFF]), Buffer.from(key)])
      );
      return data ? data.toString('utf8') : undefined;
    },
    
    put: async (key: string, value: string): Promise<void> => {
      await this.serverStateDB.put(
        Buffer.concat([Buffer.from([0xFF]), Buffer.from(key)]),
        Buffer.from(value)
      );
    },
    
    del: async (key: string): Promise<void> => {
      await this.serverStateDB.del(
        Buffer.concat([Buffer.from([0xFF]), Buffer.from(key)])
      );
    },
    
    batch: async (ops: any[]): Promise<void> => {
      const bufferOps = ops.map(op => ({
        type: op.type,
        key: Buffer.concat([Buffer.from([0xFF]), Buffer.from(op.key)]),
        value: op.value ? Buffer.from(op.value) : undefined
      }));
      await this.serverStateDB.batch(bufferOps);
    },
    
    iterator: async function* (options?: any) {
      const prefix = Buffer.from([0xFF]);
      
      for await (const [key, value] of this.serverStateDB.iterator({
        gte: prefix,
        lt: Buffer.from([0xFF + 1])
      })) {
        yield [key.slice(1).toString(), value.toString()];
      }
    }
  };
  
  // Create immutable snapshot
  async createSnapshot(): Promise<string> {
    const state = await this.state.load();
    if (!state) throw new Error('No state to snapshot');
    
    return this.snapshotManager.saveImmutableSnapshot(state);
  }
  
  // Entity-specific operations
  async getEntityStorage(signerId: string, entityId: string): Promise<EntityStorage> {
    return this.entityManager.getOrCreate(signerId, entityId);
  }
}

export interface XLNStorageOptions {
  serverCacheSize?: number;
  walCacheSize?: number;
  blockCacheSize?: number;
  archiveCacheSize?: number;
  entityCacheSize?: number;
  merkleConfig?: MerkleConfig;
}
### 6.2 Encoding/Decoding
typescript
// ============================================================================
// encoding/index.ts - RLP encoding with BigInt support
// ============================================================================

import * as RLP from '@ethereumjs/rlp';

export function encode(data: any): Buffer {
  return Buffer.from(RLP.encode(
    JSON.stringify(data, (key, value) => {
      // Handle BigInt
      if (typeof value === 'bigint') {
        return { _type: 'bigint', value: value.toString() };
      }
      // Handle Buffer
      if (Buffer.isBuffer(value)) {
        return { _type: 'buffer', value: value.toString('hex') };
      }
      // Handle Map
      if (value instanceof Map) {
        return { _type: 'map', value: Array.from(value.entries()) };
      }
      // Handle Set
      if (value instanceof Set) {
        return { _type: 'set', value: Array.from(value) };
      }
      return value;
    })
  ));
}

export function decode<T>(buffer: Buffer): T {
  const decoded = RLP.decode(buffer);
  const json = Buffer.from(decoded as Uint8Array).toString('utf8');
  
  return JSON.parse(json, (key, value) => {
    if (value && typeof value === 'object') {
      // Handle BigInt
      if (value._type === 'bigint') {
        return BigInt(value.value);
      }
      // Handle Buffer
      if (value._type === 'buffer') {
        return Buffer.from(value.value, 'hex');
      }
      // Handle Map
      if (value._type === 'map') {
        return new Map(value.value);
      }
      // Handle Set
      if (value._type === 'set') {
        return new Set(value.value);
      }
    }
    return value;
  });
}
## 7. Performance Optimizations

### 7.1 Caching Strategy
typescript
// ============================================================================
// storage/cache.ts - Multi-layer caching
// ============================================================================

import LRU from 'lru-cache';

export class CachedStorage {
  private entityCache: LRU<string, any>;
  private blockCache: LRU<string, any>;
  private merkleCache: LRU<string, Buffer>;
  
  constructor(
    private storage: XLNStorage,
    options?: {
      entityCacheSize?: number;
      blockCacheSize?: number;
      merkleCacheSize?: number;
    }
  ) {
    this.entityCache = new LRU({
      max: options?.entityCacheSize ?? 100,
      ttl: 1000 * 60 * 5 // 5 minutes
    });
    
    this.blockCache = new LRU({
      max: options?.blockCacheSize ?? 1000,
      ttl: 1000 * 60 * 60 // 1 hour
    });
    
    this.merkleCache = new LRU({
      max: options?.merkleCacheSize ?? 10000,
      sizeCalculation: (value) => value.length
    });
  }
  
  // Wrap storage methods with caching
  async getEntity(signerId: string, entityId: string): Promise<any> {
    const key = ${signerId}:${entityId};
    
    // Check cache
    const cached = this.entityCache.get(key);
    if (cached) return cached;
    
    // Load from storage
    const storage = await this.storage.getEntityStorage(signerId, entityId);
    const data = await storage.getStateDB().get(Buffer.from([PATH_TYPES.STATE]));
    
    if (data) {
      const entity = decode(data);
      this.entityCache.set(key, entity);
      return entity;
    }
    
    return null;
  }
  
  // Batch operations for efficiency
  async batchGetEntities(requests: Array<{ signerId: string; entityId: string }>): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    const uncached: typeof requests = [];
    
    // Check cache first
    for (const req of requests) {
      const key = ${req.signerId}:${req.entityId};
      const cached = this.entityCache.get(key);
      
      if (cached) {
        results.set(key, cached);
      } else {
        uncached.push(req);
      }
    }
    
    // Batch load uncached
    if (uncached.length > 0) {
      // Group by signer for efficient loading
      const bySigner = new Map<string, string[]>();
      
      for (const req of uncached) {
        if (!bySigner.has(req.signerId)) {
          bySigner.set(req.signerId, []);
        }
        bySigner.get(req.signerId)!.push(req.entityId);
      }
      
      // Load in parallel
      const promises: Promise<void>[] = [];
      
      for (const [signerId, entityIds] of bySigner) {
        promises.push(this.loadSignerEntities(signerId, entityIds, results));
      }
      
      await Promise.all(promises);
    }
    
    return results;
  }
  
  private async loadSignerEntities(
    signerId: string,
    entityIds: string[],
    results: Map<string, any>
  ): Promise<void> {
    // This could be optimized further with range queries
    const promises = entityIds.map(async (entityId) => {
      const entity = await this.getEntity(signerId, entityId);
      if (entity) {
        results.set(${signerId}:${entityId}, entity);
      }
    });
    
    await Promise.all(promises);
  }
}
### 7.2 Parallel Operations
typescript
// ============================================================================
// storage/parallel.ts - Parallel processing utilities
// ============================================================================

export class ParallelProcessor {
  constructor(private concurrency: number = 10) {}
  
  // Process entities in parallel with limited concurrency
  async processEntities<T>(
    entities: Array<{ signerId: string; entityId: string }>,
    processor: (signerId: string, entityId: string) => Promise<T>
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const queue = [...entities];
    const inFlight = new Set<Promise<void>>();
    
    while (queue.length > 0 || inFlight.size > 0) {
      // Start new tasks up to concurrency limit
      while (queue.length > 0 && inFlight.size < this.concurrency) {
        const item = queue.shift()!;
        
        const task = processor(item.signerId, item.entityId)
          .then(result => {
            results.set(${item.signerId}:${item.entityId}, result);
          })
          .finally(() => {
            inFlight.delete(task);
          });
        
        inFlight.add(task);
      }
      
      // Wait for at least one to complete
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }
    
    return results;
  }
}
## 8. Migration Path

### 8.1 Migration from Current Implementation
typescript
// ============================================================================
// migration/migrate.ts - Migration utilities
// ============================================================================

export class StorageMigration {
  constructor(
    private oldStorage: Storage, // Your current storage
    private newStorage: XLNStorage
  ) {}
  
  async migrate(options?: {
    batchSize?: number;
    checkpoint?: (progress: number) => void;
  }): Promise<void> {
    const batchSize = options?.batchSize ?? 1000;
    
    // Step 1: Load current state
    const state = await this.oldStorage.state.load();
    if (!state) throw new Error('No state to migrate');
    
    // Step 2: Migrate registry
    await this.migrateRegistry(state);
    
    // Step 3: Migrate entities in batches
    let processed = 0;
    const total = Array.from(state.signers.values())
      .reduce((sum, entities) => sum + entities.size, 0);
    
    for (const [signerId, entities] of state.signers) {
      const entityBatch: Array<[string, any]> = [];
      
      for (const [entityId, entity] of entities) {
        entityBatch.push([entityId, entity]);
        
        if (entityBatch.length >= batchSize) {
          await this.migrateEntityBatch(signerId, entityBatch);
          processed += entityBatch.length;
          options?.checkpoint?.(processed / total);
          entityBatch.length = 0;
        }
      }
      
      // Process remaining
      if (entityBatch.length > 0) {
        await this.migrateEntityBatch(signerId, entityBatch);
        processed += entityBatch.length;
        options?.checkpoint?.(processed / total);
      }
    }
    
    // Step 4: Migrate WAL
    await this.migrateWAL(state.height);
    
    // Step 5: Create initial snapshot
    await this.newStorage.createSnapshot();
  }
  
  private async migrateRegistry(state: ServerState): Promise<void> {
    // Registry is migrated as part of state save
    await this.newStorage.state.save(state);
  }
  
  private async migrateEntityBatch(
    signerId: string,
    batch: Array<[string, any]>
  ): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [entityId, entity] of batch) {
      promises.push(this.migrateEntity(signerId, entityId, entity));
    }
    
    await Promise.all(promises);
  }
  
  private async migrateEntity(
    signerId: string,
    entityId: string,
    entity: any
  ): Promise<void> {
    const storage = await this.newStorage.getEntityStorage(signerId, entityId);
    const stateDB = storage.getStateDB();
    const merkleTree = storage.getMerkleTree();
    
    // Save entity state
    const encoded = encode(entity);
    await stateDB.put(Buffer.from([PATH_TYPES.STATE]), encoded);
    
    // Initialize merkle tree
    merkleTree.setNode([PATH_TYPES.STATE], encoded);
    
    // Save merkle root
    const rootData = merkleTree.saveNode([]);
    await stateDB.put(
      MerkleKeyEncoder.merkleNode([]),
      encode(rootData)
    );
  }
  
  private async migrateWAL(currentHeight: number): Promise<void> {
    // Migrate WAL entries
    const walTxs = await this.oldStorage.wal.getFromHeight(0);
    
    // Group by height
    const byHeight = new Map<number, ServerTx[]>();
    
    for (const tx of walTxs) {
      // Extract height from transaction or use current
      const height = currentHeight; // Adjust based on your WAL structure
      
      if (!byHeight.has(height)) {
        byHeight.set(height, []);
      }
      byHeight.get(height)!.push(tx);
    }
    
    // Write to new WAL
    for (const [height, txs] of byHeight) {
      await this.newStorage.wal.append(height, txs);
    }
  }
}
### 8.2 Usage Example
typescript
// ============================================================================
// Example: Using the new storage system
// ============================================================================

import { XLNStorage } from './storage/xln-storage';
import { StorageMigration } from './migration/migrate';

async function example() {
  // Create new storage
  const storage = new XLNStorage('./data', {
    serverCacheSize: 32 * 1024 * 1024, // 32MB for server
    entityCacheSize: 16 * 1024 * 1024, // 16MB per entity
    merkleConfig: {
      bitWidth: 4,
      leafThreshold: 16,
      hashAlgorithm: 'sha256'
    }
  });
  
  // Open storage
  await storage.open();
  
  try {
    // Load state
    const state = await storage.state.load();
    
    if (!state) {
      // First run - migrate from old storage
      const migration = new StorageMigration(oldStorage, storage);
      
      await migration.migrate({
        batchSize: 500,
        checkpoint: (progress) => {
          console.log(Migration progress: ${(progress * 100).toFixed(2)}%);
        }
      });
    }
    
    // Use storage normally
    // ...
    
    // Create periodic snapshots
    setInterval(async () => {
      const hash = await storage.createSnapshot();
      console.log(Created snapshot: ${hash});
    }, 1000 * 60 * 60); // Every hour
    
  } finally {
    await storage.close();
  }
}
## Summary

This comprehensive specification provides:

1. **Hierarchical Key Encoding**: Binary keys that encode the full path for efficient range queries
2. **Entity Isolation**: Separate LevelDB instances per entity for independent operations
3. **Merkle Tree Integration**: Every value update maintains cryptographic proofs
4. **Dual Snapshot System**: Mutable (fast restart) and immutable (permanent archive)
5. **Performance Optimizations**: Caching, parallel processing, and batch operations
6. **Migration Path**: Smooth transition from your current implementation

The design maintains compatibility with your existing API while adding the performance and scalability features required for XLN's vision of millions of entities and channels.