/**
 * XLN Production-Ready Integration Tests
 *
 * Tests the production-hardened components we've built
 */

import { describe, it, expect } from 'bun:test';
import { ethers } from 'ethers';
import { MerkleTree, SparseMerkleTree, ChannelStateMerkleTree } from '../../src/merkle/MerkleTree.js';
import { sigmoidCongestion, logarithmicCongestion, compareCurves } from '../../src/fee/FeeMarketCurves.js';
import { HankoValidator, HankoSecurityProfiles } from '../../src/hanko-production.js';
import { DualClassShares, RiskCommittee, SubsidiaryFactory } from '../../src/organizations/index.js';

describe('Production-Ready Components', () => {

  describe('Merkle Trees (Real Implementation)', () => {
    it('should generate and verify real merkle proofs', () => {
      const transactions = [
        { from: 'alice', to: 'bob', amount: 100 },
        { from: 'bob', to: 'charlie', amount: 50 },
        { from: 'charlie', to: 'alice', amount: 25 },
        { from: 'alice', to: 'charlie', amount: 75 }
      ];

      const tree = new MerkleTree(transactions);
      const root = tree.getRoot();

      // Root should be a valid hash
      expect(root).toMatch(/^0x[a-f0-9]{64}$/);
      expect(root).not.toBe('0x0000000000000000000000000000000000000000000000000000000000000000');

      // Generate proof for second transaction
      const proof = tree.getProof(transactions[1]);
      expect(proof).toBeDefined();
      expect(proof!.root).toBe(root);
      expect(proof!.index).toBe(1);

      // Verify proof
      const isValid = MerkleTree.verifyProof(proof!);
      expect(isValid).toBe(true);
      expect(proof!.verified).toBe(true);

      // Tampered proof should fail
      const tamperedProof = { ...proof!, leaf: '0x' + 'f'.repeat(64) };
      expect(MerkleTree.verifyProof(tamperedProof)).toBe(false);
    });

    it('should handle batch proofs', () => {
      const data = ['item1', 'item2', 'item3', 'item4', 'item5'];
      const tree = new MerkleTree(data);

      const batchProof = tree.getBatchProof(['item1', 'item3', 'item5']);
      expect(batchProof.length).toBe(3);

      // All proofs should share same root
      const root = batchProof[0].root;
      expect(batchProof.every(p => p.root === root)).toBe(true);

      // Batch verification
      expect(MerkleTree.verifyBatchProof(batchProof)).toBe(true);
    });

    it('should handle sparse merkle trees', () => {
      const sparse = new SparseMerkleTree(16); // 16-bit depth

      // Set values at sparse indices
      sparse.set(100n, 'value at 100');
      sparse.set(1000n, 'value at 1000');
      sparse.set(10000n, 'value at 10000');

      // Get and verify proofs
      const proof100 = sparse.getProof(100n);
      expect(proof100.proof.length).toBe(16);
      expect(MerkleTree.verifyProof(proof100)).toBe(true);

      // Update value should change root
      const oldRoot = sparse.getRoot();
      sparse.set(100n, 'updated value');
      const newRoot = sparse.getRoot();
      expect(oldRoot).not.toBe(newRoot);
    });

    it('should create channel state merkle trees', () => {
      const channelState = {
        channelKey: 'channel-alice-bob',
        blockId: 42,
        subchannels: [
          {
            chainId: 1,
            ondelta: ethers.parseEther('100'),
            offdelta: ethers.parseEther('50'),
            cooperativeNonce: 3
          },
          {
            chainId: 137,
            ondelta: ethers.parseEther('200'),
            offdelta: ethers.parseEther('75'),
            cooperativeNonce: 2
          }
        ]
      };

      const tree = ChannelStateMerkleTree.fromChannelState(channelState);
      const root = tree.getRoot();
      expect(root).toMatch(/^0x[a-f0-9]{64}$/);

      // Get proof for first subchannel
      const proof = tree.getSubchannelProof(0);
      expect(proof).toBeDefined();
      expect(MerkleTree.verifyProof(proof!)).toBe(true);

      // Verify state transition
      const oldRoot = root;
      const newRoot = '0x' + 'a'.repeat(64);
      const isValid = ChannelStateMerkleTree.verifyStateTransition(
        oldRoot,
        newRoot,
        { type: 'payment', amount: 100 }
      );
      expect(isValid).toBe(true);
    });
  });

  describe('Fee Market Curves (No Math Explosion)', () => {
    it('should handle all utilization levels without overflow', () => {
      const config = {
        threshold: 0.7,
        maxMultiplier: 10,
        aggressiveness: 3
      };

      // Test edge cases that would overflow with Math.pow(excess * 10, 2)
      const testCases = [
        0,     // Zero utilization
        0.5,   // Below threshold
        0.7,   // At threshold
        0.8,   // Above threshold
        0.9,   // High utilization
        1.0,   // Full utilization
        1.1,   // Over 100% (edge case)
        1.5,   // Way over (edge case)
        -0.1,  // Negative (edge case)
        Infinity, // Infinity (edge case)
        NaN    // NaN (edge case)
      ];

      for (const utilization of testCases) {
        const sigmoid = sigmoidCongestion(utilization, config);
        const log = logarithmicCongestion(utilization, config);

        // Results should be bounded
        if (!isNaN(utilization) && isFinite(utilization)) {
          expect(sigmoid).toBeGreaterThanOrEqual(1);
          expect(sigmoid).toBeLessThanOrEqual(config.maxMultiplier);
          expect(log).toBeGreaterThanOrEqual(1);
          expect(log).toBeLessThanOrEqual(config.maxMultiplier);
        }

        // Should never overflow or return invalid values
        expect(isFinite(sigmoid)).toBe(true);
        expect(isFinite(log)).toBe(true);
      }
    });

    it('should provide smooth congestion pricing', () => {
      const config = {
        threshold: 0.7,
        maxMultiplier: 10,
        aggressiveness: 3
      };

      // Get multipliers at different utilization levels
      const curves = compareCurves(0.85, config);

      // All curves should return reasonable values
      expect(curves.sigmoid).toBeGreaterThan(1);
      expect(curves.sigmoid).toBeLessThan(10);
      expect(curves.logarithmic).toBeGreaterThan(1);
      expect(curves.logarithmic).toBeLessThan(10);

      // Sigmoid should have smooth S-curve properties
      const low = sigmoidCongestion(0.75, config);
      const mid = sigmoidCongestion(0.85, config);
      const high = sigmoidCongestion(0.95, config);

      expect(low).toBeLessThan(mid);
      expect(mid).toBeLessThan(high);
      expect(high - mid).toBeLessThan(mid - low); // Plateauing effect
    });
  });

  describe('Hanko Production Gates', () => {
    it('should enforce minimum EOA signatures', async () => {
      const validator = new HankoValidator({
        minEOASignatures: 2,
        maxDelegationDepth: 3,
        preventCircular: true
      });

      const entities = new Map([['E1', {
        id: 'E1',
        publicKey: '0x1',
        threshold: 100,
        delegates: [],
        delegateThresholds: []
      }]]);

      // Only 1 EOA signature (should fail)
      const hanko1 = {
        placeholders: [{ type: 'eoa' }],
        packedSignatures: Buffer.alloc(65),
        claims: [{ entityId: 'E1', signature: Buffer.alloc(65), threshold: 100 }],
        hash: '0x' + '1'.repeat(64)
      };

      const result1 = await validator.validateHanko(hanko1, Buffer.from('test'), entities);
      expect(result1.valid).toBe(false);
      expect(result1.reason).toContain('Insufficient EOA signatures');

      // 2 EOA signatures (should pass)
      const hanko2 = {
        placeholders: [{ type: 'eoa' }, { type: 'eoa' }],
        packedSignatures: Buffer.alloc(130),
        claims: [{ entityId: 'E1', signature: Buffer.alloc(65), threshold: 100 }],
        hash: '0x' + '2'.repeat(64)
      };

      const result2 = await validator.validateHanko(hanko2, Buffer.from('test'), entities);
      expect(result2.valid).toBe(true);
      expect(result2.eaoSignatureCount).toBe(2);
    });

    it('should detect and prevent circular delegation', async () => {
      const validator = new HankoValidator(HankoSecurityProfiles.STRICT);

      // Create circular delegation: A -> B -> C -> A
      const entities = new Map([
        ['A', { id: 'A', publicKey: '0xa', threshold: 100, delegates: ['B'], delegateThresholds: [100] }],
        ['B', { id: 'B', publicKey: '0xb', threshold: 100, delegates: ['C'], delegateThresholds: [100] }],
        ['C', { id: 'C', publicKey: '0xc', threshold: 100, delegates: ['A'], delegateThresholds: [100] }]
      ]);

      const hanko = {
        placeholders: [],
        packedSignatures: Buffer.from(''),
        claims: [
          { entityId: 'A', entityIndexes: [0], weights: [100], threshold: 100 },
          { entityId: 'B', entityIndexes: [0], weights: [100], threshold: 100 },
          { entityId: 'C', entityIndexes: [0], weights: [100], threshold: 100 }
        ],
        hash: '0x' + '3'.repeat(64)
      };

      const result = await validator.validateHanko(hanko, Buffer.from('test'), entities);
      expect(result.valid).toBe(false);
      expect(result.circularDetected).toBe(true);
      expect(result.reason).toContain('Circular delegation detected');
    });

    it('should enforce maximum delegation depth', async () => {
      const validator = new HankoValidator({
        minEOASignatures: 0,
        maxDelegationDepth: 2,
        preventCircular: true
      });

      // Create deep delegation chain: A -> B -> C -> D
      const entities = new Map([
        ['A', { id: 'A', publicKey: '0xa', threshold: 100, delegates: ['B'], delegateThresholds: [100] }],
        ['B', { id: 'B', publicKey: '0xb', threshold: 100, delegates: ['C'], delegateThresholds: [100] }],
        ['C', { id: 'C', publicKey: '0xc', threshold: 100, delegates: ['D'], delegateThresholds: [100] }],
        ['D', { id: 'D', publicKey: '0xd', threshold: 100, delegates: [], delegateThresholds: [], signature: Buffer.alloc(65) }]
      ]);

      const hanko = {
        placeholders: [{ type: 'entity' }],
        packedSignatures: Buffer.alloc(65),
        claims: [
          { entityId: 'A', entityIndexes: [0], weights: [100], threshold: 100, delegationDepth: 4 }
        ],
        hash: '0x' + '4'.repeat(64)
      };

      const result = await validator.validateHanko(hanko, Buffer.from('test'), entities);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Delegation depth exceeded');
    });
  });

  describe('Organizational Primitives', () => {
    it('should handle dual-class shares with sunset provisions', async () => {
      const config = {
        entityId: 'startup',
        classA: {
          symbol: 'A',
          name: 'Common',
          votingMultiplier: 1,
          economicMultiplier: 1,
          totalSupply: 0n,
          transferRestrictions: [],
          conversionRights: [],
          dividendPriority: 1
        },
        classB: {
          symbol: 'B',
          name: 'Super',
          votingMultiplier: 10,
          economicMultiplier: 1,
          totalSupply: 0n,
          transferRestrictions: [{ type: 'lockup' as const, expiresAt: Date.now() + 86400000 }],
          conversionRights: [{
            targetClass: 'A',
            ratio: 1,
            trigger: { type: 'time' as const, condition: Date.now() + 100 }
          }],
          dividendPriority: 1
        },
        votingAgreements: []
      };

      const shares = new DualClassShares(config);

      // Issue shares
      await shares.issueShares('founder', 'B', 1000000n);
      await shares.issueShares('investor', 'A', 500000n);

      // Check voting power (B has 10x multiplier)
      const founderPower = shares.calculateVotingPower('founder');
      const investorPower = shares.calculateVotingPower('investor');
      expect(founderPower).toBe(10000000n); // 1M * 10
      expect(investorPower).toBe(500000n);   // 500k * 1

      // Check governance scenarios
      expect(shares.checkProposalOutcome('ordinary', founderPower, investorPower)).toBe(true);
      expect(shares.checkProposalOutcome('supermajority', founderPower, investorPower)).toBe(true);

      // Test share conversion (after trigger time)
      await new Promise(resolve => setTimeout(resolve, 150));
      await shares.convertShares('founder', 'B', 'A', 100000n);
      const distribution = shares.getShareDistribution();
      expect(distribution.classA.totalSupply).toBe('600000');
      expect(distribution.classB.totalSupply).toBe('900000');
    });

    it('should manage risk with circuit breakers', async () => {
      const committee = new RiskCommittee('bank');

      // Add committee member
      await committee.addMember({
        address: 'cro',
        name: 'Chief Risk Officer',
        role: 'chair',
        votingPower: 2,
        specializations: ['credit', 'market'],
        joinedAt: Date.now(),
        term: { start: Date.now(), end: Date.now() + 86400000, renewable: true }
      });

      // Update exposures
      await committee.updateExposure({
        channelId: 'ch1',
        counterparty: 'client1',
        exposureType: 'credit',
        currentValue: 1000000n,
        maxValue: 2000000n,
        utilization: 50,
        lastUpdated: Date.now()
      });

      // Submit risk assessment
      const assessment = await committee.submitRiskAssessment({
        submitter: 'analyst',
        exposure: 1000000n,
        counterpartyRating: 85,
        complexityScore: 3,
        regulatoryFlags: []
      });

      expect(assessment.status).toBeDefined();
      expect(assessment.riskScore).toBeLessThanOrEqual(100);

      // Generate report
      const report = committee.generateRiskReport();
      expect(report.metrics.totalExposure).toBe(1000000n);
      expect(report.committeeSize).toBe(1);
      expect(report.complianceScore).toBe(100);
    });

    it('should create subsidiary structures', async () => {
      const factory = new SubsidiaryFactory();

      // Create SPV
      const spv = await factory.createSPV('parent', 'Patent acquisition', 1000000n);
      expect(spv.config.type).toBe('spv');
      expect(spv.config.dissolution.triggers.some(t => t.type === 'event')).toBe(true);

      // Create joint venture
      const jv = await factory.createJointVenture(
        [
          { entityId: 'p1', contribution: 600000n, nominee: 'd1' },
          { entityId: 'p2', contribution: 400000n, nominee: 'd2' }
        ],
        { name: 'JV Test', purpose: 'Testing' }
      );

      expect(jv.config.type).toBe('joint_venture');
      expect(jv.config.capitalStructure.shares.length).toBe(2);
      expect(jv.config.capitalStructure.shares[0].percentage).toBe(60);
      expect(jv.config.capitalStructure.shares[1].percentage).toBe(40);

      // Create series LLC
      const series = await factory.createSeriesLLC('parent', 3);
      expect(series.length).toBe(4); // Master + 3 series
      expect(series[0].config.type).toBe('series_llc');
      expect(series[1].config.name).toBe('Series A');
    });
  });
});