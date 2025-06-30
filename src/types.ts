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

