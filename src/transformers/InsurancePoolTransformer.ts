/**
 * InsurancePoolTransformer: Bilateral insurance without centralized underwriters
 *
 * Fuck traditional insurance companies. This is peer-to-peer risk sharing:
 * 1. Each channel can create insurance pools for specific risks
 * 2. Dynamic premiums based on actual claim history
 * 3. No bureaucratic claim denial - smart contract validation
 * 4. Cascading reinsurance through channel networks
 * 5. Liquidation protection for leveraged positions
 *
 * This isn't about profit extraction. It's about actual risk management.
 */

import { Subchannel } from '../../old_src/types/Subchannel.js';
import { createHash } from 'crypto';
import { encode } from 'rlp';

export interface InsuranceParams {
  poolId: string;
  coverageType: 'liquidation' | 'smart_contract' | 'impermanent_loss' | 'general';

  // Coverage specifications
  maxCoverage: bigint; // Maximum payout per claim
  deductible: bigint; // Amount not covered
  coveragePeriod: number; // Coverage duration in ms

  // Premium calculation
  basePremiumRate: number; // Base rate per period (basis points)
  riskMultiplier?: number; // Multiplier based on risk score

  // Pool parameters
  minReserveRatio: number; // Minimum reserves/coverage ratio (e.g., 20% = 2000)
  maxLeverage: number; // Maximum coverage/reserves ratio

  // Claim parameters
  claimCooldown: number; // Time between claims (ms)
  validationPeriod: number; // Time to challenge claims

  // Participants
  underwriter: 'left' | 'right';
  insured: 'left' | 'right';
}

export interface InsurancePolicy {
  policyId: string;
  poolId: string;
  params: InsuranceParams;
  status: 'active' | 'claimed' | 'expired' | 'cancelled';

  // Premium tracking
  premiumPaid: bigint;
  lastPremiumTime: number;
  nextPremiumDue: number;

  // Claim tracking
  claimHistory: Claim[];
  totalClaimsPaid: bigint;
  lastClaimTime?: number;

  // Risk metrics
  riskScore: number; // 0-1000, higher = riskier
  lossRatio: number; // Claims/premiums ratio

  // Coverage
  coverageStart: number;
  coverageEnd: number;
  remainingCoverage: bigint;
}

export interface InsurancePool {
  poolId: string;
  status: 'active' | 'underfunded' | 'liquidating';

  // Reserves
  totalReserves: bigint;
  availableReserves: bigint;
  lockedReserves: bigint; // Locked for pending claims

  // Metrics
  totalPremiumsCollected: bigint;
  totalClaimsPaid: bigint;
  activePolicies: number;
  totalCoverage: bigint;

  // Risk management
  poolRiskScore: number;
  reserveRatio: number; // Current reserves/coverage

  // Policies
  policies: Map<string, InsurancePolicy>;

  // Reinsurance
  reinsurancePools?: string[]; // Other pools providing reinsurance
}

export interface Claim {
  claimId: string;
  timestamp: number;
  claimAmount: bigint;
  approvedAmount: bigint;
  evidence: ClaimEvidence;
  status: 'pending' | 'approved' | 'rejected' | 'challenged';
  challengedBy?: string;
  resolution?: string;
}

export interface ClaimEvidence {
  eventType: string;
  proofHash: string;
  liquidationPrice?: bigint;
  marketPrice?: bigint;
  lossAmount?: bigint;
  additionalData?: any;
}

export interface InsuranceResult {
  success: boolean;
  policy?: InsurancePolicy;
  pool?: InsurancePool;
  claim?: Claim;
  proof?: InsuranceProof;
  error?: string;
}

export interface InsuranceProof {
  poolId: string;
  operation: 'create_pool' | 'write_policy' | 'pay_premium' | 'file_claim' | 'process_claim';
  beforeState: string;
  afterState: string;
  timestamp: number;
  details?: any;
}

export class InsurancePoolTransformer {
  // Store insurance pools per channel
  private static pools: Map<string, Map<string, InsurancePool>> = new Map();

  // Risk scoring model parameters (simplified)
  private static readonly RISK_FACTORS = {
    leverage: 0.3,
    volatility: 0.3,
    history: 0.2,
    collateral: 0.2
  };

  /**
   * Create an insurance pool
   */
  static createPool(
    channelKey: string,
    reserveSubchannel: Subchannel,
    underwriter: 'left' | 'right',
    initialReserves: bigint,
    poolId: string
  ): InsuranceResult {
    if (!this.pools.has(channelKey)) {
      this.pools.set(channelKey, new Map());
    }
    const channelPools = this.pools.get(channelKey)!;

    if (channelPools.has(poolId)) {
      return {
        success: false,
        error: 'Pool already exists'
      };
    }

    const underwriterIsLeft = underwriter === 'left';
    const capacity = this.calculateCapacity(reserveSubchannel, underwriterIsLeft);

    if (initialReserves > capacity.outCapacity) {
      return {
        success: false,
        error: 'Insufficient reserves'
      };
    }

    const beforeState = this.hashState(reserveSubchannel);

    // Lock reserves
    if (underwriterIsLeft) {
      reserveSubchannel.leftAllowence += initialReserves;
    } else {
      reserveSubchannel.rightAllowence += initialReserves;
    }

    // Create pool
    const pool: InsurancePool = {
      poolId,
      status: 'active',
      totalReserves: initialReserves,
      availableReserves: initialReserves,
      lockedReserves: 0n,
      totalPremiumsCollected: 0n,
      totalClaimsPaid: 0n,
      activePolicies: 0,
      totalCoverage: 0n,
      poolRiskScore: 0,
      reserveRatio: 100, // 100% initially
      policies: new Map()
    };

    channelPools.set(poolId, pool);

    const afterState = this.hashState(reserveSubchannel);

    const proof: InsuranceProof = {
      poolId,
      operation: 'create_pool',
      beforeState,
      afterState,
      timestamp: Date.now(),
      details: {
        underwriter,
        initialReserves: initialReserves.toString()
      }
    };

    return {
      success: true,
      pool,
      proof
    };
  }

  /**
   * Write an insurance policy
   */
  static writePolicy(
    channelKey: string,
    premiumSubchannel: Subchannel,
    poolId: string,
    params: InsuranceParams
  ): InsuranceResult {
    const channelPools = this.pools.get(channelKey);
    if (!channelPools) {
      return {
        success: false,
        error: 'No pools for this channel'
      };
    }

    const pool = channelPools.get(poolId);
    if (!pool) {
      return {
        success: false,
        error: 'Pool not found'
      };
    }

    if (pool.status !== 'active') {
      return {
        success: false,
        error: `Pool is ${pool.status}`
      };
    }

    // Check if pool can handle coverage
    const newTotalCoverage = pool.totalCoverage + params.maxCoverage;
    const maxAllowedCoverage = pool.totalReserves * BigInt(params.maxLeverage);

    if (newTotalCoverage > maxAllowedCoverage) {
      return {
        success: false,
        error: 'Pool cannot provide requested coverage'
      };
    }

    const beforeState = this.hashState(premiumSubchannel);

    // Calculate initial premium
    const riskScore = this.calculateRiskScore(params, pool);
    const premium = this.calculatePremium(params, riskScore);

    // Collect initial premium
    const insuredIsLeft = params.insured === 'left';
    const insuredCapacity = this.calculateCapacity(premiumSubchannel, insuredIsLeft);

    if (premium > insuredCapacity.outCapacity) {
      return {
        success: false,
        error: 'Insufficient funds for premium'
      };
    }

    // Transfer premium
    if (insuredIsLeft) {
      premiumSubchannel.offdelta -= premium;
    } else {
      premiumSubchannel.offdelta += premium;
    }

    // Create policy
    const policyId = `${poolId}-${Date.now()}`;
    const now = Date.now();

    const policy: InsurancePolicy = {
      policyId,
      poolId,
      params,
      status: 'active',
      premiumPaid: premium,
      lastPremiumTime: now,
      nextPremiumDue: now + params.coveragePeriod,
      claimHistory: [],
      totalClaimsPaid: 0n,
      riskScore,
      lossRatio: 0,
      coverageStart: now,
      coverageEnd: now + params.coveragePeriod,
      remainingCoverage: params.maxCoverage
    };

    // Update pool
    pool.policies.set(policyId, policy);
    pool.activePolicies++;
    pool.totalCoverage = newTotalCoverage;
    pool.totalPremiumsCollected += premium;
    pool.availableReserves += premium;
    pool.totalReserves += premium;
    pool.poolRiskScore = this.calculatePoolRiskScore(pool);
    pool.reserveRatio = Number(pool.totalReserves * 100n / pool.totalCoverage);

    const afterState = this.hashState(premiumSubchannel);

    const proof: InsuranceProof = {
      poolId,
      operation: 'write_policy',
      beforeState,
      afterState,
      timestamp: now,
      details: {
        policyId,
        coverage: params.maxCoverage.toString(),
        premium: premium.toString(),
        riskScore
      }
    };

    return {
      success: true,
      policy,
      pool,
      proof
    };
  }

  /**
   * File an insurance claim
   */
  static fileClaim(
    channelKey: string,
    policyId: string,
    claimAmount: bigint,
    evidence: ClaimEvidence
  ): InsuranceResult {
    const channelPools = this.pools.get(channelKey);
    if (!channelPools) {
      return {
        success: false,
        error: 'No pools for this channel'
      };
    }

    // Find policy
    let policy: InsurancePolicy | undefined;
    let pool: InsurancePool | undefined;

    for (const [, p] of channelPools) {
      const pol = p.policies.get(policyId);
      if (pol) {
        policy = pol;
        pool = p;
        break;
      }
    }

    if (!policy || !pool) {
      return {
        success: false,
        error: 'Policy not found'
      };
    }

    if (policy.status !== 'active') {
      return {
        success: false,
        error: `Policy is ${policy.status}`
      };
    }

    const now = Date.now();

    // Check coverage period
    if (now > policy.coverageEnd) {
      return {
        success: false,
        error: 'Policy has expired'
      };
    }

    // Check claim cooldown
    if (policy.lastClaimTime && now - policy.lastClaimTime < policy.params.claimCooldown) {
      return {
        success: false,
        error: 'Still in claim cooldown period'
      };
    }

    // Check remaining coverage
    if (claimAmount > policy.remainingCoverage) {
      return {
        success: false,
        error: 'Claim exceeds remaining coverage'
      };
    }

    // Apply deductible
    const payableAmount = claimAmount > policy.params.deductible
      ? claimAmount - policy.params.deductible
      : 0n;

    if (payableAmount === 0n) {
      return {
        success: false,
        error: 'Claim amount is below deductible'
      };
    }

    // Validate evidence based on coverage type
    if (!this.validateClaimEvidence(policy.params.coverageType, evidence)) {
      return {
        success: false,
        error: 'Invalid claim evidence'
      };
    }

    // Create claim
    const claim: Claim = {
      claimId: `${policyId}-claim-${Date.now()}`,
      timestamp: now,
      claimAmount,
      approvedAmount: payableAmount,
      evidence,
      status: 'pending'
    };

    // Add to claim history
    policy.claimHistory.push(claim);
    policy.lastClaimTime = now;

    // Lock reserves for claim
    pool.lockedReserves += payableAmount;
    pool.availableReserves -= payableAmount;

    // Update risk score based on claim
    policy.riskScore = Math.min(1000, policy.riskScore + 50);
    pool.poolRiskScore = this.calculatePoolRiskScore(pool);

    const proof: InsuranceProof = {
      poolId: pool.poolId,
      operation: 'file_claim',
      beforeState: '0x' + createHash('sha256').update(encode([pool.totalReserves.toString()])).digest('hex'),
      afterState: '0x' + createHash('sha256').update(encode([pool.availableReserves.toString()])).digest('hex'),
      timestamp: now,
      details: {
        claimId: claim.claimId,
        claimAmount: claimAmount.toString(),
        payableAmount: payableAmount.toString()
      }
    };

    return {
      success: true,
      policy,
      pool,
      claim,
      proof
    };
  }

  /**
   * Process a pending claim (approve/reject after validation period)
   */
  static processClaim(
    channelKey: string,
    payoutSubchannel: Subchannel,
    claimId: string,
    approved: boolean,
    reason?: string
  ): InsuranceResult {
    const channelPools = this.pools.get(channelKey);
    if (!channelPools) {
      return {
        success: false,
        error: 'No pools for this channel'
      };
    }

    // Find claim
    let policy: InsurancePolicy | undefined;
    let pool: InsurancePool | undefined;
    let claim: Claim | undefined;

    for (const [, p] of channelPools) {
      for (const [, pol] of p.policies) {
        const c = pol.claimHistory.find(cl => cl.claimId === claimId);
        if (c) {
          claim = c;
          policy = pol;
          pool = p;
          break;
        }
      }
      if (claim) break;
    }

    if (!claim || !policy || !pool) {
      return {
        success: false,
        error: 'Claim not found'
      };
    }

    if (claim.status !== 'pending') {
      return {
        success: false,
        error: `Claim is already ${claim.status}`
      };
    }

    const now = Date.now();

    // Check validation period has passed
    if (now - claim.timestamp < policy.params.validationPeriod) {
      return {
        success: false,
        error: 'Still in validation period'
      };
    }

    const beforeState = this.hashState(payoutSubchannel);

    if (approved) {
      // Pay out claim
      const underwriterIsLeft = policy.params.underwriter === 'left';
      const insuredIsLeft = policy.params.insured === 'left';

      // Transfer from pool to insured
      if (insuredIsLeft) {
        payoutSubchannel.offdelta += claim.approvedAmount;
      } else {
        payoutSubchannel.offdelta -= claim.approvedAmount;
      }

      // Update claim
      claim.status = 'approved';
      claim.resolution = reason || 'Claim validated and approved';

      // Update policy
      policy.totalClaimsPaid += claim.approvedAmount;
      policy.remainingCoverage -= claim.approvedAmount;
      policy.lossRatio = Number(policy.totalClaimsPaid * 100n / policy.premiumPaid);

      // Update pool
      pool.totalClaimsPaid += claim.approvedAmount;
      pool.lockedReserves -= claim.approvedAmount;
      pool.totalReserves -= claim.approvedAmount;

      // Check if pool is underfunded
      if (pool.totalReserves < pool.totalCoverage * BigInt(policy.params.minReserveRatio) / 10000n) {
        pool.status = 'underfunded';
      }
    } else {
      // Reject claim
      claim.status = 'rejected';
      claim.resolution = reason || 'Claim rejected after review';

      // Unlock reserves
      pool.lockedReserves -= claim.approvedAmount;
      pool.availableReserves += claim.approvedAmount;

      // Improve risk score for false claim
      policy.riskScore = Math.max(0, policy.riskScore - 25);
    }

    pool.reserveRatio = Number(pool.totalReserves * 100n / pool.totalCoverage);

    const afterState = this.hashState(payoutSubchannel);

    const proof: InsuranceProof = {
      poolId: pool.poolId,
      operation: 'process_claim',
      beforeState,
      afterState,
      timestamp: now,
      details: {
        claimId,
        approved,
        amount: approved ? claim.approvedAmount.toString() : '0',
        resolution: claim.resolution
      }
    };

    return {
      success: true,
      policy,
      pool,
      claim,
      proof
    };
  }

  /**
   * Calculate risk score for a policy
   */
  private static calculateRiskScore(params: InsuranceParams, pool: InsurancePool): number {
    let score = 0;

    // Coverage type risk
    const typeRisk = {
      'liquidation': 300,
      'smart_contract': 500,
      'impermanent_loss': 200,
      'general': 100
    };
    score += typeRisk[params.coverageType];

    // Coverage amount risk (higher coverage = higher risk)
    const coverageRatio = Number(params.maxCoverage * 100n / pool.totalReserves);
    score += Math.min(300, coverageRatio * 3);

    // Deductible (lower deductible = higher risk)
    const deductibleRatio = Number(params.deductible * 100n / params.maxCoverage);
    score += Math.max(0, 200 - deductibleRatio * 2);

    // Pool health
    if (pool.reserveRatio < 50) score += 200;
    else if (pool.reserveRatio < 100) score += 100;

    return Math.min(1000, score);
  }

  /**
   * Calculate premium for a policy
   */
  private static calculatePremium(params: InsuranceParams, riskScore: number): bigint {
    // Base premium
    let premium = params.maxCoverage * BigInt(params.basePremiumRate) / 10000n;

    // Apply risk multiplier
    const riskMultiplier = 1 + (riskScore / 1000) * (params.riskMultiplier || 2);
    premium = premium * BigInt(Math.floor(riskMultiplier * 100)) / 100n;

    // Minimum premium
    const minPremium = params.maxCoverage / 100n; // 1% minimum
    if (premium < minPremium) premium = minPremium;

    return premium;
  }

  /**
   * Calculate pool risk score
   */
  private static calculatePoolRiskScore(pool: InsurancePool): number {
    let totalRisk = 0;
    let totalWeight = 0;

    for (const policy of pool.policies.values()) {
      if (policy.status === 'active') {
        const weight = Number(policy.remainingCoverage);
        totalRisk += policy.riskScore * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? Math.floor(totalRisk / totalWeight) : 0;
  }

  /**
   * Validate claim evidence
   */
  private static validateClaimEvidence(coverageType: string, evidence: ClaimEvidence): boolean {
    // In production, this would verify cryptographic proofs
    switch (coverageType) {
      case 'liquidation':
        return !!(evidence.liquidationPrice && evidence.marketPrice &&
                 evidence.liquidationPrice !== evidence.marketPrice);

      case 'smart_contract':
        return !!(evidence.proofHash && evidence.eventType === 'exploit');

      case 'impermanent_loss':
        return !!(evidence.lossAmount && evidence.lossAmount > 0n);

      case 'general':
        return !!evidence.proofHash;

      default:
        return false;
    }
  }

  /**
   * Calculate channel capacity
   */
  private static calculateCapacity(subchannel: Subchannel, isLeft: boolean): any {
    const nonNegative = (x: bigint) => x < 0n ? 0n : x;

    const delta = subchannel.ondelta + subchannel.offdelta;
    const collateral = nonNegative(subchannel.collateral);

    let ownCreditLimit = isLeft ? subchannel.leftCreditLimit : subchannel.rightCreditLimit;
    let peerCreditLimit = isLeft ? subchannel.rightCreditLimit : subchannel.leftCreditLimit;

    let outCollateral = delta > 0n ? (delta > collateral ? collateral : delta) : 0n;
    let outPeerCredit = nonNegative(delta - collateral);
    if (outPeerCredit > peerCreditLimit) outPeerCredit = peerCreditLimit;

    let inOwnCredit = nonNegative(-delta);
    if (inOwnCredit > ownCreditLimit) inOwnCredit = ownCreditLimit;
    let outOwnCredit = nonNegative(ownCreditLimit - inOwnCredit);

    let outAllowence = isLeft ? subchannel.leftAllowence : subchannel.rightAllowence;
    let outCapacity = nonNegative(outPeerCredit + outCollateral + outOwnCredit - outAllowence);

    return { outCapacity };
  }

  /**
   * Hash state for proofs
   */
  private static hashState(subchannel: Subchannel): string {
    const encoded = encode([
      subchannel.tokenId,
      subchannel.ondelta.toString(),
      subchannel.offdelta.toString(),
      subchannel.collateral.toString()
    ]);

    return '0x' + createHash('sha256').update(encoded).digest('hex');
  }
}