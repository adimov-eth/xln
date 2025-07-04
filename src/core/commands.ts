import { verifyAggregate } from './bls';
import { getSender, hashEntityState, hashFrame, sortTransactions } from './hash';
import type {
  Address,
  Command,
  EntityState,
  EntityTx,
  Frame,
  FrameHeader,
  Result,
} from './types';

export const addTx = (
  state: EntityState,
  cmd: Extract<Command, { type: 'addTx' }>,
): Result<EntityState> => {
  const signer = cmd.tx.sig.slice(0, 42) as Address;
  const last = state.signerRecords[signer]?.nonce ?? 0n;
  if (cmd.tx.nonce !== last + 1n) return { ok: false, error: 'nonce-out-of-order' };
  return {
    ok: true,
    value: {
      ...state,
      mempool: [...state.mempool, cmd.tx],
      signerRecords: { ...state.signerRecords, [signer]: { nonce: cmd.tx.nonce } },
    },
  };
};

export const proposeFrame = (
  state: EntityState,
  cmd: Extract<Command, { type: 'proposeFrame' }>,
): { state: EntityState; frame: Frame } => {
  const txs = sortTransactions(state.mempool);
  const postStateRoot = hashEntityState({ ...state, mempool: [] });
  const frame: Frame = { ...cmd.header, txs, postStateRoot };
  return { state: { ...state, proposal: { frame, sigs: {} } }, frame };
};

export const signFrame = (
  state: EntityState,
  cmd: Extract<Command, { type: 'signFrame' }>,
): Result<EntityState> => {
  if (!state.proposal) return { ok: false, error: 'no-proposal' };
  const addr = cmd.sig.slice(0, 42) as Address;
  if (state.proposal.sigs[addr]) return { ok: false, error: 'dup-sig' };
  const nonce = (state.signerRecords[addr]?.nonce ?? 0n) + 1n;
  return {
    ok: true,
    value: {
      ...state,
      signerRecords: { ...state.signerRecords, [addr]: { nonce } },
      proposal: { ...state.proposal, sigs: { ...state.proposal.sigs, [addr]: cmd.sig } },
    },
  };
};

const effectiveWeight = (
  votes: ReadonlyArray<{ signer: string }>,
  weightMap: Record<string, bigint>,
): bigint => {
  const seen = new Set<string>();
  let total = 0n;
  for (const v of votes) {
    if (seen.has(v.signer)) continue;
    seen.add(v.signer);
    total += weightMap[v.signer] ?? 0n;
  }
  return total;
};

export const commitFrame = async (
  state: EntityState,
  cmd: Extract<Command, { type: 'commitFrame' }>,
): Promise<Result<EntityState>> => {
  const { proposal } = state;
  if (!proposal) return { ok: false, error: 'no-proposal' };

  const weightMap = Object.fromEntries(
    state.quorum.members.map((m) => [m.address, m.shares]),
  ) as Record<string, bigint>;
  const votes = Object.keys(proposal.sigs).map((signer) => ({ signer }));
  if (effectiveWeight(votes, weightMap) < state.quorum.threshold)
    return { ok: false, error: 'quorum-not-reached' };

  const frameHash = hashFrame(cmd.frame);
  if (!(await verifyAggregate(cmd.hanko, [frameHash], [])))
    return { ok: false, error: 'invalid-agg-sig' };

  let newDomainState = state.domainState;
  const newSignerRecords = { ...state.signerRecords };

  const domainReducers: Record<string, (s: unknown, tx: EntityTx) => unknown> = {
    chat: (s, tx) => ({
      ...(s as { chat?: Array<{ from: string; msg: string }> }),
      chat: [
        ...((s as { chat?: Array<{ from: string; msg: string }> }).chat ?? []),
        { from: getSender(tx), msg: (tx.data as { msg: string }).msg },
      ],
    }),
  };

  for (const tx of cmd.frame.txs) {
    const reducer = domainReducers[tx.kind];
    if (reducer) newDomainState = reducer(newDomainState, tx);
    const sender = getSender(tx);
    newSignerRecords[sender] = { nonce: tx.nonce };
  }

  return {
    ok: true,
    value: {
      ...state,
      height: cmd.frame.height,
      domainState: newDomainState,
      signerRecords: newSignerRecords,
      mempool: [],
      proposal: undefined,
    },
  };
};
