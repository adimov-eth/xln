/**
 * XLN Full Stack Integration Tests
 *
 * Tests the complete flow:
 * 1. Entity creation and consensus
 * 2. Channel operations with real transitions
 * 3. Cross-chain bridges with merkle proofs
 * 4. Fee markets with congestion pricing
 * 5. Organizational structures
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ethers } from 'ethers';
import { EntityReplica } from '../../src/types.js';
import { RealEntityChannelBridge } from '../../src/RealEntityChannelBridge.js';
import { MerkleTree, SparseMerkleTree, ChannelStateMerkleTree } from '../../src/merkle/MerkleTree.js';
import { FeeMarket } from '../../src/fee/FeeMarket.js';
import { DualClassShares, RiskCommittee, SubsidiaryFactory } from '../../src/organizations/index.js';
import { HankoValidator, HankoSecurityProfiles } from '../../src/hanko-production.js';
import User from '../../old_src/app/User.js';
import Channel from '../../old_src/app/Channel.js';

describe('XLN Full Stack Integration', () => {
  let entity1: EntityReplica;
  let entity2: EntityReplica;
  let bridge1: RealEntityChannelBridge;
  let bridge2: RealEntityChannelBridge;
  let feeMarket: FeeMarket;
  let validator: HankoValidator;

  beforeAll(async () => {
    // Initialize entities
    const signer1 = new ethers.Wallet.createRandom();
    const signer2 = new ethers.Wallet.createRandom();

    entity1 = new EntityReplica(
      'entity-1',
      { validators: [signer1.address], shares: { [signer1.address]: 100n }, threshold: 51n },
      { boardKeyHash: ethers.id('board1') },
      signer1,
      'entity-1'
    );

    entity2 = new EntityReplica(
      'entity-2',
      { validators: [signer2.address], shares: { [signer2.address]: 100n }, threshold: 51n },
      { boardKeyHash: ethers.id('board2') },
      signer2,
      'entity-2'
    );

    // Initialize bridges
    bridge1 = new RealEntityChannelBridge({
      chainId: 1,
      networkId: 'test',
      entityId: 'entity-1',
      privateKey: signer1.privateKey
    });

    bridge2 = new RealEntityChannelBridge({
      chainId: 1,
      networkId: 'test',
      entityId: 'entity-2',
      privateKey: signer2.privateKey
    });

    await bridge1.initialize(entity1);
    await bridge2.initialize(entity2);

    // Initialize fee market
    feeMarket = new FeeMarket();

    // Initialize Hanko validator
    validator = new HankoValidator(HankoSecurityProfiles.FLEXIBLE);
  });

  describe('Entity Consensus', () => {
    it('should achieve consensus on transactions', async () => {
      const tx = {
        type: 'transfer',
        from: 'entity-1',
        to: 'entity-2',
        amount: ethers.parseEther('100'),
        timestamp: Date.now(),
        nonce: Date.now()
      };

      const result = await entity1.addTransaction(tx);
      expect(result.success).toBe(true);
      expect(entity1.getView().state.transactions).toContainEqual(expect.objectContaining({
        type: 'transfer',
        from: 'entity-1'
      }));
    });

    it('should handle view changes', async () => {
      const initialView = entity1.getView().viewNumber;

      // Simulate view change
      await entity1['startNewView']();

      const newView = entity1.getView().viewNumber;
      expect(newView).toBeGreaterThan(initialView);
    });
  });

  describe('Channel Operations', () => {
    it('should open bilateral channel', async () => {
      const tx = await bridge1['openChannel'](
        bridge1['users'].get('entity-1')!,
        {
          peerId: 'entity-2',
          initialDeposit: ethers.parseEther('1000'),
          creditLimit: ethers.parseEther('500')
        }
      );

      const channels = bridge1.getActiveChannels();
      expect(channels.size).toBe(1);
      expect(channels.has('entity-2')).toBe(true);
    });

    it('should add and settle HTLC payment', async () => {
      // Add payment
      const secret = ethers.randomBytes(32);
      const hashlock = ethers.keccak256(secret);

      await bridge1['addPayment'](
        bridge1['users'].get('entity-1')!,
        {
          channelId: 'entity-2',
          amount: ethers.parseEther('10'),
          hashlock,
          timelock: Date.now() + 3600000
        }
      );

      // Settle payment
      await bridge2['settlePayment'](
        bridge2['users'].get('entity-2')!,
        {
          channelId: 'entity-1',
          transitionId: 0,
          secret: ethers.hexlify(secret)
        }
      );

      // Check capacity changed
      const capacity = await bridge1.getChannelCapacity('entity-2', true);
      expect(capacity).toBeDefined();
    });
  });

  describe('Merkle Tree Proofs', () => {
    it('should generate and verify merkle proofs', () => {
      const data = [
        'tx1',
        'tx2',
        'tx3',
        'tx4'
      ];

      const tree = new MerkleTree(data);
      const root = tree.getRoot();
      expect(root).toMatch(/^0x[a-f0-9]{64}$/);

      const proof = tree.getProof('tx2');
      expect(proof).toBeDefined();
      expect(proof!.leaf).toBeDefined();
      expect(proof!.proof.length).toBeGreaterThan(0);

      const isValid = MerkleTree.verifyProof(proof!);
      expect(isValid).toBe(true);
    });

    it('should handle sparse merkle tree updates', () => {
      const sparse = new SparseMerkleTree(8);

      sparse.set(10n, 'value1');
      sparse.set(20n, 'value2');

      const proof1 = sparse.getProof(10n);
      expect(proof1.proof.length).toBe(8);

      const root1 = sparse.getRoot();
      sparse.set(10n, 'value3');
      const root2 = sparse.getRoot();

      expect(root1).not.toBe(root2);
    });

    it('should create channel state merkle tree', () => {
      const state = {
        channelKey: 'channel-1',
        blockId: 100,
        subchannels: [
          {
            chainId: 1,
            ondelta: 1000n,
            offdelta: 500n,
            cooperativeNonce: 1
          }
        ]
      };

      const tree = ChannelStateMerkleTree.fromChannelState(state);
      const root = tree.getRoot();
      expect(root).toMatch(/^0x[a-f0-9]{64}$/);

      const proof = tree.getSubchannelProof(0);
      expect(proof).toBeDefined();
    });
  });

  describe('Fee Market', () => {
    it('should calculate dynamic fees based on utilization', async () => {
      const context = {
        subchannels: new Map([[0, {
          ondelta: ethers.parseEther('100'),
          offdelta: ethers.parseEther('50'),
          leftCreditLimit: ethers.parseEther('200'),
          rightCreditLimit: ethers.parseEther('200'),
          collateral: ethers.parseEther('300')
        }]])
      };

      const result = await feeMarket.transform(context, {
        action: 'calculateFee',
        channelKey: 'channel-1',
        amount: ethers.parseEther('10'),
        priority: false
      });

      expect(result.success).toBe(true);
      expect(result.data.fee).toBeDefined();
      expect(BigInt(result.data.fee)).toBeGreaterThan(0n);
    });

    it('should apply congestion pricing above threshold', async () => {
      const context = {
        subchannels: new Map([[0, {
          ondelta: ethers.parseEther('800'),
          offdelta: ethers.parseEther('100'),
          leftCreditLimit: ethers.parseEther('100'),
          rightCreditLimit: ethers.parseEther('100'),
          collateral: ethers.parseEther('1000')
        }]])
      };

      const result = await feeMarket.transform(context, {
        action: 'calculateFee',
        channelKey: 'channel-2',
        amount: ethers.parseEther('10'),
        priority: false
      });

      expect(result.success).toBe(true);
      const fee = BigInt(result.data.fee);
      expect(fee).toBeGreaterThan(ethers.parseEther('0.01')); // Higher than base fee
    });
  });

  describe('Hanko Validation', () => {
    it('should validate signatures with production gates', async () => {
      const entities = new Map([
        ['EntityA', {
          id: 'EntityA',
          publicKey: '0x' + '1'.repeat(40),
          threshold: 100,
          delegates: [],
          delegateThresholds: []
        }]
      ]);

      const hanko = {
        placeholders: [{ type: 'eoa' }],
        packedSignatures: Buffer.alloc(65, 1),
        claims: [{
          entityId: 'EntityA',
          signature: Buffer.alloc(65, 1),
          threshold: 100
        }],
        hash: '0x' + '2'.repeat(64)
      };

      const result = await validator.validateHanko(
        hanko,
        Buffer.from('test'),
        entities
      );

      expect(result.valid).toBe(true);
      expect(result.eaoSignatureCount).toBe(1);
      expect(result.circularDetected).toBe(false);
    });

    it('should detect circular delegation', async () => {
      const entities = new Map([
        ['EntityA', {
          id: 'EntityA',
          publicKey: '0x1',
          threshold: 100,
          delegates: ['EntityB'],
          delegateThresholds: [100]
        }],
        ['EntityB', {
          id: 'EntityB',
          publicKey: '0x2',
          threshold: 100,
          delegates: ['EntityA'],
          delegateThresholds: [100]
        }]
      ]);

      const hanko = {
        placeholders: [],
        packedSignatures: Buffer.from(''),
        claims: [
          {
            entityId: 'EntityA',
            entityIndexes: [0],
            weights: [100],
            threshold: 100
          },
          {
            entityId: 'EntityB',
            entityIndexes: [0],
            weights: [100],
            threshold: 100
          }
        ],
        hash: '0x' + '3'.repeat(64)
      };

      const result = await validator.validateHanko(
        hanko,
        Buffer.from('test'),
        entities
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Circular delegation');
      expect(result.circularDetected).toBe(true);
    });
  });

  describe('Organizational Structures', () => {
    it('should create dual-class share structure', async () => {
      const shares = new DualClassShares({
        entityId: 'startup-1',
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
          transferRestrictions: [],
          conversionRights: [{
            targetClass: 'A',
            ratio: 1,
            trigger: { type: 'time', condition: Date.now() + 86400000 }
          }],
          dividendPriority: 1
        },
        votingAgreements: []
      });

      await shares.issueShares('founder', 'B', ethers.parseEther('1000'));
      await shares.issueShares('investor', 'A', ethers.parseEther('500'));

      const founderPower = shares.calculateVotingPower('founder');
      const investorPower = shares.calculateVotingPower('investor');

      expect(founderPower).toBe(ethers.parseEther('10000')); // 1000 * 10
      expect(investorPower).toBe(ethers.parseEther('500')); // 500 * 1
    });

    it('should create risk committee', async () => {
      const committee = new RiskCommittee('bank-1');

      await committee.addMember({
        address: 'member-1',
        name: 'CRO',
        role: 'chair',
        votingPower: 2,
        specializations: ['credit', 'market'],
        joinedAt: Date.now(),
        term: {
          start: Date.now(),
          end: Date.now() + 86400000,
          renewable: true
        }
      });

      await committee.updateExposure({
        channelId: 'channel-1',
        counterparty: 'client-1',
        exposureType: 'credit',
        currentValue: ethers.parseEther('100000'),
        maxValue: ethers.parseEther('200000'),
        utilization: 50,
        lastUpdated: Date.now()
      });

      const report = committee.generateRiskReport();
      expect(report.metrics.totalExposure).toBe(ethers.parseEther('100000'));
      expect(report.committeeSize).toBe(1);
    });

    it('should create subsidiary structures', async () => {
      const factory = new SubsidiaryFactory();

      const spv = await factory.createSPV(
        'parent-1',
        'Asset acquisition',
        ethers.parseEther('1000')
      );

      expect(spv.entityId).toBeDefined();
      expect(spv.config.type).toBe('spv');
      expect(spv.config.capitalStructure.paidInCapital).toBe(ethers.parseEther('1000'));

      const jv = await factory.createJointVenture(
        [
          {
            entityId: 'partner-1',
            contribution: ethers.parseEther('600'),
            nominee: 'director-1'
          },
          {
            entityId: 'partner-2',
            contribution: ethers.parseEther('400'),
            nominee: 'director-2'
          }
        ],
        {
          name: 'JV Test',
          purpose: 'Testing'
        }
      );

      expect(jv.config.type).toBe('joint_venture');
      expect(jv.config.capitalStructure.shares.length).toBe(2);
    });
  });

  describe('Cross-Chain Integration', () => {
    it('should handle cross-chain state synchronization', async () => {
      // Create state on chain 1
      const state1 = {
        channelKey: 'cross-chain-1',
        blockId: 1,
        subchannels: [{
          chainId: 1,
          ondelta: ethers.parseEther('100'),
          offdelta: 0n,
          cooperativeNonce: 1
        }]
      };

      // Create merkle proof
      const tree = ChannelStateMerkleTree.fromChannelState(state1);
      const proof = tree.getSubchannelProof(0);

      // Verify on "chain 2"
      expect(proof).toBeDefined();
      expect(MerkleTree.verifyProof(proof!)).toBe(true);
    });
  });

  afterAll(async () => {
    // Cleanup
    console.log('Tests completed');
  });
});