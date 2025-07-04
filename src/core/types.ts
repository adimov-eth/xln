/* XLN – canonical domain model  v1.4.1‑RC3 */

export type Big = bigint
export type Address = `0x${string}`
export type SignerIdx = number

/* ---------- generic helpers ---------- */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E }

/* ---------- consensus objects ---------- */
export type EntityTx = {
  kind: string
  data: unknown
  nonce: Big
  sig: string // signer = sig.slice(0,42)
}

export type Quorum = {
  threshold: Big
  members: { address: Address; shares: Big; pubKey?: Uint8Array }[]
}

export type EntityState = {
  height: Big
  quorum: Quorum
  signerRecords: Record<Address, { nonce: Big }>
  domainState: unknown
  mempool: EntityTx[]
  proposal?: { frame: Frame; sigs: Record<Address, string> }
}

export type FrameHeader = {
  height: Big
  timestamp: Big
  prevStateRoot: Uint8Array
}

export type Frame = FrameHeader & {
  txs: EntityTx[] // sorted, deterministic
  postStateRoot: Uint8Array
}

export type Replica = { attached: boolean; state: EntityState }

export type ServerState = Map<`${SignerIdx}:${string}`, Replica>

export type ServerFrame = {
  height: Big
  timestamp: Big
  root: Uint8Array // Merkle‑root of replicas
  inputsRoot: Uint8Array // Merkle‑root of Input[]
  batch: Input[]
}

/* ---------- commands & driver input ---------- */
export type Command =
  | { type: 'addTx'; tx: EntityTx }
  | { type: 'proposeFrame'; header: FrameHeader } // NEW header field
  | { type: 'signFrame'; sig: string }
  | { type: 'commitFrame'; frame: Frame; hanko: string }
  | { type: 'attachReplica'; snapshot: EntityState }
  | { type: 'detachReplica' }

export type Input = [SignerIdx, string, Command] // signerIndex : entityId
