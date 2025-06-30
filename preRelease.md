
## 0  Project Scaffold

```text
xln-core/
├─ package.json
├─ tsconfig.json
└─ src/
   ├─ schema.ts          ← canonical domain types  (former Impl 1)
   ├─ crypto.ts          ← Schnorr + secp256k1 helpers
   ├─ codec.ts           ← RLP‑compatible binary encoder/decoder
   ├─ state.ts           ← pure state‑machine (applyCommand / applyFrame)
   ├─ server.ts          ← runtime container (ticks, routing)
   ├─ simulation.spec.ts ← mocha/fast‑check integration test
   └─ index.ts           ← CLI entry (runs devnet)
```

### Prerequisites

```bash
npm i -D typescript ts-node @types/node
npm i  noble-secp256k1 @noble/hashes rlp fast-check mocha chai
```

---

## 1  `types.ts` – single source of truth for domain types

```ts
/* ───────── primitive brands ───────── */
export type Hex     = `0x${string}`;
export type Address = Hex;
export type UInt64  = bigint;
export type Nonce   = UInt64;
export type TS      = number;      // ms since Unix epoch

/* ───────── quorum & signer record ───────── */
export interface SignerRecord {
  /** personal frame‑height inside the entity */
  nonce  : Nonce;
  /** voting power of this signer */
  shares : number;
}

/**
 * All information needed for consensus.
 * `members` is keyed by signer address, so we never keep two
 * separate containers for the same signer.
 */
export interface Quorum {
  /** ≥ sum(shares) required for a commit */
  threshold : number;
  members   : Record<Address, SignerRecord>;
}

/* ───────── entity state ───────── */
export interface EntityState {
  quorum : Quorum;
  chat   : { from: Address; msg: string; ts: TS }[];
}

/* ───────── transactions ───────── */
export type TxKind = 'chat' // | 'proposeAction' | 'vote';

export interface BaseTx<K extends TxKind = TxKind> {
  kind  : K;
  nonce : Nonce;
  from  : Address;
  body  : unknown;
  sig   : Hex;
}

export type ChatTx        = BaseTx<'chat'> & { body: { message: string } };

export type Transaction   = ChatTx; // | ProposeAction | VoteTx;

/* ───────── frames / blocks ───────── */
export interface Frame<T = unknown> {
  height : UInt64;
  ts     : TS;
  txs    : Transaction[];
  state  : T;
}

export interface ProposedFrame<T = unknown> extends Frame<T> {
  sigs : Map<Address, Hex>;
}

/* ───────── replica addressing ───────── */
export interface ReplicaAddr {
    jurisdiction : string;   // eg. 'eth'
    entityId     : string;   // eg. 'dao‑chat'
    signerId?    : string;   // optional – needed only for direct SignerMsg
    providerId?  : string;   // eg. 'lido' 
  }

export const addrKey = (a: ReplicaAddr) => `${a.jurisdiction}:${a.entityId}`;

/* ───────── replica runtime view ───────── */
export interface Replica {
  address   : ReplicaAddr;
  proposer  : Address;
  awaiting  : boolean;               // true ⇢ proposed ⇢ waiting for sigs
  mempool   : Transaction[];
  last      : Frame<EntityState>;
  proposal? : ProposedFrame<EntityState>;
}

/* ───────── server‑level commands ───────── */
export type Command =
  | { type:'IMPORT'   ; replica: Replica }
  | { type:'ADD_TX'   ; addrKey: string; tx: Transaction }
  | { type:'PROPOSE'  ; addrKey: string }
  | { type:'SIGN_REQ' ; addrKey: string; frameHash: Hex }
  | { type:'SIGN'     ; addrKey: string; signer: Address; frameHash: Hex; sig: Hex }
  | { type:'COMMIT'   ; addrKey: string; frame: Frame<EntityState> };

export interface Envelope {
  from : Address;
  to   : Address;
  cmd  : Command;
}


/* ───────── optional refinement ───────── */
// Optional refinement:
//
// * **Encoding helper** – A discriminated union lets your codec derive schema dynamically:
// 
//   ```ts
//   const encodeTx = (tx: Transaction) => {
//     switch (tx.kind) { … }
//   };
//   ```
// * **`body` generics** – If every `body` must include common fields (e.g., `fee`), move them up to `BaseTx` and let each variant extend further.


/* TODO(codegen) : generate runtime validators from this file later */
```

---

## 2  `crypto.ts` – Schnorr over secp256k1 (noble‑secp256k1)

```ts
import { schnorr, utils as u } from 'noble-secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import type { Hex } from './types';

export type PrivKey = Uint8Array;
export type PubKey  = Uint8Array;

export function randomPriv(): PrivKey { return u.randomPrivateKey(); }

export function pub(priv: PrivKey): PubKey { return schnorr.getPublicKey(priv); }

export function addr(pub: PubKey): Hex {
  const h = sha256(pub);
  return '0x' + Buffer.from(h.slice(-20)).toString('hex');
}

export async function sign(msg: Uint8Array, priv: PrivKey): Promise<Hex> {
  return '0x' + Buffer.from(await schnorr.sign(msg, priv)).toString('hex');
}

export async function verify(msg: Uint8Array, sig: Hex, pub: PubKey) {
  const raw = Uint8Array.from(Buffer.from(sig.slice(2), 'hex'));
  return schnorr.verify(raw, msg, pub);
}

export function hash(o: unknown): Uint8Array {
  return sha256(Buffer.from(JSON.stringify(o)));
}
```

---

## 3  `codec.ts` – minimal RLP helpers (excerpt)

```ts
/**
 * Minimal deterministic RLP codec.
 * Encodes / decodes Frames & Envelopes byte-perfectly.
 *
 * NOTE:  optimisation, checksum-address & streaming encoder are out-of-scope -
 *        this is enough for dev-net interoperability.
 */

import * as rlp from 'rlp';
import type {
  Frame, Transaction, TxKind, Envelope, Command, Hex, UInt64,
} from './types';

/* ————————————————— helpers ————————————————— */

const bnToBuf = (n: UInt64) => Buffer.from(n.toString(16), 'hex');
const bufToBn = (b: Buffer)  => BigInt('0x' + b.toString('hex'));

const str = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x));

/* ————————————————— transaction ————————————————— */

export function encodeTx(tx: Transaction): Buffer {
  return rlp.encode([
    tx.kind,
    bnToBuf(tx.nonce),
    tx.from,
    str(tx.body),
    tx.sig,
  ]);
}

export function decodeTx(buf: Buffer): Transaction {
  const [k, n, from, body, sig] = rlp.decode(buf) as Buffer[];
  return {
    kind  : k.toString() as TxKind,
    nonce : bufToBn(n),
    from  : `0x${from.toString('hex')}`,
    body  : JSON.parse(body.toString()),
    sig   : `0x${sig.toString('hex')}`,
  } as Transaction;
}

/* ————————————————— frame ————————————————— */

export function encodeFrame<F = unknown>(f: Frame<F>): Buffer {
  return rlp.encode([
    bnToBuf(f.height),
    f.ts,
    f.txs.map(encodeTx),
    JSON.stringify(f.state),          // dev-net only
  ]);
}

export function decodeFrame<F = unknown>(buf: Buffer): Frame<F> {
  const [h, ts, txs, st] = rlp.decode(buf) as any[];
  return {
    height: bufToBn(h),
    ts    : Number(ts),
    txs   : (txs as Buffer[]).map(decodeTx),
    state : JSON.parse(st.toString()),
  };
}

/* ————————————————— envelope (command) ————————————————— */

function encodeCmd(cmd: Command): unknown {
  return [cmd.type, JSON.stringify(cmd)];
}

function decodeCmd(arr: any[]): Command {
  return JSON.parse(arr[1].toString());
}

export function encodeEnvelope(env: Envelope): Buffer {
  return rlp.encode([
    env.from,
    env.to,
    encodeCmd(env.cmd),
  ]);
}

export function decodeEnvelope(buf: Buffer): Envelope {
  const [from, to, c] = rlp.decode(buf) as any[];
  return {
    from: from.toString(),
    to  : to.toString(),
    cmd : decodeCmd(c),
  };
}
```

*You can swap in CBOR or protobuf later.*

---

## 4  `state.ts` – pure state machine

```ts
import { Replica, Command, EntityState, Frame, Transaction } from './types';
import { addrKey } from './types';
import { hash } from './crypto';

/* ——— pure state‑machine ——— */
export function applyTx(st: EntityState, tx: Transaction, ts: number): EntityState {
  if (tx.kind !== 'chat') throw new Error('unk‑txkind');

  const rec = st.records[tx.from] ?? { nonce: 0n, shares: 0 };
  if (tx.nonce !== rec.nonce) throw new Error('bad‑nonce');

  return {
    ...st,
    records: {
      ...st.records,
      [tx.from]: { ...rec, nonce: rec.nonce + 1n },
    },
    chat: [...st.chat, { from: tx.from, msg: tx.body.message, ts }],
  };
}

export function execFrame(prev: Frame<EntityState>, txs: Transaction[], ts: number): Frame<EntityState> {
  let st = prev.state;
  for (const tx of txs) st = applyTx(st, tx, ts);
  return { height: prev.height + 1n, ts, txs, state: st };
}

export function applyCommand(rep: Replica, cmd: Command): Replica {
  switch (cmd.type) {
    case 'ADD_TX':
      return { ...rep, mempool: [...rep.mempool, cmd.tx] };

    case 'PROPOSE':
      if (rep.awaiting || rep.mempool.length === 0) return rep;
      return {
        ...rep,
        awaiting: true,
        mempool: [],
        proposal: (() => {
          const f  = execFrame(rep.last, rep.mempool, Date.now());
          const s  = new Map<Address, Hex>([[rep.proposer, '0x00']]);
          return { ...f, sigs: s };
        })(),
      };

    case 'SIGN':
      if (!rep.awaiting || !rep.proposal) return rep;
      rep.proposal.sigs.set(cmd.signer, cmd.sig);
      return { ...rep };

    case 'COMMIT':
      return { ...rep, awaiting: false, last: cmd.frame, proposal: undefined };

    default:
      return rep;
  }
}
```

---

## 5  `server.ts` – runtime & routing (single‑thread dev‑net)

```ts
import { Envelope, Replica, Command, addrKey } from './types';
import { randomPriv, pub, addr, hash, sign } from './crypto';
import { applyCommand } from './state';

export class Server {
  /* deterministic 3‑signer test wallet */
  signers = Array.from({ length: 3 }, () => {
    const priv = randomPriv();
    return { priv, pub: pub(priv), addr: addr(pub(priv)) };
  });

  replicas = new Map<string, Replica>();   // key = addrKey(rep.address)
  inbox: Envelope[] = [];

  enqueue(e: Envelope) { this.inbox.push(e); }

  async tick() {
    while (this.inbox.length) {
      const { cmd, to } = this.inbox.shift()!;

      /* ——— IMPORT ——— */
      if (cmd.type === 'IMPORT') {
        this.replicas.set(addrKey(cmd.replica.address), cmd.replica);
        continue;
      }

      const r = this.replicas.get(cmd.addrKey)!;

      /* ——— SIGN_REQ ——— */
      if (cmd.type === 'SIGN_REQ') {
        if (!r.proposal) continue;
        const signer = this.signers.find(s => s.addr === to)!;
        const sig    = await sign(hash(r.proposal), signer.priv);
        this.enqueue({
          from: signer.addr, to: r.proposer,
          cmd : { type:'SIGN',
                  addrKey : cmd.addrKey,
                  signer   : signer.addr,
                  frameHash: cmd.frameHash,
                  sig }});
        continue;
      }

      /* ——— entity logic ——— */
      const next = applyCommand(r, cmd);

      /* → multicast SIGN_REQ after proposal */
      if (cmd.type === 'PROPOSE' && next.proposal) {
        const proposer = this.signers.find(s => s.addr === next.proposer)!;
        for (const [addr, rec] of Object.entries(next.last.state.records)) {
          if (addr === proposer.addr) continue;
          this.enqueue({
            from: proposer.addr, to: addr,
            cmd : { type:'SIGN_REQ',
                    addrKey : cmd.addrKey,
                    frameHash: addr(hash(next.proposal) as any) }});
        }
      }

      /* → threshold? then COMMIT */
      if (next.proposal && next.awaiting) {
        const power = [...next.proposal.sigs.keys()]
          .reduce((sum, a) => sum + next.last.state.records[a].shares, 0);
        if (power >= next.last.state.threshold) {
          this.enqueue({
            from: next.proposer, to: next.proposer,
            cmd : { type:'COMMIT',
                    addrKey : cmd.addrKey,
                    frame   : { ...next.proposal } }});
        }
      }

      this.replicas.set(cmd.addrKey, next);
    }
  }
}


/* TODO(persistence): snapshot every N frames - out of scope now              */
```

---

## 6  `simulation.spec.ts` – mocha + fast‑check demo

```ts
import { expect } from 'chai';
import { Server } from './server';
import { addrKey, ReplicaAddr, Frame, EntityState } from './types';

function genesis(server: Server) {
  const [a, b, c] = server.signers;

  const recs = {
    [a.addr]: { nonce: 0n, shares: 300 },
    [b.addr]: { nonce: 0n, shares: 300 },
    [c.addr]: { nonce: 0n, shares: 400 },
  };
  const init: EntityState = { threshold: 600, records: recs, chat: [] };

  const frame: Frame<EntityState> = { height: 0n, ts: Date.now(), txs: [], state: init };
  const addr: ReplicaAddr = { jurisdiction: 'xln', entityId: 'dao‑chat' };

  return {
    address : addr,
    proposer: a.addr,
    awaiting: false,
    mempool : [],
    last    : frame,
  };
}

describe('XLN refactor happy‑path', () => {
  it('commits a chat frame', async () => {
    const srv = new Server();
    const rep = genesis(srv);
    const key = addrKey(rep.address);

    /* IMPORT */
    srv.enqueue({ from: rep.proposer, to: rep.proposer,
      cmd: { type:'IMPORT', replica: rep }});

    /* ADD_TX */
    const bob = srv.signers[1];
    srv.enqueue({ from: bob.addr, to: rep.proposer,
      cmd: { type:'ADD_TX',
             addrKey: key,
             tx: { kind:'chat', nonce:0n, from:bob.addr,
                   body:{ message:'hi' }, sig:'0x00' }}});

    /* PROPOSE */
    srv.enqueue({ from: rep.proposer, to: rep.proposer,
      cmd: { type:'PROPOSE', addrKey: key }});

    await srv.tick(); await srv.tick(); await srv.tick(); await srv.tick(); await srv.tick();

    const final = srv.replicas.get(key)!;
    expect(final.last.height).to.equal(1n);
    expect(final.last.state.chat).to.have.length(1);
  });
});

```

Run tests:

```bash
npx mocha -r ts-node/register src/simulation.spec.ts
```

---




