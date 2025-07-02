import { Input, ServerState, EntityState, Replica, Frame, Command, Address, Quorum } from './types'
import { computeServerRoot } from './hash'
import { verifyAggregate } from './bls'

const weight = (sigs: Record<Address, string>, q: Quorum): bigint =>
  q.members.reduce((acc, m) => acc + (sigs[m.address] ? m.shares : 0n), 0n)

const applyCommand = async (rep: Replica, cmd: Command, now: () => bigint): Promise<Replica> => {
  if (!rep.attached && cmd.type !== 'attachReplica') return rep
  const s = rep.state
  switch (cmd.type) {
    case 'attachReplica':
      return { attached: true, state: cmd.snapshot }
    case 'detachReplica':
      return { ...rep, attached: false }
    case 'addTx':
      return { ...rep, state: { ...s, mempool: [...s.mempool, cmd.tx] } }
    case 'proposeFrame': {
      const frame: Frame = {
        height: s.height + 1n,
        timestamp: now(),
        txs: s.mempool,
        postState: s,
      }
      return {
        ...rep,
        state: { ...s, proposal: { frame, sigs: {} } },
      }
    }
    case 'signFrame': {
      const addr = cmd.sig.slice(0, 42) as Address
      if (s.proposal?.sigs[addr]) return rep
      const nonce = (s.signerRecords[addr]?.nonce ?? 0n) + 1n
      const sigs = { ...(s.proposal?.sigs || {}), [addr]: cmd.sig }
      return {
        ...rep,
        state: {
          ...s,
          signerRecords: { ...s.signerRecords, [addr]: { nonce } },
          proposal: s.proposal ? { ...s.proposal, sigs } : undefined,
        },
      }
    }
    case 'commitFrame': {
      if (!(await verifyAggregate(cmd.hanko, cmd.frame, s.proposal?.sigs || {}, s.quorum)))
        return rep
      if (weight(s.proposal?.sigs || {}, s.quorum) < s.quorum.threshold) return rep
      return {
        ...rep,
        state: {
          ...cmd.frame.postState,
          height: cmd.frame.height,
          mempool: [],
          proposal: undefined,
        },
      }
    }
  }
}

export const applyServerFrame = async (
  st: ServerState,
  batch: Input[],
  now: () => bigint,
): Promise<{ next: ServerState; root: Uint8Array }> => {
  const next = new Map(st)
  for (const [idx, id, cmd] of batch) {
    const key = `${idx}:${id}` as const
    if (!next.has(key) && cmd.type !== 'attachReplica') continue
    const rep = next.get(key) || ({ attached: false, state: cmd.snapshot } as Replica)
    next.set(key, await applyCommand(rep, cmd, now))
  }
  return { next, root: computeServerRoot(next) }
}
