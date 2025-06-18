import { RLP } from '@ethereumjs/rlp';
import type { Decoded } from '@ethereumjs/rlp';
import { hash, height, id, signer } from '../types/primitives.js';
import type {
  BlockHash,
  BlockHeight,
  EntityId,
  SignerIdx,
} from '../types/primitives.js';
import { serializeWithBigInt, deserializeWithBigInt } from './serialization.js';
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
const decodeString = (b: Decoded): string => {
  if (!b) return '';
  if (b instanceof Uint8Array) {
    return Buffer.from(b).toString('utf8');
  }
  if (Buffer.isBuffer(b)) {
    return b.toString('utf8');
  }
  return '';
};

const encodeBigInt = (n: bigint | undefined | null): Buffer | null =>
  n !== undefined && n !== null ? Buffer.from(RLP.encode(n)) : null;
const decodeBigInt = (b: Decoded): bigint => {
  if (!b || (b instanceof Uint8Array && b.length === 0)) return 0n;
  if (b instanceof Uint8Array && b.length === 1 && b[0] === 128) return 0n; // RLP encodes 0 as 0x80
  return b instanceof Uint8Array ? BigInt('0x' + Buffer.from(b).toString('hex')) : 0n;
};

const encodeNumber = (n: number | undefined | null): Buffer | null =>
  n !== undefined && n !== null ? Buffer.from(RLP.encode(n)) : null;
const decodeNumber = (b: Decoded): number => {
  if (!b || (b instanceof Uint8Array && b.length === 0)) return 0;
  if (b instanceof Uint8Array && b.length === 1 && b[0] === 128) return 0; // RLP encodes 0 as 0x80
  if (b instanceof Uint8Array && b.length === 1) return b[0]!; // Single byte numbers
  return b instanceof Uint8Array ? parseInt(Buffer.from(b).toString('hex'), 16) : 0;
};

const encodeNullable = <T>(
  val: T | undefined | null,
  encoder: (v: T) => any,
): any => (val === undefined || val === null ? null : encoder(val));

const isNull = (b: Decoded): boolean => 
  b === null || 
  (b instanceof Uint8Array && b.length === 0) ||
  (Buffer.isBuffer(b) && b.length === 0);

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
  items.sort((a, b) => {
    const bufA = a instanceof Uint8Array ? a : Buffer.from(a);
    const bufB = b instanceof Uint8Array ? b : Buffer.from(b);
    return Buffer.compare(bufA, bufB);
  });
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
    Buffer.from(serializeWithBigInt(tx.data)), // JSON for arbitrary data with BigInt support
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
    Buffer.from(serializeWithBigInt(entity.data)), // JSON for arbitrary data with BigInt support
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
    encodeNullable(meta.thresholdPercent, encodeNumber),
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
    Buffer.from(RLP.encode([
      encodeNumber(state.height),
      encode.signers(state.signers),
      encode.registry(state.registry),
      state.mempool.map(encode.serverTx),
    ])),

  blockData: (block: Omit<BlockData, 'encodedData'>): Buffer =>
    Buffer.from(RLP.encode([
      encodeNumber(block.height),
      encodeNumber(block.timestamp),
      block.transactions.map(encode.serverTx),
      encodeString(block.stateHash),
      encodeNullable(block.parentHash, encodeString),
    ])),
};

export const decode = {
  entityTx: (arr: Decoded[]): EntityTx => ({
    op: decodeString(arr[0] as Decoded),
    data: decodeString(arr[1] as Decoded) ? deserializeWithBigInt(decodeString(arr[1] as Decoded)) : {},
    nonce: arr[2] && !isNull(arr[2]) ? decodeNumber(arr[2]) : undefined,
  }),

  proposedBlock: (arr: Decoded[]): ProposedBlock => ({
    txs: (arr[0] as unknown as Decoded[]).map(item => decode.entityTx(item as unknown as Decoded[])),
    hash: hash(decodeString(arr[1] as Decoded)),
    height: height(decodeNumber(arr[2] as Decoded)),
    proposer: signer(decodeNumber(arr[3] as Decoded)),
    approvals: decodeSet(arr[4] as unknown as Decoded[], item => signer(decodeNumber(item))),
    timestamp: decodeNumber(arr[5] as Decoded),
  }),

  entityState: (arr: Decoded[]): EntityState => ({
    id: id(decodeString(arr[0] as Decoded)),
    height: height(decodeNumber(arr[1] as Decoded)),
    stage: decodeString(arr[2] as Decoded) as EntityState['stage'],
    data: decodeString(arr[3] as Decoded) ? deserializeWithBigInt(decodeString(arr[3] as Decoded)) : {},
    mempool: (arr[4] as unknown as Decoded[]).map(item => decode.entityTx(item as unknown as Decoded[])),
    proposal: arr[5] && !isNull(arr[5]) ? decode.proposedBlock(arr[5] as unknown as Decoded[]) : undefined,
    lastBlockHash: arr[6] && !isNull(arr[6]) ? hash(decodeString(arr[6])) : undefined,
    faultReason: arr[7] && !isNull(arr[7]) ? decodeString(arr[7]) : undefined,
  }),

  entityMeta: (arr: Decoded[]): EntityMeta => ({
    id: id(decodeString(arr[0] as Decoded)),
    quorum: (arr[1] as unknown as Decoded[]).map(item => signer(decodeNumber(item))),
    timeoutMs: decodeNumber(arr[2] as Decoded),
    protocol: decodeString(arr[3] as Decoded),
    thresholdPercent: arr[4] && !isNull(arr[4]) ? decodeNumber(arr[4]) : undefined,
  }),

  entityCommand: (arr: Decoded[]): EntityCommand => {
    const type = decodeNumber(arr[0] as Decoded);
    switch (type) {
      case 0:
        return { type: 'addTx', tx: decode.entityTx(arr[1] as unknown as Decoded[]) };
      case 1:
        return { type: 'proposeBlock' };
      case 2:
        return {
          type: 'shareProposal',
          proposal: decode.proposedBlock(arr[1] as unknown as Decoded[]),
        };
      case 3:
        return {
          type: 'approveBlock',
          hash: hash(decodeString(arr[1] as Decoded)),
          from: arr[2] && !isNull(arr[2]) ? signer(decodeNumber(arr[2])) : undefined,
        };
      case 4:
        return { type: 'commitBlock', hash: hash(decodeString(arr[1] as Decoded)) };
      default:
        throw new Error(`Unknown command type: ${type}`);
    }
  },

  serverTx: (arr: Decoded[]): ServerTx => ({
    signer: signer(decodeNumber(arr[0] as Decoded)),
    entityId: id(decodeString(arr[1] as Decoded)),
    command: decode.entityCommand(arr[2] as unknown as Decoded[]),
  }),

  registry: (arr: Decoded[]): ReadonlyMap<EntityId, EntityMeta> =>
    decodeMap(arr, item => {
      const pair = item as unknown as Decoded[];
      return [id(decodeString(pair[0] as Decoded)), decode.entityMeta(pair[1] as unknown as Decoded[])];
    }),

  signers: (
    arr: Decoded[],
  ): ReadonlyMap<SignerIdx, SignerEntities> =>
    decodeMap(arr, item => {
      const signerPair = item as unknown as Decoded[];
      const signerId = signer(decodeNumber(signerPair[0] as Decoded));
      const entities = decodeMap(signerPair[1] as unknown as Decoded[], entityItem => {
        const entityPair = entityItem as unknown as Decoded[];
        return [
          id(decodeString(entityPair[0] as Decoded)),
          decode.entityState(entityPair[1] as unknown as Decoded[]),
        ];
      });
      return [signerId, entities];
    }),

  serverState: (buf: Buffer): ServerState => {
    const decoded = RLP.decode(buf) as unknown as Decoded[];
    return {
      height: height(decodeNumber(decoded[0] as Decoded)),
      signers: decode.signers(decoded[1] as unknown as Decoded[]),
      registry: decode.registry(decoded[2] as unknown as Decoded[]),
      mempool: (decoded[3] as unknown as Decoded[]).map(item =>
        decode.serverTx(item as unknown as Decoded[]),
      ),
    };
  },

  blockData: (buf: Buffer): BlockData => {
    const decoded = RLP.decode(buf) as unknown as Decoded[];
    return {
      height: height(decodeNumber(decoded[0] as Decoded)),
      timestamp: decodeNumber(decoded[1] as Decoded),
      transactions: (decoded[2] as unknown as Decoded[]).map(item =>
        decode.serverTx(item as unknown as Decoded[]),
      ),
      stateHash: decodeString(decoded[3] as Decoded),
      parentHash: decoded[4] && !isNull(decoded[4]) ? decodeString(decoded[4]) : undefined,
      encodedData: buf,
    };
  },
};