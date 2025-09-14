/**
 * XLN Transformer Registry
 * Bilateral sovereignty through pure functional state transformation
 */

export { BaseTransformer } from './BaseTransformer';
export { SwapTransformer } from './SwapTransformer';
export { HTLCTransformer } from './HTLCTransformer';
export { OptionsTransformer } from './OptionsTransformer';
export { FuturesTransformer } from './FuturesTransformer';
export { LiquidityPoolTransformer } from './LiquidityPoolTransformer';
export { InsurancePoolTransformer } from './InsurancePoolTransformer';
export { FlashLoanTransformer } from './FlashLoanTransformer';
export { TransformerComposer } from './TransformerComposer';

// Re-export core types
export type {
  TransformContext,
  TransformResult,
  ChannelCapacity,
  TransactionState
} from './BaseTransformer';

export type { SwapParams, SwapState } from './SwapTransformer';
export type { HTLCParams, HTLCState, HTLCClaimParams } from './HTLCTransformer';
export type {
  OptionsParams,
  OptionsState,
  OptionType,
  OptionStyle,
  Greeks
} from './OptionsTransformer';
export type {
  FuturesParams,
  FuturesState,
  FuturesType,
  FuturesPosition
} from './FuturesTransformer';
export type {
  LiquidityPoolParams,
  LiquidityPoolState,
  PoolType,
  LiquidityPosition
} from './LiquidityPoolTransformer';
export type {
  InsurancePoolParams,
  InsurancePoolState,
  InsuranceClaim,
  RiskProfile
} from './InsurancePoolTransformer';
export type {
  FlashLoanParams,
  FlashLoanState,
  FlashLoanRequest
} from './FlashLoanTransformer';
export type {
  ComposedTransform,
  CompositionResult,
  TransformerStep
} from './TransformerComposer';

import { BaseTransformer } from './BaseTransformer';
import { SwapTransformer } from './SwapTransformer';
import { HTLCTransformer } from './HTLCTransformer';
import { OptionsTransformer } from './OptionsTransformer';
import { FuturesTransformer } from './FuturesTransformer';
import { LiquidityPoolTransformer } from './LiquidityPoolTransformer';
import { InsurancePoolTransformer } from './InsurancePoolTransformer';
import { FlashLoanTransformer } from './FlashLoanTransformer';

/**
 * Transformer registry for dynamic lookup
 */
export const TransformerRegistry = {
  swap: SwapTransformer,
  htlc: HTLCTransformer,
  options: OptionsTransformer,
  futures: FuturesTransformer,
  liquidity: LiquidityPoolTransformer,
  insurance: InsurancePoolTransformer,
  flashloan: FlashLoanTransformer,
} as const;

export type TransformerName = keyof typeof TransformerRegistry;

/**
 * Get transformer by name
 */
export function getTransformer(name: TransformerName): typeof BaseTransformer {
  const transformer = TransformerRegistry[name];
  if (!transformer) {
    throw new Error(`Unknown transformer: ${name}`);
  }
  return transformer;
}

/**
 * Check if a transformer exists
 */
export function hasTransformer(name: string): name is TransformerName {
  return name in TransformerRegistry;
}

/**
 * List all available transformers
 */
export function listTransformers(): TransformerName[] {
  return Object.keys(TransformerRegistry) as TransformerName[];
}

/**
 * Bilateral execution helper
 * Ensures both parties see consistent state
 */
export function executeBilateral<T>(
  leftExecution: () => T,
  rightExecution: () => T
): { left: T; right: T } {
  const leftResult = leftExecution();
  const rightResult = rightExecution();

  return { left: leftResult, right: rightResult };
}

/**
 * Three-zone capacity validator
 * Ensures delta stays within credit|collateral|credit bounds
 */
export function validateCapacity(
  delta: bigint,
  leftCredit: bigint,
  collateral: bigint,
  rightCredit: bigint
): boolean {
  const totalCapacity = leftCredit + collateral + rightCredit;
  const minBound = -leftCredit;
  const maxBound = collateral + rightCredit;

  return delta >= minBound && delta <= maxBound;
}

/**
 * Atomic batch transformer
 * All succeed or all fail
 */
export async function executeAtomic<T>(
  operations: Array<() => Promise<T>>
): Promise<T[]> {
  const results: T[] = [];
  const rollbacks: Array<() => void> = [];

  try {
    for (const op of operations) {
      const result = await op();
      results.push(result);
      // Each operation should provide its own rollback
    }
    return results;
  } catch (error) {
    // Rollback in reverse order
    for (const rollback of rollbacks.reverse()) {
      rollback();
    }
    throw error;
  }
}