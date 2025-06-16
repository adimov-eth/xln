import type { BlockHeight, SignerIdx } from '../types';

/** Entity lifecycle stages */
export type EntityStage = 'Idle' | 'Proposed' | 'Committing' | 'Faulted';

/** deterministic proposer */
export const proposer = (height: BlockHeight, quorum: SignerIdx[]): SignerIdx =>
  quorum[Number(height) % quorum.length]!;

/** 2/3 majority test */
export const hasQuorum = (approvals: Set<SignerIdx>, quorum: SignerIdx[]) =>
  approvals.size >= Math.ceil(quorum.length * 2 / 3);