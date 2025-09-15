/**
 * Test ValidatorNode - Simplified version for benchmarking
 *
 * This is a lightweight ValidatorNode implementation specifically for
 * performance testing. It focuses on consensus simulation rather than
 * full production features.
 */

import { ethers } from 'ethers';
import { performance } from 'perf_hooks';

export interface TestValidatorConfig {
  chainId: number;
  networkId: string;
  isByzantine?: boolean;
  faultProbability?: number;
}

export class ValidatorNode {
  public id: string;
  public config: TestValidatorConfig;
  private wallet: ethers.Wallet;

  // Consensus state
  private viewNumber: number = 0;
  private height: number = 0;
  private isPrimary: boolean = false;

  // Performance tracking
  private votesCount = 0;
  private proposalsCount = 0;
  private byzantineActionsCount = 0;

  constructor(
    id: string,
    wallet: ethers.Wallet,
    config: TestValidatorConfig
  ) {
    this.id = id;
    this.wallet = wallet;
    this.config = {
      isByzantine: false,
      faultProbability: 0.0,
      ...config
    };
  }

  /**
   * Simulate consensus round participation
   */
  async participateInConsensus(roundNumber: number, totalValidators: number): Promise<{
    voted: boolean;
    byzantine: boolean;
    latency: number;
  }> {
    const startTime = performance.now();

    // Determine if this validator is primary for this round
    this.isPrimary = (roundNumber % totalValidators) === parseInt(this.id.split('-')[1] || '0');

    let voted = true;
    let byzantine = false;

    // Byzantine behavior simulation
    if (this.config.isByzantine && Math.random() < this.config.faultProbability!) {
      byzantine = true;
      this.byzantineActionsCount++;

      // Different types of Byzantine behavior
      const faultType = Math.random();

      if (faultType < 0.25) {
        // Withhold vote (liveness attack)
        voted = false;
      } else if (faultType < 0.5) {
        // Double vote (safety violation) - we'll count this as voted but malicious
        voted = true;
      } else if (faultType < 0.75) {
        // Vote for wrong proposal
        voted = true;
      } else {
        // Send conflicting messages to different validators
        voted = true;
      }
    } else {
      // Honest behavior
      voted = true;
      this.votesCount++;
    }

    // If primary, count proposal
    if (this.isPrimary) {
      this.proposalsCount++;
    }

    // Simulate network/processing latency
    const baseLatency = 20; // 20ms base
    const networkJitter = Math.random() * 30; // 0-30ms jitter
    const byzantineDelay = byzantine ? Math.random() * 100 : 0; // Extra delay for Byzantine

    const totalLatency = baseLatency + networkJitter + byzantineDelay;
    await new Promise(resolve => setTimeout(resolve, totalLatency));

    const endTime = performance.now();
    const actualLatency = endTime - startTime;

    return {
      voted,
      byzantine,
      latency: actualLatency
    };
  }

  /**
   * Simulate block proposal (primary only)
   */
  async proposeBlock(): Promise<{
    blockHash: string;
    transactionCount: number;
    latency: number;
  }> {
    const startTime = performance.now();

    if (!this.isPrimary) {
      throw new Error('Only primary can propose blocks');
    }

    // Simulate block creation
    const transactionCount = Math.floor(Math.random() * 100) + 50; // 50-150 txs
    const blockData = {
      height: this.height++,
      proposer: this.id,
      transactions: transactionCount,
      timestamp: Date.now(),
      viewNumber: this.viewNumber
    };

    // Create deterministic block hash
    const blockHash = ethers.id(JSON.stringify(blockData));

    // Simulate block assembly time
    const assemblyTime = Math.random() * 50 + 25; // 25-75ms
    await new Promise(resolve => setTimeout(resolve, assemblyTime));

    const endTime = performance.now();
    const latency = endTime - startTime;

    this.proposalsCount++;

    return {
      blockHash,
      transactionCount,
      latency
    };
  }

  /**
   * Simulate view change (when primary fails)
   */
  async initiateViewChange(): Promise<{
    newViewNumber: number;
    newPrimary: string;
    latency: number;
  }> {
    const startTime = performance.now();

    this.viewNumber++;

    // Simulate view change processing
    const viewChangeTime = Math.random() * 200 + 100; // 100-300ms
    await new Promise(resolve => setTimeout(resolve, viewChangeTime));

    const endTime = performance.now();
    const latency = endTime - startTime;

    return {
      newViewNumber: this.viewNumber,
      newPrimary: `validator-${this.viewNumber % 7}`, // Rotate primary
      latency
    };
  }

  /**
   * Get validator statistics
   */
  getStats(): {
    id: string;
    isByzantine: boolean;
    votesCount: number;
    proposalsCount: number;
    byzantineActionsCount: number;
    viewNumber: number;
    height: number;
  } {
    return {
      id: this.id,
      isByzantine: this.config.isByzantine || false,
      votesCount: this.votesCount,
      proposalsCount: this.proposalsCount,
      byzantineActionsCount: this.byzantineActionsCount,
      viewNumber: this.viewNumber,
      height: this.height
    };
  }

  /**
   * Reset validator state for new test
   */
  reset(): void {
    this.viewNumber = 0;
    this.height = 0;
    this.isPrimary = false;
    this.votesCount = 0;
    this.proposalsCount = 0;
    this.byzantineActionsCount = 0;
  }

  /**
   * Simulate network partition behavior
   */
  setPartitioned(isPartitioned: boolean): void {
    // In a real implementation, this would affect message sending/receiving
    // For testing, we can simulate by increasing fault probability
    if (isPartitioned) {
      this.config.faultProbability = Math.min((this.config.faultProbability || 0) + 0.5, 1.0);
    }
  }

  /**
   * Get address for identification
   */
  get address(): string {
    return this.wallet.address;
  }
}