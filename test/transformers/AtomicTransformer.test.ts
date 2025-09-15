/**
 * Test REAL atomic operations with proper rollback
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { AtomicTransformer, createMultiHopSwap } from '../../src/transformers/AtomicTransformer.js';
import { TransformContext } from '../../src/transformers/BaseTransformer.js';
import { Subchannel } from '../../old_src/types/Subchannel.js';

function createTestSubchannel(tokenId: number, collateral: bigint = 1000000n): Subchannel {
  return {
    chainId: 1,
    tokenId,
    leftCreditLimit: 100000n,
    rightCreditLimit: 100000n,
    leftAllowence: 0n,
    rightAllowence: 0n,
    collateral,
    ondelta: 0n,
    offdelta: 0n,
    cooperativeNonce: 0,
    disputeNonce: 0,
    deltas: [],
    proposedEvents: [],
    proposedEventsByLeft: false
  };
}

describe('AtomicTransformer - Real Rollback', () => {
  let context: TransformContext;

  beforeEach(() => {
    context = {
      channelKey: 'alice-bob',
      subchannels: new Map([
        [0, createTestSubchannel(0, 1000000n)],
        [1, createTestSubchannel(1, 1000000n)],
        [2, createTestSubchannel(2, 1000000n)]
      ]),
      timestamp: Date.now(),
      nonce: 0
    };
  });

  test('should properly snapshot state', () => {
    const txId = AtomicTransformer.beginTransaction(context);

    // Modify state after snapshot
    const subchannel = context.subchannels.get(0)!;
    const originalDelta = subchannel.offdelta;
    subchannel.offdelta += 1000n;

    // State should be modified
    expect(subchannel.offdelta).toBe(originalDelta + 1000n);

    // Rollback
    AtomicTransformer.rollbackTransaction(txId, context);

    // State should be restored
    const restoredSubchannel = context.subchannels.get(0)!;
    expect(restoredSubchannel.offdelta).toBe(originalDelta);
  });

  test('should execute atomic operation with auto-rollback on failure', async () => {
    const subchannel0 = context.subchannels.get(0)!;
    const subchannel1 = context.subchannels.get(1)!;

    const initialDelta0 = subchannel0.offdelta;
    const initialDelta1 = subchannel1.offdelta;

    const result = await AtomicTransformer.executeAtomic(
      context,
      async () => {
        // Modify state
        subchannel0.offdelta += 1000n;
        subchannel1.offdelta -= 1000n;

        // Simulate failure
        return {
          success: false,
          error: 'Simulated failure'
        };
      }
    );

    expect(result.success).toBe(false);

    // State should be rolled back
    expect(context.subchannels.get(0)!.offdelta).toBe(initialDelta0);
    expect(context.subchannels.get(1)!.offdelta).toBe(initialDelta1);
  });

  test('should commit on successful operation', async () => {
    const subchannel0 = context.subchannels.get(0)!;
    const initialDelta = subchannel0.offdelta;

    const result = await AtomicTransformer.executeAtomic(
      context,
      async () => {
        subchannel0.offdelta += 1000n;
        return {
          success: true,
          data: { modified: true }
        };
      }
    );

    expect(result.success).toBe(true);

    // State should be committed (persisted)
    expect(context.subchannels.get(0)!.offdelta).toBe(initialDelta + 1000n);
  });

  test('should handle batch operations atomically', async () => {
    const initialStates = new Map<number, bigint>();
    for (const [id, subchannel] of context.subchannels) {
      initialStates.set(id, subchannel.offdelta);
    }

    const batch = {
      operations: [
        AtomicTransformer.createSwapOperation(context, {
          tokenA: 0,
          tokenB: 1,
          amountA: 100n,
          amountB: 95n
        }),
        AtomicTransformer.createSwapOperation(context, {
          tokenA: 1,
          tokenB: 2,
          amountA: 95n,
          amountB: 90n
        })
      ],
      mode: 'all-or-nothing' as const
    };

    const result = await AtomicTransformer.executeBatch(context, batch);

    expect(result.success).toBe(true);

    // Verify state changes
    expect(context.subchannels.get(0)!.offdelta).toBe(initialStates.get(0)! - 100n);
    expect(context.subchannels.get(1)!.offdelta).toBe(initialStates.get(1)! + 95n - 95n); // Net zero
    expect(context.subchannels.get(2)!.offdelta).toBe(initialStates.get(2)! + 90n);
  });

  test('should rollback batch on failure', async () => {
    const initialStates = new Map<number, bigint>();
    for (const [id, subchannel] of context.subchannels) {
      initialStates.set(id, subchannel.offdelta);
    }

    // Create batch with a failing operation
    const batch = {
      operations: [
        AtomicTransformer.createSwapOperation(context, {
          tokenA: 0,
          tokenB: 1,
          amountA: 100n,
          amountB: 95n
        }),
        // This will fail due to insufficient capacity
        AtomicTransformer.createSwapOperation(context, {
          tokenA: 1,
          tokenB: 2,
          amountA: 10000000n, // Too large
          amountB: 90n
        })
      ],
      mode: 'all-or-nothing' as const
    };

    const result = await AtomicTransformer.executeBatch(context, batch);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient capacity');

    // All state should be rolled back
    for (const [id, expectedDelta] of initialStates) {
      expect(context.subchannels.get(id)!.offdelta).toBe(expectedDelta);
    }
  });

  test('should handle multi-hop swap atomically', async () => {
    const initialStates = new Map<number, bigint>();
    for (const [id, subchannel] of context.subchannels) {
      initialStates.set(id, subchannel.offdelta);
    }

    // Create multi-hop swap: Token 0 -> 1 -> 2
    const multiHop = createMultiHopSwap(context, [
      { from: 0, to: 1, amountIn: 100n, amountOut: 95n },
      { from: 1, to: 2, amountIn: 95n, amountOut: 90n }
    ]);

    const result = await AtomicTransformer.executeBatch(context, multiHop);

    expect(result.success).toBe(true);

    // Verify the path execution
    expect(context.subchannels.get(0)!.offdelta).toBe(initialStates.get(0)! - 100n);
    expect(context.subchannels.get(2)!.offdelta).toBe(initialStates.get(2)! + 90n);
  });

  test('should verify invariants after operation', async () => {
    const result = await AtomicTransformer.executeAtomic(
      context,
      async () => {
        const subchannel = context.subchannels.get(0)!;
        // Make collateral negative (violates invariant)
        subchannel.collateral = -1000n;

        return {
          success: true,
          data: {}
        };
      },
      () => {
        // Verification should fail due to negative collateral
        const subchannel = context.subchannels.get(0)!;
        return AtomicTransformer['validateInvariants'](subchannel) === null;
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Post-operation verification failed');

    // Collateral should be restored
    expect(context.subchannels.get(0)!.collateral).toBeGreaterThan(0n);
  });

  test('should handle exception during operation', async () => {
    const initialDelta = context.subchannels.get(0)!.offdelta;

    const result = await AtomicTransformer.executeAtomic(
      context,
      async () => {
        // Modify state
        context.subchannels.get(0)!.offdelta += 1000n;

        // Throw exception
        throw new Error('Unexpected error');
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unexpected error');

    // State should be rolled back
    expect(context.subchannels.get(0)!.offdelta).toBe(initialDelta);
  });

  test('should handle nested transactions', async () => {
    const txId1 = AtomicTransformer.beginTransaction(context);
    context.subchannels.get(0)!.offdelta += 100n;

    const txId2 = AtomicTransformer.beginTransaction(context);
    context.subchannels.get(0)!.offdelta += 200n;

    // Current state: +300n total

    // Rollback inner transaction
    AtomicTransformer.rollbackTransaction(txId2, context);

    // Should be at +100n
    expect(context.subchannels.get(0)!.offdelta).toBe(100n);

    // Rollback outer transaction
    AtomicTransformer.rollbackTransaction(txId1, context);

    // Should be back to 0
    expect(context.subchannels.get(0)!.offdelta).toBe(0n);
  });
});