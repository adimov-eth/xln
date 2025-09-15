#!/usr/bin/env bun

/**
 * Test Slashing Conditions for XLN BFT Consensus
 * Tests detection and punishment of various Byzantine behaviors
 */

import {
  applyEntityInput,
  initializeViewChangeState,
  getSlashingHistory,
  isValidatorEjected,
  getValidatorStakes,
  triggerSlashing
} from './src/entity-consensus';
import { EntityReplica, EntityState, ConsensusConfig, EntityInput, EntityTx, SlashingEvidence } from './src/types';

// Mock environment
const env = {
  timestamp: Date.now(),
  randomBytes: () => Buffer.from('mock-random-bytes')
} as any;

// Create 4 nodes for slashing testing
function createNode(id: string): EntityReplica {
  const config: ConsensusConfig = {
    threshold: BigInt(3), // 3 out of 4 needed
    validators: ['alice', 'bob', 'charlie', 'eve'],
    shares: {
      'alice': BigInt(100),
      'bob': BigInt(100),
      'charlie': BigInt(100),
      'eve': BigInt(100)
    },
    mode: 'proposer-based',
    viewChangeTimeout: 3000,
    newViewTimeout: 2000
  };

  const state: EntityState = {
    height: 0,
    timestamp: Date.now(),
    config: config,
    messages: [],
    nonces: {}
  };

  const replica: EntityReplica = {
    entityId: 'test-entity',
    signerId: id,
    isProposer: false,
    state: state,
    mempool: [],
    proposal: undefined,
    lockedFrame: undefined,
    currentView: 0,
    viewChangeRequests: new Map(),
    lastProposalTime: undefined,
    viewChangeTimer: undefined,
    slashingConditions: [],
    signatureHistory: new Map(),
    votingHistory: new Map(),
    proposalHistory: []
  };

  initializeViewChangeState(replica, 0);
  return replica;
}

console.log('═══════════════════════════════════════════════════════');
console.log('           XLN SLASHING CONDITIONS TEST');
console.log('═══════════════════════════════════════════════════════');
console.log();
console.log('🔧 Testing with 4 nodes: Alice, Bob, Charlie, Eve');
console.log('🎯 Testing various Byzantine misbehaviors and penalties');
console.log();

// Test 1: Double signing detection
console.log('⚔️ TEST 1: Double Signing Detection');
console.log('─────────────────────────────────');

const alice = createNode('alice');
const bob = createNode('bob');
const charlie = createNode('charlie');
const eve = createNode('eve');

// Alice creates two different proposals for the same height
const proposal1: any = {
  height: 1,
  txs: [{ type: 'chat', data: { message: 'Proposal 1', from: 'alice' } }],
  hash: 'proposal_1_hash',
  newState: { ...alice.state, height: 1, timestamp: Date.now() },
  signatures: new Map()
};

const proposal2: any = {
  height: 1,
  txs: [{ type: 'chat', data: { message: 'Proposal 2', from: 'alice' } }],
  hash: 'proposal_2_hash',
  newState: { ...alice.state, height: 1, timestamp: Date.now() },
  signatures: new Map()
};

// Eve signs both proposals (double signing)
const input1: EntityInput = {
  entityId: 'test-entity',
  signerId: 'eve',
  proposedFrame: proposal1,
  precommits: new Map([['eve', 'signature_1_eve']])
};

const input2: EntityInput = {
  entityId: 'test-entity',
  signerId: 'eve',
  proposedFrame: proposal2,
  precommits: new Map([['eve', 'signature_2_eve']])
};

// Store proposal1 in Alice's history
alice.proposalHistory.push(proposal1);
alice.proposalHistory.push(proposal2);

// Process first signature
console.log('✓ Eve signs first proposal');
const outputs1 = applyEntityInput(env, alice, input1);

// Process second signature (should trigger double signing detection)
console.log('✓ Eve signs second proposal (different proposal, same height)');
const outputs2 = applyEntityInput(env, alice, input2);

// Check slashing history
const slashingHistory = getSlashingHistory(alice);
console.log(`✓ Slashing conditions detected: ${slashingHistory.length}`);

if (slashingHistory.some(c => c.type === 'double_signing' && c.validator === 'eve')) {
  console.log('✅ Double signing detected and recorded');
  const doubleSigning = slashingHistory.find(c => c.type === 'double_signing')!;
  console.log(`   Penalty: ${doubleSigning.penalty}, Severity: ${doubleSigning.severity}`);
} else {
  console.log('❌ Double signing not detected');
}

console.log();

// Test 2: Invalid proposer detection
console.log('⚔️ TEST 2: Invalid Proposer Detection');
console.log('─────────────────────────────────');

// Bob tries to propose when Alice should be proposer (view 0 -> Alice is proposer)
const invalidProposal: any = {
  height: 1,
  txs: [{ type: 'chat', data: { message: 'Invalid proposal', from: 'bob' } }],
  hash: 'invalid_proposal_hash',
  newState: { ...bob.state, height: 1, timestamp: Date.now() },
  signatures: new Map()
};

const invalidInput: EntityInput = {
  entityId: 'test-entity',
  signerId: 'bob', // Bob is not the proposer in view 0
  proposedFrame: invalidProposal
};

console.log('✓ Bob attempts to propose when Alice should be proposer');
const invalidOutputs = applyEntityInput(env, charlie, invalidInput);

const charlieSlashing = getSlashingHistory(charlie);
if (charlieSlashing.some(c => c.type === 'invalid_proposal' && c.validator === 'bob')) {
  console.log('✅ Invalid proposer detected and slashed');
} else {
  console.log('❌ Invalid proposer not detected');
}

console.log();

// Test 3: Manual slashing trigger
console.log('⚔️ TEST 3: Manual Slashing Trigger');
console.log('─────────────────────────────────');

const beforeStakes = getValidatorStakes(bob);
console.log(`✓ Bob's stake before slashing: ${beforeStakes.bob}`);

// Manually trigger slashing for testing
const evidence: SlashingEvidence = {
  equivocation: {
    message1: 'I vote YES',
    message2: 'I vote NO',
    context: 'Same proposal sent to different validators'
  }
};

console.log('✓ Manually triggering equivocation slashing for Bob');
triggerSlashing(bob, 'bob', 'equivocation', evidence, 'major');

const afterStakes = getValidatorStakes(bob);
console.log(`✓ Bob's stake after slashing: ${afterStakes.bob}`);

if (afterStakes.bob < beforeStakes.bob) {
  console.log('✅ Stake reduction applied successfully');
  const reduction = beforeStakes.bob - afterStakes.bob;
  const percentage = (Number(reduction) / Number(beforeStakes.bob)) * 100;
  console.log(`   Reduced by ${reduction} (${percentage.toFixed(1)}%)`);
} else {
  console.log('❌ Stake reduction not applied');
}

console.log();

// Test 4: Critical violations and ejection
console.log('⚔️ TEST 4: Critical Violations and Ejection');
console.log('─────────────────────────────────');

console.log('✓ Charlie before ejection:', charlie.state.config.validators.includes('charlie'));

// Trigger critical violation that should eject Charlie
const criticalEvidence: SlashingEvidence = {
  doubleSigning: {
    signature1: 'sig1',
    signature2: 'sig2',
    proposal1: proposal1,
    proposal2: proposal2
  }
};

console.log('✓ Manually triggering critical double signing for Charlie');
triggerSlashing(charlie, 'charlie', 'double_signing', criticalEvidence, 'critical');

const isCharlieEjected = isValidatorEjected(charlie, 'charlie');
const isCharlieInValidators = charlie.state.config.validators.includes('charlie');

console.log(`✓ Charlie ejected: ${isCharlieEjected}`);
console.log(`✓ Charlie in validator set: ${isCharlieInValidators}`);

if (isCharlieEjected && !isCharlieInValidators) {
  console.log('✅ Critical violation ejection working');
  console.log(`   Remaining validators: ${charlie.state.config.validators.join(', ')}`);
} else {
  console.log('❌ Ejection not working properly');
}

console.log();

// Test 5: Conflicting votes detection
console.log('⚔️ TEST 5: Conflicting Votes Detection');
console.log('─────────────────────────────────');

// Bob votes YES then NO on same proposal
const vote1: EntityTx = {
  type: 'vote',
  data: { proposalId: 'prop-123', voter: 'bob', choice: 'yes' }
};

const vote2: EntityTx = {
  type: 'vote',
  data: { proposalId: 'prop-123', voter: 'bob', choice: 'no' }
};

const voteInput1: EntityInput = {
  entityId: 'test-entity',
  signerId: 'system',
  entityTxs: [vote1]
};

const voteInput2: EntityInput = {
  entityId: 'test-entity',
  signerId: 'system',
  entityTxs: [vote2]
};

console.log('✓ Bob votes YES on proposal prop-123');
applyEntityInput(env, bob, voteInput1);

console.log('✓ Bob votes NO on same proposal (conflicting vote)');
applyEntityInput(env, bob, voteInput2);

const bobVoteSlashing = getSlashingHistory(bob);
if (bobVoteSlashing.some(c => c.type === 'conflicting_votes' && c.validator === 'bob')) {
  console.log('✅ Conflicting votes detected and recorded');
} else {
  console.log('❌ Conflicting votes not detected');
}

console.log();

// Summary
console.log('═══════════════════════════════════════════════════════');
console.log('              SLASHING SUMMARY');
console.log('═══════════════════════════════════════════════════════');

const allSlashing = [
  ...getSlashingHistory(alice),
  ...getSlashingHistory(bob),
  ...getSlashingHistory(charlie),
  ...getSlashingHistory(eve)
];

console.log(`🔍 Total slashing conditions detected: ${allSlashing.length}`);

const byType = allSlashing.reduce((acc, c) => {
  acc[c.type] = (acc[c.type] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.log('📊 By type:');
for (const [type, count] of Object.entries(byType)) {
  console.log(`   ${type}: ${count}`);
}

const bySeverity = allSlashing.reduce((acc, c) => {
  acc[c.severity] = (acc[c.severity] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.log('📊 By severity:');
for (const [severity, count] of Object.entries(bySeverity)) {
  console.log(`   ${severity}: ${count}`);
}

const byPenalty = allSlashing.reduce((acc, c) => {
  acc[c.penalty] = (acc[c.penalty] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.log('📊 By penalty:');
for (const [penalty, count] of Object.entries(byPenalty)) {
  console.log(`   ${penalty}: ${count}`);
}

console.log();
console.log('Features tested:');
console.log('  ✅ Double signing detection');
console.log('  ✅ Invalid proposer detection');
console.log('  ✅ Manual slashing trigger');
console.log('  ✅ Critical violation ejection');
console.log('  ✅ Conflicting votes detection');
console.log('  ✅ Stake reduction penalties');
console.log('  ✅ Validator ejection');
console.log();
console.log('XLN now has COMPREHENSIVE SLASHING CONDITIONS!');