import { verifyAggregate } from './bls'
import { computeServerRoot, hashFrame } from './hash'
import type { Address, Command, Input, Replica, ServerState } from './types'

function effectiveWeight(
  votes: ReadonlyArray<{ signer: string }>,
  weightMap: Record<string, bigint>,
): bigint {
  const seen = new Set<string>()
  let total = 0n
  for (const v of votes) {
    if (seen.has(v.signer)) continue
    seen.add(v.signer)
    total += weightMap[v.signer] ?? 0n
  }
  return total
}

const applyCommand = async (rep: Replica, cmd: Command, _now: () => bigint): Promise<Replica> => {
  if (!rep.attached && cmd.type !== 'attachReplica') return rep
  const s = rep.state
  switch (cmd.type) {
    case 'attachReplica':
      return { attached: true, state: cmd.snapshot }
    case 'detachReplica':
      return { ...rep, attached: false }
    case 'addTx': {
      // A3: Validate nonce
      const signer = cmd.tx.sig.slice(0, 42) as Address
      const currentNonce = s.signerRecords[signer]?.nonce ?? 0n
      if (cmd.tx.nonce !== currentNonce + 1n) {
        return rep // Invalid nonce, reject transaction
      }
      
      // Increment nonce before adding to mempool
      return {
        ...rep,
        state: {
          ...s,
          signerRecords: {
            ...s.signerRecords,
            [signer]: { nonce: cmd.tx.nonce }
          },
          mempool: [...s.mempool, cmd.tx]
        }
      }
    }
    case 'proposeFrame': {
      // Proposer has already built the header with sorted txs
      // Store it for validators to verify
      return {
        ...rep,
        state: { ...s, proposal: { header: cmd.header, sigs: {} } },
      }
    }
    case 'signFrame': {
      const addr = cmd.sig.slice(0, 42) as Address
      if (s.proposal?.sigs[addr]) return rep
      const sigs = { ...(s.proposal?.sigs || {}), [addr]: cmd.sig }
      return {
        ...rep,
        state: {
          ...s,
          proposal: s.proposal ? { ...s.proposal, sigs } : undefined,
        },
      }
    }
    case 'commitFrame': {
      const sigs = s.proposal?.sigs || {}
      
      // R-1: Verify frame hash
      const frameHash = hashFrame(cmd.frame.header, cmd.frame.txs)
      const hankoBytes = new Uint8Array(Buffer.from(cmd.hanko.slice(2), 'hex'))
      const messages = Object.keys(sigs).map(() => new Uint8Array(Buffer.from(frameHash.slice(2), 'hex')))
      const pubKeys = Object.keys(sigs).map(s => new Uint8Array(Buffer.from(s.slice(2), 'hex')))
      if (!(await verifyAggregate(hankoBytes, messages, pubKeys))) return rep
      
      const weightMap = Object.fromEntries(
        s.quorum.members.map((m) => [m.address, m.shares]),
      ) as Record<string, bigint>
      const votes = Object.keys(sigs).map((signer) => ({ signer }))
      if (effectiveWeight(votes, weightMap) < s.quorum.threshold) return rep
      
      // Apply transactions to get new state
      const newState = cmd.frame.txs.reduce((acc, tx) => {
        if (tx.kind === 'chat' && typeof tx.data === 'string') {
          const chatHistory = ((acc.domainState as { chat?: Array<{ from: string; msg: string }> })?.chat) ?? []
          return {
            ...acc,
            domainState: {
              ...acc.domainState,
              chat: [...chatHistory, { from: tx.sig.slice(0, 42), msg: tx.data }],
            },
          }
        }
        return acc
      }, { ...s, height: cmd.frame.height })
      
      // Remove committed txs from mempool
      const committedNonces = new Set(cmd.frame.txs.map(tx => `${tx.sig.slice(0, 42)}:${tx.nonce}`))
      const remainingMempool = s.mempool.filter(tx => !committedNonces.has(`${tx.sig.slice(0, 42)}:${tx.nonce}`))
      
      return {
        ...rep,
        state: {
          ...newState,
          mempool: remainingMempool,
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
