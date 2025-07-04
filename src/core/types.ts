export type Address = `0x${string}`
export type SignerIdx = number
export type Command =
  | { type: 'addTx'; tx: EntityTx }
  | { type: 'proposeFrame'; header: FrameHeader } // A2: now carries FrameHeader
  | { type: 'signFrame'; sig: string }
  | { type: 'commitFrame'; frame: Frame; hanko: string }
  | { type: 'attachReplica'; snapshot: EntityState }
  | { type: 'detachReplica' }
export type Input = [SignerIdx, string, Command]
export type EntityTx = { kind: string; data: unknown; nonce: bigint; sig: string }
export type Quorum = { threshold: bigint; members: { address: Address; shares: bigint }[] }
export type EntityState = {
  height: bigint
  quorum: Quorum
  signerRecords: Record<Address, { nonce: bigint }>
  domainState: unknown
  mempool: EntityTx[]
  proposal?: { header: FrameHeader; sigs: Record<Address, string> }
}
export interface FrameHeader {
  entityId: string
  height: bigint
  memRoot: string // Merkle root of *sorted* tx list (see §5 Y-2 rule)
  prevStateRoot: string
  proposer: string // signerId that built the frame
}

export type Frame = {
  height: bigint
  timestamp: bigint
  header: FrameHeader // static fields hashed for propose/sign
  txs: EntityTx[]
  postStateRoot: string // keccak256 of EntityState after txs (was postState)
}
export type Replica = { attached: boolean; state: EntityState }
export type ServerState = Map<`${SignerIdx}:${string}`, Replica>

// Server Frame (global timeline) - Added per v1.4.1-RC2 spec
export interface ServerFrame {
  frameId: number
  timestamp: bigint
  root: string // Merkle root of replica state hashes
  inputsRoot: string // Merkle root of RLP(ServerInput)
}

// Server-level types for v1.4.1-RC2
export interface ServerInput {
  inputId: string // UID for the batch
  frameId: number // monotone tick counter
  timestamp: bigint // unix-ms
  metaTxs: ServerMetaTx[] // network-wide cmds (renamed per Y-1)
  entityInputs: EntityInput[] // per-entity signed inputs
}

export interface ServerMetaTx {
  // was ServerTx
  type: 'importEntity'
  entityId: string
  data: unknown // snapshot / metadata
}

export interface EntityInput {
  jurisdictionId: string // format chainId:contractAddr
  signerId: string // BLS public key (hex)
  entityId: string
  quorumProof: {
    quorumHash: string
    quorumStructure: string // reserved – must be '0x' until Phase 3
  }
  entityTxs: EntityTx[] // includes jurisdictionEvent txs
  precommits: string[] // BLS sigs over header hash
  proposedBlock: string // keccak256(rlp(header ‖ txs))
  observedInbox: InboxMessage[]
  accountInputs: AccountInput[]
}

export interface InboxMessage {
  msgHash: string // keccak256(message)
  fromEntityId: string
  message: unknown
}

export interface AccountInput {
  counterEntityId: string
  channelId?: bigint // reserved for phase 2 multi-channel support
  accountTxs: AccountTx[]
}

export interface AccountTx {
  type: 'AddPaymentSubcontract'
  paymentId: string
  amount: number
}
