/**
 * XLN Byzantine Attack Forensics
 * Tools for analyzing, tracking, and visualizing Byzantine behaviors
 */

import { SlashingCondition, EntityReplica, ProposedEntityFrame, SlashingEvidence } from './types.js';

export interface AttackPattern {
  type: 'coordinated_attack' | 'gradual_corruption' | 'timing_attack' | 'sybil_attack' | 'eclipse_attack';
  participants: string[];
  timespan: [number, number]; // start and end timestamps
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidence: SlashingCondition[];
  description: string;
  impact: {
    consensusRounds: number;
    stakeLost: bigint;
    validatorsEjected: string[];
    networkPartition: boolean;
  };
}

export interface ForensicReport {
  timestamp: number;
  totalSlashingEvents: number;
  attackPatterns: AttackPattern[];
  validatorStats: {
    [validator: string]: {
      totalViolations: number;
      severityBreakdown: { [severity: string]: number };
      stakeReductions: bigint;
      isEjected: boolean;
      riskScore: number; // 0-1, probability of being Byzantine
    };
  };
  networkHealth: {
    byzantineRatio: number; // % of Byzantine validators
    consensusReliability: number; // % of successful rounds
    attackResistance: number; // Network's resistance to attacks
  };
  recommendations: string[];
}

export interface TimelineEvent {
  timestamp: number;
  type: 'slashing' | 'view_change' | 'network_partition' | 'recovery';
  description: string;
  participants: string[];
  severity: 'info' | 'warning' | 'error' | 'critical';
  metadata: any;
}

export class ByzantineForensics {
  private events: TimelineEvent[] = [];
  private attackDatabase: Map<string, AttackPattern> = new Map();

  /**
   * Analyze all slashing conditions to identify attack patterns
   */
  analyzeAttackPatterns(replicas: Map<string, EntityReplica>): AttackPattern[] {
    const allSlashing: SlashingCondition[] = [];
    const participantMap = new Map<string, SlashingCondition[]>();

    // Collect all slashing conditions
    for (const replica of replicas.values()) {
      for (const condition of replica.slashingConditions) {
        allSlashing.push(condition);

        if (!participantMap.has(condition.validator)) {
          participantMap.set(condition.validator, []);
        }
        participantMap.get(condition.validator)!.push(condition);
      }
    }

    const patterns: AttackPattern[] = [];

    // 1. Detect coordinated attacks (multiple validators acting suspiciously at same time)
    patterns.push(...this.detectCoordinatedAttacks(allSlashing));

    // 2. Detect gradual corruption (single validator escalating violations)
    patterns.push(...this.detectGradualCorruption(participantMap));

    // 3. Detect timing attacks (violations clustered around consensus events)
    patterns.push(...this.detectTimingAttacks(allSlashing));

    // 4. Detect sybil attacks (multiple identities, similar behavior)
    patterns.push(...this.detectSybilAttacks(participantMap));

    return patterns;
  }

  /**
   * Detect coordinated attacks (multiple validators)
   */
  private detectCoordinatedAttacks(slashing: SlashingCondition[]): AttackPattern[] {
    const patterns: AttackPattern[] = [];
    const timeWindow = 10000; // 10 seconds

    // Group slashing events by time windows
    const timeGroups = new Map<number, SlashingCondition[]>();
    for (const condition of slashing) {
      const timeSlot = Math.floor(condition.timestamp / timeWindow);
      if (!timeGroups.has(timeSlot)) {
        timeGroups.set(timeSlot, []);
      }
      timeGroups.get(timeSlot)!.push(condition);
    }

    // Look for time windows with multiple validators misbehaving
    for (const [timeSlot, conditions] of timeGroups) {
      const participants = new Set(conditions.map(c => c.validator));

      if (participants.size >= 2 && conditions.length >= 3) {
        const startTime = timeSlot * timeWindow;
        const endTime = (timeSlot + 1) * timeWindow;

        patterns.push({
          type: 'coordinated_attack',
          participants: Array.from(participants),
          timespan: [startTime, endTime],
          severity: participants.size >= 3 ? 'critical' : 'high',
          evidence: conditions,
          description: `${participants.size} validators coordinated ${conditions.length} violations within ${timeWindow/1000} seconds`,
          impact: {
            consensusRounds: this.estimateConsensusImpact(conditions),
            stakeLost: conditions.reduce((sum, c) => sum + this.calculateStakeLoss(c), 0n),
            validatorsEjected: conditions.filter(c => c.penalty === 'ejection').map(c => c.validator),
            networkPartition: conditions.some(c => c.type === 'invalid_view_change')
          }
        });
      }
    }

    return patterns;
  }

  /**
   * Detect gradual corruption (escalating violations from single validator)
   */
  private detectGradualCorruption(participantMap: Map<string, SlashingCondition[]>): AttackPattern[] {
    const patterns: AttackPattern[] = [];

    for (const [validator, conditions] of participantMap) {
      if (conditions.length >= 3) {
        // Sort by timestamp
        const sorted = conditions.sort((a, b) => a.timestamp - b.timestamp);

        // Check for escalation pattern
        let escalationScore = 0;
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i-1];
          const curr = sorted[i];

          // Score based on severity increase
          if (curr.severity === 'major' && prev.severity === 'minor') escalationScore += 2;
          if (curr.severity === 'critical' && prev.severity === 'major') escalationScore += 3;
          if (curr.severity === 'critical' && prev.severity === 'minor') escalationScore += 4;
        }

        if (escalationScore >= 3) {
          patterns.push({
            type: 'gradual_corruption',
            participants: [validator],
            timespan: [sorted[0].timestamp, sorted[sorted.length-1].timestamp],
            severity: sorted[sorted.length-1].severity as any,
            evidence: sorted,
            description: `${validator} showed escalating Byzantine behavior over ${sorted.length} violations`,
            impact: {
              consensusRounds: this.estimateConsensusImpact(sorted),
              stakeLost: this.calculateStakeLoss(sorted[sorted.length-1]),
              validatorsEjected: sorted.filter(c => c.penalty === 'ejection').map(c => c.validator),
              networkPartition: false
            }
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Detect timing attacks (violations around consensus events)
   */
  private detectTimingAttacks(slashing: SlashingCondition[]): AttackPattern[] {
    const patterns: AttackPattern[] = [];

    // Look for clusters of violations around critical consensus phases
    const viewChangeViolations = slashing.filter(c => c.type === 'invalid_view_change');
    const doubleSigningViolations = slashing.filter(c => c.type === 'double_signing');

    if (viewChangeViolations.length >= 2 && doubleSigningViolations.length >= 1) {
      const allTimingViolations = [...viewChangeViolations, ...doubleSigningViolations];
      const participants = new Set(allTimingViolations.map(c => c.validator));

      patterns.push({
        type: 'timing_attack',
        participants: Array.from(participants),
        timespan: [
          Math.min(...allTimingViolations.map(c => c.timestamp)),
          Math.max(...allTimingViolations.map(c => c.timestamp))
        ],
        severity: 'high',
        evidence: allTimingViolations,
        description: `Coordinated timing attack targeting consensus transitions`,
        impact: {
          consensusRounds: allTimingViolations.length,
          stakeLost: allTimingViolations.reduce((sum, c) => sum + this.calculateStakeLoss(c), 0n),
          validatorsEjected: allTimingViolations.filter(c => c.penalty === 'ejection').map(c => c.validator),
          networkPartition: true
        }
      });
    }

    return patterns;
  }

  /**
   * Detect sybil attacks (multiple identities with similar behavior)
   */
  private detectSybilAttacks(participantMap: Map<string, SlashingCondition[]>): AttackPattern[] {
    const patterns: AttackPattern[] = [];

    // Simple sybil detection: validators with identical violation patterns
    const behaviorSignatures = new Map<string, string[]>();

    for (const [validator, conditions] of participantMap) {
      const signature = conditions
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(c => c.type)
        .join(',');

      if (!behaviorSignatures.has(signature)) {
        behaviorSignatures.set(signature, []);
      }
      behaviorSignatures.get(signature)!.push(validator);
    }

    for (const [signature, validators] of behaviorSignatures) {
      if (validators.length >= 2 && signature.length > 10) { // Non-trivial patterns
        const allEvidence = validators.flatMap(v => participantMap.get(v) || []);

        patterns.push({
          type: 'sybil_attack',
          participants: validators,
          timespan: [
            Math.min(...allEvidence.map(c => c.timestamp)),
            Math.max(...allEvidence.map(c => c.timestamp))
          ],
          severity: 'critical',
          evidence: allEvidence,
          description: `Potential sybil attack: ${validators.length} validators with identical behavior patterns`,
          impact: {
            consensusRounds: allEvidence.length,
            stakeLost: allEvidence.reduce((sum, c) => sum + this.calculateStakeLoss(c), 0n),
            validatorsEjected: allEvidence.filter(c => c.penalty === 'ejection').map(c => c.validator),
            networkPartition: false
          }
        });
      }
    }

    return patterns;
  }

  /**
   * Calculate validator risk scores
   */
  calculateRiskScores(replicas: Map<string, EntityReplica>): { [validator: string]: number } {
    const scores: { [validator: string]: number } = {};

    for (const [validatorId, replica] of replicas) {
      let riskScore = 0;
      const conditions = replica.slashingConditions;

      // Base risk from violation count
      riskScore += Math.min(conditions.length * 0.1, 0.3);

      // Severity weighting
      for (const condition of conditions) {
        switch (condition.severity) {
          case 'critical': riskScore += 0.4; break;
          case 'major': riskScore += 0.2; break;
          case 'minor': riskScore += 0.05; break;
        }
      }

      // Type-specific risks
      const hasDoubleSign = conditions.some(c => c.type === 'double_signing');
      const hasEquivocation = conditions.some(c => c.type === 'equivocation');
      const hasInvalidProposal = conditions.some(c => c.type === 'invalid_proposal');

      if (hasDoubleSign) riskScore += 0.3;
      if (hasEquivocation) riskScore += 0.25;
      if (hasInvalidProposal) riskScore += 0.15;

      // Recent activity penalty
      const recentViolations = conditions.filter(c => Date.now() - c.timestamp < 300000); // 5 minutes
      riskScore += recentViolations.length * 0.1;

      scores[validatorId] = Math.min(riskScore, 1.0);
    }

    return scores;
  }

  /**
   * Generate comprehensive forensic report
   */
  generateForensicReport(replicas: Map<string, EntityReplica>): ForensicReport {
    const attackPatterns = this.analyzeAttackPatterns(replicas);
    const riskScores = this.calculateRiskScores(replicas);

    // Collect all slashing conditions
    const allSlashing: SlashingCondition[] = [];
    for (const replica of replicas.values()) {
      allSlashing.push(...replica.slashingConditions);
    }

    // Calculate validator stats
    const validatorStats: { [validator: string]: any } = {};
    for (const [validatorId, replica] of replicas) {
      const conditions = replica.slashingConditions;
      const severityBreakdown = conditions.reduce((acc, c) => {
        acc[c.severity] = (acc[c.severity] || 0) + 1;
        return acc;
      }, {} as { [severity: string]: number });

      validatorStats[validatorId] = {
        totalViolations: conditions.length,
        severityBreakdown,
        stakeReductions: conditions.reduce((sum, c) => sum + this.calculateStakeLoss(c), 0n),
        isEjected: !replica.state.config.validators.includes(validatorId),
        riskScore: riskScores[validatorId] || 0
      };
    }

    // Calculate network health
    const activeValidators = Array.from(replicas.values())[0]?.state.config.validators.length || 0;
    const byzantineValidators = Object.values(riskScores).filter(score => score > 0.3).length;
    const byzantineRatio = activeValidators > 0 ? byzantineValidators / activeValidators : 0;

    // Generate recommendations
    const recommendations = this.generateRecommendations(attackPatterns, riskScores, byzantineRatio);

    return {
      timestamp: Date.now(),
      totalSlashingEvents: allSlashing.length,
      attackPatterns,
      validatorStats,
      networkHealth: {
        byzantineRatio,
        consensusReliability: this.calculateConsensusReliability(allSlashing),
        attackResistance: 1 - byzantineRatio
      },
      recommendations
    };
  }

  /**
   * Add timeline event
   */
  addTimelineEvent(event: Omit<TimelineEvent, 'timestamp'>): void {
    this.events.push({
      ...event,
      timestamp: Date.now()
    });
  }

  /**
   * Get timeline events in chronological order
   */
  getTimeline(): TimelineEvent[] {
    return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Generate attack visualization data
   */
  generateVisualizationData(replicas: Map<string, EntityReplica>) {
    const nodes = Array.from(replicas.keys()).map(validator => ({
      id: validator,
      type: 'validator',
      riskScore: this.calculateRiskScores(replicas)[validator] || 0,
      violations: replicas.get(validator)?.slashingConditions.length || 0,
      status: replicas.get(validator)?.state.config.validators.includes(validator) ? 'active' : 'ejected'
    }));

    const edges: any[] = [];
    const attackPatterns = this.analyzeAttackPatterns(replicas);

    // Create edges for attack patterns
    for (const pattern of attackPatterns) {
      for (let i = 0; i < pattern.participants.length; i++) {
        for (let j = i + 1; j < pattern.participants.length; j++) {
          edges.push({
            source: pattern.participants[i],
            target: pattern.participants[j],
            type: pattern.type,
            severity: pattern.severity,
            weight: pattern.evidence.length
          });
        }
      }
    }

    return { nodes, edges, attackPatterns };
  }

  // Helper methods
  private calculateStakeLoss(condition: SlashingCondition): bigint {
    switch (condition.penalty) {
      case 'stake_reduction': return BigInt(25); // 25% reduction
      case 'ejection': return BigInt(100); // Full stake loss
      default: return BigInt(0);
    }
  }

  private estimateConsensusImpact(conditions: SlashingCondition[]): number {
    return conditions.filter(c =>
      c.type === 'double_signing' ||
      c.type === 'invalid_proposal' ||
      c.type === 'invalid_view_change'
    ).length;
  }

  private calculateConsensusReliability(slashing: SlashingCondition[]): number {
    const criticalViolations = slashing.filter(c => c.severity === 'critical').length;
    const totalRounds = 100; // Assume 100 rounds for calculation
    return Math.max(0, (totalRounds - criticalViolations) / totalRounds);
  }

  private generateRecommendations(
    patterns: AttackPattern[],
    riskScores: { [validator: string]: number },
    byzantineRatio: number
  ): string[] {
    const recommendations: string[] = [];

    // High-risk validators
    const highRiskValidators = Object.entries(riskScores)
      .filter(([_, score]) => score > 0.5)
      .map(([validator, _]) => validator);

    if (highRiskValidators.length > 0) {
      recommendations.push(`🚨 HIGH RISK: Monitor validators ${highRiskValidators.join(', ')} closely for continued Byzantine behavior`);
    }

    // Coordinated attacks
    const coordinatedAttacks = patterns.filter(p => p.type === 'coordinated_attack');
    if (coordinatedAttacks.length > 0) {
      recommendations.push(`⚔️ COORDINATED THREAT: ${coordinatedAttacks.length} coordinated attacks detected. Consider increasing Byzantine fault tolerance threshold`);
    }

    // Network health
    if (byzantineRatio > 0.33) {
      recommendations.push(`💥 CRITICAL: Byzantine ratio (${(byzantineRatio*100).toFixed(1)}%) exceeds safety threshold. Network security compromised`);
    } else if (byzantineRatio > 0.2) {
      recommendations.push(`⚠️ WARNING: Byzantine ratio (${(byzantineRatio*100).toFixed(1)}%) approaching danger zone. Consider validator set expansion`);
    }

    // Sybil attacks
    const sybilAttacks = patterns.filter(p => p.type === 'sybil_attack');
    if (sybilAttacks.length > 0) {
      recommendations.push(`🔍 SYBIL THREAT: Potential sybil attacks detected. Implement stronger validator identity verification`);
    }

    if (recommendations.length === 0) {
      recommendations.push(`✅ NETWORK HEALTHY: No significant Byzantine threats detected. Continue monitoring`);
    }

    return recommendations;
  }
}