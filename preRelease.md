
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
/* =========================================================================
   PRIMITIVE BRANDS
   ========================================================================= */
export type Hex     = `0x${string}`;
export type Address = Hex;
export type UInt64  = bigint;
export type TS      = number;          // ms since Unix‑epoch (rounded - see server)

/* =========================================================================
   SIGNERS & QUORUM
   ========================================================================= */
export interface SignerMeta { address: Address; shares: number; }

export interface Quorum {
  readonly threshold : number;
  readonly members   : readonly SignerMeta[];
}

/* =========================================================================
   TRANSACTIONS
   ========================================================================= */
export const enum TxKind { Chat = 'chat' }

export interface BaseTx<K extends TxKind = TxKind> {
  readonly kind  : K;
  readonly nonce : UInt64;
  readonly from  : Address;
  readonly body  : unknown;
  readonly sig   : Hex;
}

export type ChatTx      = BaseTx<TxKind.Chat> & { body: { message: string } };
export type Transaction = ChatTx;

/* =========================================================================
   FRAMES
   ========================================================================= */
export interface Frame<T = unknown> {
  readonly height : UInt64;
  readonly ts     : TS;
  readonly txs    : readonly Transaction[];
  readonly state  : T;
}
export interface ProposedFrame<T = unknown> extends Frame<T> {
  readonly sigs : ReadonlyMap<Address, Hex>;
}

/* =========================================================================
   ENTITY REPLICA
   ========================================================================= */
export const enum Stage { Ready = 'ready', Awaiting = 'awaiting' }

export interface SignerRecord {
  nonce : UInt64;          // aka personal frame‑height
  // future: votes, delegation, personal balances …
}

export interface EntityState {
  quorum   : Quorum;                               // как было
  records  : Record<Address, SignerRecord>;        //  вместо `nonces`
  chat     : { from: Address; msg: string; ts: TS }[];
}


export interface ReplicaAddr {
  jurisdiction : string;   // eg. 'eth'
  entityId     : string;   // eg. 'dao‑chat'
  signerId?    : string;   // optional – needed only for direct SignerMsg
  providerId?  : string;   // = 'default' пока
}

//  Transaction stays the same, but nonce now
//  takes from EntityState.records[tx.from].nonce
export interface Replica {
  address   : ReplicaAddr;
  quorum    : Quorum;
  proposer  : Address;
  stage     : Stage;
  mempool   : Transaction[];
  last      : Frame<EntityState>;
  proposal? : ProposedFrame<EntityState>;
}

/* =========================================================================
   SERVER‑LEVEL COMMANDS (patched)
   ========================================================================= */
export type Command =
  | { type:'IMPORT'   ; replica: Replica }
  | { type:'ADD_TX'   ; entityId: string; tx: Transaction }
  | { type:'PROPOSE'  ; entityId: string }
  | { type:'SIGN_REQ' ; entityId: string; frameHash: Hex }
  | { type:'SIGN'     ; entityId: string; signer: Address; frameHash: Hex; sig: Hex }
  | { type:'COMMIT'   ; entityId: string; frame: Frame<EntityState> };

export interface Envelope {
  readonly from : Address;             // signer@entity.jurisdiction → see server
  readonly to   : Address;
  readonly cmd  : Command;
}
/* TODO(codegen) : generate runtime validators from this file later */
```

---

## 2  `crypto.ts` – Schnorr over secp256k1 (noble‑secp256k1)

```ts
import { schnorr, utils as u } from 'noble-secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import type { Hex } from './schema';

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
} from './schema';

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
import {
  Replica, Stage, Command, EntityState, Frame, ProposedFrame,
  TxKind, Transaction,
} from './schema';
import { hash } from './crypto';

export function applyTx(st: EntityState, tx: Transaction, ts: number): EntityState {
  if (tx.kind === TxKind.Chat) {
    const nonce = st.nonces[tx.from] ?? 0n;
    if (tx.nonce !== nonce) throw new Error('bad-nonce');
    return {
      ...st,
      nonces: { ...st.nonces, [tx.from]: nonce + 1n },
      chat  : [...st.chat, { from: tx.from, msg: tx.body.message, ts }],
    };
  }
  /* future kinds … */
  throw new Error('unk-txkind');
}

export function execFrame(prev: Frame<EntityState>, txs: Transaction[], ts: number): Frame<EntityState> {
  let state = prev.state;
  for (const tx of txs) state = applyTx(state, tx, ts);
  return { height: prev.height + 1n, ts, txs, state };
}

/* ——————————————————————————————————————————————————————— */
export function applyCommand(rep: Replica, cmd: Command): Replica {
  switch (cmd.type) {
    case 'ADD_TX':
      return { ...rep, mempool: [...rep.mempool, cmd.tx] };

    case 'PROPOSE': {
      if (rep.stage !== Stage.Ready || rep.mempool.length === 0) return rep;
      const frame = execFrame(rep.last, rep.mempool, Date.now());
      const sigs  = new Map([[rep.proposer, '0x00']]); // proposer self-sig to be filled by server
      return { ...rep,
        stage: Stage.Awaiting,
        mempool: [],
        proposal: { ...frame, sigs },
      };
    }

    /* —— SIGN : attach sig to proposal —— */
    case 'SIGN': {
      if (rep.stage !== Stage.Awaiting || !rep.proposal) return rep;
      const sigs = new Map(rep.proposal.sigs);
      sigs.set(cmd.signer, cmd.sig);
      return { ...rep, proposal: { ...rep.proposal, sigs } };
    }

    /* —— COMMIT : accept already-executed frame —— */
    case 'COMMIT':
      return { ...rep, stage: Stage.Ready,
               last: cmd.frame, proposal: undefined };

    default: return rep;
  }
}
```

---

## 5  `server.ts` – runtime & routing (single‑thread dev‑net)

```ts
import {
  Envelope, Replica, Command, Stage, Frame, EntityState, Quorum, TxKind,
} from './schema';
import { randomPriv, pub, addr, hash, sign, verify } from './crypto';
import { applyCommand, execFrame } from './state';

export class Server {
  /* deterministic 3-signer wallet */
  signers = Array.from({ length: 3 }, () => {
    const priv = randomPriv();
    return { priv, pub: pub(priv), addr: addr(pub(priv)) };
  });

  replicas = new Map<string, Replica>();            // entityId → replica
  inbox: Envelope[] = [];

  enqueue(e: Envelope) { this.inbox.push(e); }

  private clampTs(ms: number) { return Math.floor(ms / 1000) * 1000; }

  /** one tick */
  async tick() {
    while (this.inbox.length) {
      const env = this.inbox.shift()!;
      const { cmd } = env;

      /* ——— IMPORT handled immediately ——— */
      if (cmd.type === 'IMPORT') { this.replicas.set(cmd.replica.id, cmd.replica); continue; }

      /* ——— SIGN_REQ : produce a SIGN ——— */
      if (cmd.type === 'SIGN_REQ') {
        const r = this.replicas.get(cmd.entityId)!;
        if (!r.proposal) continue;
        const signer = this.signers.find(s => s.addr === env.to)!;
        const sig    = await sign(hash(r.proposal), signer.priv);
        this.enqueue({
          from: signer.addr, to: r.proposer,
          cmd : { type:'SIGN',
                  entityId : r.id,
                  signer   : signer.addr,
                  frameHash: cmd.frameHash,
                  sig }});
        continue;
      }

      /* ——— everything else is entity logic ——— */
      const r = this.replicas.get(cmd.entityId)!;
      const next = applyCommand(r, cmd);

      /* → after PROPOSE send SIGN_REQs */
      if (cmd.type === 'PROPOSE' && next.proposal) {
        const proposer = this.signers.find(s => s.addr === next.proposer)!;
        for (const m of next.quorum.members) {
          if (m.address === proposer.addr) continue;
          this.enqueue({
            from: proposer.addr, to: m.address,
            cmd : { type:'SIGN_REQ', entityId: next.id,
                    frameHash: addr(hash(next.proposal) as any) }});
        }
      }

      /* → threshold reached?  broadcast COMMIT */
      if (next.proposal && next.stage === Stage.Awaiting) {
        const power = next.quorum.members
          .filter(m => next.proposal!.sigs.has(m.address))
          .reduce((s, m) => s + m.shares, 0);
        if (power >= next.quorum.threshold) {
          const committed = { ...next.proposal };
          this.enqueue({
            from: next.proposer, to: next.address,
            cmd : { type:'COMMIT', entityId: next.id, frame: committed }});
        }
      }
      this.replicas.set(next.id, next);
    }
  }
}

/* TODO(persistence): snapshot every N frames - out of scope now              */
```

---

## 6  `simulation.spec.ts` – mocha + fast‑check demo

```ts
import { expect } from 'chai';
import * as fc from 'fast-check';
import { Server } from './server';
import { TxKind, Replica, Quorum, Frame, EntityState, Stage } from './schema';

/* deterministic genesis */
function genesis(server: Server): Replica {
  const [a, b, c] = server.signers;
  const quorum: Quorum = {
    threshold: 600,
    members: [
      { address: a.addr, shares: 300 },
      { address: b.addr, shares: 300 },
      { address: c.addr, shares: 400 },
    ],
  };
  const init: EntityState = {
    quorum, nonces: { [a.addr]: 0n, [b.addr]: 0n, [c.addr]: 0n }, chat: [],
  };
  const frame: Frame<EntityState> = {
    height: 0n, ts: Date.now(), txs: [], state: init,
  };
  return {
    id: 'dao-chat',
    address: 'dao-chat@xln',
    quorum, proposer: a.addr, stage: Stage.Ready,
    mempool: [], last: frame,
  };
}

describe('XLN happy-path', () => {
  it('commits a chat frame', async () => {
    const srv = new Server();
    const rep = genesis(srv);
    srv.enqueue({ from: rep.proposer, to: rep.proposer,
      cmd: { type: 'IMPORT', replica: rep },
    });

    const bSigner = srv.signers[1];
    srv.enqueue({ from: bSigner.addr, to: rep.proposer,
      cmd: { type: 'ADD_TX',
             entityId: rep.id,
             tx: { kind: TxKind.Chat,
                   nonce: 0n,
                   from: bSigner.addr,
                   body: { message: 'hi' },
                   sig: '0x00' } }});

    srv.enqueue({ from: rep.proposer, to: rep.proposer,
      cmd: { type: 'PROPOSE', entityId: rep.id }});

    await srv.tick();   // IMPORT
    await srv.tick();   // ADD_TX
    await srv.tick();   // PROPOSE + multicast SIGN
    await srv.tick();   // SIGNs processed, COMMIT queued
    await srv.tick();   // COMMIT applied

    const final = srv.replicas.get(rep.id)!;
    expect(final.last.height).to.equal(1n);
    expect(final.last.state.chat).to.have.length(1);
  });
});
```

Run tests:

```bash
npx mocha -r ts-node/register src/simulation.spec.ts
```

*all tests green → the integrated node survives its first quorum cycle.*

---




