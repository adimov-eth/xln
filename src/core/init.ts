import type { Replica, Quorum, Frame, EntityState, ServerState, Address } from '../types'

export const createBlankReplica = (): Replica => {
  const signer = '0x' + '00'.repeat(20) as Address
  const quorum: Quorum = {
    threshold: 1,
    members: { [signer]: { nonce: 0n, shares: 1 } }
  }
  const state: EntityState = { quorum, chat: [] }
  const frame: Frame<EntityState> = { height: 0n, ts: 0, txs: [], state }
  return {
    address: { jurisdiction: 'demo', entityId: 'chat' },
    proposer: signer,
    isAwaitingSignatures: false,
    mempool: [],
    last: frame
  }
}

export const createServer = (): ServerState => {
  const rep = createBlankReplica()
  const replicas = new Map<string, Replica>()
  replicas.set(`demo:chat:${rep.proposer}`, rep)
  return { height: 0n, replicas }
}
