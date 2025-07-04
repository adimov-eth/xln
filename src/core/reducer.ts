import { computeServerRoot, computeInputsRoot } from './hash';
import * as Cmd from './commands';
import type { Command, Input, Replica, Result, ServerFrame, ServerState } from './types';
/* ---------- command handler ---------- */
const applyCommand = async (
  rep: Replica,
  cmd: Command,
  _now: () => bigint,
): Promise<Result<Replica>> => {
  if (!rep.attached && cmd.type !== 'attachReplica')
    return { ok: false, error: 'replica-detached' };

  const s = rep.state;

  switch (cmd.type) {
    /* ---------- replica mgmt ---------- */
    case 'attachReplica':
      return { ok: true, value: { attached: true, state: cmd.snapshot } };

    case 'detachReplica':
      return { ok: true, value: { ...rep, attached: false } };

    /* ---------- transaction ---------- */
    case 'addTx': {
      const res = Cmd.addTx(s, cmd);
      return res.ok ? { ok: true, value: { ...rep, state: res.value } } : res;
    }

    /* ---------- frame proposal ---------- */
    case 'proposeFrame': {
      const { state: ns } = Cmd.proposeFrame(s, cmd);
      return { ok: true, value: { ...rep, state: ns } };
    }

    case 'signFrame': {
      const res = Cmd.signFrame(s, cmd);
      return res.ok ? { ok: true, value: { ...rep, state: res.value } } : res;
    }

    /* ---------- commit ---------- */
    case 'commitFrame': {
      const res = await Cmd.commitFrame(s, cmd);
      return res.ok ? { ok: true, value: { ...rep, state: res.value } } : res;
    }
  }
};

/* ---------- server reducer ---------- */
export const applyServerFrame = async (
  st: ServerState,
  batch: Input[],
  now: () => bigint,
  height: bigint,
): Promise<{ next: ServerState; serverFrame: ServerFrame }> => {
  const next = new Map(st);
  const rejects: { key: string; err: string }[] = [];

  for (const [idx, id, cmd] of batch) {
    const key = `${idx}:${id}` as const;
    const rep = next.get(key) ?? ({ attached: false, state: cmd.snapshot } as Replica);
    const res = await applyCommand(rep, cmd, now);
    if (res.ok) next.set(key, res.value);
    else rejects.push({ key, err: res.error });
  }

  if (rejects.length) console.warn('rejected commands', rejects);

  const root = computeServerRoot(next);
  const inputsRoot = computeInputsRoot(batch);

  return {
    next,
    serverFrame: {
      height,
      timestamp: now(),
      root,
      inputsRoot,
      batch,
    },
  };
};
