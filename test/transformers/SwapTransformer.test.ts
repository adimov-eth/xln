/**
 * SwapTransformer Test Suite
 *
 * Tests atomic swaps with edge cases and attack vectors
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SwapTransformer, BatchSwapTransformer, SwapRouter } from '../../src/transformers/SwapTransformer.js';
import { TransformContext } from '../../src/transformers/BaseTransformer.js';
import { Subchannel } from '../../old_src/types/Subchannel.js';

describe('SwapTransformer', () => {
  let context: TransformContext;
  let tokenA: Subchannel;
  let tokenB: Subchannel;

  beforeEach(() => {
    // Setup test subchannels
    tokenA = {
      tokenId: 1,
      ondelta: 0n,
      offdelta: 0n,
      collateral: 1000000n,
      leftCreditLimit: 500000n,
      rightCreditLimit: 500000n,
      leftAllowence: 0n,
      rightAllowence: 0n,
      deltas: [],
      proposedEvents: []
    };

    tokenB = {
      tokenId: 2,
      ondelta: 0n,
      offdelta: 0n,
      collateral: 1000000n,
      leftCreditLimit: 500000n,
      rightCreditLimit: 500000n,
      leftAllowence: 0n,
      rightAllowence: 0n,
      deltas: [],
      proposedEvents: []
    };

    context = {
      channelKey: 'channel-1',
      subchannels: new Map([
        [1, tokenA],
        [2, tokenB]
      ]),
      timestamp: Date.now(),
      nonce: 1
    };
  });

  describe('Basic Swaps', () => {
    it('should execute simple swap', () => {
      const result = SwapTransformer.execute({
        context,
        params: {
          tokenIn: 1,
          tokenOut: 2,
          amountIn: 1000n,
          deadline: context.timestamp + 3600000,
          trader: 'left'
        }
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.amountOut).toBeGreaterThan(0n);
      expect(result.data!.fee).toBe(3n); // 0.3% of 1000
    });

    it('should respect slippage protection', () => {
      const result = SwapTransformer.execute({
        context,
        params: {
          tokenIn: 1,
          tokenOut: 2,
          amountIn: 1000n,
          minAmountOut: 10000000n, // Impossible amount
          deadline: context.timestamp + 3600000,
          trader: 'left'
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Slippage exceeded');
    });

    it('should fail after deadline', () => {
      const result = SwapTransformer.execute({
        context,
        params: {
          tokenIn: 1,
          tokenOut: 2,
          amountIn: 1000n,
          deadline: context.timestamp - 1, // Already expired
          trader: 'left'
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Swap expired');
    });
  });

  describe('Capacity Checks', () => {
    it('should fail with insufficient balance', () => {
      const result = SwapTransformer.execute({
        context,
        params: {
          tokenIn: 1,
          tokenOut: 2,
          amountIn: 10000000n, // More than capacity
          deadline: context.timestamp + 3600000,
          trader: 'left'
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient balance');
    });

    it('should fail with insufficient liquidity', () => {
      // Drain tokenB liquidity
      tokenB.collateral = 100n;

      const result = SwapTransformer.execute({
        context,
        params: {
          tokenIn: 1,
          tokenOut: 2,
          amountIn: 1000n,
          deadline: context.timestamp + 3600000,
          trader: 'left'
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient liquidity');
    });
  });

  describe('Price Impact', () => {
    it('should calculate price impact correctly', () => {
      const result = SwapTransformer.execute({
        context,
        params: {
          tokenIn: 1,
          tokenOut: 2,
          amountIn: 100000n, // Large swap
          deadline: context.timestamp + 3600000,
          trader: 'left'
        }
      });

      expect(result.success).toBe(true);
      expect(result.data!.priceImpact).toBeGreaterThan(0);
    });
  });
});

describe('BatchSwapTransformer', () => {
  let context: TransformContext;

  beforeEach(() => {
    const tokens = new Map<number, Subchannel>();
    for (let i = 1; i <= 5; i++) {
      tokens.set(i, {
        tokenId: i,
        ondelta: 0n,
        offdelta: 0n,
        collateral: 1000000n,
        leftCreditLimit: 500000n,
        rightCreditLimit: 500000n,
        leftAllowence: 0n,
        rightAllowence: 0n,
        deltas: [],
        proposedEvents: []
      });
    }

    context = {
      channelKey: 'channel-batch',
      subchannels: tokens,
      timestamp: Date.now(),
      nonce: 1
    };
  });

  it('should execute multiple swaps atomically', () => {
    const swaps = [
      {
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 1000n,
        deadline: context.timestamp + 3600000,
        trader: 'left' as const
      },
      {
        tokenIn: 2,
        tokenOut: 3,
        amountIn: 500n,
        deadline: context.timestamp + 3600000,
        trader: 'left' as const
      }
    ];

    const result = BatchSwapTransformer.executeBatch({
      context,
      swaps
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  it('should rollback all swaps if one fails', () => {
    const swaps = [
      {
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 1000n,
        deadline: context.timestamp + 3600000,
        trader: 'left' as const
      },
      {
        tokenIn: 2,
        tokenOut: 3,
        amountIn: 10000000n, // Will fail
        deadline: context.timestamp + 3600000,
        trader: 'left' as const
      }
    ];

    const result = BatchSwapTransformer.executeBatch({
      context,
      swaps
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Swap 1 failed');

    // Verify rollback - check original state preserved
    const tokenA = context.subchannels.get(1)!;
    expect(tokenA.offdelta).toBe(0n);
  });
});

describe('SwapRouter', () => {
  let context: TransformContext;

  beforeEach(() => {
    const tokens = new Map<number, Subchannel>();
    for (let i = 1; i <= 5; i++) {
      tokens.set(i, {
        tokenId: i,
        ondelta: 0n,
        offdelta: 0n,
        collateral: 1000000n,
        leftCreditLimit: 500000n,
        rightCreditLimit: 500000n,
        leftAllowence: 0n,
        rightAllowence: 0n,
        deltas: [],
        proposedEvents: []
      });
    }

    context = {
      channelKey: 'channel-router',
      subchannels: tokens,
      timestamp: Date.now(),
      nonce: 1
    };
  });

  describe('Path Finding', () => {
    it('should find direct path when available', () => {
      const path = SwapRouter.findBestPath({
        tokenIn: 1,
        tokenOut: 2,
        context
      });

      expect(path).toEqual([1, 2]);
    });

    it('should find multi-hop path when needed', () => {
      // Remove direct path
      context.subchannels.delete(2);

      const path = SwapRouter.findBestPath({
        tokenIn: 1,
        tokenOut: 3,
        context
      });

      expect(path.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Route Execution', () => {
    it('should execute multi-hop swap', () => {
      const result = SwapRouter.executeRoute({
        context,
        path: [1, 2, 3],
        amountIn: 1000n,
        minAmountOut: 500n,
        deadline: context.timestamp + 3600000,
        trader: 'left'
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2); // Two hops
    });

    it('should enforce slippage on final output', () => {
      const result = SwapRouter.executeRoute({
        context,
        path: [1, 2, 3],
        amountIn: 1000n,
        minAmountOut: 10000000n, // Impossible
        deadline: context.timestamp + 3600000,
        trader: 'left'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Slippage exceeded');
    });

    it('should rollback entire route on failure', () => {
      // Make second hop fail by reducing liquidity
      const token3 = context.subchannels.get(3)!;
      token3.collateral = 1n;

      const result = SwapRouter.executeRoute({
        context,
        path: [1, 2, 3],
        amountIn: 1000n,
        minAmountOut: 500n,
        deadline: context.timestamp + 3600000,
        trader: 'left'
      });

      expect(result.success).toBe(false);

      // Verify first hop was rolled back
      const token1 = context.subchannels.get(1)!;
      expect(token1.offdelta).toBe(0n);
    });
  });
});

describe('Edge Cases and Attack Vectors', () => {
  let context: TransformContext;

  beforeEach(() => {
    context = {
      channelKey: 'channel-attack',
      subchannels: new Map([
        [1, {
          tokenId: 1,
          ondelta: 0n,
          offdelta: 0n,
          collateral: 1000000n,
          leftCreditLimit: 500000n,
          rightCreditLimit: 500000n,
          leftAllowence: 0n,
          rightAllowence: 0n,
          deltas: [],
          proposedEvents: []
        }],
        [2, {
          tokenId: 2,
          ondelta: 0n,
          offdelta: 0n,
          collateral: 1000000n,
          leftCreditLimit: 500000n,
          rightCreditLimit: 500000n,
          leftAllowence: 0n,
          rightAllowence: 0n,
          deltas: [],
          proposedEvents: []
        }]
      ]),
      timestamp: Date.now(),
      nonce: 1
    };
  });

  it('should handle zero amount swap', () => {
    const result = SwapTransformer.execute({
      context,
      params: {
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 0n,
        deadline: context.timestamp + 3600000,
        trader: 'left'
      }
    });

    expect(result.success).toBe(true);
    expect(result.data!.amountOut).toBe(0n);
  });

  it('should handle maximum bigint values', () => {
    const maxBigInt = BigInt(2) ** BigInt(256) - BigInt(1);

    const result = SwapTransformer.execute({
      context,
      params: {
        tokenIn: 1,
        tokenOut: 2,
        amountIn: maxBigInt,
        deadline: context.timestamp + 3600000,
        trader: 'left'
      }
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Insufficient balance');
  });

  it('should prevent sandwich attacks via slippage', () => {
    // Attacker tries to frontrun
    const frontrun = SwapTransformer.execute({
      context,
      params: {
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 100000n, // Large trade to move price
        deadline: context.timestamp + 3600000,
        trader: 'right'
      }
    });

    expect(frontrun.success).toBe(true);

    // Victim's trade with slippage protection
    const victim = SwapTransformer.execute({
      context,
      params: {
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 1000n,
        minAmountOut: 900n, // Expecting reasonable output
        deadline: context.timestamp + 3600000,
        trader: 'left'
      }
    });

    // Should fail due to price impact from frontrun
    expect(victim.success).toBe(false);
  });

  it('should maintain invariants after swap', () => {
    const result = SwapTransformer.execute({
      context,
      params: {
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 1000n,
        deadline: context.timestamp + 3600000,
        trader: 'left'
      }
    });

    expect(result.success).toBe(true);

    // Check invariants
    const tokenA = context.subchannels.get(1)!;
    const tokenB = context.subchannels.get(2)!;

    // No negative collateral
    expect(tokenA.collateral).toBeGreaterThanOrEqual(0n);
    expect(tokenB.collateral).toBeGreaterThanOrEqual(0n);

    // Conservation of value (approximately, accounting for fees)
    const totalDelta = tokenA.offdelta + tokenB.offdelta;
    expect(totalDelta).toBeLessThanOrEqual(3n); // Just the fee
  });
});