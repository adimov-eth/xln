import { createHash } from 'crypto';
import { decode, encode } from 'rlp';

export type EntityStorage = Readonly<{ value: number }>;

export type EntityTx =
  | { readonly type: 'create' }                   
  | { readonly type: 'increment'; n: number };    

export type EntityBlock = Readonly<{
  height: number;
  storage: EntityStorage;
  inbox: readonly Buffer[];
}>;

export type EntityState = Readonly<{
  stage: 'idle' | 'commit';
  mempool: Map<string, Buffer>;
  lastBlock?: EntityBlock;
}>;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();
const txHash = (raw: Buffer) => sha256(raw).toString('hex');
  
export const encodeTx = (tx: EntityTx): Buffer => Buffer.from(encode([
  tx.type === 'increment' ? 1 : 0,
  tx.type === 'increment' ? tx.n : 0
]));

export const decodeTx = (raw: Buffer): EntityTx => {
  const [tag, n] = decode(raw) as unknown as [number, number];
  return tag === 1 ? { type: 'increment', n } : { type: 'create' };
};

export const encodeBlock = (b: EntityBlock): Buffer => Buffer.from(encode([
  b.height,
  b.storage.value,
  b.inbox as Buffer[]
]));

export const decodeBlock = (raw: Buffer): EntityBlock => {
  const [height, value, inbox] = decode(raw) as unknown as [number, number, Buffer[]];
  return { height, storage: { value }, inbox };
};

const applyTx = (s: EntityStorage, tx: EntityTx): EntityStorage => {
  if (tx.type === 'create') return { value: 0 };
  return { value: s.value + tx.n };
};

export const Entity = {
  init(): EntityState {
    return { stage: 'idle', mempool: new Map() };
  },

  addTx(state: EntityState, tx: EntityTx): EntityState {
    const raw = encodeTx(tx);
    return {
      ...state,
      mempool: new Map(state.mempool).set(txHash(raw), raw)
    };
  },

  commit(state: EntityState): EntityState {
    if (state.mempool.size === 0) return state;
    const inbox  = [...state.mempool.values()];
    const height = (state.lastBlock?.height ?? 0) + 1;

    let storage = state.lastBlock?.storage ?? { value: 0 };
    for (const raw of inbox) storage = applyTx(storage, decodeTx(raw));

    const block: EntityBlock = { height, storage, inbox };
    return { stage: 'commit', mempool: new Map(), lastBlock: block };
  }
};
