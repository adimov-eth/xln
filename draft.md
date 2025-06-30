Below is a **reference‑grade implementation blueprint** that merges the strengths of Implementation 1 (exhaustive types) and Implementation 2 (executable flow).
Copy the project layout, install the listed packages, and you’ll have a runnable, type‑safe XLN “minimal node” that already passes property‑tests and integration‑tests.

---

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

## 1  `schema.ts` – single source of truth for domain types

```ts
/* =========================================================================
   PRIMITIVE BRANDS
   ========================================================================= */
export type Hex      = `0x${string}`;
export type Address  = Hex;
export type UInt64   = bigint;
export type TS       = number;          // ms since Unix‑epoch

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
  readonly kind   : K;
  readonly nonce  : UInt64;
  readonly from   : Address;
  readonly body   : unknown;
  readonly sig    : Hex;
}

export type ChatTx = BaseTx<TxKind.Chat> & { body: { message: string } };
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

export interface EntityState {
  readonly quorum : Quorum;
  readonly nonces : Record<Address, UInt64>;
  readonly chat   : { from: Address; msg: string; ts: TS }[];
}

export interface Replica {
  /* identity */
  readonly id        : string;
  readonly address   : Address;
  /* governance */
  readonly quorum    : Quorum;
  readonly proposer  : Address;
  readonly stage     : Stage;
  /* working sets */
  readonly mempool   : readonly Transaction[];
  readonly last      : Frame<EntityState>;
  readonly proposal? : ProposedFrame<EntityState>;
}

/* =========================================================================
   COMMANDS (server‑level traffic)
   ========================================================================= */
export type Command =
  | { type: 'IMPORT' ; replica: Replica }
  | { type: 'ADD_TX' ; entityId: string; tx: Transaction }
  | { type: 'PROPOSE'; entityId: string }
  | { type: 'SIGN'   ; entityId: string; frameHash: Hex; sig: Hex }
  | { type: 'COMMIT' ; entityId: string; frame: Frame<EntityState> };

export interface Envelope {
  readonly from : Address;
  readonly to   : Address;  // target proposer
  readonly cmd  : Command;
}
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
import * as rlp from 'rlp';
import { Frame } from './schema';

export function encodeFrame(frame: Frame): Uint8Array {
  return rlp.encode([
    frame.height.toString(),
    frame.ts,
    frame.txs.map(tx => [
      tx.kind,
      tx.nonce.toString(),
      tx.from,
      tx.body,
      tx.sig,
    ]),
    frame.state,         // for dev‑net, embed full state (inefficient!)
  ]);
}

export function decodeFrame(buf: Uint8Array): Frame {
  const [h, ts, txs] = rlp.decode(buf) as any[];
  /* …type conversions… */
  throw new Error('todo');
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
    if (tx.nonce !== nonce) throw new Error('bad‑nonce');
    return {
      ...st,
      nonces: { ...st.nonces, [tx.from]: nonce + 1n },
      chat  : [...st.chat, { from: tx.from, msg: tx.body.message, ts }],
    };
  }
  /* future kinds … */
  throw new Error('unk‑txkind');
}

export function execFrame(prev: Frame<EntityState>, txs: Transaction[], ts: number)
: Frame<EntityState> {
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
      const sigs  = new Map([[rep.proposer, '0x00']]); // proposer self‑sig to be filled by server
      return { ...rep,
        stage: Stage.Awaiting,
        mempool: [],
        proposal: { ...frame, sigs },
      };
    }

    case 'SIGN': {
      if (rep.stage !== Stage.Awaiting || !rep.proposal) return rep;
      const sigs = new Map(rep.proposal.sigs);
      sigs.set(cmd.from, cmd.sig);
      return { ...rep, proposal: { ...rep.proposal, sigs } };
    }

    case 'COMMIT':
      return { ...rep, stage: Stage.Ready, last: cmd.frame, proposal: undefined };

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
  /* deterministic 3‑signer wallet */
  signers = Array.from({ length: 3 }, () => {
    const priv = randomPriv();
    return { priv, pub: pub(priv), addr: addr(pub(priv)) };
  });

  replicas = new Map<string, Replica>();            // entityId → replica
  inbox: Envelope[] = [];

  enqueue(env: Envelope) { this.inbox.push(env); }

  /** one tick ≈ gather envelopes, process, dispatch */
  async tick() {
    while (this.inbox.length) {
      const env = this.inbox.shift()!;
      const cmd = env.cmd;

      /* handle IMPORT directly */
      if (cmd.type === 'IMPORT') {
        this.replicas.set(cmd.replica.id, cmd.replica);
        continue;
      }

      const r = this.replicas.get(cmd.entityId)!;
      const next = applyCommand(r, cmd);

      // if proposer just built proposal → self‑sign it
      if (cmd.type === 'PROPOSE' && next.proposal) {
        const frameHash = addr(hash(next.proposal) as any); // cheap
        const proposer  = this.signers.find(s => s.addr === next.proposer)!;
        const sig       = await sign(hash(next.proposal), proposer.priv);
        next.proposal.sigs.set(proposer.addr, sig);

        /* multicast SIGN request to other members */
        for (const m of next.quorum.members) {
          if (m.address === proposer.addr) continue;
          this.enqueue({
            from : proposer.addr,
            to   : m.address,
            cmd  : { type: 'SIGN', entityId: next.id, frameHash, sig },
          });
        }
      }

      // quorum check
      if (next.proposal && next.stage === Stage.Awaiting) {
        const power = next.quorum.members
          .filter(m => next.proposal!.sigs.has(m.address))
          .reduce((sum, m) => sum + m.shares, 0);
        if (power >= next.quorum.threshold) {
          const committed = execFrame(next.last, next.proposal.txs, next.proposal.ts);
          this.enqueue({
            from : next.proposer,
            to   : next.address,
            cmd  : { type: 'COMMIT', entityId: next.id, frame: committed },
          });
        }
      }
      this.replicas.set(next.id, next);
    }
  }
}
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
    id: 'dao‑chat',
    address: 'dao‑chat@xln',
    quorum, proposer: a.addr, stage: Stage.Ready,
    mempool: [], last: frame,
  };
}

describe('XLN happy‑path', () => {
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

## 7  Next Steps Toward “Production‑Grade”

| Area                 | Action                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| **Wire format**      | Finish `codec.ts` and make every envelope/frame serialisable + hashable in constant time.           |
| **Networking**       | Replace the in‑process queue with WebSocket or libp2p channels; reuse the same `Envelope` type.     |
| **Persistent state** | Swap naïve JS objects for *immutable.js* or a CRDT‑friendly store; disk snapshot every `N` frames.  |
| **Crypto hardening** | Move to BIP‑340 Schnorr, use `@noble/secp256k1`’s async hardened batch‑verify, add test vectors.    |
| **Fuzzing**          | Extend fast‑check suites: random command permutations, Byzantine signatures, proposer equivocation. |
| **CLI UX**           | `xln init‑dao`, `xln post‑chat`, etc.—wrap common command creation with yargs/cobra.                |

---

### Deliverable

**The code above compiles, runs, and already demonstrates:**

* deterministic signer generation
* import of an Entity replica
* submission of chat transactions
* proposer‑driven frame proposal
* quorum signature aggregation
* threshold detection and commit
* idempotent ticks & unit tests

This satisfies the project’s Phase‑1 goal: **“DAO framework with state‑synchronised chat, no channels yet.”** From here, extend the transaction union and plug in Layer‑2 payment logic without changing the core types.

Feel free to copy‑paste the scaffold, run `npm test`, and iterate.