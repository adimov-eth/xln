/**
 * NetworkSimulator: Test XLN at massive scale
 *
 * Simulates:
 * - Millions of bilateral channels
 * - Byzantine failures
 * - Network partitions
 * - Economic attacks
 * - Performance under load
 */

import { performance } from 'perf_hooks';
import {
  SwapTransformer,
  HTLCTransformer,
  FlashLoanTransformer,
  type TransformContext
} from '../transformers';
import { ValidatorNode } from '../consensus/ValidatorNode';
import { EntityChannelBridgeEnhanced } from '../EntityChannelBridgeEnhanced';
import { StatePersistence } from '../persistence/StatePersistence';
import { Subchannel } from '../../old_src/types/Subchannel';

export interface SimulationConfig {
  numEntities: number;
  numChannels: number;
  numValidators: number;
  byzantineRatio: number; // Percentage of Byzantine nodes
  networkLatency: number; // Average ms
  packetLoss: number; // Percentage
  transactionRate: number; // TPS per channel
  simulationDuration: number; // Seconds
  checkpointInterval: number; // Seconds
}

export interface SimulationResult {
  totalTransactions: bigint;
  successfulTransactions: bigint;
  failedTransactions: bigint;
  averageTPS: number;
  peakTPS: number;
  averageLatency: number;
  p99Latency: number;
  byzantineFailures: number;
  networkPartitions: number;
  slashingEvents: number;
  finalConsistency: boolean;
}

export interface SimulatedEntity {
  id: string;
  channels: Map<string, SimulatedChannel>;
  balance: bigint;
  reputation: number;
  isByzantine: boolean;
  isOnline: boolean;
}

export interface SimulatedChannel {
  channelKey: string;
  leftEntity: string;
  rightEntity: string;
  subchannels: Map<number, Subchannel>;
  context: TransformContext;
  transactionCount: number;
  volumeTraded: bigint;
  disputes: number;
}

export class NetworkSimulator {
  private config: SimulationConfig;
  private entities: Map<string, SimulatedEntity> = new Map();
  private channels: Map<string, SimulatedChannel> = new Map();
  private validators: ValidatorNode[] = [];
  private metrics: SimulationResult;
  private running = false;
  private startTime = 0;
  private tpsHistory: number[] = [];
  private latencyHistory: number[] = [];

  constructor(config: SimulationConfig) {
    this.config = config;
    this.metrics = this.initializeMetrics();
  }

  /**
   * Initialize simulation
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing XLN network simulation...');
    console.log(`   Entities: ${this.config.numEntities}`);
    console.log(`   Channels: ${this.config.numChannels}`);
    console.log(`   Validators: ${this.config.numValidators}`);
    console.log(`   Byzantine ratio: ${this.config.byzantineRatio}%`);

    // Create entities
    await this.createEntities();

    // Create channels
    await this.createChannels();

    // Create validators
    await this.createValidators();

    console.log('✅ Simulation initialized');
  }

  /**
   * Run simulation
   */
  async run(): Promise<SimulationResult> {
    console.log('\n📊 Starting simulation...\n');

    this.running = true;
    this.startTime = performance.now();

    // Start transaction generators
    const generators = this.startTransactionGenerators();

    // Start Byzantine actors
    const byzantineActors = this.startByzantineActors();

    // Start network chaos
    const chaosEngine = this.startChaosEngine();

    // Monitor metrics
    const monitor = this.startMetricsMonitor();

    // Run for configured duration
    await this.sleep(this.config.simulationDuration * 1000);

    // Stop simulation
    this.running = false;

    // Clean up
    generators.forEach(g => clearInterval(g));
    byzantineActors.forEach(a => clearInterval(a));
    clearInterval(chaosEngine);
    clearInterval(monitor);

    // Calculate final metrics
    this.calculateFinalMetrics();

    // Verify consistency
    this.metrics.finalConsistency = await this.verifyFinalConsistency();

    return this.metrics;
  }

  /**
   * Create simulated entities
   */
  private async createEntities(): Promise<void> {
    const byzantineCount = Math.floor(this.config.numEntities * this.config.byzantineRatio / 100);

    for (let i = 0; i < this.config.numEntities; i++) {
      const entity: SimulatedEntity = {
        id: `entity_${i}`,
        channels: new Map(),
        balance: 1000000n * 10n ** 6n, // 1M USDC
        reputation: 100,
        isByzantine: i < byzantineCount,
        isOnline: true
      };

      this.entities.set(entity.id, entity);
    }
  }

  /**
   * Create bilateral channels
   */
  private async createChannels(): Promise<void> {
    const entityIds = Array.from(this.entities.keys());
    const channelsPerEntity = Math.ceil(this.config.numChannels * 2 / this.config.numEntities);

    for (const [entityId, entity] of this.entities) {
      for (let i = 0; i < channelsPerEntity && this.channels.size < this.config.numChannels; i++) {
        // Random partner
        const partnerId = entityIds[Math.floor(Math.random() * entityIds.length)];
        if (partnerId === entityId) continue;

        const channelKey = this.createChannelKey(entityId, partnerId);

        if (this.channels.has(channelKey)) continue;

        // Create channel
        const channel = this.createChannel(entityId, partnerId);
        this.channels.set(channelKey, channel);

        // Add to entities
        entity.channels.set(channelKey, channel);
        this.entities.get(partnerId)!.channels.set(channelKey, channel);
      }
    }
  }

  /**
   * Create validator nodes
   */
  private async createValidators(): Promise<void> {
    for (let i = 0; i < this.config.numValidators; i++) {
      const config = {
        nodeId: `validator_${i}`,
        privateKey: Buffer.alloc(32, i),
        publicKey: Buffer.alloc(32, i + 100),
        peers: [],
        byzantineThreshold: Math.floor(this.config.numValidators / 3),
        blockTime: 1000,
        viewChangeTimeout: 5000,
        checkpointInterval: 10
      };

      const persistence = new StatePersistence({
        dataDir: `/tmp/xln_sim/${config.nodeId}`,
        walDir: `/tmp/xln_sim/${config.nodeId}/wal`,
        snapshotDir: `/tmp/xln_sim/${config.nodeId}/snapshots`,
        maxWalSize: 100 * 1024 * 1024,
        snapshotInterval: 1000,
        compressionLevel: 0,
        checksumAlgorithm: 'sha256'
      });

      const validator = new ValidatorNode(config, persistence);
      this.validators.push(validator);
    }
  }

  /**
   * Start transaction generators
   */
  private startTransactionGenerators(): NodeJS.Timer[] {
    const generators: NodeJS.Timer[] = [];

    for (const [channelKey, channel] of this.channels) {
      const interval = 1000 / this.config.transactionRate; // ms between transactions

      const generator = setInterval(() => {
        if (!this.running) return;

        // Random transaction type
        const txType = Math.random();

        if (txType < 0.6) {
          // 60% swaps
          this.simulateSwap(channel);
        } else if (txType < 0.8) {
          // 20% HTLCs
          this.simulateHTLC(channel);
        } else if (txType < 0.95) {
          // 15% flash loans
          this.simulateFlashLoan(channel);
        } else {
          // 5% complex strategies
          this.simulateComplexStrategy(channel);
        }
      }, interval + Math.random() * interval); // Add jitter

      generators.push(generator);
    }

    return generators;
  }

  /**
   * Start Byzantine actors
   */
  private startByzantineActors(): NodeJS.Timer[] {
    const actors: NodeJS.Timer[] = [];

    for (const [entityId, entity] of this.entities) {
      if (!entity.isByzantine) continue;

      const actor = setInterval(() => {
        if (!this.running) return;

        const attackType = Math.random();

        if (attackType < 0.3) {
          // Double spend attempt
          this.simulateDoubleSpend(entity);
        } else if (attackType < 0.5) {
          // Invalid state
          this.simulateInvalidState(entity);
        } else if (attackType < 0.7) {
          // Channel griefing
          this.simulateGriefing(entity);
        } else {
          // Eclipse attack
          this.simulateEclipseAttack(entity);
        }
      }, 10000); // Attack every 10 seconds

      actors.push(actor);
    }

    return actors;
  }

  /**
   * Start chaos engine for network failures
   */
  private startChaosEngine(): NodeJS.Timer {
    return setInterval(() => {
      if (!this.running) return;

      const chaosType = Math.random();

      if (chaosType < 0.1) {
        // 10% network partition
        this.simulateNetworkPartition();
      } else if (chaosType < 0.2) {
        // 10% mass disconnection
        this.simulateMassDisconnection();
      } else if (chaosType < 0.3) {
        // 10% latency spike
        this.simulateLatencySpike();
      }
    }, 5000); // Chaos every 5 seconds
  }

  /**
   * Monitor and record metrics
   */
  private startMetricsMonitor(): NodeJS.Timer {
    return setInterval(() => {
      if (!this.running) return;

      const currentTPS = this.calculateCurrentTPS();
      this.tpsHistory.push(currentTPS);

      if (currentTPS > this.metrics.peakTPS) {
        this.metrics.peakTPS = currentTPS;
      }

      // Log progress
      const elapsed = (performance.now() - this.startTime) / 1000;
      const progress = (elapsed / this.config.simulationDuration) * 100;

      console.log(`⏱️  Progress: ${progress.toFixed(1)}% | TPS: ${currentTPS} | Txs: ${this.metrics.totalTransactions}`);
    }, 1000); // Every second
  }

  /**
   * Simulate swap transaction
   */
  private simulateSwap(channel: SimulatedChannel): void {
    const startTime = performance.now();

    try {
      const result = SwapTransformer.execute({
        context: channel.context,
        params: {
          fromAsset: 'USDC',
          toAsset: 'ETH',
          amount: BigInt(Math.floor(Math.random() * 1000)) * 10n ** 6n,
          minReceived: 0n,
          slippageTolerance: 100n
        }
      });

      if (result.success) {
        this.metrics.successfulTransactions++;
        channel.transactionCount++;
        channel.volumeTraded += BigInt(Math.floor(Math.random() * 1000)) * 10n ** 6n;
      } else {
        this.metrics.failedTransactions++;
      }
    } catch (error) {
      this.metrics.failedTransactions++;
    }

    this.metrics.totalTransactions++;

    const latency = performance.now() - startTime;
    this.latencyHistory.push(latency);
  }

  /**
   * Simulate HTLC payment
   */
  private simulateHTLC(channel: SimulatedChannel): void {
    const startTime = performance.now();

    try {
      const result = HTLCTransformer.create(channel.context, {
        tokenId: 1,
        amount: BigInt(Math.floor(Math.random() * 100)) * 10n ** 6n,
        hashlock: new Uint8Array(32).fill(Math.floor(Math.random() * 256)),
        timelock: Date.now() + 3600000,
        sender: 'left',
        receiver: 'right'
      });

      if (result.success) {
        this.metrics.successfulTransactions++;
        channel.transactionCount++;
      } else {
        this.metrics.failedTransactions++;
      }
    } catch (error) {
      this.metrics.failedTransactions++;
    }

    this.metrics.totalTransactions++;

    const latency = performance.now() - startTime;
    this.latencyHistory.push(latency);
  }

  /**
   * Simulate flash loan
   */
  private simulateFlashLoan(channel: SimulatedChannel): void {
    const startTime = performance.now();

    try {
      const loanResult = FlashLoanTransformer.borrow({
        context: channel.context,
        params: {
          tokenId: 1,
          amount: BigInt(Math.floor(Math.random() * 10000)) * 10n ** 6n,
          borrower: Math.random() > 0.5 ? 'left' : 'right'
        }
      });

      if (loanResult.success) {
        // Simulate repayment
        const repayResult = FlashLoanTransformer.repay({
          context: channel.context,
          params: {
            loanId: loanResult.data!.loanId,
            amount: loanResult.data!.amount + loanResult.data!.fee
          }
        });

        if (repayResult.success) {
          this.metrics.successfulTransactions += 2;
          channel.transactionCount += 2;
        } else {
          this.metrics.failedTransactions++;
        }
      } else {
        this.metrics.failedTransactions++;
      }
    } catch (error) {
      this.metrics.failedTransactions++;
    }

    this.metrics.totalTransactions += 2;

    const latency = performance.now() - startTime;
    this.latencyHistory.push(latency);
  }

  /**
   * Simulate complex multi-step strategy
   */
  private simulateComplexStrategy(channel: SimulatedChannel): void {
    // Simulate atomic multi-step operation
    const steps = Math.floor(Math.random() * 5) + 2;

    for (let i = 0; i < steps; i++) {
      this.simulateSwap(channel);
    }
  }

  /**
   * Simulate double spend attack
   */
  private simulateDoubleSpend(entity: SimulatedEntity): void {
    this.metrics.byzantineFailures++;

    // Try to spend same funds twice
    for (const channel of entity.channels.values()) {
      // Submit conflicting transactions
      this.simulateSwap(channel);
      this.simulateSwap(channel); // Same nonce
    }
  }

  /**
   * Simulate invalid state submission
   */
  private simulateInvalidState(entity: SimulatedEntity): void {
    this.metrics.byzantineFailures++;

    // Submit invalid channel state
    for (const channel of entity.channels.values()) {
      // Corrupt channel state
      const subchannel = channel.subchannels.get(1);
      if (subchannel) {
        subchannel.offdelta = 999999999n * 10n ** 6n; // Invalid delta
      }
    }
  }

  /**
   * Simulate channel griefing
   */
  private simulateGriefing(entity: SimulatedEntity): void {
    this.metrics.byzantineFailures++;

    // Lock funds without releasing
    for (const channel of entity.channels.values()) {
      HTLCTransformer.create(channel.context, {
        tokenId: 1,
        amount: 1000000n * 10n ** 6n,
        hashlock: new Uint8Array(32), // Unrevealable hash
        timelock: Date.now() + 86400000,
        sender: entity.id === channel.leftEntity ? 'left' : 'right',
        receiver: entity.id === channel.leftEntity ? 'right' : 'left'
      });
    }
  }

  /**
   * Simulate eclipse attack
   */
  private simulateEclipseAttack(entity: SimulatedEntity): void {
    this.metrics.byzantineFailures++;

    // Isolate entity from network
    entity.isOnline = false;
    setTimeout(() => {
      entity.isOnline = true;
    }, 5000);
  }

  /**
   * Simulate network partition
   */
  private simulateNetworkPartition(): void {
    this.metrics.networkPartitions++;

    const entityIds = Array.from(this.entities.keys());
    const partitionSize = Math.floor(entityIds.length / 2);

    // Partition network
    for (let i = 0; i < partitionSize; i++) {
      const entity = this.entities.get(entityIds[i]);
      if (entity) {
        entity.isOnline = false;
      }
    }

    // Heal partition after delay
    setTimeout(() => {
      for (let i = 0; i < partitionSize; i++) {
        const entity = this.entities.get(entityIds[i]);
        if (entity) {
          entity.isOnline = true;
        }
      }
    }, 10000);
  }

  /**
   * Simulate mass disconnection
   */
  private simulateMassDisconnection(): void {
    const disconnectRatio = 0.2; // 20% disconnect

    for (const entity of this.entities.values()) {
      if (Math.random() < disconnectRatio) {
        entity.isOnline = false;

        // Reconnect after random delay
        setTimeout(() => {
          entity.isOnline = true;
        }, Math.random() * 5000);
      }
    }
  }

  /**
   * Simulate latency spike
   */
  private simulateLatencySpike(): void {
    // Temporarily increase network latency
    const originalLatency = this.config.networkLatency;
    this.config.networkLatency *= 10;

    setTimeout(() => {
      this.config.networkLatency = originalLatency;
    }, 2000);
  }

  /**
   * Calculate current TPS
   */
  private calculateCurrentTPS(): number {
    if (this.tpsHistory.length === 0) return 0;

    const recentTxs = this.tpsHistory.slice(-10);
    return recentTxs.reduce((a, b) => a + b, 0) / recentTxs.length;
  }

  /**
   * Calculate final metrics
   */
  private calculateFinalMetrics(): void {
    const duration = (performance.now() - this.startTime) / 1000;

    this.metrics.averageTPS = Number(this.metrics.totalTransactions) / duration;

    if (this.latencyHistory.length > 0) {
      this.metrics.averageLatency =
        this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;

      const sorted = this.latencyHistory.sort((a, b) => a - b);
      this.metrics.p99Latency = sorted[Math.floor(sorted.length * 0.99)];
    }
  }

  /**
   * Verify final consistency
   */
  private async verifyFinalConsistency(): Promise<boolean> {
    // Verify all channels have consistent state
    for (const channel of this.channels.values()) {
      const leftView = this.entities.get(channel.leftEntity);
      const rightView = this.entities.get(channel.rightEntity);

      if (!leftView || !rightView) continue;

      // Check delta consistency
      for (const [tokenId, subchannel] of channel.subchannels) {
        const totalDelta = subchannel.ondelta + subchannel.offdelta;
        const capacity = subchannel.leftCreditLimit +
                        subchannel.collateral +
                        subchannel.rightCreditLimit;

        if (Math.abs(Number(totalDelta)) > Number(capacity)) {
          console.error(`❌ Inconsistent channel ${channel.channelKey}`);
          return false;
        }
      }
    }

    return true;
  }

  // Helper methods

  private createChannelKey(left: string, right: string): string {
    return left < right ? `${left}-${right}` : `${right}-${left}`;
  }

  private createChannel(leftEntity: string, rightEntity: string): SimulatedChannel {
    const usdc: Subchannel = {
      id: `${leftEntity}-${rightEntity}-1`,
      tokenId: 1,
      leftEntity,
      rightEntity,
      leftBalance: 100000n * 10n ** 6n,
      rightBalance: 100000n * 10n ** 6n,
      leftCreditLimit: 10000n * 10n ** 6n,
      rightCreditLimit: 10000n * 10n ** 6n,
      collateral: 50000n * 10n ** 6n,
      ondelta: 0n,
      offdelta: 0n,
      leftNonce: 1n,
      rightNonce: 1n,
      leftAllowence: 0n,
      rightAllowence: 0n,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const context: TransformContext = {
      channelKey: this.createChannelKey(leftEntity, rightEntity),
      subchannels: new Map([[1, usdc]]),
      timestamp: Date.now(),
      nonce: 1
    };

    return {
      channelKey: context.channelKey,
      leftEntity,
      rightEntity,
      subchannels: context.subchannels,
      context,
      transactionCount: 0,
      volumeTraded: 0n,
      disputes: 0
    };
  }

  private initializeMetrics(): SimulationResult {
    return {
      totalTransactions: 0n,
      successfulTransactions: 0n,
      failedTransactions: 0n,
      averageTPS: 0,
      peakTPS: 0,
      averageLatency: 0,
      p99Latency: 0,
      byzantineFailures: 0,
      networkPartitions: 0,
      slashingEvents: 0,
      finalConsistency: false
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Print simulation report
   */
  printReport(): void {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║         XLN SIMULATION RESULTS               ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    console.log('📊 Transaction Metrics:');
    console.log(`   Total: ${this.metrics.totalTransactions.toLocaleString()}`);
    console.log(`   Successful: ${this.metrics.successfulTransactions.toLocaleString()}`);
    console.log(`   Failed: ${this.metrics.failedTransactions.toLocaleString()}`);
    console.log(`   Success Rate: ${(Number(this.metrics.successfulTransactions) / Number(this.metrics.totalTransactions) * 100).toFixed(2)}%`);

    console.log('\n⚡ Performance Metrics:');
    console.log(`   Average TPS: ${this.metrics.averageTPS.toFixed(0)}`);
    console.log(`   Peak TPS: ${this.metrics.peakTPS.toFixed(0)}`);
    console.log(`   Average Latency: ${this.metrics.averageLatency.toFixed(2)}ms`);
    console.log(`   P99 Latency: ${this.metrics.p99Latency.toFixed(2)}ms`);

    console.log('\n🔒 Security Metrics:');
    console.log(`   Byzantine Failures: ${this.metrics.byzantineFailures}`);
    console.log(`   Network Partitions: ${this.metrics.networkPartitions}`);
    console.log(`   Slashing Events: ${this.metrics.slashingEvents}`);
    console.log(`   Final Consistency: ${this.metrics.finalConsistency ? '✅' : '❌'}`);

    console.log('\n🎯 Key Findings:');
    if (this.metrics.averageTPS > 100000) {
      console.log('   ✅ Achieved 100k+ TPS');
    }
    if (this.metrics.p99Latency < 10) {
      console.log('   ✅ Sub-10ms P99 latency');
    }
    if (this.metrics.finalConsistency) {
      console.log('   ✅ Maintained consistency under Byzantine conditions');
    }
  }
}