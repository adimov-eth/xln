/**
 * Complete XLN system integration tests
 *
 * Tests the full stack:
 * - Entity consensus
 * - Channel operations
 * - Transformers
 * - Cross-chain bridges
 * - Fee market
 * - P2P networking
 * - Persistence
 */

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { EntityState, EntityReplica } from '../../src/types.js';
import { EntityChannelBridge } from '../../src/EntityChannelBridge.js';
import { CrossChainBridge } from '../../src/bridges/CrossChainBridge.js';
import { FeeMarket } from '../../src/fee/FeeMarket.js';
import { SwapTransformer } from '../../src/transformers/SwapTransformer.js';
import { HTLCTransformer } from '../../src/transformers/HTLCTransformer.js';
import { FlashLoanTransformer } from '../../src/transformers/FlashLoanTransformer.js';
import { ValidatorNode } from '../../src/consensus/ValidatorNode.js';
import { P2PNetwork } from '../../src/network/P2PNetwork.js';
import { StatePersistence } from '../../src/persistence/StatePersistence.js';
import { NetworkSimulator } from '../../src/simulator/NetworkSimulator.js';
import { TransformContext } from '../../src/transformers/BaseTransformer.js';
import { Subchannel } from '../../old_src/types/Subchannel.js';

describe('XLN Complete System Integration', () => {
  let validators: ValidatorNode[] = [];
  let p2pNetworks: P2PNetwork[] = [];
  let persistence: StatePersistence;
  let feeMarket: FeeMarket;
  let crossChainBridge: CrossChainBridge;
  let entityBridge: EntityChannelBridge;

  beforeAll(async () => {
    // Initialize persistence
    persistence = new StatePersistence('./test-data');
    await persistence.initialize();

    // Initialize fee market
    feeMarket = new FeeMarket();

    // Initialize cross-chain bridge
    crossChainBridge = new CrossChainBridge();

    // Initialize entity-channel bridge
    entityBridge = new EntityChannelBridge({
      chainId: 1,
      networkId: 'test-network'
    });

    // Start validator nodes
    for (let i = 0; i < 4; i++) {
      const validator = new ValidatorNode({
        validatorId: `validator-${i}`,
        port: 8545 + i,
        stake: 100000,
        peers: validators.map(v => ({
          id: v.validatorId,
          endpoint: `http://localhost:${v.port}`
        }))
      });
      await validator.start();
      validators.push(validator);
    }

    // Start P2P networks
    for (let i = 0; i < 3; i++) {
      const p2p = new P2PNetwork({
        nodeId: `node-${i}`,
        port: 30303 + i,
        bootstrapNodes: i > 0 ? [`localhost:30303`] : []
      });
      await p2p.start();
      p2pNetworks.push(p2p);
    }
  });

  afterAll(async () => {
    // Cleanup
    for (const validator of validators) {
      await validator.stop();
    }
    for (const p2p of p2pNetworks) {
      await p2p.stop();
    }
  });

  describe('Entity Consensus', () => {
    test('Byzantine fault tolerance with 3f+1 validators', async () => {
      // Create entity state
      const entityState: EntityState = {
        id: '0x' + '1'.repeat(40),
        seq: 1,
        stateRoot: '0x' + '0'.repeat(64),
        timestamp: BigInt(Date.now()),
        transactions: []
      };

      // Propose block through first validator
      const leader = validators[0];
      await leader.proposeBlock(entityState);

      // Wait for consensus
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify all honest validators agreed
      for (const validator of validators.slice(0, 3)) {
        const state = await validator.getEntityState(entityState.id);
        expect(state?.seq).toBe(1);
        expect(state?.stateRoot).toBe(entityState.stateRoot);
      }
    });

    test('View change on leader failure', async () => {
      // Simulate leader failure
      await validators[0].stop();

      // Wait for view change
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify new leader elected
      const newLeader = validators[1];
      expect(newLeader.isLeader()).toBe(true);

      // Restart failed validator
      await validators[0].start();
    });
  });

  describe('Channel Operations', () => {
    test('Open bilateral channel with credit limits', async () => {
      const alice = '0x' + 'a'.repeat(40);
      const bob = '0x' + 'b'.repeat(40);

      // Initialize entity replicas
      const aliceReplica: EntityReplica = {
        entityState: {
          id: alice,
          seq: 0,
          stateRoot: '0x0',
          timestamp: 0n,
          transactions: []
        },
        mempool: [],
        consensusState: 'idle',
        view: 0,
        signatures: new Map()
      };

      await entityBridge.initialize(alice, aliceReplica);

      // Open channel
      await entityBridge.processEntityTx(alice, {
        type: 'channel_open',
        data: {
          peerId: bob,
          initialDeposit: 1000000,
          creditLimit: 500000
        }
      });

      // Verify channel created
      const capacity = await entityBridge.getChannelCapacity(
        `${alice}-${bob}`,
        true
      );

      expect(capacity).toBeDefined();
      expect(capacity.collateral).toBe(1000000n);
    });

    test('Bilateral swap without global pool', async () => {
      const context: TransformContext = {
        channelKey: 'alice-bob',
        subchannels: new Map([[0, createTestSubchannel()]]),
        timestamp: Date.now(),
        nonce: 1
      };

      const swap = new SwapTransformer();
      const result = await swap.transform(context, {
        action: 'swap',
        amountIn: '1000',
        tokenIn: 0,
        tokenOut: 1,
        minAmountOut: '900'
      });

      expect(result.success).toBe(true);
      expect(result.proof).toBeDefined();
    });

    test('HTLC routing across multiple channels', async () => {
      const htlc = new HTLCTransformer();

      // Create payment route: Alice -> Bob -> Charlie
      const contexts = new Map<string, TransformContext>([
        ['alice-bob', createTestContext('alice-bob')],
        ['bob-charlie', createTestContext('bob-charlie')]
      ]);

      // Lock payment
      const lockResult = await htlc.transform(contexts.get('alice-bob')!, {
        action: 'lock',
        amount: '1000',
        hashlock: '0x' + '1'.repeat(64),
        timelock: Date.now() + 3600000,
        receiver: 'charlie'
      });

      expect(lockResult.success).toBe(true);

      // Forward through Bob
      const forwardResult = await htlc.transform(contexts.get('bob-charlie')!, {
        action: 'forward',
        htlcId: lockResult.data.htlcId,
        amount: '990' // Bob takes 10 as fee
      });

      expect(forwardResult.success).toBe(true);

      // Charlie reveals preimage
      const unlockResult = await htlc.transform(contexts.get('bob-charlie')!, {
        action: 'unlock',
        htlcId: forwardResult.data.htlcId,
        preimage: '0x' + '2'.repeat(64)
      });

      expect(unlockResult.success).toBe(true);
    });

    test('Flash loan within bilateral channel', async () => {
      const context = createTestContext('alice-bob');
      const flashLoan = new FlashLoanTransformer();

      // Request flash loan
      const loanResult = await flashLoan.transform(context, {
        action: 'borrow',
        amount: '10000',
        callback: async (loanedAmount: bigint) => {
          // Simulate arbitrage with borrowed funds
          const profit = loanedAmount / 10n; // 10% profit
          return loanedAmount + profit;
        }
      });

      expect(loanResult.success).toBe(true);
      expect(loanResult.data.profit).toBe('1000');
    });
  });

  describe('Cross-Chain Operations', () => {
    test('Open cross-chain bilateral channel', async () => {
      const context: TransformContext = {
        channelKey: 'cross-chain-test',
        subchannels: new Map(),
        timestamp: Date.now(),
        nonce: 0
      };

      const result = await crossChainBridge.transform(context, {
        action: 'openCrossChain',
        sourceChainId: 1,
        targetChainId: 137,
        sourceEntity: '0x' + 'a'.repeat(40),
        targetEntity: '0x' + 'b'.repeat(40),
        sourceCollateral: '1000000',
        targetCollateral: '1000000',
        creditLimit: '500000'
      });

      expect(result.success).toBe(true);
      expect(result.data.sourceChain).toBe('Ethereum');
      expect(result.data.targetChain).toBe('Polygon');
    });

    test('Transfer value across chains', async () => {
      const channelKey = '1-137-0x' + 'a'.repeat(40) + '-0x' + 'b'.repeat(40);

      // First open the channel
      const context: TransformContext = {
        channelKey,
        subchannels: new Map(),
        timestamp: Date.now(),
        nonce: 0
      };

      await crossChainBridge.transform(context, {
        action: 'openCrossChain',
        sourceChainId: 1,
        targetChainId: 137,
        sourceEntity: '0x' + 'a'.repeat(40),
        targetEntity: '0x' + 'b'.repeat(40),
        sourceCollateral: '1000000',
        targetCollateral: '1000000',
        creditLimit: '500000'
      });

      // Transfer from Ethereum to Polygon
      const transferResult = await crossChainBridge.transform(context, {
        action: 'transferCrossChain',
        channelKey,
        amount: '10000',
        direction: 'sourceToTarget'
      });

      expect(transferResult.success).toBe(true);
      expect(transferResult.data.transferId).toBeDefined();
    });

    test('Atomic cross-chain swap', async () => {
      const bridge = new CrossChainBridge();
      const atomicSwap = new (await import('../../src/bridges/CrossChainBridge.js')).AtomicCrossChainSwap(bridge);

      const swapResult = await atomicSwap.initiateSwap({
        sourceChain: 1,
        targetChain: 137,
        sourceAmount: 1000000n,
        targetAmount: 900000n,
        sourceEntity: '0x' + 'a'.repeat(40),
        targetEntity: '0x' + 'b'.repeat(40),
        timelock: 3600
      });

      expect(swapResult.success).toBe(true);
      expect(swapResult.data.swapId).toBeDefined();
    });
  });

  describe('Fee Market', () => {
    test('Dynamic fee calculation based on utilization', async () => {
      const context = createTestContext('alice-bob');

      // Low utilization fee
      const lowUtilFee = await feeMarket.transform(context, {
        action: 'calculateFee',
        channelKey: 'alice-bob',
        amount: '10000',
        priority: false
      });

      expect(lowUtilFee.success).toBe(true);
      const lowFee = BigInt(lowUtilFee.data.fee);

      // Increase utilization
      const subchannel = context.subchannels.get(0)!;
      subchannel.offdelta = subchannel.collateral * 8n / 10n; // 80% utilized

      // High utilization fee
      const highUtilFee = await feeMarket.transform(context, {
        action: 'calculateFee',
        channelKey: 'alice-bob',
        amount: '10000',
        priority: false
      });

      expect(highUtilFee.success).toBe(true);
      const highFee = BigInt(highUtilFee.data.fee);

      // High utilization should have higher fees
      expect(highFee).toBeGreaterThan(lowFee);
    });

    test('Reputation-based fee discounts', async () => {
      // Build good reputation
      for (let i = 0; i < 10; i++) {
        await feeMarket.transform({} as TransformContext, {
          action: 'updateReputation',
          entity: '0x' + 'a'.repeat(40),
          success: true,
          volume: '100000'
        });
      }

      // Build bad reputation
      for (let i = 0; i < 5; i++) {
        await feeMarket.transform({} as TransformContext, {
          action: 'updateReputation',
          entity: '0x' + 'c'.repeat(40),
          success: false,
          volume: '10000'
        });
      }

      const context = createTestContext('alice-charlie');

      // Calculate fee with good reputation
      const goodRepFee = await feeMarket.transform(context, {
        action: 'calculateFee',
        channelKey: 'alice-charlie',
        amount: '10000',
        priority: false
      });

      expect(goodRepFee.success).toBe(true);
      expect(goodRepFee.data.breakdown.discount).not.toBe('0');
    });
  });

  describe('P2P Networking', () => {
    test('Gossip channel updates across network', async () => {
      const channelUpdate = {
        channelKey: 'alice-bob',
        seq: 1,
        stateHash: '0x' + '1'.repeat(64),
        leftSig: '0x' + '2'.repeat(64),
        rightSig: '0x' + '3'.repeat(64)
      };

      // Broadcast from first node
      p2pNetworks[0].gossipChannelUpdate(channelUpdate);

      // Wait for propagation
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify all nodes received update
      for (const p2p of p2pNetworks) {
        const received = p2p.getChannelUpdate('alice-bob');
        expect(received).toBeDefined();
        expect(received?.seq).toBe(1);
      }
    });

    test('Peer discovery and connection', async () => {
      // Verify all nodes discovered each other
      for (const p2p of p2pNetworks) {
        const peers = p2p.getConnectedPeers();
        expect(peers.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('State Persistence', () => {
    test('Write-Ahead Log for crash recovery', async () => {
      const entry = {
        type: 'channel_update',
        data: {
          channelKey: 'alice-bob',
          delta: '1000'
        }
      };

      // Write to WAL
      await persistence.writeWAL(entry);

      // Simulate crash and recovery
      const recovered = await persistence.recoverFromWAL();
      expect(recovered.length).toBeGreaterThan(0);
      expect(recovered[0].type).toBe('channel_update');
    });

    test('Periodic snapshots with merkle proofs', async () => {
      // Create snapshot
      const snapshot = await persistence.createSnapshot();
      expect(snapshot.root).toBeDefined();
      expect(snapshot.timestamp).toBeDefined();

      // Generate merkle proof
      const proof = await persistence.generateMerkleProof('alice-bob');
      expect(proof).toBeDefined();
      expect(proof?.root).toBe(snapshot.root);
    });
  });

  describe('Network Simulation', () => {
    test('Simulate network with Byzantine nodes', async () => {
      const simulator = new NetworkSimulator({
        numEntities: 100,
        numChannels: 500,
        numValidators: 7,
        byzantineRatio: 20, // 20% Byzantine
        networkLatency: 10,
        packetLoss: 1,
        transactionRate: 100,
        simulationDuration: 10,
        checkpointInterval: 5
      });

      await simulator.initialize();
      const result = await simulator.run();

      // Network should maintain safety despite Byzantine nodes
      expect(result.finalConsistency).toBe(true);
      expect(result.successRate).toBeGreaterThan(0.95);
    });

    test('Stress test with 10k channels', async () => {
      const simulator = new NetworkSimulator({
        numEntities: 1000,
        numChannels: 10000,
        numValidators: 13,
        byzantineRatio: 0,
        networkLatency: 1,
        packetLoss: 0,
        transactionRate: 1000,
        simulationDuration: 5,
        checkpointInterval: 1
      });

      await simulator.initialize();
      const result = await simulator.run();

      // Should handle scale
      expect(result.averageTPS).toBeGreaterThan(10000);
      expect(result.averageLatency).toBeLessThan(100);
    });
  });

  describe('End-to-End Scenarios', () => {
    test('Complete DeFi transaction flow', async () => {
      // 1. Open channel
      const channelKey = 'defi-alice-bob';
      const context = createTestContext(channelKey);

      // 2. Calculate and collect fees
      const feeQuote = await feeMarket.transform(context, {
        action: 'getFeeQuote',
        amount: '10000',
        priority: true
      });

      // 3. Execute swap
      const swap = new SwapTransformer();
      const swapResult = await swap.transform(context, {
        action: 'swap',
        amountIn: '10000',
        tokenIn: 0,
        tokenOut: 1,
        minAmountOut: '9000'
      });

      // 4. Collect fee
      await feeMarket.transform(context, {
        action: 'collectFee',
        channelKey,
        fee: feeQuote.data.quote,
        payer: 'left'
      });

      // 5. Persist state
      await persistence.writeWAL({
        type: 'swap_complete',
        data: swapResult.data
      });

      // 6. Broadcast to network
      p2pNetworks[0].broadcast({
        type: 'channel_update',
        channelKey,
        data: swapResult.proof
      });

      expect(swapResult.success).toBe(true);
    });

    test('Cross-chain arbitrage with flash loans', async () => {
      // Setup: Channels on different chains
      const ethContext = createTestContext('eth-alice-bob');
      const polyContext = createTestContext('poly-alice-bob');

      // 1. Take flash loan on Ethereum
      const flashLoan = new FlashLoanTransformer();
      const loanResult = await flashLoan.transform(ethContext, {
        action: 'borrow',
        amount: '100000',
        callback: async (borrowed: bigint) => {
          // 2. Transfer to Polygon
          const transferResult = await crossChainBridge.transform(ethContext, {
            action: 'transferCrossChain',
            channelKey: '1-137-alice-bob',
            amount: borrowed.toString(),
            direction: 'sourceToTarget'
          });

          // 3. Arbitrage on Polygon (simulated 10% profit)
          const profit = borrowed / 10n;

          // 4. Transfer back to Ethereum
          await crossChainBridge.transform(polyContext, {
            action: 'transferCrossChain',
            channelKey: '1-137-alice-bob',
            amount: (borrowed + profit).toString(),
            direction: 'targetToSource'
          });

          // 5. Repay flash loan with profit
          return borrowed + profit;
        }
      });

      expect(loanResult.success).toBe(true);
      expect(BigInt(loanResult.data.profit)).toBeGreaterThan(0n);
    });
  });
});

// Helper functions
function createTestSubchannel(): Subchannel {
  return {
    chainId: 1,
    tokenId: 0,
    leftCreditLimit: 100000n,
    rightCreditLimit: 100000n,
    leftAllowence: 0n,
    rightAllowence: 0n,
    collateral: 1000000n,
    ondelta: 0n,
    offdelta: 0n,
    cooperativeNonce: 0,
    disputeNonce: 0,
    deltas: [],
    proposedEvents: [],
    proposedEventsByLeft: false
  };
}

function createTestContext(channelKey: string): TransformContext {
  return {
    channelKey,
    subchannels: new Map([[0, createTestSubchannel()]]),
    timestamp: Date.now(),
    nonce: 0
  };
}