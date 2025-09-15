/**
 * AtomicTransformer: Proper atomic operations with real rollback
 *
 * This fixes the theatrical rollback mechanism in BaseTransformer
 * by implementing actual state snapshots and restoration.
 */

import { Subchannel } from '../../old_src/types/Subchannel.js';
import { BaseTransformer, TransformContext, TransformResult } from './BaseTransformer.js';

export interface AtomicOperation {
  id: string;
  execute: () => Promise<TransformResult>;
  rollback: () => Promise<void>;
  verify?: () => boolean;
}

export interface AtomicBatch {
  operations: AtomicOperation[];
  mode: 'all-or-nothing' | 'best-effort';
}

/**
 * State snapshot for rollback
 */
interface StateSnapshot {
  subchannels: Map<number, Subchannel>;
  metadata: Map<string, any>;
  timestamp: number;
}

export class AtomicTransformer extends BaseTransformer {
  // Track active transactions and their snapshots
  private static transactions: Map<string, StateSnapshot> = new Map();

  // Track rollback functions for each transaction
  private static rollbackRegistry: Map<string, (() => void)[]> = new Map();

  /**
   * Begin atomic transaction with state snapshot
   */
  static beginTransaction(context: TransformContext): string {
    const txId = this.generateTransactionId();

    // Deep clone all subchannels
    const snapshot: StateSnapshot = {
      subchannels: new Map(),
      metadata: new Map(),
      timestamp: Date.now()
    };

    for (const [id, subchannel] of context.subchannels) {
      snapshot.subchannels.set(id, this.cloneSubchannel(subchannel));
    }

    this.transactions.set(txId, snapshot);
    this.rollbackRegistry.set(txId, []);

    return txId;
  }

  /**
   * Commit transaction (cleanup snapshot)
   */
  static commitTransaction(txId: string): boolean {
    const snapshot = this.transactions.get(txId);
    if (!snapshot) {
      return false;
    }

    // Clear snapshot and rollback functions
    this.transactions.delete(txId);
    this.rollbackRegistry.delete(txId);

    return true;
  }

  /**
   * Rollback transaction to snapshot
   */
  static rollbackTransaction(
    txId: string,
    context: TransformContext
  ): boolean {
    const snapshot = this.transactions.get(txId);
    if (!snapshot) {
      return false;
    }

    // Restore all subchannels from snapshot
    context.subchannels.clear();
    for (const [id, subchannel] of snapshot.subchannels) {
      context.subchannels.set(id, this.cloneSubchannel(subchannel));
    }

    // Execute all registered rollback functions in reverse order
    const rollbacks = this.rollbackRegistry.get(txId) || [];
    for (let i = rollbacks.length - 1; i >= 0; i--) {
      try {
        rollbacks[i]();
      } catch (e) {
        console.error('Rollback function failed:', e);
      }
    }

    // Cleanup
    this.transactions.delete(txId);
    this.rollbackRegistry.delete(txId);

    return true;
  }

  /**
   * Register rollback function for transaction
   */
  static registerRollback(txId: string, rollback: () => void): void {
    const rollbacks = this.rollbackRegistry.get(txId) || [];
    rollbacks.push(rollback);
    this.rollbackRegistry.set(txId, rollbacks);
  }

  /**
   * Execute atomic operation with automatic rollback on failure
   */
  static async executeAtomic<T extends any>(
    context: TransformContext,
    operation: () => Promise<TransformResult>,
    verification?: () => boolean
  ): Promise<TransformResult> {
    const txId = this.beginTransaction(context);

    try {
      const result = await operation();

      if (!result.success) {
        this.rollbackTransaction(txId, context);
        return result;
      }

      // Optional verification
      if (verification && !verification()) {
        this.rollbackTransaction(txId, context);
        return {
          success: false,
          error: 'Post-operation verification failed'
        };
      }

      this.commitTransaction(txId);
      return result;

    } catch (error) {
      this.rollbackTransaction(txId, context);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Operation failed'
      };
    }
  }

  /**
   * Execute batch of operations atomically
   */
  static async executeBatch(
    context: TransformContext,
    batch: AtomicBatch
  ): Promise<TransformResult> {
    const txId = this.beginTransaction(context);
    const results: TransformResult[] = [];

    try {
      for (const op of batch.operations) {
        const result = await op.execute();
        results.push(result);

        if (!result.success && batch.mode === 'all-or-nothing') {
          // Rollback everything
          this.rollbackTransaction(txId, context);

          // Execute explicit rollback functions
          for (let i = results.length - 1; i >= 0; i--) {
            await batch.operations[i].rollback();
          }

          return {
            success: false,
            error: `Operation ${op.id} failed: ${result.error}`,
            data: { failedAt: op.id, results }
          };
        }

        // Register operation's rollback
        this.registerRollback(txId, () => op.rollback());
      }

      // Verify all operations if needed
      for (const op of batch.operations) {
        if (op.verify && !op.verify()) {
          this.rollbackTransaction(txId, context);

          // Execute all rollbacks
          for (const op of batch.operations) {
            await op.rollback();
          }

          return {
            success: false,
            error: `Verification failed for operation ${op.id}`
          };
        }
      }

      this.commitTransaction(txId);
      return {
        success: true,
        data: { results }
      };

    } catch (error) {
      this.rollbackTransaction(txId, context);

      // Execute all rollbacks that were registered
      for (let i = batch.operations.length - 1; i >= 0; i--) {
        try {
          await batch.operations[i].rollback();
        } catch (e) {
          console.error(`Rollback failed for ${batch.operations[i].id}:`, e);
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Batch execution failed'
      };
    }
  }

  /**
   * Deep clone subchannel
   */
  private static cloneSubchannel(subchannel: Subchannel): Subchannel {
    return {
      ...subchannel,
      deltas: [...(subchannel.deltas || [])],
      proposedEvents: [...(subchannel.proposedEvents || [])]
    };
  }

  /**
   * Create atomic swap operation
   */
  static createSwapOperation(
    context: TransformContext,
    params: {
      tokenA: number;
      tokenB: number;
      amountA: bigint;
      amountB: bigint;
    }
  ): AtomicOperation {
    const { tokenA, tokenB, amountA, amountB } = params;

    return {
      id: `swap-${tokenA}-${tokenB}-${Date.now()}`,

      execute: async () => {
        const subchannelA = context.subchannels.get(tokenA);
        const subchannelB = context.subchannels.get(tokenB);

        if (!subchannelA || !subchannelB) {
          return {
            success: false,
            error: 'Subchannels not found'
          };
        }

        // Check capacity
        const capacityA = this.calculateCapacity(subchannelA, 'left');
        const capacityB = this.calculateCapacity(subchannelB, 'right');

        if (capacityA.outCapacity < amountA) {
          return {
            success: false,
            error: 'Insufficient capacity in token A'
          };
        }

        if (capacityB.outCapacity < amountB) {
          return {
            success: false,
            error: 'Insufficient capacity in token B'
          };
        }

        // Execute swap
        subchannelA.offdelta -= amountA;
        subchannelB.offdelta += amountB;

        return {
          success: true,
          data: {
            swapped: {
              tokenA: amountA.toString(),
              tokenB: amountB.toString()
            }
          }
        };
      },

      rollback: async () => {
        const subchannelA = context.subchannels.get(tokenA);
        const subchannelB = context.subchannels.get(tokenB);

        if (subchannelA && subchannelB) {
          subchannelA.offdelta += amountA;
          subchannelB.offdelta -= amountB;
        }
      },

      verify: () => {
        const subchannelA = context.subchannels.get(tokenA);
        const subchannelB = context.subchannels.get(tokenB);

        if (!subchannelA || !subchannelB) {
          return false;
        }

        // Verify invariants
        return this.validateInvariants(subchannelA) === null &&
               this.validateInvariants(subchannelB) === null;
      }
    };
  }

  /**
   * Main transformer implementation (for compatibility)
   */
  async transform(
    context: TransformContext,
    params: any
  ): Promise<TransformResult> {
    return this.executeAtomic(
      context,
      async () => {
        // Default atomic operation
        return {
          success: true,
          data: params
        };
      }
    );
  }
}

/**
 * Create atomic multi-hop swap
 */
export function createMultiHopSwap(
  context: TransformContext,
  hops: Array<{
    from: number;
    to: number;
    amountIn: bigint;
    amountOut: bigint;
  }>
): AtomicBatch {
  const operations: AtomicOperation[] = hops.map((hop, i) =>
    AtomicTransformer.createSwapOperation(context, {
      tokenA: hop.from,
      tokenB: hop.to,
      amountA: hop.amountIn,
      amountB: hop.amountOut
    })
  );

  return {
    operations,
    mode: 'all-or-nothing'
  };
}