/**
 * TransformerComposer: Atomic composition of multiple transformers
 *
 * Enables complex DeFi strategies as atomic operations:
 * - Flash loan → Swap → Option → Repay
 * - Provide liquidity → Buy insurance → Stake
 * - HTLC → Future → Settlement
 *
 * If ANY step fails, entire composition reverts
 */

import { BaseTransformer, TransformContext, TransformResult } from './BaseTransformer.js';

export interface ComposableStep {
  readonly transformer: string;
  readonly method: string;
  readonly params: any;
  readonly continueOnError?: boolean; // Allow optional steps
}

export interface CompositionResult {
  readonly steps: StepResult[];
  readonly totalGas?: bigint;
  readonly atomicProof: string;
}

export interface StepResult {
  readonly step: number;
  readonly transformer: string;
  readonly success: boolean;
  readonly data?: any;
  readonly error?: string;
  readonly gasUsed?: bigint;
}

export class TransformerComposer extends BaseTransformer {
  // Registry of available transformers
  private static transformers: Map<string, typeof BaseTransformer> = new Map();

  /**
   * Register a transformer for composition
   */
  static register(name: string, transformer: typeof BaseTransformer): void {
    this.transformers.set(name, transformer);
  }

  /**
   * Execute atomic composition of multiple transformers
   */
  static compose({
    context,
    steps,
    atomicOnly = true
  }: {
    context: TransformContext;
    steps: ComposableStep[];
    atomicOnly?: boolean;
  }): TransformResult<CompositionResult> {
    if (steps.length === 0) {
      return { success: false, error: 'No steps provided' };
    }

    const txId = this.beginTransaction();
    const results: StepResult[] = [];
    let totalGas = 0n;

    try {
      // Record initial state for atomic proof
      const initialState = this.captureFullState(context);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepResult = this.executeStep(context, step, i);

        results.push(stepResult);

        if (!stepResult.success) {
          if (step.continueOnError) {
            continue; // Optional step failed, continue
          }

          if (atomicOnly) {
            this.rollbackTransaction(txId);
            return {
              success: false,
              error: `Step ${i} failed: ${stepResult.error}`,
              data: {
                steps: results,
                atomicProof: '0x0'
              }
            };
          }
        }

        totalGas += stepResult.gasUsed || 0n;

        // Update context with step results if needed
        if (stepResult.data?.contextUpdate) {
          this.updateContext(context, stepResult.data.contextUpdate);
        }
      }

      // Check if all required steps succeeded
      const requiredFailed = results.find(
        (r, i) => !r.success && !steps[i].continueOnError
      );

      if (requiredFailed) {
        this.rollbackTransaction(txId);
        return {
          success: false,
          error: 'Required steps failed',
          data: {
            steps: results,
            atomicProof: '0x0'
          }
        };
      }

      // Commit atomic transaction
      this.commitTransaction(txId);

      // Generate atomic proof
      const finalState = this.captureFullState(context);
      const atomicProof = this.generateAtomicProof(
        initialState,
        finalState,
        results
      );

      return {
        success: true,
        data: {
          steps: results,
          totalGas,
          atomicProof
        },
        proof: this.createProof('compose', initialState, finalState, {
          steps: steps.length,
          succeeded: results.filter(r => r.success).length,
          gas: totalGas.toString()
        })
      };

    } catch (error) {
      this.rollbackTransaction(txId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Composition failed',
        data: {
          steps: results,
          atomicProof: '0x0'
        }
      };
    }
  }

  /**
   * Execute a single step
   */
  private static executeStep(
    context: TransformContext,
    step: ComposableStep,
    index: number
  ): StepResult {
    const transformer = this.transformers.get(step.transformer);

    if (!transformer) {
      return {
        step: index,
        transformer: step.transformer,
        success: false,
        error: `Transformer '${step.transformer}' not registered`
      };
    }

    try {
      // Measure gas (simplified)
      const gasStart = Date.now();

      // Execute transformer method
      const method = (transformer as any)[step.method];
      if (!method) {
        return {
          step: index,
          transformer: step.transformer,
          success: false,
          error: `Method '${step.method}' not found`
        };
      }

      const result = method.call(transformer, {
        context,
        ...step.params
      });

      const gasUsed = BigInt(Date.now() - gasStart);

      return {
        step: index,
        transformer: step.transformer,
        success: result.success,
        data: result.data,
        error: result.error,
        gasUsed
      };

    } catch (error) {
      return {
        step: index,
        transformer: step.transformer,
        success: false,
        error: error instanceof Error ? error.message : 'Step execution failed'
      };
    }
  }

  /**
   * Capture full channel state for atomic proofs
   */
  private static captureFullState(context: TransformContext): string {
    return this.hashChannelState(context.subchannels);
  }

  /**
   * Update context with step results
   */
  private static updateContext(
    context: TransformContext,
    update: Partial<TransformContext>
  ): void {
    if (update.timestamp) context.timestamp = update.timestamp;
    if (update.nonce) context.nonce = update.nonce;
    // Subchannels are already modified by reference
  }

  /**
   * Generate atomic proof of composition
   */
  private static generateAtomicProof(
    initialState: string,
    finalState: string,
    results: StepResult[]
  ): string {
    const proofData = {
      initial: initialState,
      final: finalState,
      steps: results.map(r => ({
        transformer: r.transformer,
        success: r.success,
        gas: r.gasUsed?.toString() || '0'
      }))
    };

    return this.hashChannelState([proofData as any]);
  }

  /**
   * Required abstract method implementation
   */
  async transform(
    context: TransformContext,
    params: any
  ): Promise<TransformResult> {
    return TransformerComposer.compose({
      context,
      steps: params.steps,
      atomicOnly: params.atomicOnly
    });
  }
}

/**
 * Pre-built composition strategies
 */
export class DeFiStrategies {
  /**
   * Flash loan arbitrage strategy
   */
  static flashArbitrage({
    context,
    loanAmount,
    swapPath,
    profitThreshold
  }: {
    context: TransformContext;
    loanAmount: bigint;
    swapPath: number[];
    profitThreshold: bigint;
  }): ComposableStep[] {
    return [
      {
        transformer: 'FlashLoanTransformer',
        method: 'borrow',
        params: { amount: loanAmount, token: swapPath[0] }
      },
      {
        transformer: 'SwapRouter',
        method: 'executeRoute',
        params: {
          path: swapPath,
          amountIn: loanAmount,
          minAmountOut: loanAmount + profitThreshold
        }
      },
      {
        transformer: 'FlashLoanTransformer',
        method: 'repay',
        params: { amount: loanAmount, token: swapPath[0] }
      }
    ];
  }

  /**
   * Covered call strategy (own asset + sell call option)
   */
  static coveredCall({
    underlying,
    strikePrice,
    expiry,
    premium
  }: {
    underlying: number;
    strikePrice: bigint;
    expiry: number;
    premium: bigint;
  }): ComposableStep[] {
    return [
      {
        transformer: 'LiquidityPoolTransformer',
        method: 'provideLiquidity',
        params: { token: underlying }
      },
      {
        transformer: 'OptionsTransformer',
        method: 'writeOption',
        params: {
          optionType: 'call',
          underlying,
          strikePrice,
          expiry,
          premium
        }
      },
      {
        transformer: 'InsurancePoolTransformer',
        method: 'buyInsurance',
        params: {
          coverageType: 'impermanent_loss',
          amount: premium
        },
        continueOnError: true // Insurance is optional
      }
    ];
  }

  /**
   * Lightning network payment with fallback
   */
  static lightningPayment({
    paymentHash,
    amount,
    route,
    fallbackRoute
  }: {
    paymentHash: string;
    amount: bigint;
    route: string[];
    fallbackRoute?: string[];
  }): ComposableStep[] {
    const steps: ComposableStep[] = [
      {
        transformer: 'HTLCTransformer',
        method: 'createHTLC',
        params: {
          hashLock: paymentHash,
          amount,
          route
        }
      }
    ];

    if (fallbackRoute) {
      steps.push({
        transformer: 'HTLCTransformer',
        method: 'createHTLC',
        params: {
          hashLock: paymentHash,
          amount,
          route: fallbackRoute
        },
        continueOnError: true // Fallback is optional
      });
    }

    return steps;
  }

  /**
   * Automated market making with hedging
   */
  static automatedMarketMaker({
    pool,
    tokens,
    amounts,
    hedgeRatio = 0.5
  }: {
    pool: string;
    tokens: number[];
    amounts: bigint[];
    hedgeRatio?: number;
  }): ComposableStep[] {
    return [
      {
        transformer: 'LiquidityPoolTransformer',
        method: 'createPool',
        params: {
          poolId: pool,
          tokens,
          curveType: 'constant_product'
        }
      },
      {
        transformer: 'LiquidityPoolTransformer',
        method: 'addLiquidity',
        params: {
          poolId: pool,
          amounts
        }
      },
      {
        transformer: 'FuturesTransformer',
        method: 'openPosition',
        params: {
          futuresType: 'perpetual',
          contracts: amounts[0] * BigInt(Math.floor(hedgeRatio * 100)) / 100n,
          side: 'short' // Hedge against impermanent loss
        },
        continueOnError: true // Hedging is optional
      }
    ];
  }
}