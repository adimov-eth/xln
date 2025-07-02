
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




## 2  `state.ts` – pure state machine

```ts
import { Replica, Command, EntityState, Frame, Transaction } from './types';
import { addrKey } from './types';
import { hash } from './crypto';

/** 
 * Apply a single transaction to the EntityState.
 * Enforces per-signer nonces, updates nonce inside quorum.members,
 * and appends to chat.
 */
export function applyTx(
  st: EntityState,
  tx: Transaction,
  ts: number
): EntityState {
  if (tx.kind !== 'chat') throw new Error('unknown tx kind');

  const rec = st.quorum.members[tx.from];
  if (!rec) throw new Error(`unknown signer: ${tx.from}`);
  if (tx.nonce !== rec.nonce) throw new Error('bad nonce');

  // bump signer nonce, leave shares unchanged
  const newMembers = {
    ...st.quorum.members,
    [tx.from]: { nonce: rec.nonce + 1n, shares: rec.shares }
  };

  return {
    quorum: { ...st.quorum, members: newMembers },
    chat  : [...st.chat, { from: tx.from, msg: tx.body.message, ts }]
  };
}

/**
 * Execute a batch of transactions as a new Frame.
 */
export function execFrame(
  prev: Frame<EntityState>,
  txs: Transaction[],
  ts: number
): Frame<EntityState> {
  let state = prev.state;
  for (const tx of txs) {
    state = applyTx(state, tx, ts);
  }
  return { height: prev.height + 1n, ts, txs, state };
}

/**
 * Apply a server-level command to a Replica.
 * Manages ADD_TX, PROPOSE, SIGN, COMMIT flows.
 */
export function applyCommand(rep: Replica, cmd: Command): Replica {
  switch (cmd.type) {
    case 'ADD_TX':
      return { ...rep, mempool: [...rep.mempool, cmd.tx] };

    case 'PROPOSE':
      // only proposer can propose, and only if not already awaiting
      if (rep.awaiting || rep.mempool.length === 0) return rep;
      const frame = execFrame(rep.last, rep.mempool, Date.now());
      return {
        ...rep,
        awaiting : true,
        mempool  : [],
        proposal : { ...frame, sigs: new Map([[rep.proposer, '0x00']]) }
      };

    case 'SIGN':
      // other signers add their signature
      if (!rep.awaiting || !rep.proposal) return rep;
      rep.proposal.sigs.set(cmd.signer, cmd.sig);
      return { ...rep };

    case 'COMMIT':
      // once threshold reached, commit the frame
      return {
        ...rep,
        awaiting : false,
        last     : cmd.frame,
        proposal : undefined
      };

    default:
      return rep;
  }
}

```

---

## 3  `server.ts` – runtime & routing (single‑thread dev‑net)

```ts
import { Envelope, Replica, Command, addrKey, Quorum } from './types';
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
        for (const [addr, rec] of Object.entries(next.last.state.quorum.members)) {
          if (addr === proposer.addr) continue;
          this.enqueue({
            from: proposer.addr, to: addr,
            cmd : { type:'SIGN_REQ',
                    addrKey : cmd.addrKey,
                    frameHash: '0x' + hash(next.proposal).toString('hex') }});
        }
      }

      /* → threshold? then COMMIT */
      if (next.proposal && next.awaiting) {
        const quorum = next.last.state.quorum;
        
        // Power of the replica *before* this command was applied
        const oldPower = r.proposal
          ? [...r.proposal.sigs.keys()].reduce((sum, a) => sum + (quorum.members[a]?.shares ?? 0), 0)
          : 0;
        
        // Power of the replica *after* this command was applied
        const newPower = [...next.proposal.sigs.keys()]
          .reduce((sum, a) => sum + (quorum.members[a]?.shares ?? 0), 0);
        
        // If the threshold was just crossed, multicast COMMIT to all members.
        // This prevents re-committing if more signatures arrive later.
        if (oldPower < quorum.threshold && newPower >= quorum.threshold) {
          const committedFrame = { ...next.proposal };
          delete (committedFrame as any).sigs; // Sigs are not part of the final frame

          for (const memberAddress of Object.keys(quorum.members)) {
            this.enqueue({
              from: next.proposer,
              to: memberAddress,
              cmd: {
                type: 'COMMIT',
                addrKey: cmd.addrKey,
                frame: committedFrame
              }
            });
          }
        }
      }

      this.replicas.set(cmd.addrKey, next);
    }
  }
}


/* TODO(persistence): snapshot every N frames - out of scope now              */
```

---

## 4  `simulation.spec.ts` – mocha + fast‑check demo

```ts
import { expect } from 'chai';
import { Server }      from './server';
import { addrKey,
         ReplicaAddr,
         Frame,
         EntityState,
         SignerRecord,
         Quorum,
         Transaction,
         Replica }  from './types';

// build a deterministic genesis Replica
export function genesis(srv: Server): Replica {
  const [A, B, C] = srv.signers;

  // initial signer records
  const members: Record<string, SignerRecord> = {
    [A.addr]: { nonce: 0n, shares: 300 },
    [B.addr]: { nonce: 0n, shares: 300 },
    [C.addr]: { nonce: 0n, shares: 400 },
  };
  const quorum: Quorum = { threshold: 600, members };

  const initState: EntityState = { quorum, chat: [] };
  const frame: Frame<EntityState> =
    { height: 0n, ts: Date.now(), txs: [], state: initState };

  const addr: ReplicaAddr = { jurisdiction: 'xln', entityId: 'dao-chat' };

  return {
    address : addr,
    proposer: A.addr,
    awaiting: false,
    mempool : [],
    last    : frame
  };
}

describe('XLN signer-record inside entity', () => {
  it('commits a single chat message', async () => {
    const srv = new Server();
    const rep = genesis(srv);
    const key = addrKey(rep.address);

    // IMPORT the replica
    srv.enqueue({ from: rep.proposer, to: rep.proposer,
      cmd: { type: 'IMPORT', replica: rep }
    });

    // ADD_TX by B
    const B = srv.signers[1];
    const tx: Transaction = {
      kind : 'chat', // FIX: 'TxKind.Chat' is not a value, 'chat' is the correct literal
      nonce: 0n,
      from : B.addr,
      body : { message: 'hello XLN' },
      sig  : '0x00' // signature verification is out of scope for this test
    };
    srv.enqueue({ from: B.addr, to: rep.proposer,
      cmd: { type: 'ADD_TX', addrKey: key, tx }
    });

    // PROPOSE by proposer
    srv.enqueue({ from: rep.proposer, to: rep.proposer,
      cmd: { type: 'PROPOSE', addrKey: key }
    });

    // The server's tick() method processes the entire inbox, including
    // messages that are enqueued during the current tick.
    // Therefore, one call is sufficient to run the full cycle.
    await srv.tick();

    const final = srv.replicas.get(key)!;
    expect(final.last.height).to.equal(1n);
    expect(final.last.state.chat).to.have.length(1);
    expect(final.last.state.chat[0].msg).to.equal('hello XLN');
    
    // Verify that all replicas have committed the frame and are no longer awaiting
    srv.replicas.forEach(replica => {
      expect(replica.last.height).to.equal(1n);
      expect(replica.awaiting).to.be.false;
      expect(replica.proposal).to.be.undefined;
    });
  });
});

```

Run tests:

```bash
npx mocha -r ts-node/register src/simulation.spec.ts
```



## 5  `crypto.ts` – Schnorr over secp256k1 (noble‑secp256k1)

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

## 6  `codec.ts` – minimal RLP helpers (excerpt)

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
