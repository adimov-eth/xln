export type Big = bigint
export type Address = `0x${string}`
export type SignerIdx = number
export type Command =
  | { type: 'addTx'; tx: EntityTx }
  | { type: 'proposeFrame' }
  | { type: 'signFrame'; sig: string }
  | { type: 'commitFrame'; frame: Frame; hanko: string }
  | { type: 'attachReplica'; snapshot: EntityState }
  | { type: 'detachReplica' }
export type Input = [SignerIdx, string, Command]
export type EntityTx = { kind: string; data: unknown; nonce: Big; sig: string }
export type Quorum = { threshold: Big; members: { address: Address; shares: Big }[] }
export type EntityState = {
  height: Big
  quorum: Quorum
  signerRecords: Record<Address, { nonce: Big }>
  domainState: unknown
  mempool: EntityTx[]
  proposal?: { frame: Frame; sigs: Record<Address, string> }
}
export type Frame = {
  height: Big
  timestamp: Big
  txs: EntityTx[]
  postState: EntityState
}
export type Replica = { attached: boolean; state: EntityState }
export type ServerState = Map<`${SignerIdx}:${string}`, Replica>
