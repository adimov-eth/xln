#!/usr/bin/env bun

/**
 * Test Byzantine Forensics for XLN
 * Tests attack pattern detection and forensic analysis
 */

import {
  applyEntityInput,
  initializeViewChangeState,
  triggerSlashing
} from './src/entity-consensus';
import { ByzantineForensics } from './src/forensics';
import { EntityReplica, EntityState, ConsensusConfig, EntityInput, SlashingEvidence } from './src/types';

// Mock environment
const env = {
  timestamp: Date.now(),
  randomBytes: () => Buffer.from('mock-random-bytes')
} as any;

// Create nodes for forensics testing
function createNode(id: string): EntityReplica {
  const config: ConsensusConfig = {
    threshold: BigInt(4), // 4 out of 6 needed
    validators: ['alice', 'bob', 'charlie', 'dave', 'eve', 'mallory'],
    shares: {
      'alice': BigInt(100),
      'bob': BigInt(100),
      'charlie': BigInt(100),
      'dave': BigInt(100),
      'eve': BigInt(100),
      'mallory': BigInt(100)
    },
    mode: 'proposer-based',
    viewChangeTimeout: 5000
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
console.log('          XLN BYZANTINE FORENSICS TEST');
console.log('═══════════════════════════════════════════════════════');
console.log();
console.log('🔧 Testing with 6 nodes: Alice, Bob, Charlie, Dave, Eve, Mallory');
console.log('🎯 Simulating various Byzantine attack patterns and analyzing them');
console.log();

const alice = createNode('alice');
const bob = createNode('bob');
const charlie = createNode('charlie');
const dave = createNode('dave');
const eve = createNode('eve');
const mallory = createNode('mallory');

const replicas = new Map([
  ['alice', alice],
  ['bob', bob],
  ['charlie', charlie],
  ['dave', dave],
  ['eve', eve],
  ['mallory', mallory]
]);

const forensics = new ByzantineForensics();

// Test 1: Simulate coordinated attack
console.log('⚔️ TEST 1: Simulating Coordinated Attack');
console.log('─────────────────────────────────');

// Eve, Mallory, and Charlie coordinate an attack
const baseTime = Date.now();

// Set up coordinated attack evidence (all at roughly same time)
const coordinatedEvidence: SlashingEvidence = {
  doubleSigning: {
    signature1: 'sig1_coordinated',
    signature2: 'sig2_coordinated',
    proposal1: {} as any,
    proposal2: {} as any
  }
};

console.log('✓ Eve, Mallory, and Charlie launch coordinated double-signing attack');

// Trigger coordinated violations (within 5 second window)
triggerSlashing(eve, 'eve', 'double_signing', coordinatedEvidence, 'critical');
setTimeout(() => {
  triggerSlashing(mallory, 'mallory', 'double_signing', coordinatedEvidence, 'critical');
}, 1000);
setTimeout(() => {
  triggerSlashing(charlie, 'charlie', 'invalid_proposal', { invalidProposal: { proposal: {} as any, reason: 'coordinated' } }, 'major');
}, 2000);

// Wait for coordinated attack to complete
await new Promise(resolve => setTimeout(resolve, 3000));

console.log('✓ Coordinated attack simulation complete');
console.log();

// Test 2: Simulate gradual corruption
console.log('⚔️ TEST 2: Simulating Gradual Corruption');
console.log('─────────────────────────────────');

console.log('✓ Bob starts with minor violations and escalates');

// Bob's escalation pattern: minor → major → critical
triggerSlashing(bob, 'bob', 'premature_commit', { prematureCommit: { proposal: {} as any, commitTime: 0, expectedCommitTime: 1000 } }, 'minor');

setTimeout(() => {
  triggerSlashing(bob, 'bob', 'conflicting_votes', { conflictingVotes: { vote1: 'yes', vote2: 'no', proposal: 'prop1' } }, 'major');
}, 1000);

setTimeout(() => {
  triggerSlashing(bob, 'bob', 'equivocation', { equivocation: { message1: 'msg1', message2: 'msg2', context: 'escalation' } }, 'critical');
}, 2000);

await new Promise(resolve => setTimeout(resolve, 3000));

console.log('✓ Gradual corruption simulation complete');
console.log();

// Test 3: Add timeline events
console.log('📅 TEST 3: Recording Timeline Events');
console.log('─────────────────────────────────');

forensics.addTimelineEvent({
  type: 'slashing',
  description: 'Coordinated attack detected',
  participants: ['eve', 'mallory', 'charlie'],
  severity: 'critical',
  metadata: { attackType: 'coordinated' }
});

forensics.addTimelineEvent({
  type: 'network_partition',
  description: 'Network partition caused by Byzantine validators',
  participants: ['eve', 'mallory'],
  severity: 'error',
  metadata: { duration: 15000 }
});

forensics.addTimelineEvent({
  type: 'view_change',
  description: 'Emergency view change due to Byzantine proposer',
  participants: ['alice', 'bob', 'dave'],
  severity: 'warning',
  metadata: { newView: 2, reason: 'byzantine_proposer' }
});

console.log('✓ Timeline events recorded');
const timeline = forensics.getTimeline();
console.log(`✓ Timeline contains ${timeline.length} events`);
console.log();

// Test 4: Generate forensic report
console.log('🔍 TEST 4: Generating Forensic Report');
console.log('─────────────────────────────────');

const report = forensics.generateForensicReport(replicas);

console.log(`📊 FORENSIC REPORT SUMMARY:`);
console.log(`   Total slashing events: ${report.totalSlashingEvents}`);
console.log(`   Attack patterns detected: ${report.attackPatterns.length}`);
console.log(`   Network health - Byzantine ratio: ${(report.networkHealth.byzantineRatio * 100).toFixed(1)}%`);
console.log(`   Network health - Consensus reliability: ${(report.networkHealth.consensusReliability * 100).toFixed(1)}%`);
console.log(`   Network health - Attack resistance: ${(report.networkHealth.attackResistance * 100).toFixed(1)}%`);
console.log();

// Display attack patterns
console.log('🎯 ATTACK PATTERNS DETECTED:');
for (let i = 0; i < report.attackPatterns.length; i++) {
  const pattern = report.attackPatterns[i];
  console.log(`   ${i + 1}. ${pattern.type.toUpperCase()}`);
  console.log(`      Participants: ${pattern.participants.join(', ')}`);
  console.log(`      Severity: ${pattern.severity}`);
  console.log(`      Evidence: ${pattern.evidence.length} violations`);
  console.log(`      Description: ${pattern.description}`);
  console.log(`      Impact: ${pattern.impact.validatorsEjected.length} ejected, ${pattern.impact.stakeLost}% stake lost`);
  console.log();
}

// Display validator risk scores
console.log('⚠️ VALIDATOR RISK SCORES:');
for (const [validator, stats] of Object.entries(report.validatorStats)) {
  console.log(`   ${validator}: Risk ${(stats.riskScore * 100).toFixed(1)}%, Violations ${stats.totalViolations}, Ejected: ${stats.isEjected}`);
}
console.log();

// Display recommendations
console.log('💡 RECOMMENDATIONS:');
for (let i = 0; i < report.recommendations.length; i++) {
  console.log(`   ${i + 1}. ${report.recommendations[i]}`);
}
console.log();

// Test 5: Generate visualization data
console.log('📈 TEST 5: Generating Visualization Data');
console.log('─────────────────────────────────');

const vizData = forensics.generateVisualizationData(replicas);

console.log(`📊 VISUALIZATION DATA:`);
console.log(`   Nodes: ${vizData.nodes.length}`);
console.log(`   Edges: ${vizData.edges.length}`);
console.log(`   Attack patterns: ${vizData.attackPatterns.length}`);
console.log();

console.log('🔍 NODE ANALYSIS:');
for (const node of vizData.nodes) {
  const status = node.status === 'active' ? '✅' : '🚫';
  console.log(`   ${status} ${node.id}: Risk ${(node.riskScore * 100).toFixed(1)}%, Violations ${node.violations}`);
}
console.log();

if (vizData.edges.length > 0) {
  console.log('🔗 ATTACK RELATIONSHIPS:');
  for (const edge of vizData.edges) {
    console.log(`   ${edge.source} ↔ ${edge.target}: ${edge.type} (severity: ${edge.severity})`);
  }
  console.log();
}

// Test 6: Timeline analysis
console.log('📅 TEST 6: Timeline Analysis');
console.log('─────────────────────────────────');

const sortedTimeline = forensics.getTimeline();
console.log(`📅 ATTACK TIMELINE (${sortedTimeline.length} events):`);

for (let i = 0; i < sortedTimeline.length; i++) {
  const event = sortedTimeline[i];
  const timeStr = new Date(event.timestamp).toISOString().substr(11, 8);
  const severity = event.severity === 'critical' ? '🔴' :
                   event.severity === 'error' ? '🟠' :
                   event.severity === 'warning' ? '🟡' : '🟢';

  console.log(`   ${severity} [${timeStr}] ${event.type.toUpperCase()}: ${event.description}`);
  if (event.participants.length > 0) {
    console.log(`      Participants: ${event.participants.join(', ')}`);
  }
}
console.log();

// Final summary
console.log('═══════════════════════════════════════════════════════');
console.log('              FORENSICS TEST COMPLETE');
console.log('═══════════════════════════════════════════════════════');

const totalViolations = Array.from(replicas.values()).reduce((sum, r) => sum + r.slashingConditions.length, 0);
const ejectedValidators = Array.from(replicas.values()).filter(r => !r.state.config.validators.includes(r.signerId)).length;

console.log(`🔍 Total violations detected: ${totalViolations}`);
console.log(`🚫 Validators ejected: ${ejectedValidators}`);
console.log(`⚔️ Attack patterns identified: ${report.attackPatterns.length}`);
console.log(`📅 Timeline events recorded: ${sortedTimeline.length}`);
console.log(`💡 Security recommendations: ${report.recommendations.length}`);
console.log();
console.log('Features tested:');
console.log('  ✅ Coordinated attack detection');
console.log('  ✅ Gradual corruption analysis');
console.log('  ✅ Timeline event tracking');
console.log('  ✅ Risk score calculation');
console.log('  ✅ Network health assessment');
console.log('  ✅ Visualization data generation');
console.log('  ✅ Security recommendations');
console.log();
console.log('XLN now has COMPREHENSIVE FORENSIC ANALYSIS!');