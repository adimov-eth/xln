/**
 * FlashLoanTransformer: Atomic borrowing without collateral
 *
 * Core insight: In bilateral channels, flash loans are trust-free because
 * the entire operation is atomic. Your channel partner can't lose funds
 * since either the loan is repaid or the entire transaction reverts.
 *
 * This inverts traditional flash loans - you borrow from partners, not pools.
 */

import { BaseTransformer, TransformContext, TransformResult } from './BaseTransformer.js';
import { Subchannel } from '../../old_src/types/Subchannel.js';

export interface FlashLoanParams {
  readonly tokenId: number;
  readonly amount: bigint;
  readonly borrower: 'left' | 'right';
  readonly fee?: bigint; // Optional fee override
  readonly data?: any; // Callback data for borrower
}

export interface FlashLoanState {
  readonly loanId: string;
  readonly amount: bigint;
  readonly fee: bigint;
  readonly borrowed: boolean;
  readonly repaid: boolean;
  readonly gasUsed: bigint;
}

export interface ActiveLoan {
  readonly loanId: string;
  readonly params: FlashLoanParams;
  readonly txId: string;
  readonly borrowedAt: number;
  readonly mustRepayBy: number; // Same transaction
}

export class FlashLoanTransformer extends BaseTransformer {
  private static readonly DEFAULT_FEE_BASIS_POINTS = 9n; // 0.09%
  private static readonly MAX_LOANS_PER_TX = 10; // Prevent abuse

  // Track active loans per transaction
  private static activeLoans: Map<string, ActiveLoan[]> = new Map();

  /**
   * Borrow funds atomically
   */
  static borrow({
    context,
    params
  }: {
    context: TransformContext;
    params: FlashLoanParams;
  }): TransformResult<FlashLoanState> {
    const subchannel = context.subchannels.get(params.tokenId);
    if (!subchannel) {
      return { success: false, error: 'Token not found' };
    }

    // Get or create transaction ID
    const txId = this.getCurrentTransaction() || this.beginTransaction();

    // Check loan limits
    const txLoans = this.activeLoans.get(txId) || [];
    if (txLoans.length >= this.MAX_LOANS_PER_TX) {
      return { success: false, error: 'Too many flash loans in transaction' };
    }

    // Check if already borrowed this token in this tx
    if (txLoans.find(l => l.params.tokenId === params.tokenId)) {
      return { success: false, error: 'Already borrowed this token in transaction' };
    }

    // Calculate lender capacity (opposite of borrower)
    const lender = params.borrower === 'left' ? 'right' : 'left';
    const lenderCapacity = this.calculateCapacity(subchannel, lender);

    if (params.amount > lenderCapacity.outCapacity) {
      return {
        success: false,
        error: `Insufficient liquidity: ${params.amount} > ${lenderCapacity.outCapacity}`
      };
    }

    // Record state before
    const beforeState = this.hashChannelState([subchannel]);

    // Calculate fee
    const fee = params.fee ?? (params.amount * this.DEFAULT_FEE_BASIS_POINTS) / 10000n;

    // Execute loan transfer
    const transfer = this.transfer(
      subchannel,
      params.amount,
      params.borrower === 'left' ? 'rightToLeft' : 'leftToRight'
    );

    if (!transfer.success) {
      return { success: false, error: transfer.error };
    }

    // Create loan record
    const loanId = `loan-${context.channelKey}-${Date.now()}`;
    const activeLoan: ActiveLoan = {
      loanId,
      params: { ...params, fee }, // Include calculated fee
      txId,
      borrowedAt: context.timestamp,
      mustRepayBy: context.timestamp // Same transaction atomicity
    };

    // Track active loan
    if (!this.activeLoans.has(txId)) {
      this.activeLoans.set(txId, []);
    }
    this.activeLoans.get(txId)!.push(activeLoan);

    // Create proof
    const afterState = this.hashChannelState([subchannel]);
    const proof = this.createProof('flash_borrow', beforeState, afterState, {
      loanId,
      amount: params.amount.toString(),
      fee: fee.toString(),
      borrower: params.borrower
    });

    // Set up automatic revert if not repaid
    this.checkpoint(`flash-loan-${loanId}`, subchannel, txId);

    return {
      success: true,
      data: {
        loanId,
        amount: params.amount,
        fee,
        borrowed: true,
        repaid: false,
        gasUsed: 1000n // Simplified gas calculation
      },
      proof,
      rollback: () => {
        // If transaction rolls back, undo the borrow
        this.restore(`flash-loan-${loanId}`);
      }
    };
  }

  /**
   * Repay flash loan in same transaction
   */
  static repay({
    context,
    loanId
  }: {
    context: TransformContext;
    loanId: string;
  }): TransformResult<FlashLoanState> {
    const txId = this.getCurrentTransaction();
    if (!txId) {
      return { success: false, error: 'No active transaction' };
    }

    const txLoans = this.activeLoans.get(txId);
    if (!txLoans) {
      return { success: false, error: 'No active loans in transaction' };
    }

    const loan = txLoans.find(l => l.loanId === loanId);
    if (!loan) {
      return { success: false, error: 'Loan not found in transaction' };
    }

    // Verify same transaction (atomicity requirement)
    if (loan.txId !== txId) {
      return { success: false, error: 'Loan must be repaid in same transaction' };
    }

    const subchannel = context.subchannels.get(loan.params.tokenId);
    if (!subchannel) {
      return { success: false, error: 'Subchannel not found' };
    }

    // Calculate repayment amount (principal + fee)
    const repayAmount = loan.params.amount + loan.params.fee!;

    // Check borrower has funds to repay
    const borrowerCapacity = this.calculateCapacity(subchannel, loan.params.borrower);
    if (repayAmount > borrowerCapacity.outCapacity) {
      return {
        success: false,
        error: `Insufficient funds to repay: ${repayAmount} > ${borrowerCapacity.outCapacity}`
      };
    }

    // Record state before
    const beforeState = this.hashChannelState([subchannel]);

    // Execute repayment transfer
    const transfer = this.transfer(
      subchannel,
      repayAmount,
      loan.params.borrower === 'left' ? 'leftToRight' : 'rightToLeft'
    );

    if (!transfer.success) {
      return { success: false, error: `Repayment failed: ${transfer.error}` };
    }

    // Remove from active loans
    const index = txLoans.indexOf(loan);
    txLoans.splice(index, 1);

    // Create proof
    const afterState = this.hashChannelState([subchannel]);
    const proof = this.createProof('flash_repay', beforeState, afterState, {
      loanId,
      repayAmount: repayAmount.toString(),
      fee: loan.params.fee!.toString()
    });

    return {
      success: true,
      data: {
        loanId,
        amount: loan.params.amount,
        fee: loan.params.fee!,
        borrowed: true,
        repaid: true,
        gasUsed: 1000n
      },
      proof
    };
  }

  /**
   * Verify all loans repaid before transaction commit
   */
  static verifyRepayment(txId: string): TransformResult {
    const txLoans = this.activeLoans.get(txId);

    if (!txLoans || txLoans.length === 0) {
      return { success: true }; // No loans to verify
    }

    // Check if any loans remain unpaid
    if (txLoans.length > 0) {
      const unpaidLoans = txLoans.map(l => l.loanId).join(', ');
      return {
        success: false,
        error: `Flash loans not repaid: ${unpaidLoans}. Transaction will revert.`
      };
    }

    // Clean up
    this.activeLoans.delete(txId);

    return { success: true };
  }

  /**
   * Flash mint LP tokens (borrow LP tokens that must be burned)
   */
  static flashMint({
    context,
    poolId,
    amount,
    minter
  }: {
    context: TransformContext;
    poolId: string;
    amount: bigint;
    minter: 'left' | 'right';
  }): TransformResult<FlashLoanState> {
    // This would interact with LiquidityPoolTransformer
    // Mints LP tokens that must be burned in same transaction
    // Useful for arbitrage and rebalancing

    return this.borrow({
      context,
      params: {
        tokenId: 999, // LP token ID (would be from pool)
        amount,
        borrower: minter,
        fee: 0n // No fee for LP token flash mints
      }
    });
  }

  /**
   * Get current transaction ID
   */
  private static getCurrentTransaction(): string | undefined {
    // In production, this would track the current atomic transaction
    // For now, use a simple approach
    const transactions = Array.from(this.activeLoans.keys());
    return transactions[transactions.length - 1];
  }

  /**
   * Required abstract method implementation
   */
  async transform(
    context: TransformContext,
    params: any
  ): Promise<TransformResult> {
    if (params.operation === 'borrow') {
      return FlashLoanTransformer.borrow({ context, params });
    } else if (params.operation === 'repay') {
      return FlashLoanTransformer.repay({ context, loanId: params.loanId });
    } else {
      return { success: false, error: 'Invalid operation' };
    }
  }
}

/**
 * Flash loan attack prevention
 */
export class FlashLoanSecurity {
  /**
   * Detect potential price manipulation
   */
  static detectManipulation(
    preBorrowPrice: bigint,
    currentPrice: bigint,
    threshold: number = 10 // 10% threshold
  ): boolean {
    const change = this.abs(currentPrice - preBorrowPrice);
    const percentChange = Number(change * 100n / preBorrowPrice);
    return percentChange > threshold;
  }

  /**
   * Prevent reentrancy attacks
   */
  static nonReentrant(
    txId: string,
    operation: string
  ): TransformResult {
    const key = `reentrancy-${txId}-${operation}`;
    const guard = this.checkpoint(key, true);

    if (guard) {
      return {
        success: false,
        error: 'Reentrancy detected'
      };
    }

    this.checkpoint(key, true);

    return {
      success: true,
      rollback: () => {
        this.checkpoint(key, false);
      }
    };
  }

  /**
   * Validate callback data hasn't been tampered
   */
  static validateCallback(
    originalData: any,
    callbackData: any
  ): boolean {
    const originalHash = this.hashChannelState([originalData]);
    const callbackHash = this.hashChannelState([callbackData]);
    return originalHash === callbackHash;
  }

  // Inherit utility methods from BaseTransformer
  private static abs = BaseTransformer['abs'];
  private static checkpoint = BaseTransformer['checkpoint'];
  private static hashChannelState = BaseTransformer['hashChannelState'];
}

/**
 * Common flash loan strategies
 */
export class FlashLoanStrategies {
  /**
   * Arbitrage between two pools
   */
  static arbitrage({
    loanAmount,
    pool1,
    pool2,
    tokenA,
    tokenB
  }: {
    loanAmount: bigint;
    pool1: string;
    pool2: string;
    tokenA: number;
    tokenB: number;
  }): any[] {
    return [
      {
        transformer: 'FlashLoanTransformer',
        method: 'borrow',
        params: { tokenId: tokenA, amount: loanAmount }
      },
      {
        transformer: 'SwapTransformer',
        method: 'execute',
        params: {
          poolId: pool1,
          tokenIn: tokenA,
          tokenOut: tokenB,
          amountIn: loanAmount
        }
      },
      {
        transformer: 'SwapTransformer',
        method: 'execute',
        params: {
          poolId: pool2,
          tokenIn: tokenB,
          tokenOut: tokenA
        }
      },
      {
        transformer: 'FlashLoanTransformer',
        method: 'repay',
        params: { loanId: '${loanId}' } // Would be injected
      }
    ];
  }

  /**
   * Collateral swap without closing position
   */
  static collateralSwap({
    position,
    oldCollateral,
    newCollateral,
    amount
  }: {
    position: string;
    oldCollateral: number;
    newCollateral: number;
    amount: bigint;
  }): any[] {
    return [
      {
        transformer: 'FlashLoanTransformer',
        method: 'borrow',
        params: { tokenId: newCollateral, amount }
      },
      {
        transformer: 'FuturesTransformer',
        method: 'addCollateral',
        params: { position, token: newCollateral, amount }
      },
      {
        transformer: 'FuturesTransformer',
        method: 'removeCollateral',
        params: { position, token: oldCollateral, amount }
      },
      {
        transformer: 'SwapTransformer',
        method: 'execute',
        params: {
          tokenIn: oldCollateral,
          tokenOut: newCollateral,
          amountIn: amount
        }
      },
      {
        transformer: 'FlashLoanTransformer',
        method: 'repay',
        params: { loanId: '${loanId}' }
      }
    ];
  }
}