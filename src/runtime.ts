import { hashFrame } from "./core/entity"
import type pino from 'pino'
import { applyServerBlock } from './core/server'
import { randomPriv, pub, addr } from './crypto/bls'
import type { Input, Replica, Frame, EntityState, Quorum, ChatTx, ServerState, Address, Hex } from './types'
import { makeLogger, ILogger } from './logging'

const PRIVS = Array.from({ length: 5 }, () => randomPriv())
const PUBS = PRIVS.map(pub)
const ADDRS = PUBS.map(addr)

const genesisEntity = (): Replica => {
  const quorum: Quorum = {
    threshold: 3,
    members: Object.fromEntries(
      ADDRS.map(a => [a as Address, { nonce: 0n, shares: 1 }])
    )
  }
  const initState: EntityState = { quorum, chat: [] }
  const initFrame: Frame<EntityState> = { height: 0n, ts: 0, txs: [], state: initState }
  return {
    address: { jurisdiction: 'demo', entityId: 'chat' },
    proposer: ADDRS[0] as Address,
    isAwaitingSignatures: false,
    mempool: [],
    last: initFrame
  }
}

const createServer = (): ServerState => {
  const base = genesisEntity()
  const replicas = new Map<string, Replica>()
  ADDRS.forEach(signer => {
    replicas.set(`demo:chat:${signer}`, { ...base, proposer: signer as Address })
  })
  return { height: 0n, replicas }
}

export class Runtime {
  private log: ILogger
  private server: ServerState
  private pending: Input[] = []
  private now = 0

  constructor(opts: { logLevel?: pino.Level } = {}) {
    this.log = makeLogger(opts.logLevel ?? (process.env.LOG_LEVEL as any) ?? 'info')
    this.server = createServer()
  }

  get replicas() {
    return [...this.server.replicas.values()].map(r => ({
      address: r.address,
      proposer: r.proposer,
      chat: r.last.state.chat,
      stateRoot: hashFrame(r.last)
    }))
  }

  injectClientTx(tx: ChatTx) {
    this.log.info('client tx', tx)
    const input: Input = {
      from: tx.from as Address,
      to: ADDRS[0] as Address,
      cmd: { type: 'ADD_TX', addrKey: 'demo:chat', tx }
    }
    this.pending.push(input)
  }

  tick() {
    this.now += 100
    this.log.debug('tick start', { height: this.server.height })
    const { state, outbox } = applyServerBlock(this.server, this.pending, this.now)
    outbox.forEach(o => this.log.debug('apply cmd', o.cmd))
    this.server = state
    this.pending = outbox
  }
}
