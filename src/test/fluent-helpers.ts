// ============================================================================
// test/fluent-helpers.ts - Helper functions for fluent tests
// ============================================================================

import { getProposer } from '../engine/consensus.js';
import type { TestScenario } from './fluent-api.js';

// ============================================================================
// Smart Block Proposal - Automatically determine correct proposer
// ============================================================================

export const smartPropose = (scenario: TestScenario, entityId: string): TestScenario => {
  // Get entity metadata to find quorum
  const meta = scenario.getServer().registry.get(entityId as any);
  if (!meta) {
    throw new Error(`Entity ${entityId} not found`);
  }
  
  // Get entity from any signer to check height
  const entity = scenario.getEntity(entityId);
  const currentHeight = entity.height;
  
  // Calculate who should propose
  const proposer = getProposer(currentHeight, meta.quorum);
  
  // Send propose command from correct signer
  return scenario.proposeBlock(Number(proposer), entityId);
};

// ============================================================================
// Test Patterns - Common setups
// ============================================================================

export const patterns = {
  // Single signer DAO
  singleSignerDao: (scenario: TestScenario) => 
    scenario.withDao('dao', [0], { balance: 1000n }),
  
  // Multi-sig DAO with 3 signers
  multiSigDao: (scenario: TestScenario) =>
    scenario.withDao('dao', [0, 1, 2], { balance: 1000n, voteThreshold: 66 }),
  
  // DAO with treasury wallet
  daoWithTreasury: (scenario: TestScenario) =>
    scenario
      .withDao('dao', [0, 1], { balance: 1000n })
      .withWallet('treasury', 2, 0n)
};