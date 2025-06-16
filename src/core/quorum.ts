import type { BlockHeight, SignerIdx } from '../types';

/** Entity lifecycle stages */
export type EntityStage = 'Idle' | 'Proposed' | 'Committing' | 'Faulted';

/** deterministic proposer */
export const proposer = (height: BlockHeight, quorum: SignerIdx[]): SignerIdx =>
  quorum[Number(height) % quorum.length]!;

/** 
 * 2/3 majority test using BigInt to prevent overflow
 * @param approvals - Set of signers who have approved
 * @param quorum - All signers in the quorum
 * @returns true if approvals meet 2/3 threshold
 */
export const hasQuorum = (approvals: Set<SignerIdx>, quorum: readonly SignerIdx[]): boolean => {
  // Use BigInt to prevent overflow with large quorum sizes
  const a = BigInt(approvals.size);
  const q = BigInt(quorum.length);
  return a * 3n >= q * 2n;
};