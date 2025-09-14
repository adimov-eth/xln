/**
 * Metrics Collector for XLN
 * 
 * Comprehensive monitoring and observability:
 * 1. Performance metrics (latency, throughput)
 * 2. Business metrics (volume, fees, channels)
 * 3. Health metrics (errors, Byzantine faults)
 * 4. Network topology metrics
 * 5. Real-time alerting
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { EntityState, EntityReplica } from '../types.js';
import { ChannelState } from '../../old_src/channel.js';
import { Subchannel } from '../../old_src/types/Subchannel.js';
import { log } from '../utils.js';

export interface MetricSnapshot {
  timestamp: number;
  
  // Performance metrics
  performance: {
    entityTxLatency: number;      // Average ms
    channelUpdateLatency: number; // Average ms
    consensusRoundTime: number;   // Average ms
    throughputTps: number;        // Transactions per second
    mempoolSize: number;
    blockHeight: number;
  };
  
  // Business metrics
  business: {
    totalVolume: bigint;          // Total value transferred
    totalFees: bigint;            // Total fees collected
    activeChannels: number;
    activeEntities: number;
    totalLiquidity: bigint;       // Total collateral locked
    averageChannelSize: bigint;
  };
  
  // Health metrics
  health: {
    errorRate: number;            // Errors per minute
    byzantineFaults: number;      // Total Byzantine faults detected
    disputeRate: number;          // Disputes per hour
    reorgCount: number;           // Blockchain reorgs handled
    consensusFailures: number;
    networkPartitions: number;
  };
  
  // Network topology
  topology: {
    nodeCount: number;
    edgeCount: number;
    avgDegree: number;
    clusteringCoefficient: number;
    diameter: number;             // Longest shortest path
    centralityScore: Map<string, number>;
  };
}

export interface Alert {
  id: string;
  level: 'info' | 'warning' | 'critical';
  category: string;
  message: string;
  timestamp: number;
  metadata?: any;
}

export class MetricsCollector extends EventEmitter {
  private metrics: MetricSnapshot;
  private history: MetricSnapshot[] = [];
  private maxHistorySize = 1440; // 24 hours at 1 minute intervals
  
  // Tracking maps
  private latencies = {
    entityTx: [] as number[],
    channelUpdate: [] as number[],
    consensus: [] as number[]
  };
  
  private errors: Array<{ time: number; error: any }> = [];
  private byzantineFaults: Array<{ time: number; fault: any }> = [];
  private disputes: Array<{ time: number; dispute: any }> = [];
  
  private channels: Map<string, ChannelMetrics> = new Map();
  private entities: Map<string, EntityMetrics> = new Map();
  
  // Alert thresholds
  private thresholds = {
    maxLatency: 1000,           // 1 second
    minThroughput: 10,          // 10 TPS
    maxErrorRate: 10,           // 10 errors per minute
    maxByzantineFaults: 1,      // Any Byzantine fault is critical
    maxDisputeRate: 5,          // 5 disputes per hour
    minChannelCapacity: 0.1,    // 10% capacity warning
    maxMempoolSize: 10000       // Maximum mempool size
  };
  
  constructor() {
    super();
    this.metrics = this.createEmptySnapshot();
    
    // Start periodic collection
    setInterval(() => this.collectMetrics(), 60000); // Every minute
    setInterval(() => this.checkAlerts(), 10000);    // Every 10 seconds
  }
  
  /**
   * Record entity transaction
   */
  recordEntityTx(
    entityId: string,
    latency: number,
    success: boolean,
    txCount: number = 1
  ): void {
    this.latencies.entityTx.push(latency);
    
    let entityMetrics = this.entities.get(entityId);
    if (!entityMetrics) {
      entityMetrics = {
        txCount: 0,
        txVolume: 0n,
        consensusRounds: 0,
        lastActive: Date.now()
      };
      this.entities.set(entityId, entityMetrics);
    }
    
    entityMetrics.txCount += txCount;
    entityMetrics.lastActive = Date.now();
    
    if (!success) {
      this.recordError({
        type: 'entity_tx_failed',
        entityId,
        latency
      });
    }
  }
  
  /**
   * Record channel update
   */
  recordChannelUpdate(
    channelKey: string,
    latency: number,
    delta: bigint,
    isOndelta: boolean
  ): void {
    this.latencies.channelUpdate.push(latency);
    
    let channelMetrics = this.channels.get(channelKey);
    if (!channelMetrics) {
      channelMetrics = {
        updateCount: 0,
        volume: 0n,
        fees: 0n,
        disputes: 0,
        lastActive: Date.now()
      };
      this.channels.set(channelKey, channelMetrics);
    }
    
    channelMetrics.updateCount++;
    channelMetrics.volume += delta > 0n ? delta : -delta;
    channelMetrics.lastActive = Date.now();
  }
  
  /**
   * Record consensus round
   */
  recordConsensusRound(
    entityId: string,
    roundTime: number,
    validators: number,
    success: boolean
  ): void {
    this.latencies.consensus.push(roundTime);
    
    const entityMetrics = this.entities.get(entityId);
    if (entityMetrics) {
      entityMetrics.consensusRounds++;
    }
    
    if (!success) {
      this.metrics.health.consensusFailures++;
      this.emitAlert({
        level: 'warning',
        category: 'consensus',
        message: `Consensus failed for entity ${entityId}`,
        metadata: { entityId, validators, roundTime }
      });
    }
  }
  
  /**
   * Record error
   */
  recordError(error: any): void {
    this.errors.push({ time: Date.now(), error });
    
    // Clean old errors (keep last hour)
    const cutoff = Date.now() - 3600000;
    this.errors = this.errors.filter(e => e.time > cutoff);
  }
  
  /**
   * Record Byzantine fault
   */
  recordByzantineFault(fault: any): void {
    this.byzantineFaults.push({ time: Date.now(), fault });
    
    this.emitAlert({
      level: 'critical',
      category: 'byzantine',
      message: 'Byzantine fault detected!',
      metadata: fault
    });
  }
  
  /**
   * Record dispute
   */
  recordDispute(channelKey: string, dispute: any): void {
    this.disputes.push({ time: Date.now(), dispute });
    
    const channelMetrics = this.channels.get(channelKey);
    if (channelMetrics) {
      channelMetrics.disputes++;
    }
    
    // Clean old disputes (keep last day)
    const cutoff = Date.now() - 86400000;
    this.disputes = this.disputes.filter(d => d.time > cutoff);
  }
  
  /**
   * Record reorg
   */
  recordReorg(depth: number): void {
    this.metrics.health.reorgCount++;
    
    if (depth > 3) {
      this.emitAlert({
        level: 'warning',
        category: 'reorg',
        message: `Deep reorg detected: ${depth} blocks`,
        metadata: { depth }
      });
    }
  }
  
  /**
   * Collect periodic metrics
   */
  private collectMetrics(): void {
    const now = Date.now();
    
    // Calculate performance metrics
    const avgEntityTxLatency = this.calculateAverage(this.latencies.entityTx);
    const avgChannelUpdateLatency = this.calculateAverage(this.latencies.channelUpdate);
    const avgConsensusRoundTime = this.calculateAverage(this.latencies.consensus);
    
    // Calculate throughput
    const recentTxCount = Array.from(this.entities.values())
      .reduce((sum, m) => sum + m.txCount, 0);
    const throughputTps = recentTxCount / 60; // Per second over last minute
    
    // Calculate business metrics
    const totalVolume = Array.from(this.channels.values())
      .reduce((sum, m) => sum + m.volume, 0n);
    
    const totalFees = Array.from(this.channels.values())
      .reduce((sum, m) => sum + m.fees, 0n);
    
    const activeChannels = Array.from(this.channels.values())
      .filter(m => now - m.lastActive < 3600000).length;
    
    const activeEntities = Array.from(this.entities.values())
      .filter(m => now - m.lastActive < 3600000).length;
    
    // Calculate health metrics
    const recentErrors = this.errors.filter(e => now - e.time < 60000).length;
    const errorRate = recentErrors; // Per minute
    
    const recentDisputes = this.disputes.filter(d => now - d.time < 3600000).length;
    const disputeRate = recentDisputes; // Per hour
    
    // Create snapshot
    this.metrics = {
      timestamp: now,
      performance: {
        entityTxLatency: avgEntityTxLatency,
        channelUpdateLatency: avgChannelUpdateLatency,
        consensusRoundTime: avgConsensusRoundTime,
        throughputTps,
        mempoolSize: 0, // Would be set externally
        blockHeight: 0  // Would be set externally
      },
      business: {
        totalVolume,
        totalFees,
        activeChannels,
        activeEntities,
        totalLiquidity: 0n, // Would be calculated from channels
        averageChannelSize: 0n // Would be calculated
      },
      health: {
        errorRate,
        byzantineFaults: this.byzantineFaults.length,
        disputeRate,
        reorgCount: this.metrics.health.reorgCount,
        consensusFailures: this.metrics.health.consensusFailures,
        networkPartitions: this.metrics.health.networkPartitions
      },
      topology: this.calculateTopology()
    };
    
    // Add to history
    this.history.push(this.metrics);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
    
    // Clear latency buffers
    this.latencies.entityTx = [];
    this.latencies.channelUpdate = [];
    this.latencies.consensus = [];
    
    // Emit metrics event
    this.emit('metrics', this.metrics);
  }
  
  /**
   * Check for alerts
   */
  private checkAlerts(): void {
    const metrics = this.metrics;
    
    // Performance alerts
    if (metrics.performance.entityTxLatency > this.thresholds.maxLatency) {
      this.emitAlert({
        level: 'warning',
        category: 'performance',
        message: `High entity transaction latency: ${metrics.performance.entityTxLatency}ms`
      });
    }
    
    if (metrics.performance.throughputTps < this.thresholds.minThroughput) {
      this.emitAlert({
        level: 'info',
        category: 'performance',
        message: `Low throughput: ${metrics.performance.throughputTps} TPS`
      });
    }
    
    // Health alerts
    if (metrics.health.errorRate > this.thresholds.maxErrorRate) {
      this.emitAlert({
        level: 'warning',
        category: 'health',
        message: `High error rate: ${metrics.health.errorRate} errors/min`
      });
    }
    
    if (metrics.health.byzantineFaults > this.thresholds.maxByzantineFaults) {
      this.emitAlert({
        level: 'critical',
        category: 'security',
        message: `Byzantine faults detected: ${metrics.health.byzantineFaults}`
      });
    }
    
    if (metrics.health.disputeRate > this.thresholds.maxDisputeRate) {
      this.emitAlert({
        level: 'warning',
        category: 'disputes',
        message: `High dispute rate: ${metrics.health.disputeRate} disputes/hour`
      });
    }
    
    // Mempool size alert
    if (metrics.performance.mempoolSize > this.thresholds.maxMempoolSize) {
      this.emitAlert({
        level: 'warning',
        category: 'mempool',
        message: `Large mempool: ${metrics.performance.mempoolSize} transactions`
      });
    }
  }
  
  /**
   * Calculate network topology metrics
   */
  private calculateTopology(): MetricSnapshot['topology'] {
    const nodes = new Set<string>();
    const edges: Array<[string, string]> = [];
    
    // Build graph from channels
    for (const [channelKey, metrics] of this.channels) {
      // Extract entities from channel key (simplified)
      const entities = channelKey.split('-');
      if (entities.length === 2) {
        nodes.add(entities[0]);
        nodes.add(entities[1]);
        edges.push([entities[0], entities[1]]);
      }
    }
    
    const nodeCount = nodes.size;
    const edgeCount = edges.length;
    const avgDegree = nodeCount > 0 ? (edgeCount * 2) / nodeCount : 0;
    
    // Calculate clustering coefficient (simplified)
    const clusteringCoefficient = this.calculateClusteringCoefficient(
      Array.from(nodes),
      edges
    );
    
    // Calculate centrality scores
    const centralityScore = this.calculateCentrality(
      Array.from(nodes),
      edges
    );
    
    return {
      nodeCount,
      edgeCount,
      avgDegree,
      clusteringCoefficient,
      diameter: 0, // Would require full graph traversal
      centralityScore
    };
  }
  
  /**
   * Calculate clustering coefficient
   */
  private calculateClusteringCoefficient(
    nodes: string[],
    edges: Array<[string, string]>
  ): number {
    // Simplified calculation
    // Real implementation would check triangles in the graph
    return 0.5; // Placeholder
  }
  
  /**
   * Calculate centrality scores
   */
  private calculateCentrality(
    nodes: string[],
    edges: Array<[string, string]>
  ): Map<string, number> {
    const centrality = new Map<string, number>();
    
    // Degree centrality (simplified)
    for (const node of nodes) {
      const degree = edges.filter(
        e => e[0] === node || e[1] === node
      ).length;
      centrality.set(node, degree);
    }
    
    return centrality;
  }
  
  /**
   * Emit alert
   */
  private emitAlert(alert: Omit<Alert, 'id' | 'timestamp'>): void {
    const fullAlert: Alert = {
      id: createHash('sha256')
        .update(JSON.stringify(alert))
        .digest('hex')
        .slice(0, 16),
      timestamp: Date.now(),
      ...alert
    };
    
    this.emit('alert', fullAlert);
    log.warn(`🚨 Alert: ${alert.message}`);
  }
  
  /**
   * Calculate average
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
  
  /**
   * Create empty snapshot
   */
  private createEmptySnapshot(): MetricSnapshot {
    return {
      timestamp: Date.now(),
      performance: {
        entityTxLatency: 0,
        channelUpdateLatency: 0,
        consensusRoundTime: 0,
        throughputTps: 0,
        mempoolSize: 0,
        blockHeight: 0
      },
      business: {
        totalVolume: 0n,
        totalFees: 0n,
        activeChannels: 0,
        activeEntities: 0,
        totalLiquidity: 0n,
        averageChannelSize: 0n
      },
      health: {
        errorRate: 0,
        byzantineFaults: 0,
        disputeRate: 0,
        reorgCount: 0,
        consensusFailures: 0,
        networkPartitions: 0
      },
      topology: {
        nodeCount: 0,
        edgeCount: 0,
        avgDegree: 0,
        clusteringCoefficient: 0,
        diameter: 0,
        centralityScore: new Map()
      }
    };
  }
  
  /**
   * Get current metrics
   */
  getCurrentMetrics(): MetricSnapshot {
    return this.metrics;
  }
  
  /**
   * Get metrics history
   */
  getHistory(minutes: number = 60): MetricSnapshot[] {
    const cutoff = Date.now() - (minutes * 60000);
    return this.history.filter(m => m.timestamp > cutoff);
  }
  
  /**
   * Export metrics for external monitoring (Prometheus format)
   */
  exportPrometheus(): string {
    const m = this.metrics;
    const lines: string[] = [];
    
    // Performance metrics
    lines.push(`# HELP xln_entity_tx_latency Entity transaction latency in ms`);
    lines.push(`# TYPE xln_entity_tx_latency gauge`);
    lines.push(`xln_entity_tx_latency ${m.performance.entityTxLatency}`);
    
    lines.push(`# HELP xln_throughput_tps Transactions per second`);
    lines.push(`# TYPE xln_throughput_tps gauge`);
    lines.push(`xln_throughput_tps ${m.performance.throughputTps}`);
    
    // Business metrics
    lines.push(`# HELP xln_total_volume Total volume transferred`);
    lines.push(`# TYPE xln_total_volume counter`);
    lines.push(`xln_total_volume ${m.business.totalVolume}`);
    
    lines.push(`# HELP xln_active_channels Number of active channels`);
    lines.push(`# TYPE xln_active_channels gauge`);
    lines.push(`xln_active_channels ${m.business.activeChannels}`);
    
    // Health metrics
    lines.push(`# HELP xln_error_rate Errors per minute`);
    lines.push(`# TYPE xln_error_rate gauge`);
    lines.push(`xln_error_rate ${m.health.errorRate}`);
    
    lines.push(`# HELP xln_byzantine_faults Total Byzantine faults`);
    lines.push(`# TYPE xln_byzantine_faults counter`);
    lines.push(`xln_byzantine_faults ${m.health.byzantineFaults}`);
    
    return lines.join('\n');
  }
}

interface ChannelMetrics {
  updateCount: number;
  volume: bigint;
  fees: bigint;
  disputes: number;
  lastActive: number;
}

interface EntityMetrics {
  txCount: number;
  txVolume: bigint;
  consensusRounds: number;
  lastActive: number;
}