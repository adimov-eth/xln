import { Input, ServerState, EntityState, Replica, Frame, Command, Address } from './types'
import { computeServerRoot } from './hash'
import { verifyAggregate } from './bls'

const applyCommand = (rep: Replica, cmd: Command, now: () => bigint): Replica => {
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
      if (!verifyAggregate(cmd.hanko, '0x', s.quorum)) return rep
      if (Object.keys(s.proposal?.sigs || {}).length * 2 < s.quorum.members.length) return rep
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

export const applyServerFrame = (
  st: ServerState,
  batch: Input[],
  now: () => bigint,
): { next: ServerState; root: Uint8Array } => {
  const next = new Map(st)
  for (const [idx, id, cmd] of batch) {
    const key = `${idx}:${id}` as const
    const rep =
      next.get(key) ||
      ({
        attached: false,
        state: cmd.type === 'attachReplica' ? cmd.snapshot : (undefined as unknown as EntityState),
      } as Replica)
    next.set(key, applyCommand(rep, cmd, now))
  }
  return { next, root: computeServerRoot(next) }
}
