import { computeServerRoot, computeInputsRoot } from './hash'
import * as Cmd from './commands'
import type { Command, Input, Replica, Result, ServerFrame, ServerState } from './types'

/* ---------- command handler ---------- */
const applyCommand = async (
  rep: Replica,
  cmd: Command,
  _now: () => bigint,
): Promise<Result<Replica>> => {
  switch (cmd.type) {
    case 'attachReplica':
      return Cmd.attachReplica(cmd.snapshot)

    case 'detachReplica':
      return Cmd.detachReplica(rep)

    case 'addTx':
      return Cmd.addTx(rep, cmd.tx)

    case 'proposeFrame': {
      const result = Cmd.proposeFrame(rep, cmd.header)
      return result.ok ? { ok: true, value: result.value.replica } : result
    }

    case 'signFrame':
      return Cmd.signFrame(rep, cmd.sig)

    case 'commitFrame':
      return Cmd.commitFrame(rep, cmd.frame, cmd.hanko)
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
