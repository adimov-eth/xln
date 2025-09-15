/**
 * FeeMarket: Dynamic fee pricing based on channel utilization
 *
 * Key Innovations:
 * 1. Bilateral fee negotiation - no global fee market
 * 2. Capacity-based pricing - fees increase with utilization
 * 3. Reputation discounts - good actors pay less
 * 4. MEV-resistant - fees agreed bilaterally, not auction-based
 *
 * Fee Components:
 * - Base fee: Minimum operational cost
 * - Congestion fee: Increases with channel utilization
 * - Risk premium: Based on counterparty reputation
 * - Priority fee: Optional expedited processing
 */

import { Subchannel } from '../../old_src/types/Subchannel.js';
import { BaseTransformer, TransformContext, TransformResult, ChannelCapacity } from '../transformers/BaseTransformer.js';

export interface FeeParameters {
  baseFee: bigint;           // Minimum fee in wei
  congestionMultiplier: number; // 1.0 = normal, 2.0 = double
  riskMultiplier: number;    // Based on reputation
  priorityFee: bigint;       // Optional expedite
  discountRate: number;      // 0-1, reputation discount
}

export interface ChannelFeeState {
  leftFees: FeeParameters;
  rightFees: FeeParameters;
  accumulatedLeft: bigint;  // Total fees collected by left
  accumulatedRight: bigint; // Total fees collected by right
  lastUpdate: number;       // Timestamp
  utilizationHistory: number[]; // Recent utilization percentages
}

export interface ReputationScore {
  entity: string;
  score: number;            // 0-1000, higher is better
  completedTransactions: number;
  failedTransactions: number;
  totalVolume: bigint;
  lastUpdated: number;
}

export interface FeeMarketState {
  channelFees: Map<string, ChannelFeeState>;
  reputation: Map<string, ReputationScore>;
  globalMetrics: {
    totalFeesCollected: bigint;
    averageUtilization: number;
    peakUtilization: number;
    lastRebalance: number;
  };
}

/**
 * Dynamic fee market for bilateral channels
 */
export class FeeMarket extends BaseTransformer {
  private state: FeeMarketState;

  // Fee constants (can be adjusted)
  private static readonly MIN_BASE_FEE = 1000n; // 1000 wei minimum
  private static readonly MAX_BASE_FEE = 1000000n; // 1M wei maximum
  private static readonly CONGESTION_THRESHOLD = 0.7; // 70% utilization
  private static readonly MAX_CONGESTION_MULTIPLIER = 10; // 10x max
  private static readonly REPUTATION_WEIGHT = 0.3; // 30% impact
  private static readonly UTILIZATION_WINDOW = 100; // Keep last 100 samples

  constructor() {
    super();
    this.state = {
      channelFees: new Map(),
      reputation: new Map(),
      globalMetrics: {
        totalFeesCollected: 0n,
        averageUtilization: 0,
        peakUtilization: 0,
        lastRebalance: Date.now()
      }
    };
  }

  /**
   * Main transformer interface
   */
  async transform(
    context: TransformContext,
    params: any
  ): Promise<TransformResult> {
    const { action } = params;

    switch (action) {
      case 'calculateFee':
        return this.calculateFee(context, params);
      case 'collectFee':
        return this.collectFee(context, params);
      case 'updateReputation':
        return this.updateReputation(params);
      case 'rebalanceFees':
        return this.rebalanceFees(context);
      case 'getFeeQuote':
        return this.getFeeQuote(context, params);
      default:
        return {
          success: false,
          error: `Unknown action: ${action}`
        };
    }
  }

  /**
   * Calculate dynamic fee based on channel state
   */
  private calculateFee(
    context: TransformContext,
    params: any
  ): Promise<TransformResult> {
    const { channelKey, amount, priority = false } = params;

    const subchannel = context.subchannels.get(0);
    if (!subchannel) {
      return Promise.resolve({
        success: false,
        error: 'No subchannel found'
      });
    }

    // Get channel utilization
    const capacity = BaseTransformer.calculateCapacity(subchannel, 'left');
    const utilization = this.calculateUtilization(capacity);

    // Get or create fee state
    let feeState = this.state.channelFees.get(channelKey);
    if (!feeState) {
      feeState = this.initializeFeeState();
      this.state.channelFees.set(channelKey, feeState);
    }

    // Update utilization history
    feeState.utilizationHistory.push(utilization * 100);
    if (feeState.utilizationHistory.length > FeeMarket.UTILIZATION_WINDOW) {
      feeState.utilizationHistory.shift();
    }

    // Calculate congestion multiplier
    const congestionMultiplier = this.calculateCongestionMultiplier(utilization);

    // Get reputation scores
    const leftReputation = this.getReputationScore(channelKey.split('-')[0]);
    const rightReputation = this.getReputationScore(channelKey.split('-')[1]);

    // Calculate risk multiplier
    const riskMultiplier = this.calculateRiskMultiplier(
      leftReputation,
      rightReputation
    );

    // Calculate final fee
    const baseFee = this.calculateBaseFee(BigInt(amount));
    const congestionFee = BigInt(Math.floor(
      Number(baseFee) * congestionMultiplier
    ));
    const riskFee = BigInt(Math.floor(
      Number(baseFee) * riskMultiplier
    ));
    const priorityFee = priority ? baseFee / 10n : 0n; // 10% for priority

    const totalFee = baseFee + congestionFee + riskFee + priorityFee;

    // Apply reputation discount
    const discount = this.calculateDiscount(leftReputation, rightReputation);
    const finalFee = totalFee - BigInt(Math.floor(Number(totalFee) * discount));

    // Update fee state
    feeState.leftFees = {
      baseFee,
      congestionMultiplier,
      riskMultiplier,
      priorityFee,
      discountRate: discount
    };
    feeState.lastUpdate = Date.now();

    return Promise.resolve({
      success: true,
      data: {
        fee: finalFee.toString(),
        breakdown: {
          base: baseFee.toString(),
          congestion: congestionFee.toString(),
          risk: riskFee.toString(),
          priority: priorityFee.toString(),
          discount: (Number(totalFee) * discount).toFixed(0)
        },
        utilization: (utilization * 100).toFixed(1) + '%'
      }
    });
  }

  /**
   * Collect fee from transaction
   */
  private collectFee(
    context: TransformContext,
    params: any
  ): Promise<TransformResult> {
    const { channelKey, fee, payer } = params;

    const feeAmount = BigInt(fee);
    const subchannel = context.subchannels.get(0);
    if (!subchannel) {
      return Promise.resolve({
        success: false,
        error: 'No subchannel found'
      });
    }

    // Transfer fee
    const isLeft = payer === 'left';
    if (isLeft) {
      subchannel.offdelta -= feeAmount;
    } else {
      subchannel.offdelta += feeAmount;
    }

    // Update accumulated fees
    let feeState = this.state.channelFees.get(channelKey);
    if (!feeState) {
      feeState = this.initializeFeeState();
      this.state.channelFees.set(channelKey, feeState);
    }

    if (isLeft) {
      feeState.accumulatedRight += feeAmount; // Right collects from left
    } else {
      feeState.accumulatedLeft += feeAmount; // Left collects from right
    }

    // Update global metrics
    this.state.globalMetrics.totalFeesCollected += feeAmount;

    return Promise.resolve({
      success: true,
      data: {
        collected: feeAmount.toString(),
        totalAccumulated: isLeft
          ? feeState.accumulatedRight.toString()
          : feeState.accumulatedLeft.toString()
      }
    });
  }

  /**
   * Update entity reputation
   */
  private updateReputation(params: any): Promise<TransformResult> {
    const { entity, success, volume } = params;

    let reputation = this.state.reputation.get(entity);
    if (!reputation) {
      reputation = {
        entity,
        score: 500, // Start at middle
        completedTransactions: 0,
        failedTransactions: 0,
        totalVolume: 0n,
        lastUpdated: Date.now()
      };
      this.state.reputation.set(entity, reputation);
    }

    // Update transaction counts
    if (success) {
      reputation.completedTransactions++;
      reputation.score = Math.min(1000, reputation.score + 10);
    } else {
      reputation.failedTransactions++;
      reputation.score = Math.max(0, reputation.score - 50);
    }

    // Update volume
    if (volume) {
      reputation.totalVolume += BigInt(volume);
    }

    // Adjust score based on success rate
    const successRate = reputation.completedTransactions /
      (reputation.completedTransactions + reputation.failedTransactions);

    if (successRate > 0.95) {
      reputation.score = Math.min(1000, reputation.score + 5);
    } else if (successRate < 0.8) {
      reputation.score = Math.max(0, reputation.score - 10);
    }

    reputation.lastUpdated = Date.now();

    return Promise.resolve({
      success: true,
      data: {
        entity,
        newScore: reputation.score,
        successRate: (successRate * 100).toFixed(1) + '%'
      }
    });
  }

  /**
   * Rebalance fees across all channels
   */
  private rebalanceFees(context: TransformContext): Promise<TransformResult> {
    const rebalanced: string[] = [];
    let totalUtilization = 0;
    let channelCount = 0;

    // Calculate average utilization
    for (const [channelKey, feeState] of this.state.channelFees) {
      if (feeState.utilizationHistory.length > 0) {
        const avgUtil = feeState.utilizationHistory.reduce((a, b) => a + b, 0) /
                       feeState.utilizationHistory.length;
        totalUtilization += avgUtil;
        channelCount++;

        // Adjust base fees based on historical utilization
        if (avgUtil > 80) {
          // High utilization - increase fees
          feeState.leftFees.baseFee = BaseTransformer.min(
            feeState.leftFees.baseFee * 11n / 10n, // 10% increase
            FeeMarket.MAX_BASE_FEE
          );
          rebalanced.push(channelKey);
        } else if (avgUtil < 20) {
          // Low utilization - decrease fees
          feeState.leftFees.baseFee = BaseTransformer.max(
            feeState.leftFees.baseFee * 9n / 10n, // 10% decrease
            FeeMarket.MIN_BASE_FEE
          );
          rebalanced.push(channelKey);
        }
      }
    }

    // Update global metrics
    if (channelCount > 0) {
      this.state.globalMetrics.averageUtilization = totalUtilization / channelCount;
      this.state.globalMetrics.peakUtilization = Math.max(
        this.state.globalMetrics.peakUtilization,
        this.state.globalMetrics.averageUtilization
      );
    }
    this.state.globalMetrics.lastRebalance = Date.now();

    return Promise.resolve({
      success: true,
      data: {
        rebalanced: rebalanced.length,
        averageUtilization: this.state.globalMetrics.averageUtilization.toFixed(1) + '%',
        peakUtilization: this.state.globalMetrics.peakUtilization.toFixed(1) + '%'
      }
    });
  }

  /**
   * Get fee quote without executing
   */
  private getFeeQuote(
    context: TransformContext,
    params: any
  ): Promise<TransformResult> {
    const { amount, priority = false } = params;

    const subchannel = context.subchannels.get(0);
    if (!subchannel) {
      return Promise.resolve({
        success: false,
        error: 'No subchannel found'
      });
    }

    // Calculate capacity and utilization
    const capacity = BaseTransformer.calculateCapacity(subchannel, 'left');
    const utilization = this.calculateUtilization(capacity);

    // Estimate fee
    const baseFee = this.calculateBaseFee(BigInt(amount));
    const congestionMultiplier = this.calculateCongestionMultiplier(utilization);
    const estimatedFee = BigInt(Math.floor(
      Number(baseFee) * (1 + congestionMultiplier)
    ));

    const priorityFee = priority ? baseFee / 10n : 0n;
    const totalEstimate = estimatedFee + priorityFee;

    return Promise.resolve({
      success: true,
      data: {
        quote: totalEstimate.toString(),
        validUntil: Date.now() + 60000, // Valid for 1 minute
        utilization: (utilization * 100).toFixed(1) + '%'
      }
    });
  }

  /**
   * Calculate channel utilization
   */
  private calculateUtilization(capacity: ChannelCapacity): number {
    const total = capacity.inCapacity + capacity.outCapacity;
    if (total === 0n) return 0;

    const used = capacity.creditUsed;
    return Number(used * 100n / total) / 100;
  }

  /**
   * Calculate congestion multiplier based on utilization
   */
  private calculateCongestionMultiplier(utilization: number): number {
    if (utilization < FeeMarket.CONGESTION_THRESHOLD) {
      return 1.0;
    }

    // Sigmoid curve for smooth, bounded growth
    // Maps [0.7, 1.0] utilization to [1.0, MAX_CONGESTION_MULTIPLIER]
    const excess = Math.min(utilization - FeeMarket.CONGESTION_THRESHOLD, 0.3);

    // Use tanh for smooth S-curve: grows quickly then plateaus
    // tanh(x) ranges from 0 to ~1 for x in [0, 3]
    const normalized = excess / 0.3; // Normalize to [0, 1]
    const tanhInput = normalized * 3; // Scale to [0, 3] for good tanh response
    const smoothed = Math.tanh(tanhInput);

    // Scale from [0, 1] to [1, MAX_CONGESTION_MULTIPLIER]
    const multiplier = 1 + smoothed * (FeeMarket.MAX_CONGESTION_MULTIPLIER - 1);

    return Math.min(multiplier, FeeMarket.MAX_CONGESTION_MULTIPLIER);
  }

  /**
   * Calculate base fee based on amount
   */
  private calculateBaseFee(amount: bigint): bigint {
    // 0.1% of amount, bounded by min/max
    const fee = amount / 1000n;

    if (fee < FeeMarket.MIN_BASE_FEE) {
      return FeeMarket.MIN_BASE_FEE;
    }
    if (fee > FeeMarket.MAX_BASE_FEE) {
      return FeeMarket.MAX_BASE_FEE;
    }

    return fee;
  }

  /**
   * Calculate risk multiplier based on reputation
   */
  private calculateRiskMultiplier(
    leftRep: ReputationScore,
    rightRep: ReputationScore
  ): number {
    const avgScore = (leftRep.score + rightRep.score) / 2;

    // High reputation = low risk = low multiplier
    if (avgScore > 800) return 0.5;
    if (avgScore > 600) return 1.0;
    if (avgScore > 400) return 1.5;
    if (avgScore > 200) return 2.0;
    return 3.0; // High risk
  }

  /**
   * Calculate discount based on reputation
   */
  private calculateDiscount(
    leftRep: ReputationScore,
    rightRep: ReputationScore
  ): number {
    const avgScore = (leftRep.score + rightRep.score) / 2;

    // High reputation = higher discount
    if (avgScore > 900) return 0.2;  // 20% discount
    if (avgScore > 700) return 0.1;  // 10% discount
    if (avgScore > 500) return 0.05; // 5% discount
    return 0; // No discount
  }

  /**
   * Get reputation score for entity
   */
  private getReputationScore(entity: string): ReputationScore {
    let reputation = this.state.reputation.get(entity);
    if (!reputation) {
      reputation = {
        entity,
        score: 500,
        completedTransactions: 0,
        failedTransactions: 0,
        totalVolume: 0n,
        lastUpdated: Date.now()
      };
      this.state.reputation.set(entity, reputation);
    }
    return reputation;
  }

  /**
   * Initialize fee state for new channel
   */
  private initializeFeeState(): ChannelFeeState {
    return {
      leftFees: {
        baseFee: FeeMarket.MIN_BASE_FEE,
        congestionMultiplier: 1.0,
        riskMultiplier: 1.0,
        priorityFee: 0n,
        discountRate: 0
      },
      rightFees: {
        baseFee: FeeMarket.MIN_BASE_FEE,
        congestionMultiplier: 1.0,
        riskMultiplier: 1.0,
        priorityFee: 0n,
        discountRate: 0
      },
      accumulatedLeft: 0n,
      accumulatedRight: 0n,
      lastUpdate: Date.now(),
      utilizationHistory: []
    };
  }

  /**
   * Get fee market statistics
   */
  async getStatistics(): Promise<any> {
    const stats = {
      totalChannels: this.state.channelFees.size,
      totalFeesCollected: this.state.globalMetrics.totalFeesCollected.toString(),
      averageUtilization: this.state.globalMetrics.averageUtilization.toFixed(1) + '%',
      peakUtilization: this.state.globalMetrics.peakUtilization.toFixed(1) + '%',
      topEarners: [] as any[],
      reputationDistribution: {
        excellent: 0, // 800+
        good: 0,      // 600-800
        average: 0,   // 400-600
        poor: 0,      // 200-400
        bad: 0        // 0-200
      }
    };

    // Calculate top fee earners
    const earners: Array<[string, bigint]> = [];
    for (const [channel, feeState] of this.state.channelFees) {
      const total = feeState.accumulatedLeft + feeState.accumulatedRight;
      if (total > 0n) {
        earners.push([channel, total]);
      }
    }

    earners.sort((a, b) => {
      if (a[1] > b[1]) return -1;
      if (a[1] < b[1]) return 1;
      return 0;
    });

    stats.topEarners = earners.slice(0, 5).map(([channel, fees]) => ({
      channel: channel.slice(0, 20) + '...',
      fees: fees.toString()
    }));

    // Calculate reputation distribution
    for (const rep of this.state.reputation.values()) {
      if (rep.score >= 800) stats.reputationDistribution.excellent++;
      else if (rep.score >= 600) stats.reputationDistribution.good++;
      else if (rep.score >= 400) stats.reputationDistribution.average++;
      else if (rep.score >= 200) stats.reputationDistribution.poor++;
      else stats.reputationDistribution.bad++;
    }

    return stats;
  }
}