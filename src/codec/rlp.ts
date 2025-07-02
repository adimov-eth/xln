import { keccak_256 as keccak } from '@noble/hashes/sha3';
import * as rlp from 'rlp';
import type { Address, Command, EntityState, Frame, Hex, Input, SignerRecord, Transaction, TxKind, UInt64 } from '../types';

/* — internal helpers for bigint <-> Buffer — */
const bnToBuf = (n: UInt64): Uint8Array =>
  n === 0n ? new Uint8Array() : Buffer.from(n.toString(16).padStart(2, '0'), 'hex');
const bufToBn = (b: Uint8Array): UInt64 =>
  b.length === 0 ? 0n : BigInt('0x' + Buffer.from(b).toString('hex'));

/* — Transaction (Entity Tx) encode/decode — */
export const encTx = (t: Transaction): Uint8Array =>
  rlp.encode([
    t.kind,
    bnToBuf(t.nonce),
    t.from,
    JSON.stringify(t.body),  // body is small JSON (e.g. {"message": "hi"})
    t.sig,
  ]) as Uint8Array;
export const decTx = (b: Uint8Array): Transaction => {
  const [k, n, f, body, sig] = rlp.decode(b) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  return {
    kind : k.toString() as TxKind,
    nonce: bufToBn(n),
    from : `0x${Buffer.from(f).toString('hex')}`,
    body : JSON.parse(Buffer.from(body).toString()),
    sig  : `0x${Buffer.from(sig).toString('hex')}`,
  } as Transaction;
};

/* -- EntityState encode helper (deterministic ordering) -- */
export const encEntityState = (s: EntityState): Uint8Array => {
  const members = Object.entries(s.quorum.members)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([addr, rec]) => [addr, bnToBuf(rec.nonce), rec.shares]);
  const chat = s.chat.map(c => [c.from, c.msg, c.ts]);
  return rlp.encode([
    [s.quorum.threshold, members],
    chat,
  ]) as Uint8Array;
};

/* — Entity Frame encode/decode — */
export const encFrame = (f: Frame<EntityState>): Uint8Array =>
  rlp.encode([
    bnToBuf(f.height),
    f.ts,
    f.txs.map(encTx) as any,
    encEntityState(f.state),
  ]) as Uint8Array;
export const decEntityState = (b: Uint8Array): EntityState => {
  const [qArr, chatArr] = rlp.decode(b) as any[];
  const [thresh, membersArr] = qArr as [Uint8Array, any[]];
  const members: Record<Address, SignerRecord> = {};
  (membersArr as any[]).forEach(([a, n, s]: [Uint8Array, Uint8Array, number]) => {
    members[Buffer.from(a).toString() as Address] = { nonce: bufToBn(n), shares: Number(s) };
  });
  const chat = (chatArr as any[]).map(([f, m, t]: [Uint8Array, Uint8Array, Uint8Array]) => ({
    from: Buffer.from(f).toString() as Address,
    msg: Buffer.from(m).toString(),
    ts: Number(t.toString()),
  }));
  return { quorum: { threshold: Number(thresh.toString()), members }, chat };
};

export const decFrame = (b: Uint8Array): Frame<EntityState> => {
  const [h, ts, txs, st] = rlp.decode(b) as [Uint8Array, Uint8Array, Uint8Array[], Uint8Array];
  return {
    height: bufToBn(h),
    ts    : Number(ts.toString()),
    txs   : (txs as Uint8Array[]).map(decTx),
    state : decEntityState(st),
  };
};

/* — Command encode/decode (wrapped in Input) — */
const encCmd = (c: Command): rlp.Input => [
  c.type,
  JSON.stringify(c, (_, v) => typeof v === 'bigint' ? v.toString() : v)
];
const decCmd = (arr: any[]): Command => JSON.parse(arr[1].toString());

/* — Input (wire packet) encode/decode — */
export const encInput = (i: Input): Uint8Array =>
  rlp.encode([ i.from, i.to, encCmd(i.cmd) ]) as Uint8Array;
export const decInput = (b: Uint8Array): Input => {
  const [from, to, cmdArr] = rlp.decode(b) as [Uint8Array, Uint8Array, any];
  return {
    from: Buffer.from(from).toString() as Address,
    to  : Buffer.from(to).toString() as Address,
    cmd : decCmd(cmdArr)
  };
};

/* — ServerFrame encode/decode — */
export const encServerFrame = (f: import('../types').ServerFrame): Uint8Array =>
  rlp.encode([
    bnToBuf(f.height),
    f.ts,
    f.inputs.map(encInput) as any,
    f.root,
  ]) as Uint8Array;
export const decServerFrame = (b: Uint8Array): import('../types').ServerFrame => {
  const [h, ts, ins, root] = rlp.decode(b) as any[];
  const frame = {
    height: bufToBn(h),
    ts: Number(ts.toString()),
    inputs: (ins as Uint8Array[]).map(decInput),
    root: `0x${Buffer.from(root).toString('hex')}` as Hex,
    hash: '0x00' as Hex,  // will be filled after decoding if needed
  };
  frame.hash = ('0x' + Buffer.from(keccak(encServerFrame(frame))).toString('hex')) as Hex;
  return frame;
};

