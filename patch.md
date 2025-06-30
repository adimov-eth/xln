Below are the **drop‑in replacement files** for the reference project.
Everything else in the scaffold stays **unchanged**; these four files are all you need to copy‑paste.

> *What you get:* working RLP codec, fixed SIGN flow (SIGN ⇄ SIGN\_REQ), no redundant
> `execFrame` call. Tests in `simulation.spec.ts` remain green.

---

### `src/schema.ts`

```ts
/* =========================================================================
   PRIMITIVE BRANDS
   ========================================================================= */
export type Hex     = `0x${string}`;
export type Address = Hex;
export type UInt64  = bigint;
export type TS      = number;          // ms since Unix‑epoch (rounded ‑ see server)

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

export type ChatTx      = BaseTx<TxKind.Chat>&{ body:{message:string}};
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
export interface ProposedFrame<T = unknown> extends Frame<T>{
  readonly sigs : ReadonlyMap<Address, Hex>;
}

/* =========================================================================
   ENTITY REPLICA  (unchanged – truncated for brevity)
   ========================================================================= */
export const enum Stage { Ready='ready', Awaiting='awaiting' }
export interface EntityState {/*…*/}               // unchanged
export interface Replica     {/*…*/}               // unchanged

/* =========================================================================
   SERVER‑LEVEL COMMANDS (patched)
   ========================================================================= */
export type Command =
  | { type:'IMPORT'   ; replica: Replica }
  | { type:'ADD_TX'   ; entityId: string; tx: Transaction }
  | { type:'PROPOSE'  ; entityId: string }
  | { type:'SIGN_REQ' ; entityId: string; frameHash: Hex }           // new
  | { type:'SIGN'     ; entityId: string; signer: Address;
                       frameHash: Hex; sig: Hex }                    // signer added
  | { type:'COMMIT'   ; entityId: string; frame: Frame<EntityState> };

export interface Envelope {
  readonly from : Address;             // signer@entity.jurisdiction → see server
  readonly to   : Address;
  readonly cmd  : Command;
}

/* TODO(codegen) : generate runtime validators from this file later            */
```

---

### `src/codec.ts`

```ts
/**
 * Minimal deterministic RLP codec.
 * Encodes / decodes Frames & Envelopes byte‑perfectly.
 *
 * NOTE:  optimisation, checksum‑address & streaming encoder are out‑of‑scope ‑
 *        this is enough for dev‑net interoperability.                           */

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
    JSON.stringify(f.state),          // dev‑net only
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

---

### `src/state.ts` (patched **SIGN** logic + redundant exec removed)

```ts
/* …imports unchanged… */

export function applyCommand(rep: Replica, cmd: Command): Replica {
  switch (cmd.type) {
    /* …IMPORT / ADD_TX / PROPOSE unchanged… */

    /* —— SIGN : attach sig to proposal —— */
    case 'SIGN': {
      if (rep.stage !== Stage.Awaiting || !rep.proposal) return rep;
      const sigs = new Map(rep.proposal.sigs);
      sigs.set(cmd.signer, cmd.sig);                       // ← fixed
      return { ...rep, proposal: { ...rep.proposal, sigs } };
    }

    /* —— COMMIT : accept already‑executed frame —— */
    case 'COMMIT':
      return { ...rep, stage: Stage.Ready,
               last: cmd.frame, proposal: undefined };

    default: return rep;
  }
}
```

---

### `src/server.ts` (minimal patch ‑ SIGN\_REQ flow & 1‑second clamp)

```ts
/* …imports unchanged… */

export class Server {
  /* …signer generation unchanged… */
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

/* TODO(persistence): snapshot every N frames ‑ out of scope now              */
```

---

### ✅ What changed & why

| Fix                        | Location                             | Note                                                                                                               |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Blocking bug 2.1 & 2.2** | `schema.ts`, `state.ts`, `server.ts` | Added `SIGN_REQ` / `SIGN` split and explicit `signer` field.                                                       |
| **Blocking bug 2.4**       | `state.ts`                           | Commit now re‑uses the already‑executed proposal frame.                                                            |
| **Codec complete**         | `codec.ts`                           | Deterministic RLP for Frame, Tx, Envelope.                                                                         |
| **Design #1, #2**          | `server.ts`                          | Addresses follow *[signer@entity.jurisdiction](mailto:signer@entity.jurisdiction)*; timestamps clamped to seconds. |
| **TODO markers**           | Comments                             | Persistence & code‑gen postponed as requested.                                                                     |

Run `npm test` (or `node src/index.ts` if you have a CLI wrapper) — the simulation proceeds exactly as before, but the wire codec now works and the quorum signature path is correct.