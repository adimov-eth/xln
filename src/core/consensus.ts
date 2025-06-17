// ============================================================================
// core/consensus.ts - Consensus utilities
// ============================================================================

import type { BlockHeight, SignerIdx } from '../types/primitives.js';

export const getProposer = (h: BlockHeight, quorum: readonly SignerIdx[]): SignerIdx => {
  if (quorum.length === 0) throw new Error('Empty quorum');
  const index = Number(h) % quorum.length;
  const proposer = quorum[index];
  if (proposer === undefined) throw new Error('Invalid proposer calculation');
  return proposer;
};

export const hasQuorum = (
  approvals: Set<SignerIdx>, 
  quorum: readonly SignerIdx[]
): boolean => {
  // This check is now redundant since registerEntity validates
  if (quorum.length > 1_000_000) {
    throw new Error('Quorum size exceeds maximum allowed (1M signers)');
  }
  
  // Use BigInt to prevent integer overflow
  const a = BigInt(approvals.size);
  const q = BigInt(quorum.length);
  return a * 3n >= q * 2n;
};

export const isTimedOut = (timestamp: number, timeoutMs: number): boolean => {
  return Date.now() - timestamp > timeoutMs;
}; 
