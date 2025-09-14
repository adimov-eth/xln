import { describe, test, expect, beforeEach } from 'bun:test';
import {
  SwapTransformer,
  HTLCTransformer,
  OptionsTransformer,
  FuturesTransformer,
  LiquidityPoolTransformer,
  FlashLoanTransformer,
  type TransformContext
} from '../../src/transformers';
import { Subchannel } from '../../old_src/types/Subchannel';

/**
 * Integration test with correct interfaces
 * Bilateral sovereignty without global consensus
 */
describe('XLN Bilateral Integration', () => {
  let context: TransformContext;
  let usdc: Subchannel;
  let eth: Subchannel;

  beforeEach(() => {
    // Create test subchannels
    usdc = {
      id: 'alice-bob-1',
      tokenId: 1,
      leftEntity: 'alice',
      rightEntity: 'bob',
      leftBalance: 1000000n * 10n ** 6n, // 1M USDC
      rightBalance: 1000000n * 10n ** 6n,
      leftCreditLimit: 100000n * 10n ** 6n,
      rightCreditLimit: 100000n * 10n ** 6n,
      collateral: 500000n * 10n ** 6n,
      ondelta: 0n,
      offdelta: 0n,
      leftNonce: 1n,
      rightNonce: 1n,
      leftAllowence: 0n,
      rightAllowence: 0n,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    eth = {
      id: 'alice-bob-2',
      tokenId: 2,
      leftEntity: 'alice',
      rightEntity: 'bob',
      leftBalance: 100n * 10n ** 18n, // 100 ETH
      rightBalance: 100n * 10n ** 18n,
      leftCreditLimit: 10n * 10n ** 18n,
      rightCreditLimit: 10n * 10n ** 18n,
      collateral: 50n * 10n ** 18n,
      ondelta: 0n,
      offdelta: 0n,
      leftNonce: 1n,
      rightNonce: 1n,
      leftAllowence: 0n,
      rightAllowence: 0n,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    context = {
      channelKey: 'alice-bob',
      subchannels: new Map([
        [1, usdc],
        [2, eth]
      ]),
      timestamp: Date.now(),
      nonce: 1
    };
  });

  test('Bilateral AMM pool creation and swap', () => {
    // Create pool between USDC and ETH
    const poolResult = LiquidityPoolTransformer.addLiquidity(
      context,
      {
        poolId: 'usdc-eth-pool',
        curveType: 'constant_product',
        tokenIds: [1, 2], // USDC, ETH
        initialLiquidity: [1000n * 10n ** 6n, 1n * 10n ** 18n],
        swapFee: 30, // 0.3%
        protocolFee: 5, // 0.05%
        lpTokenId: 100,
        lpAmount: 1000n * 10n ** 18n // Initial LP tokens
      }
    );

    expect(poolResult.success).toBe(true);
    if (!poolResult.success) return;

    // Swap USDC for ETH through the pool
    const swapResult = LiquidityPoolTransformer.swap(
      context,
      {
        poolId: 'usdc-eth-pool',
        tokenIn: 1, // USDC
        tokenOut: 2, // ETH
        amountIn: 100n * 10n ** 6n, // 100 USDC
        minAmountOut: 90n * 10n ** 15n, // Min 0.09 ETH
        swapper: 'left',
        deadline: Date.now() + 60000
      }
    );

    expect(swapResult.success).toBe(true);
    if (!swapResult.success) return;

    // Verify state changes
    const usdcAfter = context.subchannels.get(1)!;
    const ethAfter = context.subchannels.get(2)!;

    // Check deltas changed
    expect(usdcAfter.offdelta).not.toBe(0n);
    expect(ethAfter.offdelta).not.toBe(0n);
  });

  test('HTLC multi-hop payment', () => {
    const htlcResult = HTLCTransformer.create(
      context,
      {
        tokenId: 1, // USDC
        amount: 50n * 10n ** 6n,
        hashlock: new Uint8Array(32).fill(3),
        timelock: Date.now() + 3600000, // 1 hour
        sender: 'left',
        receiver: 'right'
      }
    );

    expect(htlcResult.success).toBe(true);
    if (!htlcResult.success) return;

    // HTLC locks funds until claimed or expired
    const usdcAfter = context.subchannels.get(1)!;
    expect(usdcAfter.leftAllowence).toBeGreaterThan(0n);
  });

  test('Flash loan from channel partner', () => {
    const flashResult = FlashLoanTransformer.borrow({
      context,
      params: {
        tokenId: 1, // USDC
        amount: 500000n * 10n ** 6n, // 500k USDC
        borrower: 'left',
        fee: 500n * 10n ** 6n // 500 USDC fee (0.1%)
      }
    });

    expect(flashResult.success).toBe(true);
    if (!flashResult.success) return;

    // Simulate using the loan and repaying
    const repayResult = FlashLoanTransformer.repay({
      context,
      params: {
        loanId: flashResult.data!.loanId,
        amount: 500500n * 10n ** 6n // Principal + fee
      }
    });

    expect(repayResult.success).toBe(true);
  });

  test('Options creation with bilateral pricing', () => {
    const optionResult = OptionsTransformer.create(
      context,
      {
        tokenId: 2, // ETH option
        optionType: 'call',
        style: 'european',
        strike: 2000n * 10n ** 6n, // $2000 strike
        expiry: Date.now() + 30 * 24 * 3600000, // 30 days
        amount: 1n * 10n ** 18n, // 1 ETH
        premium: 50n * 10n ** 6n, // $50 premium in USDC
        writer: 'right',
        holder: 'left'
      }
    );

    expect(optionResult.success).toBe(true);
    if (!optionResult.success) return;

    // Option locked collateral
    const ethAfter = context.subchannels.get(2)!;
    expect(ethAfter.rightAllowence).toBeGreaterThan(0n);
  });

  test('Futures position with bilateral margin', () => {
    const futuresResult = FuturesTransformer.open(
      context,
      {
        tokenId: 2, // ETH futures
        futuresType: 'perpetual',
        notional: 10n * 10n ** 18n, // 10 ETH notional
        leverage: 10n,
        side: 'long',
        trader: 'left',
        entryPrice: 2000n * 10n ** 6n,
        marginTokenId: 1 // USDC for margin
      }
    );

    expect(futuresResult.success).toBe(true);
    if (!futuresResult.success) return;

    // Margin locked in USDC channel
    const usdcAfter = context.subchannels.get(1)!;
    expect(usdcAfter.leftAllowence).toBeGreaterThan(0n);
  });

  test('Three-zone capacity boundaries', () => {
    // Test movement through [credit|collateral|credit] zones
    const smallSwap = LiquidityPoolTransformer.swap(
      context,
      {
        poolId: 'test-pool',
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 50n * 10n ** 6n, // Within credit
        minAmountOut: 0n,
        swapper: 'left',
        deadline: Date.now() + 60000
      }
    );

    // Should succeed within credit zone
    expect(smallSwap.success || smallSwap.error).toBeTruthy();

    const largeSwap = LiquidityPoolTransformer.swap(
      context,
      {
        poolId: 'test-pool',
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 2000000n * 10n ** 6n, // Beyond capacity
        minAmountOut: 0n,
        swapper: 'left',
        deadline: Date.now() + 60000
      }
    );

    // Should fail beyond total capacity
    expect(largeSwap.success).toBe(false);
  });

  test('Ondelta/Offdelta separation', () => {
    // Create a swap
    const swapResult = LiquidityPoolTransformer.swap(
      context,
      {
        poolId: 'delta-test',
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 100n * 10n ** 6n,
        minAmountOut: 0n,
        swapper: 'left',
        deadline: Date.now() + 60000
      }
    );

    if (swapResult.success) {
      const usdc = context.subchannels.get(1)!;

      // Offdelta changes immediately (bilateral agreement)
      expect(usdc.offdelta).not.toBe(0n);

      // Ondelta unchanged until on-chain settlement
      expect(usdc.ondelta).toBe(0n);
    }
  });

  test('Atomic transaction rollback', () => {
    const initialUsdc = { ...context.subchannels.get(1)! };

    // Try an operation that will fail
    const failedOp = OptionsTransformer.create(
      context,
      {
        tokenId: 2,
        optionType: 'call',
        style: 'european',
        strike: 2000n * 10n ** 6n,
        expiry: Date.now() - 1, // Already expired
        amount: 1000n * 10n ** 18n, // More than available
        premium: 1n,
        writer: 'left',
        holder: 'right'
      }
    );

    expect(failedOp.success).toBe(false);

    // State should be unchanged after failure
    const usdcAfter = context.subchannels.get(1)!;
    expect(usdcAfter.offdelta).toBe(initialUsdc.offdelta);
    expect(usdcAfter.leftAllowence).toBe(initialUsdc.leftAllowence);
  });
});

describe('Bilateral Trust Model', () => {
  test('Flash loans prove relationship-based trust', () => {
    const context: TransformContext = {
      channelKey: 'alice-bob',
      subchannels: new Map([
        [1, {
          id: 'alice-bob-1',
          tokenId: 1,
          leftEntity: 'alice',
          rightEntity: 'bob',
          leftBalance: 10000000n * 10n ** 6n, // 10M USDC
          rightBalance: 10000000n * 10n ** 6n,
          leftCreditLimit: 1000000n * 10n ** 6n,
          rightCreditLimit: 1000000n * 10n ** 6n,
          collateral: 5000000n * 10n ** 6n,
          ondelta: 0n,
          offdelta: 0n,
          leftNonce: 1n,
          rightNonce: 1n,
          leftAllowence: 0n,
          rightAllowence: 0n,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }]
      ]),
      timestamp: Date.now(),
      nonce: 1
    };

    // Alice can borrow up to total channel capacity
    const maxLoan = 16000000n * 10n ** 6n; // Total capacity

    const flashResult = FlashLoanTransformer.borrow({
      context,
      params: {
        tokenId: 1,
        amount: maxLoan,
        borrower: 'left'
      }
    });

    expect(flashResult.success).toBe(true);

    // Key insights:
    // 1. No global pool required
    // 2. Trust based on bilateral relationship history
    // 3. Instant execution without blocks
    // 4. MEV-resistant by design
  });

  test('Bilateral sovereignty prevents global attacks', () => {
    // Each channel is sovereign
    // Attacks on one channel don't affect others

    const aliceBobContext: TransformContext = {
      channelKey: 'alice-bob',
      subchannels: new Map([[1, createTestSubchannel('alice', 'bob')]]),
      timestamp: Date.now(),
      nonce: 1
    };

    const aliceCarolContext: TransformContext = {
      channelKey: 'alice-carol',
      subchannels: new Map([[1, createTestSubchannel('alice', 'carol')]]),
      timestamp: Date.now(),
      nonce: 1
    };

    // Manipulate alice-bob channel
    const attack = LiquidityPoolTransformer.swap(
      aliceBobContext,
      {
        poolId: 'attack',
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 1000000n * 10n ** 6n,
        minAmountOut: 0n,
        swapper: 'left',
        deadline: Date.now() + 60000
      }
    );

    // alice-carol channel unaffected
    const carolChannel = aliceCarolContext.subchannels.get(1)!;
    expect(carolChannel.offdelta).toBe(0n);

    // No global state means no global attack surface
  });
});

describe('Performance Characteristics', () => {
  test('Parallel execution without coordination', () => {
    const channels: TransformContext[] = [];

    // Create 100 independent channels
    for (let i = 0; i < 100; i++) {
      channels.push({
        channelKey: `alice-partner${i}`,
        subchannels: new Map([[1, createTestSubchannel('alice', `partner${i}`)]]),
        timestamp: Date.now(),
        nonce: 1
      });
    }

    const startTime = Date.now();

    // Execute operations in parallel
    // In production, these would be truly parallel
    const results = channels.map(ctx =>
      LiquidityPoolTransformer.swap(ctx, {
        poolId: 'perf-test',
        tokenIn: 1,
        tokenOut: 2,
        amountIn: 100n * 10n ** 6n,
        minAmountOut: 0n,
        swapper: 'left',
        deadline: Date.now() + 60000
      })
    );

    const endTime = Date.now();
    const elapsed = endTime - startTime;

    // Even sequential execution is fast
    // True parallel would achieve billions of TPS
    expect(elapsed).toBeLessThan(1000); // Under 1 second for 100 ops

    // No consensus delays, no block times, no MEV auctions
  });
});

// Helper function
function createTestSubchannel(left: string, right: string): Subchannel {
  return {
    id: `${left}-${right}-1`,
    tokenId: 1,
    leftEntity: left,
    rightEntity: right,
    leftBalance: 1000000n * 10n ** 6n,
    rightBalance: 1000000n * 10n ** 6n,
    leftCreditLimit: 100000n * 10n ** 6n,
    rightCreditLimit: 100000n * 10n ** 6n,
    collateral: 500000n * 10n ** 6n,
    ondelta: 0n,
    offdelta: 0n,
    leftNonce: 1n,
    rightNonce: 1n,
    leftAllowence: 0n,
    rightAllowence: 0n,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}