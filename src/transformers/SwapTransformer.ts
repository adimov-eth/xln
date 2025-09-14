/**
 * SwapTransformer: Atomic cross-asset swaps within bilateral channels
 *
 * Pure functional transformer that maintains bilateral sovereignty
 */

import { BaseTransformer, TransformContext, TransformResult } from './BaseTransformer.js';
import { Subchannel } from '../../old_src/types/Subchannel.js';

export interface SwapParams {
  readonly tokenIn: number;
  readonly tokenOut: number;
  readonly amountIn: bigint;
  readonly minAmountOut?: bigint;
  readonly deadline: number;
  readonly trader: 'left' | 'right';
}

export interface SwapState {
  readonly amountOut: bigint;
  readonly priceImpact: number;
  readonly executionPrice: bigint;
  readonly fee: bigint;
}

export class SwapTransformer extends BaseTransformer {
  private static readonly FEE_BASIS_POINTS = 30n; // 0.3%
  private static readonly PRICE_PRECISION = 1000000n;

  /**
   * Execute atomic swap between assets
   */
  static execute({
    context,
    params
  }: {
    context: TransformContext;
    params: SwapParams;
  }): TransformResult<SwapState> {
    // Validate deadline
    if (context.timestamp > params.deadline) {
      return { success: false, error: 'Swap expired' };
    }

    // Get subchannels
    const tokenInChannel = context.subchannels.get(params.tokenIn);
    const tokenOutChannel = context.subchannels.get(params.tokenOut);

    if (!tokenInChannel || !tokenOutChannel) {
      return { success: false, error: 'Invalid token pair' };
    }

    // Begin atomic transaction
    const txId = this.beginTransaction();

    try {
      // Calculate trader capacity
      const inCapacity = this.calculateCapacity(tokenInChannel, params.trader);
      const outCapacity = this.calculateCapacity(tokenOutChannel,
        params.trader === 'left' ? 'right' : 'left');

      if (params.amountIn > inCapacity.outCapacity) {
        return { success: false, error: 'Insufficient balance' };
      }

      // Calculate swap output using constant product
      const swapState = this.calculateSwapOutput(
        tokenInChannel,
        tokenOutChannel,
        params.amountIn
      );

      // Check slippage protection
      if (params.minAmountOut && swapState.amountOut < params.minAmountOut) {
        return {
          success: false,
          error: `Slippage exceeded: ${swapState.amountOut} < ${params.minAmountOut}`
        };
      }

      // Check counterparty has sufficient output tokens
      if (swapState.amountOut > outCapacity.outCapacity) {
        return { success: false, error: 'Insufficient liquidity' };
      }

      // Record state before
      const beforeState = this.hashChannelState([tokenInChannel, tokenOutChannel]);

      // Execute transfers atomically
      const inTransfer = this.transfer(
        tokenInChannel,
        params.amountIn,
        params.trader === 'left' ? 'leftToRight' : 'rightToLeft'
      );

      if (!inTransfer.success) {
        this.rollbackTransaction(txId);
        return { success: false, error: inTransfer.error };
      }

      const outTransfer = this.transfer(
        tokenOutChannel,
        swapState.amountOut,
        params.trader === 'left' ? 'rightToLeft' : 'leftToRight'
      );

      if (!outTransfer.success) {
        this.rollbackTransaction(txId);
        return { success: false, error: outTransfer.error };
      }

      // Validate invariants
      const inError = this.validateInvariants(tokenInChannel);
      const outError = this.validateInvariants(tokenOutChannel);

      if (inError || outError) {
        this.rollbackTransaction(txId);
        return { success: false, error: inError || outError };
      }

      // Commit transaction
      this.commitTransaction(txId);

      // Generate proof
      const afterState = this.hashChannelState([tokenInChannel, tokenOutChannel]);
      const proof = this.createProof('swap', beforeState, afterState, {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
        amountOut: swapState.amountOut.toString(),
        trader: params.trader
      });

      return {
        success: true,
        data: swapState,
        proof
      };

    } catch (error) {
      this.rollbackTransaction(txId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Swap failed'
      };
    }
  }

  /**
   * Calculate swap output using constant product formula
   */
  private static calculateSwapOutput(
    tokenInChannel: Subchannel,
    tokenOutChannel: Subchannel,
    amountIn: bigint
  ): SwapState {
    // Extract reserves from channel state
    const reserveIn = this.getEffectiveReserve(tokenInChannel);
    const reserveOut = this.getEffectiveReserve(tokenOutChannel);

    // Apply fee
    const fee = (amountIn * this.FEE_BASIS_POINTS) / 10000n;
    const amountInAfterFee = amountIn - fee;

    // x * y = k constant product
    const k = reserveIn * reserveOut;
    const newReserveIn = reserveIn + amountInAfterFee;
    const newReserveOut = k / newReserveIn;
    const amountOut = reserveOut - newReserveOut;

    // Calculate price impact
    const spotPrice = (reserveOut * this.PRICE_PRECISION) / reserveIn;
    const executionPrice = (amountOut * this.PRICE_PRECISION) / amountIn;
    const priceImpact = Number(
      ((spotPrice - executionPrice) * 10000n) / spotPrice
    );

    return {
      amountOut,
      priceImpact,
      executionPrice,
      fee
    };
  }

  /**
   * Get effective reserve from channel state
   */
  private static getEffectiveReserve(subchannel: Subchannel): bigint {
    // Use collateral as reserve proxy
    // In production, this would track actual liquidity
    return this.nonNegative(subchannel.collateral) || this.PRICE_PRECISION;
  }

  /**
   * Required abstract method implementation
   */
  async transform(
    context: TransformContext,
    params: SwapParams
  ): Promise<TransformResult<SwapState>> {
    return SwapTransformer.execute({ context, params });
  }
}

/**
 * Batch swap executor for multiple swaps in one transaction
 */
export class BatchSwapTransformer extends SwapTransformer {
  static executeBatch({
    context,
    swaps
  }: {
    context: TransformContext;
    swaps: SwapParams[];
  }): TransformResult<SwapState[]> {
    const txId = this.beginTransaction();
    const results: SwapState[] = [];

    try {
      for (const swap of swaps) {
        const result = this.execute({ context, params: swap });

        if (!result.success) {
          this.rollbackTransaction(txId);
          return {
            success: false,
            error: `Swap ${swaps.indexOf(swap)} failed: ${result.error}`
          };
        }

        results.push(result.data!);
      }

      this.commitTransaction(txId);

      return {
        success: true,
        data: results,
        proof: this.createProof('batch_swap', '', '', {
          count: swaps.length,
          totalVolume: results.reduce((sum, r) => sum + r.fee, 0n).toString()
        })
      };

    } catch (error) {
      this.rollbackTransaction(txId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Batch swap failed'
      };
    }
  }
}

/**
 * Multi-hop swap router for complex paths
 */
export class SwapRouter extends SwapTransformer {
  static findBestPath({
    tokenIn,
    tokenOut,
    context
  }: {
    tokenIn: number;
    tokenOut: number;
    context: TransformContext;
  }): number[] {
    // Simplified pathfinding - in production use Dijkstra
    const directPath = [tokenIn, tokenOut];

    // Check if direct path exists
    if (context.subchannels.has(tokenIn) && context.subchannels.has(tokenOut)) {
      return directPath;
    }

    // Find intermediate token (simplified)
    for (const [tokenId] of context.subchannels) {
      if (tokenId !== tokenIn && tokenId !== tokenOut) {
        if (context.subchannels.has(tokenIn) && context.subchannels.has(tokenId) &&
            context.subchannels.has(tokenId) && context.subchannels.has(tokenOut)) {
          return [tokenIn, tokenId, tokenOut];
        }
      }
    }

    return directPath;
  }

  static executeRoute({
    context,
    path,
    amountIn,
    minAmountOut,
    deadline,
    trader
  }: {
    context: TransformContext;
    path: number[];
    amountIn: bigint;
    minAmountOut: bigint;
    deadline: number;
    trader: 'left' | 'right';
  }): TransformResult<SwapState[]> {
    if (path.length < 2) {
      return { success: false, error: 'Invalid path' };
    }

    const txId = this.beginTransaction();
    const swaps: SwapState[] = [];
    let currentAmount = amountIn;

    try {
      for (let i = 0; i < path.length - 1; i++) {
        const swap = this.execute({
          context,
          params: {
            tokenIn: path[i],
            tokenOut: path[i + 1],
            amountIn: currentAmount,
            deadline,
            trader
          }
        });

        if (!swap.success) {
          this.rollbackTransaction(txId);
          return {
            success: false,
            error: `Hop ${i} failed: ${swap.error}`
          };
        }

        swaps.push(swap.data!);
        currentAmount = swap.data!.amountOut;
      }

      // Check final slippage
      const finalAmount = swaps[swaps.length - 1].amountOut;
      if (finalAmount < minAmountOut) {
        this.rollbackTransaction(txId);
        return {
          success: false,
          error: `Slippage exceeded: ${finalAmount} < ${minAmountOut}`
        };
      }

      this.commitTransaction(txId);

      return {
        success: true,
        data: swaps,
        proof: this.createProof('multi_hop_swap', '', '', {
          path,
          hops: path.length - 1,
          amountIn: amountIn.toString(),
          amountOut: finalAmount.toString()
        })
      };

    } catch (error) {
      this.rollbackTransaction(txId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Route execution failed'
      };
    }
  }
}