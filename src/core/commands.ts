import { verifyAggregate } from './bls';
import { hashEntityState, hashFrame, sortTransactions, getSender } from './hash';
import type {
  Address,
  EntityState,
  EntityTx,
  Frame,
  FrameHeader,
  Replica,
  Result,
} from './types';

/* ---------- helpers ---------- */
function effectiveWeight(
  votes: ReadonlyArray<{ signer: string }>,
  weightMap: Record<string, bigint>,
): bigint {
  const seen = new Set<string>();
  let total = 0n;
  for (const v of votes) {
    if (seen.has(v.signer)) continue;
    seen.add(v.signer);
    total += weightMap[v.signer] ?? 0n;
  }
  return total;
}

/* ---------- pure command functions ---------- */
export const addTx = (rep: Replica, tx: EntityTx): Result<Replica> => {
  if (!rep.attached) return { ok: false, error: 'replica-detached' };

  const s = rep.state;
  const signer = tx.sig.slice(0, 42) as Address;
  const last = s.signerRecords[signer]?.nonce ?? 0n;

  if (tx.nonce !== last + 1n) return { ok: false, error: 'nonce-out-of-order' };

  return {
    ok: true,
    value: {
      ...rep,
      state: {
        ...s,
        mempool: [...s.mempool, tx],
        signerRecords: { ...s.signerRecords, [signer]: { nonce: tx.nonce } },
      },
    },
  };
};

export const proposeFrame = (
  rep: Replica,
  header: FrameHeader,
): Result<{ replica: Replica; frame: Frame }> => {
  if (!rep.attached) return { ok: false, error: 'replica-detached' };

  const s = rep.state;
  const txs = sortTransactions(s.mempool);
  const postStateRoot = hashEntityState({ ...s, mempool: [] });

  const frame: Frame = {
    ...header,
    txs,
    postStateRoot,
  };

  return {
    ok: true,
    value: {
      replica: {
        ...rep,
        state: { ...s, proposal: { frame, sigs: {} } },
      },
      frame,
    },
  };
};

export const signFrame = (rep: Replica, sig: string): Result<Replica> => {
  if (!rep.attached) return { ok: false, error: 'replica-detached' };

  const s = rep.state;
  if (!s.proposal) return { ok: false, error: 'no-proposal' };

  const addr = sig.slice(0, 42) as Address;
  if (s.proposal.sigs[addr]) return { ok: false, error: 'dup-sig' };

  const nonce = (s.signerRecords[addr]?.nonce ?? 0n) + 1n;

  return {
    ok: true,
    value: {
      ...rep,
      state: {
        ...s,
        signerRecords: { ...s.signerRecords, [addr]: { nonce } },
        proposal: { ...s.proposal, sigs: { ...s.proposal.sigs, [addr]: sig } },
      },
    },
  };
};

export const commitFrame = async (
  rep: Replica,
  frame: Frame,
  hanko: string,
): Promise<Result<Replica>> => {
  if (!rep.attached) return { ok: false, error: 'replica-detached' };

  const s = rep.state;
  const { proposal } = s;
  if (!proposal) return { ok: false, error: 'no-proposal' };

  // Check weight before expensive BLS verification
  const weightMap = Object.fromEntries(
    s.quorum.members.map((m) => [m.address, m.shares]),
  ) as Record<string, bigint>;
  const votes = Object.keys(proposal.sigs).map((signer) => ({ signer }));

  if (effectiveWeight(votes, weightMap) < s.quorum.threshold) {
    return { ok: false, error: 'quorum-not-reached' };
  }

  // Verify BLS aggregate signature
  const frameHash = hashFrame(frame);
  if (!(await verifyAggregate(hanko, [frameHash], []))) {
    return { ok: false, error: 'invalid-agg-sig' };
  }

  // Apply transactions and update nonces
  let newDomainState = s.domainState;
  const newSignerRecords = { ...s.signerRecords };

  // Domain reducers dispatch table
  const domainReducers: Record<string, (state: unknown, tx: EntityTx) => unknown> = {
    chat: (state, tx) => ({
      ...(state as { chat?: Array<{ from: string; msg: string }> }),
      chat: [
        ...((state as { chat?: Array<{ from: string; msg: string }> }).chat ?? []),
        { from: getSender(tx), msg: (tx.data as { msg: string }).msg },
      ],
    }),
    // Add other domain reducers here as needed
  };

  // Process each transaction
  for (const tx of frame.txs) {
    const reducer = domainReducers[tx.kind];
    if (reducer) {
      newDomainState = reducer(newDomainState, tx);
    }
    const sender = getSender(tx);
    newSignerRecords[sender] = { nonce: tx.nonce };
  }

  return {
    ok: true,
    value: {
      ...rep,
      state: {
        ...s,
        height: frame.height,
        domainState: newDomainState,
        signerRecords: newSignerRecords,
        mempool: [],
        proposal: undefined,
      },
    },
  };
};

export const attachReplica = (snapshot: EntityState): Result<Replica> => ({
  ok: true,
  value: { attached: true, state: snapshot },
});

export const detachReplica = (rep: Replica): Result<Replica> => ({
  ok: true,
  value: { ...rep, attached: false },
});
