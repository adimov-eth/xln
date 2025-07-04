import { verifyAggregate } from './bls'
import {
  computeServerRoot,
  computeInputsRoot,
  hashEntityState,
  hashFrame,
  sortTransactions,
} from './hash'
import type {
  Address,
  Command,
  Frame,
  FrameHeader,
  Input,
  Replica,
  Result,
  ServerFrame,
  ServerState,
} from './types'

/* ---------- helpers ---------- */
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

/* ---------- command handler ---------- */
const applyCommand = async (
  rep: Replica,
  cmd: Command,
  now: () => bigint,
): Promise<Result<Replica>> => {
  if (!rep.attached && cmd.type !== 'attachReplica') return { ok: false, error: 'replica-detached' }

  const s = rep.state

  switch (cmd.type) {
    /* ---------- replica mgmt ---------- */
    case 'attachReplica':
      return { ok: true, value: { attached: true, state: cmd.snapshot } }

    case 'detachReplica':
      return { ok: true, value: { ...rep, attached: false } }

    /* ---------- transaction ---------- */
    case 'addTx': {
      const signer = cmd.tx.sig.slice(0, 42) as Address
      const last = s.signerRecords[signer]?.nonce ?? 0n
      if (cmd.tx.nonce !== last + 1n) return { ok: false, error: 'nonce-out-of-order' }
      return {
        ok: true,
        value: {
          ...rep,
          state: {
            ...s,
            mempool: [...s.mempool, cmd.tx],
            signerRecords: { ...s.signerRecords, [signer]: { nonce: cmd.tx.nonce } },
          },
        },
      }
    }

    /* ---------- frame proposal ---------- */
    case 'proposeFrame': {
      const txs = sortTransactions(s.mempool)
      const postStateRoot = hashEntityState({ ...s, mempool: [] })
      const frame: Frame = {
        ...cmd.header,
        txs,
        postStateRoot,
      }
      return {
        ok: true,
        value: {
          ...rep,
          state: { ...s, proposal: { frame, sigs: {} } },
        },
      }
    }

    case 'signFrame': {
      if (!s.proposal) return { ok: false, error: 'no-proposal' }
      const addr = cmd.sig.slice(0, 42) as Address
      if (s.proposal.sigs[addr]) return { ok: false, error: 'dup-sig' }
      const nonce = (s.signerRecords[addr]?.nonce ?? 0n) + 1n
      return {
        ok: true,
        value: {
          ...rep,
          state: {
            ...s,
            signerRecords: { ...s.signerRecords, [addr]: { nonce } },
            proposal: { ...s.proposal, sigs: { ...s.proposal.sigs, [addr]: cmd.sig } },
          },
        },
      }
    }

    /* ---------- commit ---------- */
    case 'commitFrame': {
      const { proposal } = s
      if (!proposal) return { ok: false, error: 'no-proposal' }

      const frameHash = hashFrame(cmd.frame)
      if (!(await verifyAggregate(cmd.hanko, [frameHash], [])))
        return { ok: false, error: 'invalid-agg-sig' }

      const weightMap = Object.fromEntries(
        s.quorum.members.map((m) => [m.address, m.shares]),
      ) as Record<string, bigint>
      const votes = Object.keys(proposal.sigs).map((signer) => ({ signer }))
      if (effectiveWeight(votes, weightMap) < s.quorum.threshold)
        return { ok: false, error: 'quorum-not-reached' }

      return {
        ok: true,
        value: {
          ...rep,
          state: {
            ...s,
            height: cmd.frame.height,
            mempool: [],
            proposal: undefined,
          },
        },
      }
    }
  }
}

/* ---------- server reducer ---------- */
export const applyServerFrame = async (
  st: ServerState,
  batch: Input[],
  now: () => bigint,
  height: bigint,
): Promise<{ next: ServerState; serverFrame: ServerFrame }> => {
  const next = new Map(st)
  const rejects: { key: string; err: string }[] = []

  for (const [idx, id, cmd] of batch) {
    const key = `${idx}:${id}` as const
    const rep = next.get(key) ?? ({ attached: false, state: cmd.snapshot } as Replica)
    const res = await applyCommand(rep, cmd, now)
    if (res.ok) next.set(key, res.value)
    else rejects.push({ key, err: res.error })
  }

  if (rejects.length) console.warn('rejected commands', rejects)

  const root = computeServerRoot(next)
  const inputsRoot = computeInputsRoot(batch)

  return {
    next,
    serverFrame: {
      height,
      timestamp: now(),
      root,
      inputsRoot,
      batch,
    },
  }
}
