Okay, let's get this core infrastructure built. I'll implement the LevelDB storage, RLP encoding, and Merkle tree as specified, then integrate them into the existing system.

### 1. Dependency Updates

I'll start by updating `package.json` to include the new dependencies.

```json
{
  "name": "v3",
  "module": "index.ts",
  "type": "module",
  "private": true,
  "devDependencies": {
    "@types/bun": "latest",
    "bun-types": "^1.2.16",
    "fast-check": "^4.1.1"
  },
  "peerDependencies": {
    "typescript": "^5"
  },
  "dependencies": {
    "@ethereumjs/rlp": "^5.0.1",
    "level": "^8.0.1"
  }
}
```

### 2. RLP Encoding Implementation

Here is the new `src/utils/encoding.ts` file. It provides comprehensive, deterministic RLP encoding and decoding for all of the project's data structures.

```typescript
import { RLP } from '@ethereumjs/rlp';
import type { Decoded } from '@ethereumjs/rlp';
import { hash, height, id, signer } from '../types/primitives.js';
import type {
  BlockHash,
  BlockHeight,
  EntityId,
  SignerIdx,
} from '../types/primitives.js';
import type {
  BlockData,
  EntityCommand,
  EntityMeta,
  EntityState,
  EntityTx,
  OutboxMsg,
  ProposedBlock,
  ServerState,
  ServerTx,
  SignerEntities,
} from '../types/state.js';

// ============================================================================
// Helper Functions
// ============================================================================

const encodeString = (s: string | undefined | null): Buffer | null =>
  s ? Buffer.from(s, 'utf8') : null;
const decodeString = (b: Decoded): string =>
  b && Buffer.isBuffer(b) ? b.toString('utf8') : '';

const encodeBigInt = (n: bigint | undefined | null): Buffer | null =>
  n !== undefined && n !== null ? RLP.encode(n) : null;
const decodeBigInt = (b: Decoded): bigint =>
  b && Buffer.isBuffer(b) && b.length > 0 ? (RLP.decode(b as Uint8Array) as bigint) : 0n;

const encodeNumber = (n: number | undefined | null): Buffer | null =>
  n !== undefined && n !== null ? RLP.encode(n) : null;
const decodeNumber = (b: Decoded): number =>
  b && Buffer.isBuffer(b) && b.length > 0 ? Number(RLP.decode(b as Uint8Array)) : 0;

const encodeNullable = <T>(
  val: T | undefined | null,
  encoder: (v: T) => any,
): any => (val === undefined || val === null ? null : encoder(val));

const encodeMap = <K, V>(
  map: ReadonlyMap<K, V>,
  entryEncoder: (k: K, v: V) => any[],
): any[] => {
  const entries = Array.from(map.entries()).map(([k, v]) => entryEncoder(k, v));
  entries.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  return entries;
};

const decodeMap = <K, V>(
  arr: Decoded[],
  entryDecoder: (item: Decoded) => [K, V],
): Map<K, V> => new Map(arr.map(entryDecoder));

const encodeSet = <T>(
  set: ReadonlySet<T>,
  itemEncoder: (item: T) => any,
): any[] => {
  const items = Array.from(set).map(itemEncoder);
  items.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return items;
};

const decodeSet = <T>(arr: Decoded[], itemDecoder: (item: Decoded) => T): Set<T> =>
  new Set(arr.map(itemDecoder));

// ============================================================================
// RLP Encoders / Decoders
// ============================================================================

export const encode = {
  merkleKey: (signerId: SignerIdx, entityId: EntityId): Buffer =>
    Buffer.from(`${signerId}:${entityId}`),

  entityTx: (tx: EntityTx): (Buffer | null)[] => [
    encodeString(tx.op),
    Buffer.from(JSON.stringify(tx.data)), // JSON for arbitrary data
    encodeNullable(tx.nonce, encodeNumber),
  ],

  proposedBlock: (block: ProposedBlock): (Buffer | any[] | null)[] => [
    block.txs.map(encode.entityTx),
    encodeString(block.hash),
    encodeNumber(block.height),
    encodeNumber(block.proposer),
    encodeSet(block.approvals, encodeNumber),
    encodeNumber(block.timestamp),
  ],

  entityState: (entity: EntityState): (Buffer | any[] | null)[] => [
    encodeString(entity.id),
    encodeNumber(entity.height),
    encodeString(entity.stage),
    Buffer.from(JSON.stringify(entity.data)), // JSON for arbitrary data
    entity.mempool.map(encode.entityTx),
    encodeNullable(entity.proposal, encode.proposedBlock),
    encodeNullable(entity.lastBlockHash, encodeString),
    encodeNullable(entity.faultReason, encodeString),
  ],

  entityMeta: (meta: EntityMeta): (Buffer | any[] | null)[] => [
    encodeString(meta.id),
    meta.quorum.map(encodeNumber),
    encodeNumber(meta.timeoutMs),
    encodeString(meta.protocol),
  ],

  entityCommand: (cmd: EntityCommand): (Buffer | any[] | null)[] => {
    switch (cmd.type) {
      case 'addTx':
        return [encodeNumber(0), encode.entityTx(cmd.tx)];
      case 'proposeBlock':
        return [encodeNumber(1)];
      case 'shareProposal':
        return [encodeNumber(2), encode.proposedBlock(cmd.proposal)];
      case 'approveBlock':
        return [
          encodeNumber(3),
          encodeString(cmd.hash),
          encodeNullable(cmd.from, encodeNumber),
        ];
      case 'commitBlock':
        return [encodeNumber(4), encodeString(cmd.hash)];
    }
  },

  serverTx: (tx: ServerTx): (Buffer | any[] | null)[] => [
    encodeNumber(tx.signer),
    encodeString(tx.entityId),
    encode.entityCommand(tx.command),
  ],

  registry: (reg: ReadonlyMap<EntityId, EntityMeta>): any[] =>
    encodeMap(reg, (k, v) => [encodeString(k), encode.entityMeta(v)]),

  signers: (
    signersMap: ReadonlyMap<SignerIdx, SignerEntities>,
  ): any[] =>
    encodeMap(signersMap, (signerId, entities) => [
      encodeNumber(signerId),
      encodeMap(entities, (entityId, entity) => [
        encodeString(entityId),
        encode.entityState(entity),
      ]),
    ]),

  serverState: (state: ServerState): Buffer =>
    RLP.encode([
      encodeNumber(state.height),
      encode.signers(state.signers),
      encode.registry(state.registry),
      state.mempool.map(encode.serverTx),
    ]),

  blockData: (block: Omit<BlockData, 'encodedData'>): Buffer =>
    RLP.encode([
      encodeNumber(block.height),
      encodeNumber(block.timestamp),
      block.transactions.map(encode.serverTx),
      encodeString(block.stateHash),
      encodeNullable(block.parentHash, encodeString),
    ]),
};

export const decode = {
  entityTx: (arr: Decoded[]): EntityTx => ({
    op: decodeString(arr[0]),
    data: JSON.parse(decodeString(arr[1])),
    nonce: arr[2] ? decodeNumber(arr[2]) : undefined,
  }),

  proposedBlock: (arr: Decoded[]): ProposedBlock => ({
    txs: (arr[0] as Decoded[]).map(item => decode.entityTx(item as Decoded[])),
    hash: hash(decodeString(arr[1])),
    height: height(decodeNumber(arr[2])),
    proposer: signer(decodeNumber(arr[3])),
    approvals: decodeSet(arr[4] as Decoded[], item => signer(decodeNumber(item))),
    timestamp: decodeNumber(arr[5]),
  }),

  entityState: (arr: Decoded[]): EntityState => ({
    id: id(decodeString(arr[0])),
    height: height(decodeNumber(arr[1])),
    stage: decodeString(arr[2]) as EntityState['stage'],
    data: JSON.parse(decodeString(arr[3])),
    mempool: (arr[4] as Decoded[]).map(item => decode.entityTx(item as Decoded[])),
    proposal: arr[5] ? decode.proposedBlock(arr[5] as Decoded[]) : undefined,
    lastBlockHash: arr[6] ? hash(decodeString(arr[6])) : undefined,
    faultReason: arr[7] ? decodeString(arr[7]) : undefined,
  }),

  entityMeta: (arr: Decoded[]): EntityMeta => ({
    id: id(decodeString(arr[0])),
    quorum: (arr[1] as Decoded[]).map(item => signer(decodeNumber(item))),
    timeoutMs: decodeNumber(arr[2]),
    protocol: decodeString(arr[3]),
  }),

  entityCommand: (arr: Decoded[]): EntityCommand => {
    const type = decodeNumber(arr[0]);
    switch (type) {
      case 0:
        return { type: 'addTx', tx: decode.entityTx(arr[1] as Decoded[]) };
      case 1:
        return { type: 'proposeBlock' };
      case 2:
        return {
          type: 'shareProposal',
          proposal: decode.proposedBlock(arr[1] as Decoded[]),
        };
      case 3:
        return {
          type: 'approveBlock',
          hash: hash(decodeString(arr[1])),
          from: arr[2] ? signer(decodeNumber(arr[2])) : undefined,
        };
      case 4:
        return { type: 'commitBlock', hash: hash(decodeString(arr[1])) };
      default:
        throw new Error(`Unknown command type: ${type}`);
    }
  },

  serverTx: (arr: Decoded[]): ServerTx => ({
    signer: signer(decodeNumber(arr[0])),
    entityId: id(decodeString(arr[1])),
    command: decode.entityCommand(arr[2] as Decoded[]),
  }),

  registry: (arr: Decoded[]): ReadonlyMap<EntityId, EntityMeta> =>
    decodeMap(arr, item => {
      const pair = item as Decoded[];
      return [id(decodeString(pair[0])), decode.entityMeta(pair[1] as Decoded[])];
    }),

  signers: (
    arr: Decoded[],
  ): ReadonlyMap<SignerIdx, SignerEntities> =>
    decodeMap(arr, item => {
      const signerPair = item as Decoded[];
      const signerId = signer(decodeNumber(signerPair[0]));
      const entities = decodeMap(signerPair[1] as Decoded[], entityItem => {
        const entityPair = entityItem as Decoded[];
        return [
          id(decodeString(entityPair[0])),
          decode.entityState(entityPair[1] as Decoded[]),
        ];
      });
      return [signerId, entities];
    }),

  serverState: (buf: Buffer): ServerState => {
    const decoded = RLP.decode(buf) as Decoded[];
    return {
      height: height(decodeNumber(decoded[0])),
      signers: decode.signers(decoded[1] as Decoded[]),
      registry: decode.registry(decoded[2] as Decoded[]),
      mempool: (decoded[3] as Decoded[]).map(item =>
        decode.serverTx(item as Decoded[]),
      ),
    };
  },

  blockData: (buf: Buffer): BlockData => {
    const decoded = RLP.decode(buf) as Decoded[];
    return {
      height: height(decodeNumber(decoded[0])),
      timestamp: decodeNumber(decoded[1]),
      transactions: (decoded[2] as Decoded[]).map(item =>
        decode.serverTx(item as Decoded[]),
      ),
      stateHash: decodeString(decoded[3]),
      parentHash: decoded[4] ? decodeString(decoded[4]) : undefined,
      encodedData: buf,
    };
  },
};
```

### 3. Merkle Tree Implementation

This is the new `src/utils/merkle.ts` file. It implements a sorted Merkle tree that rebuilds on insertion, with support for proof generation and verification.

```typescript
import { createHash } from 'crypto';

export type MerkleProof = {
  readonly path: string[];
  readonly index: number;
};

export type MerkleNode = {
  readonly hash: string;
  readonly key?: Buffer;
  readonly value?: Buffer;
  readonly left?: MerkleNode;
  readonly right?: MerkleNode;
};

const EMPTY_HASH = createHash('sha256').digest('hex');

const sha256 = (data: Buffer): Buffer => {
  return createHash('sha256').update(data).digest();
};

export class MerkleTree {
  private root: MerkleNode | null = null;
  private nodes: Map<string, Buffer> = new Map();
  private levels: MerkleNode[][] = [];
  private leafMap: Map<string, number> = new Map();

  constructor(
    private readonly hashFn: (data: Buffer) => Buffer = sha256,
  ) {}

  insert(key: Buffer, value: Buffer): void {
    const keyHash = this.hashFn(key);
    this.nodes.set(keyHash.toString('hex'), value);
    this.rebuild();
  }

  batchInsert(items: { key: Buffer; value: Buffer }[]): void {
    for (const { key, value } of items) {
      const keyHash = this.hashFn(key);
      this.nodes.set(keyHash.toString('hex'), value);
    }
    this.rebuild();
  }

  get(key: Buffer): Buffer | null {
    const keyHash = this.hashFn(key);
    return this.nodes.get(keyHash.toString('hex')) ?? null;
  }

  getProof(key: Buffer): MerkleProof | null {
    const keyHash = this.hashFn(key).toString('hex');
    const leafIndex = this.leafMap.get(keyHash);

    if (leafIndex === undefined) {
      return null;
    }

    const path: string[] = [];
    let currentIndex = leafIndex;

    for (let i = this.levels.length - 1; i > 0; i--) {
      const level = this.levels[i];
      const isRight = currentIndex % 2;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < level.length) {
        path.push(level[siblingIndex].hash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { path, index: leafIndex };
  }

  static verifyProof(
    key: Buffer,
    value: Buffer,
    proof: MerkleProof,
    rootHash: string,
    hashFn: (data: Buffer) => Buffer = sha256,
  ): boolean {
    const keyHash = hashFn(key);
    const leafData = Buffer.concat([keyHash, value]);
    let computedHash = hashFn(leafData).toString('hex');

    let currentIndex = proof.index;
    for (const siblingHash of proof.path) {
      const isRight = currentIndex % 2;
      const pair = isRight
        ? [siblingHash, computedHash]
        : [computedHash, siblingHash];
      computedHash = hashFn(
        Buffer.concat([Buffer.from(pair[0], 'hex'), Buffer.from(pair[1], 'hex')]),
      ).toString('hex');
      currentIndex = Math.floor(currentIndex / 2);
    }

    return computedHash === rootHash;
  }

  getRootHash(): string {
    return this.root?.hash ?? EMPTY_HASH;
  }

  private rebuild(): void {
    this.levels = [];
    this.leafMap.clear();

    if (this.nodes.size === 0) {
      this.root = null;
      return;
    }

    const sortedKeys = Array.from(this.nodes.keys()).sort();

    let level = sortedKeys.map((key, index) => {
      const value = this.nodes.get(key)!;
      const leafData = Buffer.concat([Buffer.from(key, 'hex'), value]);
      const node: MerkleNode = {
        hash: this.hashFn(leafData).toString('hex'),
        key: Buffer.from(key, 'hex'),
        value,
      };
      this.leafMap.set(key, index);
      return node;
    });
    this.levels.push(level);

    while (level.length > 1) {
      const nextLevel: MerkleNode[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        const parentHash = this.hashFn(
          Buffer.concat([
            Buffer.from(left.hash, 'hex'),
            Buffer.from(right.hash, 'hex'),
          ]),
        );
        nextLevel.push({
          hash: parentHash.toString('hex'),
          left,
          right: right === left ? undefined : right,
        });
      }
      level = nextLevel;
      this.levels.push(level);
    }

    this.root = level[0] ?? null;
    this.levels.reverse(); // Root at index 0
  }
}
```

### 4. LevelDB Storage Implementation

Here is the new `src/storage/leveldb.ts` file, implementing the `Storage` interface with persistent LevelDB databases.

```typescript
import { Level } from 'level';
import type { BatchOperation } from 'level';
import type { BlockHeight, ServerState, ServerTx, BlockData } from '../types/state.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import { decode, encode } from '../utils/encoding.js';
import { Mutex } from '../utils/mutex.js';
import type { Storage } from './interface.js';

export class LevelDBStorage implements Storage {
  private db: Level<string, Buffer>;
  private walDb: Level<string, Buffer>;
  private blockDb: Level<string, Buffer>;
  private snapshotDb: Level<string, Buffer>;
  private mutex = new Mutex();

  constructor(basePath: string) {
    const options = { valueEncoding: 'buffer', keyEncoding: 'utf8' };
    this.db = new Level(`${basePath}/main`, options);
    this.walDb = new Level(`${basePath}/wal`, options);
    this.blockDb = new Level(`${basePath}/blocks`, options);
    this.snapshotDb = new Level(`${basePath}/snapshots`, options);
  }

  private formatHeight = (h: BlockHeight) => Number(h).toString().padStart(10, '0');

  readonly wal = {
    append: async (h: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const key = `wal:${this.formatHeight(h)}`;
        const value = RLP.encode(txs.map(encode.serverTx));
        await this.walDb.put(key, Buffer.from(value));
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL append failed: ${e}`);
      } finally {
        release();
      }
    },

    readFromHeight: async (h: BlockHeight): Promise<Result<readonly ServerTx[]>> => {
      try {
        const result: ServerTx[] = [];
        const startKey = `wal:${this.formatHeight(h)}`;
        for await (const value of this.walDb.values({ gte: startKey })) {
          const decodedTxs = RLP.decode(value) as Decoded[];
          result.push(...decodedTxs.map(tx => decode.serverTx(tx as Decoded[])));
        }
        return Ok(result);
      } catch (e) {
        return Err(`WAL read failed: ${e}`);
      }
    },

    truncateBefore: async (h: BlockHeight): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const endKey = `wal:${this.formatHeight(h)}`;
        const ops: BatchOperation<Level<string, Buffer>, string, Buffer>[] = [];
        for await (const key of this.walDb.keys({ lt: endKey })) {
          ops.push({ type: 'del', key });
        }
        if (ops.length > 0) {
          await this.walDb.batch(ops);
        }
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL truncate failed: ${e}`);
      } finally {
        release();
      }
    },
  };

  readonly blocks = {
    save: async (h: BlockHeight, block: BlockData): Promise<Result<void>> => {
      try {
        const key = `block:${this.formatHeight(h)}`;
        const bufferToSave = block.encodedData ?? encode.blockData(block);
        await this.blockDb.put(key, bufferToSave);
        return Ok(undefined);
      } catch (e) {
        return Err(`Block save failed: ${e}`);
      }
    },
    get: async (h: BlockHeight): Promise<Result<BlockData | null>> => {
      try {
        const key = `block:${this.formatHeight(h)}`;
        const value = await this.blockDb.get(key);
        return Ok(decode.blockData(value));
      } catch (e: any) {
        if (e.code === 'LEVEL_NOT_FOUND') return Ok(null);
        return Err(`Block get failed: ${e}`);
      }
    },
  };

  readonly snapshots = {
    save: async (state: ServerState): Promise<Result<void>> => {
      try {
        const key = `snapshot:${this.formatHeight(state.height)}`;
        const value = encode.serverState(state);
        await this.snapshotDb.put(key, value);
        return Ok(undefined);
      } catch (e) {
        return Err(`Snapshot save failed: ${e}`);
      }
    },

    loadLatest: async (): Promise<Result<ServerState | null>> => {
      try {
        const it = this.snapshotDb.iterator({ reverse: true, limit: 1 });
        const result = await it.next();
        await it.close();

        if (!result) return Ok(null);

        const [, value] = result;
        return Ok(decode.serverState(value));
      } catch (e) {
        return Err(`Snapshot load failed: ${e}`);
      }
    },
  };

  async close(): Promise<void> {
    await Promise.all([
      this.db.close(),
      this.walDb.close(),
      this.blockDb.close(),
      this.snapshotDb.close(),
    ]);
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.db.clear(),
      this.walDb.clear(),
      this.blockDb.clear(),
      this.snapshotDb.clear(),
    ]);
  }
}
```

### 5. Integration Updates

Now, I'll update the rest of the codebase to use these new components.

#### `src/types/state.ts`

I'll add the optional `encodedData` field to `BlockData`.

```typescript
import type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives.js';

export type EntityStage = 'idle' | 'proposed' | 'committing' | 'faulted';
export type SignerEntities = ReadonlyMap<EntityId, EntityState>;

export type EntityTx = {
  readonly op: string;
  readonly data: any;
  nonce?: number;
};

export type ProposedBlock = {
  readonly txs: readonly EntityTx[];
  readonly hash: BlockHash;
  readonly height: BlockHeight;
  readonly proposer: SignerIdx;
  readonly approvals: ReadonlySet<SignerIdx>;
  readonly timestamp: number;
};

export type EntityState<T = any> = {
  readonly id: EntityId;
  readonly height: BlockHeight;
  readonly stage: EntityStage;
  readonly data: T;
  readonly mempool: readonly EntityTx[];
  readonly proposal?: ProposedBlock;
  readonly lastBlockHash?: BlockHash;
  readonly faultReason?: string;
};

export type EntityMeta = {
  readonly id: EntityId;
  readonly quorum: readonly SignerIdx[];
  readonly timeoutMs: number;
  readonly protocol: string;
};

export type EntityCommand = 
  | { readonly type: 'addTx'; readonly tx: EntityTx }
  | { readonly type: 'proposeBlock' }
  | { readonly type: 'shareProposal'; readonly proposal: ProposedBlock }
  | { readonly type: 'approveBlock'; readonly hash: BlockHash; readonly from?: SignerIdx }
  | { readonly type: 'commitBlock'; readonly hash: BlockHash };

export type ServerTx = {
  readonly signer: SignerIdx;
  readonly entityId: EntityId;
  readonly command: EntityCommand;
};

export type OutboxMsg = {
  readonly from: EntityId;
  readonly to: EntityId;
  readonly toSigner?: SignerIdx;
  readonly command: EntityCommand;
};

export type ServerState = {
  readonly height: BlockHeight;
  readonly signers: ReadonlyMap<SignerIdx, SignerEntities>;
  readonly registry: ReadonlyMap<EntityId, EntityMeta>;
  readonly mempool: readonly ServerTx[];
};

export type BlockData = {
  readonly height: BlockHeight;
  readonly timestamp: number;
  readonly transactions: readonly ServerTx[];
  readonly stateHash: string;
  readonly parentHash?: string;
  readonly encodedData?: Buffer;
};

export type CommandResult = {
  readonly entity: EntityState;
  readonly messages: readonly OutboxMsg[];
};

export type Clock = {
  readonly now: () => number;
};

export type ProcessedBlock = {
  readonly server: ServerState;
  readonly stateHash: string;
  readonly appliedTxs: readonly ServerTx[];
  readonly failedTxs: readonly ServerTx[];
  readonly messages: readonly OutboxMsg[];
};

export type { BlockHash, BlockHeight, EntityId, SignerIdx } from './primitives.js';
```

#### `src/utils/hash.ts`

I'll update `computeStateHash` to use the new `MerkleTree`.

```typescript
import { createHash } from 'crypto';
import type { BlockHash, BlockHeight, EntityId } from '../types/primitives.js';
import { hash } from '../types/primitives.js';
import type { EntityTx, ServerState } from '../types/state.js';
import { encode } from './encoding.js';
import { MerkleTree } from './merkle.js';

const sha256 = (data: Buffer): Buffer => {
  return createHash('sha256').update(data).digest();
};

export const deterministicHash = (data: any): string => {
  // This function is now legacy, but kept for non-RLP hashing needs.
  // RLP should be preferred for any data that needs a deterministic hash.
  const serialized = JSON.stringify(data);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
};

export const computeBlockHash = (
  entityId: EntityId,
  blockHeight: BlockHeight,
  state: any,
  txs: readonly EntityTx[],
): BlockHash => {
  const encoded = RLP.encode([
    entityId,
    Number(blockHeight),
    JSON.stringify(state),
    txs.map(encode.entityTx),
  ]);
  return hash(sha256(Buffer.from(encoded)).toString('hex'));
};

export const computeStateHash = (server: ServerState): string => {
  const tree = new MerkleTree(sha256);

  for (const [signerId, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const key = encode.merkleKey(signerId, entityId);
      const value = Buffer.from(RLP.encode(encode.entityState(entity)));
      tree.insert(key, value);
    }
  }

  // To make the hash sensitive to height and registry changes,
  // we hash the Merkle root with that data.
  const rootHash = tree.getRootHash();
  const finalHash = sha256(
    Buffer.concat([
      Buffer.from(rootHash, 'hex'),
      Buffer.from(RLP.encode(encodeNumber(server.height))),
      Buffer.from(RLP.encode(encode.registry(server.registry))),
    ]),
  );

  return finalHash.toString('hex');
};
```

#### `src/infra/runner.ts`

I'll update the block creation logic to use RLP encoding.

```typescript
// ============================================================================
// infra/runner.ts - Block runner with effects
// ============================================================================

import { processServerTick } from '../engine/processor.js';
import type { Storage } from '../storage/interface.js';
import { height } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, Clock, ProcessedBlock, ServerState } from '../types/state.js';
import { computeStateHash } from '../utils/hash.js';
import { createInitialState } from '../utils/serialization.js';
import type { Logger } from './deps.js';
import { ConsoleLogger, SystemClock } from './deps.js';
import { encode } from '../utils/encoding.js';

export type RunnerConfig = {
  readonly storage: Storage;
  readonly protocols: ProtocolRegistry;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly snapshotInterval?: number;
};

export const createBlockRunner = (config: RunnerConfig) => {
  const { 
    storage, 
    protocols, 
    clock = SystemClock, 
    logger = ConsoleLogger,
    snapshotInterval = 100 
  } = config;
  
  // Compatibility wrapper to convert new engine result to old format
  const processBlockPure = (ctx: { server: ServerState; protocols: ProtocolRegistry; clock: Clock }): Result<ProcessedBlock> => {
    const result = processServerTick(ctx.server, ctx.protocols, ctx.clock.now());
    
    if (!result.ok) {
      return Err(result.error);
    }
    
    // Convert new engine result to old format
    return Ok({
      server: result.value.server,
      stateHash: result.value.stateHash,
      appliedTxs: result.value.appliedCommands,
      failedTxs: result.value.failedCommands.map((f: any) => f.command),
      messages: result.value.generatedMessages
    });
  };
  
  const runner = {
    processBlock: async (server: ServerState, skipWal = false): Promise<Result<ServerState>> => {
      const nextHeight = height(Number(server.height) + 1);
      
      const blockResult = processBlockPure({ server, protocols, clock });
      if (!blockResult.ok) {
        return blockResult;
      }
      
      const processed = blockResult.value;
      
      if (!skipWal && server.mempool.length > 0) {
        const walResult = await storage.wal.append(nextHeight, server.mempool);
        if (!walResult.ok) {
          return Err(`WAL write failed: ${walResult.error}`);
        }
      }
      
      const blockContent = {
        height: nextHeight,
        timestamp: clock.now(),
        transactions: server.mempool,
        stateHash: processed.stateHash,
        parentHash: Number(server.height) > 0 ? computeStateHash(server) : undefined,
      };
      
      const blockData: BlockData = {
        ...blockContent,
        encodedData: encode.blockData(blockContent),
      };
      
      const saveResult = await storage.blocks.save(nextHeight, blockData);
      if (!saveResult.ok) {
        logger.error('Block save failed', saveResult.error);
      }
      
      if (Number(nextHeight) % snapshotInterval === 0) {
        const snapshotResult = await storage.snapshots.save(processed.server);
        if (!snapshotResult.ok) {
          logger.error('Snapshot failed', snapshotResult.error);
        } else {
          const truncateResult = await storage.wal.truncateBefore(nextHeight);
          if (!truncateResult.ok) {
            logger.warn('WAL truncation failed', truncateResult.error);
          }
        }
      }
      
      if (processed.failedTxs.length > 0) {
        logger.warn(`Block ${nextHeight}: ${processed.failedTxs.length} failed transactions`);
      }
      
      logger.info(`Block ${nextHeight} processed`, {
        applied: processed.appliedTxs.length,
        failed: processed.failedTxs.length,
        messages: processed.messages.length,
        newMempool: processed.server.mempool.length
      });
      
      return Ok(processed.server);
    },
    
    recover: async (initialState?: ServerState): Promise<Result<ServerState>> => {
      logger.info('Starting recovery...');
      
      const snapshotResult = await storage.snapshots.loadLatest();
      if (!snapshotResult.ok) return Err(`Snapshot load failed: ${snapshotResult.error}`);
      
      let server = snapshotResult.value || initialState || createInitialState();
      logger.info(`Loaded snapshot at height ${server.height}`);
      
      const walResult = await storage.wal.readFromHeight(height(Number(server.height) + 1));
      if (!walResult.ok) return Err(`WAL read failed: ${walResult.error}`);
      
      const walTxs = walResult.value;
      if (walTxs.length === 0) {
        logger.info('No WAL entries to replay');
        return Ok(server);
      }
      
      logger.info(`Replaying ${walTxs.length} WAL transactions`);
      
      server = { ...server, mempool: walTxs };
      const processResult = await runner.processBlock(server, true);
      if (!processResult.ok) return Err(`Recovery replay failed: ${processResult.error}`);
      
      logger.info('Recovery complete', { height: processResult.value.height, replayed: walTxs.length });
      
      return Ok(processResult.value);
    }
  };
  
  return runner;
};
```

#### `src/storage/memory.ts`

I'll update `MemoryStorage` to use RLP encoding for consistency, which also helps in testing the encoders.

```typescript
// ============================================================================
// storage/memory.ts - In-memory storage implementation
// ============================================================================

import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { BlockData, BlockHeight, ServerState, ServerTx } from '../types/state.js';
import { Mutex } from '../utils/mutex.js';
import { decode, encode } from '../utils/encoding.js';
import type { Storage } from './interface.js';
import { RLP } from '@ethereumjs/rlp';
import type { Decoded } from '@ethereumjs/rlp';

export class MemoryStorage implements Storage {
  private walEntries = new Map<string, Buffer>();
  private blockStore = new Map<BlockHeight, Buffer>();
  private snapshotStore = new Map<BlockHeight, Buffer>();
  private mutex = new Mutex();
  
  private formatHeight = (h: BlockHeight) => Number(h).toString().padStart(10, '0');

  readonly wal = {
    append: async (h: BlockHeight, txs: readonly ServerTx[]): Promise<Result<void>> => {
      const release = await this.mutex.acquire();
      try {
        const key = `wal:${this.formatHeight(h)}`;
        const value = Buffer.from(RLP.encode(txs.map(encode.serverTx)));
        this.walEntries.set(key, value);
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL append failed: ${e}`);
      } finally {
        release();
      }
    },
    
    readFromHeight: async (h: BlockHeight): Promise<Result<readonly ServerTx[]>> => {
      try {
        const result: ServerTx[] = [];
        const startKey = `wal:${this.formatHeight(h)}`;
        const sortedKeys = Array.from(this.walEntries.keys()).sort();
        
        for (const key of sortedKeys) {
          if (key >= startKey) {
            const value = this.walEntries.get(key);
            if (value) {
              const decodedTxs = RLP.decode(value) as Decoded[];
              result.push(...decodedTxs.map(tx => decode.serverTx(tx as Decoded[])));
            }
          }
        }
        return Ok(result);
      } catch (e) {
        return Err(`WAL read failed: ${e}`);
      }
    },
    
    truncateBefore: async (h: BlockHeight): Promise<Result<void>> => {
      try {
        const endKey = `wal:${this.formatHeight(h)}`;
        for (const key of this.walEntries.keys()) {
          if (key < endKey) {
            this.walEntries.delete(key);
          }
        }
        return Ok(undefined);
      } catch (e) {
        return Err(`WAL truncate failed: ${e}`);
      }
    }
  };
  
  readonly blocks = {
    save: async (h: BlockHeight, block: BlockData): Promise<Result<void>> => {
      const bufferToSave = block.encodedData ?? encode.blockData(block);
      this.blockStore.set(h, bufferToSave);
      return Ok(undefined);
    },
    get: async (h: BlockHeight): Promise<Result<BlockData | null>> => {
      const buffer = this.blockStore.get(h);
      return Ok(buffer ? decode.blockData(buffer) : null);
    }
  };
  
  readonly snapshots = {
    save: async (state: ServerState): Promise<Result<void>> => {
      try {
        const encoded = encode.serverState(state);
        this.snapshotStore.set(state.height, encoded);
        return Ok(undefined);
      } catch (e) {
        return Err(`Snapshot save failed: ${e}`);
      }
    },
    
    loadLatest: async (): Promise<Result<ServerState | null>> => {
      try {
        if (this.snapshotStore.size === 0) return Ok(null);
        const latestHeight = Math.max(...Array.from(this.snapshotStore.keys()).map(Number));
        const encoded = this.snapshotStore.get(latestHeight as BlockHeight);
        return Ok(encoded ? decode.serverState(encoded) : null);
      } catch (e) {
        return Err(`Snapshot load failed: ${e}`);
      }
    }
  };
  
  clear(): void {
    this.walEntries.clear();
    this.blockStore.clear();
    this.snapshotStore.clear();
  }
}
```

### 6. Test Implementations

Finally, I'll add the new test files to ensure everything works as expected.

#### `src/test/encoding.test.ts`

```typescript
import { test, expect } from 'bun:test';
import { createServer, importEntity, registerEntity, submitCommand } from '../engine/server.js';
import { height, id, signer } from '../types/primitives.js';
import type { ServerState } from '../types/state.js';
import { decode, encode } from '../utils/encoding.js';

const createTestServerState = (): ServerState => {
  let server = createServer();
  server = registerEntity(server, 'wallet-1', { quorum: [1], protocol: 'wallet' });
  server = importEntity(server, signer(1), 'wallet-1', { balance: 1000n, nonce: 0 });
  server = submitCommand(server, signer(1), 'wallet-1', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'wallet-2', amount: '50' }, nonce: 1 },
  });
  return { ...server, height: height(10) };
};

test('RLP encoding round trip for ServerState', () => {
  const original = createTestServerState();
  const encoded = encode.serverState(original);
  const decoded = decode.serverState(encoded);
  
  // Using toEqual is tricky with Maps. Let's compare encoded versions.
  const reEncoded = encode.serverState(decoded);
  expect(encoded).toEqual(reEncoded);

  // For a more robust check, compare JSON strings of canonical forms.
  const toCanonical = (obj: any): any => JSON.parse(JSON.stringify(obj, (k, v) => typeof v === 'bigint' ? v.toString() : v)));
  expect(toCanonical(decoded)).toEqual(toCanonical(original));
});

test('deterministic RLP encoding', () => {
  const state1 = createTestServerState();
  const state2 = createTestServerState(); // Create an identical state
  
  const encoded1 = encode.serverState(state1);
  const encoded2 = encode.serverState(state2);
  
  expect(encoded1).toEqual(encoded2);
});

test('RLP encoding handles null and undefined fields', () => {
  const original: ServerState = {
    ...createTestServerState(),
    mempool: [],
  };
  const entity = original.signers.get(signer(1))!.get(id('wallet-1'))!;
  entity.proposal = undefined;
  entity.lastBlockHash = undefined;

  const encoded = encode.serverState(original);
  const decoded = decode.serverState(encoded);

  const decodedEntity = decoded.signers.get(signer(1))!.get(id('wallet-1'))!;
  expect(decodedEntity.proposal).toBeUndefined();
  expect(decodedEntity.lastBlockHash).toBeUndefined();
});
```

#### `src/test/merkle.test.ts`

```typescript
import { test, expect } from 'bun:test';
import { MerkleTree } from '../utils/merkle.js';

test('merkle tree root hash calculation', () => {
  const tree = new MerkleTree();
  tree.insert(Buffer.from('key1'), Buffer.from('value1'));
  tree.insert(Buffer.from('key2'), Buffer.from('value2'));
  
  const rootHash1 = tree.getRootHash();
  
  const tree2 = new MerkleTree();
  tree2.insert(Buffer.from('key2'), Buffer.from('value2'));
  tree2.insert(Buffer.from('key1'), Buffer.from('value1'));
  
  const rootHash2 = tree2.getRootHash();
  
  expect(rootHash1).toBeDefined();
  expect(rootHash1).not.toBe('0');
  expect(rootHash1).toEqual(rootHash2); // Should be deterministic regardless of insertion order
});

test('merkle proof generation and verification', () => {
  const tree = new MerkleTree();
  const k1 = Buffer.from('key1');
  const v1 = Buffer.from('value1');
  const k2 = Buffer.from('key2');
  const v2 = Buffer.from('value2');
  const k3 = Buffer.from('key3');
  const v3 = Buffer.from('value3');
  
  tree.insert(k1, v1);
  tree.insert(k2, v2);
  tree.insert(k3, v3);
  
  const rootHash = tree.getRootHash();
  
  const proof1 = tree.getProof(k1);
  expect(proof1).not.toBeNull();
  const verified1 = MerkleTree.verifyProof(k1, v1, proof1!, rootHash);
  expect(verified1).toBe(true);
  
  const proof2 = tree.getProof(k2);
  expect(proof2).not.toBeNull();
  const verified2 = MerkleTree.verifyProof(k2, v2, proof2!, rootHash);
  expect(verified2).toBe(true);

  // Verification should fail with wrong value
  const verified3 = MerkleTree.verifyProof(k1, v2, proof1!, rootHash);
  expect(verified3).toBe(false);
});

test('merkle tree handles empty and single-item cases', () => {
  const emptyTree = new MerkleTree();
  expect(emptyTree.getRootHash()).not.toBeNull(); // Should be hash of empty string

  const singleTree = new MerkleTree();
  const key = Buffer.from('key');
  const value = Buffer.from('value');
  singleTree.insert(key, value);
  
  const rootHash = singleTree.getRootHash();
  const proof = singleTree.getProof(key);
  
  expect(proof).not.toBeNull();
  expect(proof!.path.length).toBe(0); // No siblings
  
  const verified = MerkleTree.verifyProof(key, value, proof!, rootHash);
  expect(verified).toBe(true);
});
```

#### `src/test/leveldb.test.ts`

```typescript
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { LevelDBStorage } from '../storage/leveldb.js';
import { createServer, importEntity, registerEntity } from '../engine/server.js';
import type { ServerState } from '../types/state.js';
import { signer, height } from '../types/primitives.js';
import * as fs from 'fs/promises';

const DB_PATH = './test-db';

let storage: LevelDBStorage;

const createTestServerState = (h: number): ServerState => {
  let server = createServer();
  server = registerEntity(server, 'wallet-1', { quorum: [1], protocol: 'wallet' });
  server = importEntity(server, signer(1), 'wallet-1', { balance: 1000n, nonce: 0 });
  return { ...server, height: height(h) };
};

beforeAll(async () => {
  await fs.rm(DB_PATH, { recursive: true, force: true });
  storage = new LevelDBStorage(DB_PATH);
});

afterAll(async () => {
  await storage.close();
  await fs.rm(DB_PATH, { recursive: true, force: true });
});

test('leveldb persistence for snapshots', async () => {
  const state = createTestServerState(100);
  
  const saveResult = await storage.snapshots.save(state);
  expect(saveResult.ok).toBe(true);
  
  // Create a new instance to ensure it reads from disk
  const newStorage = new LevelDBStorage(DB_PATH);
  const loadResult = await newStorage.snapshots.loadLatest();
  
  expect(loadResult.ok).toBe(true);
  expect(loadResult.value).not.toBeNull();
  
  // Deep equality check
  const originalJSON = JSON.stringify(state, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  const loadedJSON = JSON.stringify(loadResult.value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  expect(loadedJSON).toEqual(originalJSON);
  
  await newStorage.close();
});

test('leveldb loadLatest finds the correct snapshot', async () => {
  await storage.clear();
  
  const state10 = createTestServerState(10);
  const state20 = createTestServerState(20);
  
  await storage.snapshots.save(state10);
  await storage.snapshots.save(state20);
  
  const loaded = await storage.snapshots.loadLatest();
  expect(loaded.ok).toBe(true);
  expect(loaded.value?.height).toBe(20);
});

test('leveldb WAL operations work correctly', async () => {
  await storage.clear();
  
  const txs1 = [{ signer: signer(1), entityId: 'e1', command: { type: 'proposeBlock' } }];
  const txs2 = [{ signer: signer(2), entityId: 'e2', command: { type: 'proposeBlock' } }];
  
  await storage.wal.append(height(1), txs1);
  await storage.wal.append(height(2), txs2);
  
  const read1 = await storage.wal.readFromHeight(height(1));
  expect(read1.ok).toBe(true);
  expect(read1.value).toHaveLength(2);
  
  const read2 = await storage.wal.readFromHeight(height(2));
  expect(read2.ok).toBe(true);
  expect(read2.value).toHaveLength(1);
  
  await storage.wal.truncateBefore(height(2));
  const read3 = await storage.wal.readFromHeight(height(1));
  expect(read3.ok).toBe(true);
  expect(read3.value).toHaveLength(1); // Should only have height 2's entry
  expect(read3.value[0].signer).toBe(2);
});
```