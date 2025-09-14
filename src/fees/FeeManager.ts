/**
 * Fee Manager for XLN
 * 
 * Implements various fee mechanisms:
 * 1. Routing fees for multi-hop payments
 * 2. Liquidity fees based on channel imbalance
 * 3. Time-value fees for locked capital
 * 4. Penalty fees for misbehavior
 * 5. Dynamic fee adjustment based on demand
 */

import { Subchannel } from '../../old_src/types/Subchannel.js';
import { createHash } from 'crypto';

export interface FeeConfig {
  // Base fees (in basis points, 1 bp = 0.01%)
  baseFeeRate: number;        // Base fee for any transaction
  routingFeeRate: number;      // Fee for routing through channel
  liquidityFeeRate: number;    // Fee based on channel imbalance
  
  // Time-based fees
  timeValueRate: number;       // Daily rate for locked capital (in bp)
  htlcTimeoutPenalty: number;  // Penalty for HTLC timeout (fixed amount)
  
  // Dynamic adjustment parameters
  targetUtilization: number;   // Target channel utilization (0-1)
  feeAdjustmentRate: number;   // How quickly fees adjust (0-1)
  maxFeeRate: number;         // Maximum total fee rate (in bp)
  minFeeRate: number;         // Minimum total fee rate (in bp)
  
  // Penalty parameters
  disputePenalty: number;      // Penalty for forcing on-chain dispute
  byzantinePenalty: number;    // Penalty for Byzantine behavior
}

export interface FeeCalculation {
  baseFee: bigint;
  routingFee: bigint;
  liquidityFee: bigint;
  timeValueFee: bigint;
  totalFee: bigint;
  effectiveRate: number; // In basis points
  breakdown: string;      // Human-readable breakdown
}

export class FeeManager {
  private config: FeeConfig;
  private channelMetrics: Map<string, ChannelMetrics> = new Map();
  
  constructor(config?: Partial<FeeConfig>) {
    this.config = {
      baseFeeRate: 10,        // 0.1%
      routingFeeRate: 5,      // 0.05%
      liquidityFeeRate: 20,   // 0.2% max
      timeValueRate: 1,       // 0.01% per day
      htlcTimeoutPenalty: 1000,
      targetUtilization: 0.5,
      feeAdjustmentRate: 0.1,
      maxFeeRate: 100,        // 1% max
      minFeeRate: 1,          // 0.01% min
      disputePenalty: 10000,
      byzantinePenalty: 100000,
      ...config
    };
  }
  
  /**
   * Calculate fees for a payment
   */
  calculateFees(
    amount: bigint,
    subchannel: Subchannel,
    isRouting: boolean = false,
    lockTime?: number // For HTLCs
  ): FeeCalculation {
    const breakdown: string[] = [];
    
    // Base fee
    const baseFee = this.calculateBaseFee(amount);
    breakdown.push(`Base: ${baseFee} (${this.config.baseFeeRate}bp)`);
    
    // Routing fee (if applicable)
    let routingFee = 0n;
    if (isRouting) {
      routingFee = this.calculateRoutingFee(amount);
      breakdown.push(`Routing: ${routingFee} (${this.config.routingFeeRate}bp)`);
    }
    
    // Liquidity fee based on channel imbalance
    const liquidityFee = this.calculateLiquidityFee(amount, subchannel);
    const liquidityRate = this.getLiquidityRate(subchannel);
    breakdown.push(`Liquidity: ${liquidityFee} (${liquidityRate.toFixed(2)}bp)`);
    
    // Time-value fee for locked capital (HTLCs)
    let timeValueFee = 0n;
    if (lockTime) {
      timeValueFee = this.calculateTimeValueFee(amount, lockTime);
      const days = lockTime / (24 * 3600 * 1000);
      breakdown.push(`Time-value: ${timeValueFee} (${days.toFixed(1)} days)`);
    }
    
    // Total fee
    const totalFee = baseFee + routingFee + liquidityFee + timeValueFee;
    
    // Effective rate in basis points
    const effectiveRate = Number((totalFee * 10000n) / amount) / 100;
    
    return {
      baseFee,
      routingFee,
      liquidityFee,
      timeValueFee,
      totalFee,
      effectiveRate,
      breakdown: breakdown.join('\n')
    };
  }
  
  /**
   * Calculate base fee
   */
  private calculateBaseFee(amount: bigint): bigint {
    return (amount * BigInt(this.config.baseFeeRate)) / 10000n;
  }
  
  /**
   * Calculate routing fee
   */
  private calculateRoutingFee(amount: bigint): bigint {
    return (amount * BigInt(this.config.routingFeeRate)) / 10000n;
  }
  
  /**
   * Calculate liquidity fee based on channel imbalance
   */
  private calculateLiquidityFee(amount: bigint, subchannel: Subchannel): bigint {
    const rate = this.getLiquidityRate(subchannel);
    return (amount * BigInt(Math.floor(rate * 100))) / 1000000n;
  }
  
  /**
   * Get liquidity fee rate based on channel balance
   */
  private getLiquidityRate(subchannel: Subchannel): number {
    const total = subchannel.collateral;
    if (total === 0n) return 0;
    
    const delta = subchannel.ondelta + subchannel.offdelta;
    const utilization = Number(delta) / Number(total);
    
    // Higher fee for more imbalanced channels
    const imbalance = Math.abs(utilization - 0.5) * 2; // 0 = balanced, 1 = fully imbalanced
    return this.config.liquidityFeeRate * imbalance;
  }
  
  /**
   * Calculate time-value fee for locked capital
   */
  private calculateTimeValueFee(amount: bigint, lockTimeMs: number): bigint {
    const days = lockTimeMs / (24 * 3600 * 1000);
    const dailyRate = BigInt(this.config.timeValueRate);
    return (amount * dailyRate * BigInt(Math.floor(days))) / 10000n;
  }
  
  /**
   * Update channel metrics for dynamic fee adjustment
   */
  updateChannelMetrics(channelKey: string, subchannel: Subchannel): void {
    const now = Date.now();
    
    let metrics = this.channelMetrics.get(channelKey);
    if (!metrics) {
      metrics = {
        volumeTotal: 0n,
        volumeHourly: 0n,
        lastUpdate: now,
        utilizationHistory: [],
        feeMultiplier: 1.0
      };
      this.channelMetrics.set(channelKey, metrics);
    }
    
    // Reset hourly volume if needed
    if (now - metrics.lastUpdate > 3600000) {
      metrics.volumeHourly = 0n;
    }
    
    // Calculate utilization
    const total = subchannel.collateral;
    const delta = subchannel.ondelta + subchannel.offdelta;
    const utilization = total > 0n ? Number(delta) / Number(total) : 0;
    
    // Update history (keep last 24 hours)
    metrics.utilizationHistory.push({ time: now, value: utilization });
    metrics.utilizationHistory = metrics.utilizationHistory.filter(
      h => now - h.time < 24 * 3600 * 1000
    );
    
    // Adjust fee multiplier based on average utilization
    const avgUtilization = metrics.utilizationHistory.reduce(
      (sum, h) => sum + h.value, 0
    ) / metrics.utilizationHistory.length;
    
    if (avgUtilization > this.config.targetUtilization) {
      // Increase fees if over-utilized
      metrics.feeMultiplier = Math.min(
        metrics.feeMultiplier * (1 + this.config.feeAdjustmentRate),
        this.config.maxFeeRate / this.config.baseFeeRate
      );
    } else {
      // Decrease fees if under-utilized
      metrics.feeMultiplier = Math.max(
        metrics.feeMultiplier * (1 - this.config.feeAdjustmentRate),
        this.config.minFeeRate / this.config.baseFeeRate
      );
    }
    
    metrics.lastUpdate = now;
  }
  
  /**
   * Get dynamic fee for a channel
   */
  getDynamicFee(channelKey: string, amount: bigint): bigint {
    const metrics = this.channelMetrics.get(channelKey);
    if (!metrics) return this.calculateBaseFee(amount);
    
    const baseFee = this.calculateBaseFee(amount);
    return BigInt(Math.floor(Number(baseFee) * metrics.feeMultiplier));
  }
  
  /**
   * Calculate penalty for dispute
   */
  calculateDisputePenalty(isInitiator: boolean): bigint {
    // Initiator pays full penalty, responder pays half
    return BigInt(isInitiator ? this.config.disputePenalty : this.config.disputePenalty / 2);
  }
  
  /**
   * Calculate penalty for Byzantine behavior
   */
  calculateByzantinePenalty(): bigint {
    return BigInt(this.config.byzantinePenalty);
  }
  
  /**
   * Get fee statistics for a channel
   */
  getChannelStats(channelKey: string): ChannelStats | null {
    const metrics = this.channelMetrics.get(channelKey);
    if (!metrics) return null;
    
    return {
      totalVolume: metrics.volumeTotal,
      hourlyVolume: metrics.volumeHourly,
      averageUtilization: metrics.utilizationHistory.reduce(
        (sum, h) => sum + h.value, 0
      ) / Math.max(metrics.utilizationHistory.length, 1),
      currentFeeMultiplier: metrics.feeMultiplier,
      utilizationHistory: metrics.utilizationHistory
    };
  }
  
  /**
   * Distribute collected fees
   */
  distributeFees(
    totalFees: bigint,
    config: {
      liquidityProvider: string;
      router?: string;
      protocol?: string;
    }
  ): Map<string, bigint> {
    const distribution = new Map<string, bigint>();
    
    // 70% to liquidity provider
    const lpFee = (totalFees * 70n) / 100n;
    distribution.set(config.liquidityProvider, lpFee);
    
    // 20% to router (if applicable)
    if (config.router) {
      const routerFee = (totalFees * 20n) / 100n;
      distribution.set(config.router, routerFee);
    }
    
    // 10% to protocol
    if (config.protocol) {
      const protocolFee = (totalFees * 10n) / 100n;
      distribution.set(config.protocol, protocolFee);
    }
    
    return distribution;
  }
}

interface ChannelMetrics {
  volumeTotal: bigint;
  volumeHourly: bigint;
  lastUpdate: number;
  utilizationHistory: Array<{ time: number; value: number }>;
  feeMultiplier: number;
}

interface ChannelStats {
  totalVolume: bigint;
  hourlyVolume: bigint;
  averageUtilization: number;
  currentFeeMultiplier: number;
  utilizationHistory: Array<{ time: number; value: number }>;
}

/**
 * Fee optimizer for finding best routes
 */
export class FeeOptimizer {
  constructor(private feeManager: FeeManager) {}
  
  /**
   * Find cheapest path through network
   */
  findCheapestPath(
    source: string,
    destination: string,
    amount: bigint,
    channels: Map<string, ChannelInfo>
  ): PathResult | null {
    // Implementation of Dijkstra's algorithm with fees as weights
    const distances = new Map<string, bigint>();
    const previous = new Map<string, string>();
    const unvisited = new Set<string>();
    
    // Initialize
    for (const [channelKey, info] of channels) {
      unvisited.add(info.left);
      unvisited.add(info.right);
      distances.set(info.left, BigInt(Number.MAX_SAFE_INTEGER));
      distances.set(info.right, BigInt(Number.MAX_SAFE_INTEGER));
    }
    
    distances.set(source, 0n);
    
    while (unvisited.size > 0) {
      // Find minimum distance node
      let current: string | null = null;
      let minDistance = BigInt(Number.MAX_SAFE_INTEGER);
      
      for (const node of unvisited) {
        const dist = distances.get(node) || BigInt(Number.MAX_SAFE_INTEGER);
        if (dist < minDistance) {
          minDistance = dist;
          current = node;
        }
      }
      
      if (!current || current === destination) break;
      
      unvisited.delete(current);
      
      // Check neighbors
      for (const [channelKey, info] of channels) {
        let neighbor: string | null = null;
        
        if (info.left === current) neighbor = info.right;
        else if (info.right === current) neighbor = info.left;
        
        if (!neighbor || !unvisited.has(neighbor)) continue;
        
        // Calculate fee for this hop
        const feeCalc = this.feeManager.calculateFees(
          amount,
          info.subchannel,
          true // isRouting
        );
        
        const altDistance = minDistance + feeCalc.totalFee;
        const currentDistance = distances.get(neighbor) || BigInt(Number.MAX_SAFE_INTEGER);
        
        if (altDistance < currentDistance) {
          distances.set(neighbor, altDistance);
          previous.set(neighbor, current);
        }
      }
    }
    
    // Reconstruct path
    const path: string[] = [];
    let current: string | undefined = destination;
    
    while (current && current !== source) {
      path.unshift(current);
      current = previous.get(current);
    }
    
    if (current !== source) return null; // No path found
    
    path.unshift(source);
    
    return {
      path,
      totalFee: distances.get(destination) || 0n,
      hops: path.length - 1
    };
  }
}

interface ChannelInfo {
  left: string;
  right: string;
  subchannel: Subchannel;
}

interface PathResult {
  path: string[];
  totalFee: bigint;
  hops: number;
}