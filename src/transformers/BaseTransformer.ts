/**
 * BaseTransformer: Elegant abstraction for all XLN transformers
 *
 * Core insight: Every transformer is a pure function that:
 * 1. Validates preconditions
 * 2. Transforms state atomically
 * 3. Generates cryptographic proof
 * 4. Maintains bilateral invariants
 */

import { Subchannel } from '../../old_src/types/Subchannel.js';
import { createHash } from 'crypto';
import { encode } from 'rlp';

// Core types that all transformers share
export interface TransformContext {
  channelKey: string;
  subchannels: Map<number, Subchannel>;
  timestamp: number;
  nonce: number;
}

export interface TransformResult<T = any> {
  success: boolean;
  data?: T;
  proof?: TransformProof;
  error?: string;
  rollback?: () => void;
}

export interface TransformProof {
  operation: string;
  beforeState: string;
  afterState: string;
  timestamp: number;
  signature?: string;
  details?: any;
}

export interface ChannelCapacity {
  inCapacity: bigint;
  outCapacity: bigint;
  availableCollateral: bigint;
  creditUsed: bigint;
  creditAvailable: bigint;
}

// Atomic transaction wrapper
export interface AtomicTransaction {
  id: string;
  operations: TransformOperation[];
  state: 'pending' | 'committed' | 'reverted';
  checkpoints: Map<string, any>;
}

export interface TransformOperation {
  transformer: string;
  method: string;
  params: any;
  result?: TransformResult;
}

/**
 * Abstract base class for all transformers
 */
export abstract class BaseTransformer {
  // Transaction tracking for atomicity
  private static transactions: Map<string, AtomicTransaction> = new Map();

  // Shared state checkpoint system
  private static checkpoints: Map<string, any> = new Map();

  /**
   * Calculate bilateral channel capacity with clean abstraction
   */
  protected static calculateCapacity(
    subchannel: Subchannel,
    perspective: 'left' | 'right'
  ): ChannelCapacity {
    const isLeft = perspective === 'left';
    const delta = subchannel.ondelta + subchannel.offdelta;
    const collateral = this.nonNegative(subchannel.collateral);

    // Credit limits from each perspective
    const ownCreditLimit = isLeft
      ? subchannel.leftCreditLimit
      : subchannel.rightCreditLimit;

    const peerCreditLimit = isLeft
      ? subchannel.rightCreditLimit
      : subchannel.leftCreditLimit;

    // Allowances (locked amounts)
    const ownAllowance = isLeft
      ? subchannel.leftAllowence || 0n
      : subchannel.rightAllowence || 0n;

    const peerAllowance = isLeft
      ? subchannel.rightAllowence || 0n
      : subchannel.leftAllowence || 0n;

    // Calculate capacities using the three-zone model
    const { inCapacity, outCapacity, creditUsed, creditAvailable } =
      this.computeThreeZoneCapacity(
        delta,
        collateral,
        ownCreditLimit,
        peerCreditLimit,
        ownAllowance,
        peerAllowance,
        isLeft
      );

    return {
      inCapacity,
      outCapacity,
      availableCollateral: collateral,
      creditUsed,
      creditAvailable
    };
  }

  /**
   * Three-zone capacity model: [credit|collateral|credit]
   */
  private static computeThreeZoneCapacity(
    delta: bigint,
    collateral: bigint,
    ownCredit: bigint,
    peerCredit: bigint,
    ownAllowance: bigint,
    peerAllowance: bigint,
    isLeft: boolean
  ): {
    inCapacity: bigint;
    outCapacity: bigint;
    creditUsed: bigint;
    creditAvailable: bigint;
  } {
    // Zone calculation based on delta position
    let inCollateral: bigint;
    let outCollateral: bigint;
    let inOwnCredit: bigint;
    let outOwnCredit: bigint;
    let inPeerCredit: bigint;
    let outPeerCredit: bigint;

    if (delta > 0n) {
      // Delta positive: we owe them
      inCollateral = this.nonNegative(collateral - delta);
      outCollateral = delta > collateral ? collateral : delta;
      inOwnCredit = 0n;
      outOwnCredit = ownCredit;
      outPeerCredit = this.nonNegative(delta - collateral);
      inPeerCredit = this.nonNegative(peerCredit - outPeerCredit);
    } else {
      // Delta negative: they owe us
      inCollateral = collateral;
      outCollateral = 0n;
      inOwnCredit = this.nonNegative(-delta);
      outOwnCredit = this.nonNegative(ownCredit - inOwnCredit);
      inPeerCredit = peerCredit;
      outPeerCredit = 0n;
    }

    // Apply allowances
    const inCapacity = this.nonNegative(
      inOwnCredit + inCollateral + inPeerCredit - peerAllowance
    );

    const outCapacity = this.nonNegative(
      outPeerCredit + outCollateral + outOwnCredit - ownAllowance
    );

    const creditUsed = inOwnCredit + outPeerCredit;
    const creditAvailable = outOwnCredit + inPeerCredit;

    return { inCapacity, outCapacity, creditUsed, creditAvailable };
  }

  /**
   * Hash channel state for proof generation
   */
  protected static hashChannelState(
    subchannels: Subchannel[] | Map<number, Subchannel>
  ): string {
    const channels = Array.isArray(subchannels)
      ? subchannels
      : Array.from(subchannels.values());

    const sorted = channels.sort((a, b) => a.tokenId - b.tokenId);

    const encoded = encode(
      sorted.map(s => [
        s.tokenId,
        s.ondelta.toString(),
        s.offdelta.toString(),
        s.collateral.toString(),
        s.leftCreditLimit.toString(),
        s.rightCreditLimit.toString(),
        s.leftAllowence?.toString() || '0',
        s.rightAllowence?.toString() || '0'
      ])
    );

    return '0x' + createHash('sha256').update(encoded).digest('hex');
  }

  /**
   * Create proof of transformation
   */
  protected static createProof(
    operation: string,
    beforeState: string,
    afterState: string,
    details?: any
  ): TransformProof {
    return {
      operation,
      beforeState,
      afterState,
      timestamp: Date.now(),
      details
    };
  }

  /**
   * Begin atomic transaction
   */
  protected static beginTransaction(transactionId?: string): string {
    const txId = transactionId || this.generateTransactionId();

    if (this.transactions.has(txId)) {
      throw new Error(`Transaction ${txId} already exists`);
    }

    const tx: AtomicTransaction = {
      id: txId,
      operations: [],
      state: 'pending',
      checkpoints: new Map()
    };

    this.transactions.set(txId, tx);
    return txId;
  }

  /**
   * Commit atomic transaction
   */
  protected static commitTransaction(txId: string): TransformResult {
    const tx = this.transactions.get(txId);
    if (!tx) {
      return {
        success: false,
        error: `Transaction ${txId} not found`
      };
    }

    if (tx.state !== 'pending') {
      return {
        success: false,
        error: `Transaction ${txId} is ${tx.state}`
      };
    }

    // Check all operations succeeded
    const failed = tx.operations.find(op => !op.result?.success);
    if (failed) {
      return this.rollbackTransaction(txId);
    }

    tx.state = 'committed';

    // Clear checkpoints
    for (const key of tx.checkpoints.keys()) {
      this.checkpoints.delete(key);
    }

    return {
      success: true,
      data: {
        transactionId: txId,
        operations: tx.operations.length,
        committed: Date.now()
      }
    };
  }

  /**
   * Rollback atomic transaction
   */
  protected static rollbackTransaction(txId: string): TransformResult {
    const tx = this.transactions.get(txId);
    if (!tx) {
      return {
        success: false,
        error: `Transaction ${txId} not found`
      };
    }

    // Execute rollback functions in reverse order
    for (let i = tx.operations.length - 1; i >= 0; i--) {
      const op = tx.operations[i];
      if (op.result?.rollback) {
        op.result.rollback();
      }
    }

    // Restore checkpoints
    for (const [key, value] of tx.checkpoints) {
      this.checkpoints.set(key, value);
    }

    tx.state = 'reverted';

    return {
      success: false,
      error: 'Transaction rolled back',
      data: {
        transactionId: txId,
        operations: tx.operations.length,
        reverted: Date.now()
      }
    };
  }

  /**
   * Save checkpoint for rollback
   */
  protected static checkpoint(key: string, value: any, txId?: string): void {
    const oldValue = this.checkpoints.get(key);
    this.checkpoints.set(key, structuredClone(value));

    if (txId) {
      const tx = this.transactions.get(txId);
      if (tx && !tx.checkpoints.has(key)) {
        tx.checkpoints.set(key, oldValue);
      }
    }
  }

  /**
   * Restore from checkpoint
   */
  protected static restore(key: string): any {
    return this.checkpoints.get(key);
  }

  /**
   * Validate basic invariants
   */
  protected static validateInvariants(subchannel: Subchannel): string | null {
    // No negative collateral
    if (subchannel.collateral < 0n) {
      return 'Negative collateral detected';
    }

    // Credit limits must be non-negative
    if (subchannel.leftCreditLimit < 0n || subchannel.rightCreditLimit < 0n) {
      return 'Negative credit limits';
    }

    // Allowances must be non-negative
    const leftAllowance = subchannel.leftAllowence || 0n;
    const rightAllowance = subchannel.rightAllowence || 0n;

    if (leftAllowance < 0n || rightAllowance < 0n) {
      return 'Negative allowances';
    }

    // Total exposure check
    const totalDelta = subchannel.ondelta + subchannel.offdelta;
    const maxExposure = subchannel.collateral +
                       subchannel.leftCreditLimit +
                       subchannel.rightCreditLimit;

    if (this.abs(totalDelta) > maxExposure * 2n) {
      return 'Exposure exceeds reasonable bounds';
    }

    return null;
  }

  /**
   * Transfer value between parties atomically
   */
  protected static transfer(
    subchannel: Subchannel,
    amount: bigint,
    direction: 'leftToRight' | 'rightToLeft'
  ): TransformResult {
    const beforeState = this.hashChannelState([subchannel]);

    if (direction === 'leftToRight') {
      subchannel.offdelta -= amount; // Left loses, right gains
    } else {
      subchannel.offdelta += amount; // Right loses, left gains
    }

    const error = this.validateInvariants(subchannel);
    if (error) {
      // Rollback
      if (direction === 'leftToRight') {
        subchannel.offdelta += amount;
      } else {
        subchannel.offdelta -= amount;
      }

      return {
        success: false,
        error
      };
    }

    const afterState = this.hashChannelState([subchannel]);

    return {
      success: true,
      proof: this.createProof('transfer', beforeState, afterState, {
        amount: amount.toString(),
        direction
      })
    };
  }

  /**
   * Lock funds (increase allowance)
   */
  protected static lock(
    subchannel: Subchannel,
    amount: bigint,
    party: 'left' | 'right'
  ): TransformResult {
    if (party === 'left') {
      subchannel.leftAllowence = (subchannel.leftAllowence || 0n) + amount;
    } else {
      subchannel.rightAllowence = (subchannel.rightAllowence || 0n) + amount;
    }

    return {
      success: true,
      rollback: () => {
        if (party === 'left') {
          subchannel.leftAllowence = (subchannel.leftAllowence || 0n) - amount;
        } else {
          subchannel.rightAllowence = (subchannel.rightAllowence || 0n) - amount;
        }
      }
    };
  }

  /**
   * Unlock funds (decrease allowance)
   */
  protected static unlock(
    subchannel: Subchannel,
    amount: bigint,
    party: 'left' | 'right'
  ): TransformResult {
    const current = party === 'left'
      ? (subchannel.leftAllowence || 0n)
      : (subchannel.rightAllowence || 0n);

    if (amount > current) {
      return {
        success: false,
        error: `Cannot unlock ${amount}, only ${current} locked`
      };
    }

    if (party === 'left') {
      subchannel.leftAllowence = current - amount;
    } else {
      subchannel.rightAllowence = current - amount;
    }

    return {
      success: true,
      rollback: () => {
        if (party === 'left') {
          subchannel.leftAllowence = current;
        } else {
          subchannel.rightAllowence = current;
        }
      }
    };
  }

  // Utility functions
  protected static nonNegative(x: bigint): bigint {
    return x < 0n ? 0n : x;
  }

  protected static abs(x: bigint): bigint {
    return x < 0n ? -x : x;
  }

  protected static min(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
  }

  protected static max(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
  }

  protected static generateTransactionId(): string {
    return 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Abstract method that each transformer must implement
   */
  abstract transform(
    context: TransformContext,
    params: any
  ): Promise<TransformResult>;
}