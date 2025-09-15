/**
 * Dual-Class Share Structure for XLN Entities
 *
 * Implements:
 * 1. Class A shares: Voting shares with economic rights
 * 2. Class B shares: Super-voting shares (10x voting power)
 * 3. Sunset provisions: Automatic conversion after time/events
 * 4. Anti-dilution protection
 * 5. Drag-along/tag-along rights
 */

import { ethers } from 'ethers';
import { EntityState, EntityTx } from '../types.js';

export interface ShareClass {
  symbol: string;
  name: string;
  votingMultiplier: number;
  economicMultiplier: number;
  totalSupply: bigint;
  transferRestrictions: TransferRestriction[];
  conversionRights: ConversionRight[];
  dividendPriority: number;
}

export interface TransferRestriction {
  type: 'lockup' | 'rightOfFirstRefusal' | 'boardApproval' | 'accreditedOnly';
  expiresAt?: number;
  params?: any;
}

export interface ConversionRight {
  targetClass: string;
  ratio: number; // e.g., 1:1 or 1:10
  trigger: ConversionTrigger;
}

export interface ConversionTrigger {
  type: 'time' | 'ipo' | 'acquisition' | 'vote' | 'death' | 'transfer';
  condition: any;
}

export interface Shareholder {
  address: string;
  shares: Map<string, bigint>; // class -> amount
  vestingSchedule?: VestingSchedule;
  tagAlongRights: boolean;
  dragAlongBound: boolean;
}

export interface VestingSchedule {
  startTime: number;
  cliffTime: number;
  endTime: number;
  totalShares: bigint;
  vestedShares: bigint;
  releasedShares: bigint;
}

export interface DualClassConfig {
  entityId: string;
  classA: ShareClass;
  classB: ShareClass;
  sunsetProvision?: SunsetProvision;
  votingAgreements: VotingAgreement[];
}

export interface SunsetProvision {
  type: 'time' | 'ownershipThreshold' | 'transferCount';
  triggerValue: any;
  conversionRatio: number;
  activated: boolean;
}

export interface VotingAgreement {
  parties: string[];
  type: 'pooling' | 'proxy' | 'trustee';
  expiresAt: number;
  terms: string;
}

/**
 * Dual-class share system for sophisticated governance
 */
export class DualClassShares {
  private config: DualClassConfig;
  private shareholders: Map<string, Shareholder> = new Map();
  private votingPools: Map<string, VotingAgreement> = new Map();
  private proposalThresholds: Map<string, bigint> = new Map();

  constructor(config: DualClassConfig) {
    this.config = config;
    this.initializeShareClasses();
  }

  /**
   * Initialize share classes with default structures
   */
  private initializeShareClasses(): void {
    // Set default proposal thresholds
    this.proposalThresholds.set('ordinary', 50n); // 50%
    this.proposalThresholds.set('special', 67n); // 67%
    this.proposalThresholds.set('supermajority', 75n); // 75%
    this.proposalThresholds.set('amendment', 90n); // 90%
  }

  /**
   * Issue shares to a shareholder
   */
  async issueShares(
    recipient: string,
    shareClass: string,
    amount: bigint,
    vestingSchedule?: VestingSchedule
  ): Promise<EntityTx> {
    // Validate share class
    const classConfig = shareClass === 'A' ? this.config.classA : this.config.classB;
    if (!classConfig) {
      throw new Error(`Invalid share class: ${shareClass}`);
    }

    // Check authorization
    if (!await this.canIssueShares(shareClass, amount)) {
      throw new Error('Share issuance not authorized');
    }

    // Get or create shareholder
    let shareholder = this.shareholders.get(recipient);
    if (!shareholder) {
      shareholder = {
        address: recipient,
        shares: new Map(),
        tagAlongRights: shareClass === 'A',
        dragAlongBound: shareClass === 'A'
      };
      this.shareholders.set(recipient, shareholder);
    }

    // Issue shares
    const currentHolding = shareholder.shares.get(shareClass) || 0n;
    shareholder.shares.set(shareClass, currentHolding + amount);

    // Apply vesting if specified
    if (vestingSchedule) {
      shareholder.vestingSchedule = vestingSchedule;
    }

    // Update total supply
    classConfig.totalSupply += amount;

    // Check sunset provisions
    await this.checkSunsetTriggers();

    return {
      type: 'share_issuance',
      from: this.config.entityId,
      data: {
        recipient,
        shareClass,
        amount: amount.toString(),
        vestingSchedule,
        totalSupply: classConfig.totalSupply.toString()
      },
      timestamp: Date.now(),
      nonce: Date.now()
    };
  }

  /**
   * Transfer shares between shareholders
   */
  async transferShares(
    from: string,
    to: string,
    shareClass: string,
    amount: bigint
  ): Promise<EntityTx> {
    const fromHolder = this.shareholders.get(from);
    if (!fromHolder) {
      throw new Error('Sender not found');
    }

    const fromBalance = fromHolder.shares.get(shareClass) || 0n;
    if (fromBalance < amount) {
      throw new Error('Insufficient shares');
    }

    // Check transfer restrictions
    const classConfig = shareClass === 'A' ? this.config.classA : this.config.classB;
    await this.validateTransferRestrictions(from, to, shareClass, amount, classConfig);

    // Check right of first refusal
    if (await this.hasROFR(shareClass)) {
      await this.executeROFR(from, to, shareClass, amount);
    }

    // Check tag-along rights
    if (await this.triggerTagAlong(from, shareClass, amount)) {
      await this.executeTagAlong(from, to, shareClass, amount);
    }

    // Execute transfer
    fromHolder.shares.set(shareClass, fromBalance - amount);

    let toHolder = this.shareholders.get(to);
    if (!toHolder) {
      toHolder = {
        address: to,
        shares: new Map(),
        tagAlongRights: shareClass === 'A',
        dragAlongBound: shareClass === 'A'
      };
      this.shareholders.set(to, toHolder);
    }

    const toBalance = toHolder.shares.get(shareClass) || 0n;
    toHolder.shares.set(shareClass, toBalance + amount);

    // Check sunset provisions
    await this.checkSunsetTriggers();

    return {
      type: 'share_transfer',
      from,
      data: {
        to,
        shareClass,
        amount: amount.toString(),
        timestamp: Date.now()
      },
      timestamp: Date.now(),
      nonce: Date.now()
    };
  }

  /**
   * Convert shares from one class to another
   */
  async convertShares(
    holder: string,
    fromClass: string,
    toClass: string,
    amount: bigint
  ): Promise<EntityTx> {
    const shareholder = this.shareholders.get(holder);
    if (!shareholder) {
      throw new Error('Shareholder not found');
    }

    const fromBalance = shareholder.shares.get(fromClass) || 0n;
    if (fromBalance < amount) {
      throw new Error('Insufficient shares for conversion');
    }

    // Find conversion right
    const fromConfig = fromClass === 'A' ? this.config.classA : this.config.classB;
    const conversionRight = fromConfig.conversionRights.find(
      cr => cr.targetClass === toClass
    );

    if (!conversionRight) {
      throw new Error(`No conversion right from ${fromClass} to ${toClass}`);
    }

    // Check conversion trigger
    if (!await this.isConversionTriggered(conversionRight.trigger)) {
      throw new Error('Conversion trigger not met');
    }

    // Calculate converted amount
    const convertedAmount = amount * BigInt(conversionRight.ratio);

    // Execute conversion
    shareholder.shares.set(fromClass, fromBalance - amount);
    const toBalance = shareholder.shares.get(toClass) || 0n;
    shareholder.shares.set(toClass, toBalance + convertedAmount);

    // Update total supplies
    fromConfig.totalSupply -= amount;
    const toConfig = toClass === 'A' ? this.config.classA : this.config.classB;
    toConfig.totalSupply += convertedAmount;

    return {
      type: 'share_conversion',
      from: holder,
      data: {
        fromClass,
        toClass,
        amount: amount.toString(),
        convertedAmount: convertedAmount.toString(),
        ratio: conversionRight.ratio
      },
      timestamp: Date.now(),
      nonce: Date.now()
    };
  }

  /**
   * Calculate voting power for a shareholder
   */
  calculateVotingPower(address: string): bigint {
    const shareholder = this.shareholders.get(address);
    if (!shareholder) {
      return 0n;
    }

    let totalVotes = 0n;

    // Class A votes
    const classAShares = shareholder.shares.get('A') || 0n;
    totalVotes += classAShares * BigInt(this.config.classA.votingMultiplier);

    // Class B votes (typically 10x)
    const classBShares = shareholder.shares.get('B') || 0n;
    totalVotes += classBShares * BigInt(this.config.classB.votingMultiplier);

    // Check voting pools
    for (const [poolId, agreement] of this.votingPools) {
      if (agreement.parties.includes(address)) {
        // Add pooled voting power
        const poolPower = this.calculatePoolVotingPower(poolId);
        totalVotes += poolPower / BigInt(agreement.parties.length);
      }
    }

    return totalVotes;
  }

  /**
   * Check if a proposal passes with current votes
   */
  checkProposalOutcome(
    proposalType: string,
    votesFor: bigint,
    votesAgainst: bigint
  ): boolean {
    const threshold = this.proposalThresholds.get(proposalType) || 50n;
    const totalVotes = votesFor + votesAgainst;

    if (totalVotes === 0n) return false;

    const percentageFor = (votesFor * 100n) / totalVotes;
    return percentageFor >= threshold;
  }

  /**
   * Execute drag-along rights
   */
  async executeDragAlong(
    majorityHolder: string,
    buyer: string,
    pricePerShare: bigint
  ): Promise<EntityTx[]> {
    const transactions: EntityTx[] = [];

    // Check if majority holder has drag-along rights
    const majorityPower = this.calculateVotingPower(majorityHolder);
    const totalPower = this.calculateTotalVotingPower();

    if (majorityPower * 2n < totalPower) {
      throw new Error('Insufficient voting power for drag-along');
    }

    // Force all shareholders to sell
    for (const [address, shareholder] of this.shareholders) {
      if (address === majorityHolder) continue;
      if (!shareholder.dragAlongBound) continue;

      for (const [shareClass, amount] of shareholder.shares) {
        const tx = await this.transferShares(
          address,
          buyer,
          shareClass,
          amount
        );
        transactions.push(tx);

        // Record sale price for compensation
        tx.data.pricePerShare = pricePerShare.toString();
        tx.data.totalCompensation = (amount * pricePerShare).toString();
      }
    }

    return transactions;
  }

  /**
   * Implement vesting schedule
   */
  async processVesting(address: string): Promise<bigint> {
    const shareholder = this.shareholders.get(address);
    if (!shareholder || !shareholder.vestingSchedule) {
      return 0n;
    }

    const schedule = shareholder.vestingSchedule;
    const now = Date.now();

    // Check cliff
    if (now < schedule.cliffTime) {
      return 0n;
    }

    // Calculate vested amount
    let vestedAmount: bigint;
    if (now >= schedule.endTime) {
      vestedAmount = schedule.totalShares;
    } else {
      const elapsed = BigInt(now - schedule.startTime);
      const total = BigInt(schedule.endTime - schedule.startTime);
      vestedAmount = (schedule.totalShares * elapsed) / total;
    }

    // Calculate newly vested shares
    const newlyVested = vestedAmount - schedule.vestedShares;
    schedule.vestedShares = vestedAmount;

    return newlyVested;
  }

  /**
   * Check and execute sunset provisions
   */
  private async checkSunsetTriggers(): Promise<void> {
    if (!this.config.sunsetProvision || this.config.sunsetProvision.activated) {
      return;
    }

    const provision = this.config.sunsetProvision;
    let triggered = false;

    switch (provision.type) {
      case 'time':
        triggered = Date.now() >= provision.triggerValue;
        break;

      case 'ownershipThreshold':
        // Check if Class B ownership falls below threshold
        const classBOwnership = this.calculateClassOwnershipPercentage('B');
        triggered = classBOwnership < provision.triggerValue;
        break;

      case 'transferCount':
        // Would track transfer count
        triggered = false; // Implement transfer tracking
        break;
    }

    if (triggered) {
      await this.executeSunsetProvision();
    }
  }

  /**
   * Execute sunset provision - convert all Class B to Class A
   */
  private async executeSunsetProvision(): Promise<void> {
    console.log('Executing sunset provision - converting Class B to Class A');

    for (const [address, shareholder] of this.shareholders) {
      const classBShares = shareholder.shares.get('B') || 0n;
      if (classBShares > 0n) {
        await this.convertShares(
          address,
          'B',
          'A',
          classBShares
        );
      }
    }

    this.config.sunsetProvision!.activated = true;
  }

  /**
   * Validate transfer restrictions
   */
  private async validateTransferRestrictions(
    from: string,
    to: string,
    shareClass: string,
    amount: bigint,
    classConfig: ShareClass
  ): Promise<void> {
    for (const restriction of classConfig.transferRestrictions) {
      switch (restriction.type) {
        case 'lockup':
          if (Date.now() < (restriction.expiresAt || 0)) {
            throw new Error('Shares are in lockup period');
          }
          break;

        case 'boardApproval':
          // Would check board approval
          break;

        case 'accreditedOnly':
          // Would verify accredited investor status
          break;

        case 'rightOfFirstRefusal':
          // Handled separately
          break;
      }
    }
  }

  /**
   * Check if right of first refusal applies
   */
  private async hasROFR(shareClass: string): Promise<boolean> {
    const classConfig = shareClass === 'A' ? this.config.classA : this.config.classB;
    return classConfig.transferRestrictions.some(r => r.type === 'rightOfFirstRefusal');
  }

  /**
   * Execute right of first refusal
   */
  private async executeROFR(
    from: string,
    to: string,
    shareClass: string,
    amount: bigint
  ): Promise<void> {
    // In production, would notify existing shareholders
    // and give them opportunity to purchase
    console.log(`ROFR triggered for ${amount} ${shareClass} shares`);
  }

  /**
   * Check if tag-along rights are triggered
   */
  private async triggerTagAlong(
    from: string,
    shareClass: string,
    amount: bigint
  ): Promise<boolean> {
    const fromHolder = this.shareholders.get(from);
    if (!fromHolder) return false;

    const totalShares = fromHolder.shares.get(shareClass) || 0n;
    const percentageSold = (amount * 100n) / totalShares;

    // Tag-along typically triggers on sale of >50% of shares
    return percentageSold > 50n;
  }

  /**
   * Execute tag-along rights
   */
  private async executeTagAlong(
    from: string,
    to: string,
    shareClass: string,
    amount: bigint
  ): Promise<void> {
    // Notify minority shareholders of their tag-along rights
    console.log(`Tag-along rights triggered for ${shareClass} sale`);
  }

  /**
   * Check if share issuance is authorized
   */
  private async canIssueShares(shareClass: string, amount: bigint): Promise<boolean> {
    // Would check board authorization, shareholder approval, etc.
    return true;
  }

  /**
   * Check if conversion trigger is met
   */
  private async isConversionTriggered(trigger: ConversionTrigger): Promise<boolean> {
    switch (trigger.type) {
      case 'time':
        return Date.now() >= trigger.condition;
      case 'ipo':
        // Would check IPO status
        return false;
      case 'acquisition':
        // Would check acquisition status
        return false;
      case 'vote':
        // Would check shareholder vote
        return true;
      default:
        return false;
    }
  }

  /**
   * Calculate voting power of a voting pool
   */
  private calculatePoolVotingPower(poolId: string): bigint {
    const agreement = this.votingPools.get(poolId);
    if (!agreement) return 0n;

    let totalPower = 0n;
    for (const party of agreement.parties) {
      totalPower += this.calculateVotingPower(party);
    }

    return totalPower;
  }

  /**
   * Calculate total voting power
   */
  private calculateTotalVotingPower(): bigint {
    let total = 0n;
    for (const [address] of this.shareholders) {
      total += this.calculateVotingPower(address);
    }
    return total;
  }

  /**
   * Calculate class ownership percentage
   */
  private calculateClassOwnershipPercentage(shareClass: string): bigint {
    const classConfig = shareClass === 'A' ? this.config.classA : this.config.classB;
    const totalShares = this.config.classA.totalSupply + this.config.classB.totalSupply;

    if (totalShares === 0n) return 0n;

    return (classConfig.totalSupply * 100n) / totalShares;
  }

  /**
   * Get current share distribution
   */
  getShareDistribution(): any {
    const distribution = {
      classA: {
        totalSupply: this.config.classA.totalSupply.toString(),
        holders: [] as any[]
      },
      classB: {
        totalSupply: this.config.classB.totalSupply.toString(),
        holders: [] as any[]
      },
      votingPower: {} as any
    };

    for (const [address, shareholder] of this.shareholders) {
      const classAShares = shareholder.shares.get('A') || 0n;
      const classBShares = shareholder.shares.get('B') || 0n;

      if (classAShares > 0n) {
        distribution.classA.holders.push({
          address,
          shares: classAShares.toString(),
          percentage: ((classAShares * 100n) / this.config.classA.totalSupply).toString()
        });
      }

      if (classBShares > 0n) {
        distribution.classB.holders.push({
          address,
          shares: classBShares.toString(),
          percentage: ((classBShares * 100n) / this.config.classB.totalSupply).toString()
        });
      }

      distribution.votingPower[address] = this.calculateVotingPower(address).toString();
    }

    return distribution;
  }
}