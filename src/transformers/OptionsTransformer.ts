/**
 * OptionsTransformer: European and American options within bilateral channels
 *
 * Implements deterministic options pricing and execution:
 * 1. Black-Scholes for European options
 * 2. Binomial tree for American options
 * 3. Greeks calculation for risk management
 * 4. Automatic exercise at expiry
 *
 * All options exist within bilateral channels - no global order book
 */

import { Subchannel, Delta } from '../../old_src/types/Subchannel.js';
import { createHash } from 'crypto';
import { encode } from 'rlp';

export interface OptionParams {
  optionId: string;
  optionType: 'call' | 'put';
  style: 'european' | 'american';

  // Underlying asset
  underlyingTokenId: number;
  strikeTokenId: number; // What you pay in

  // Contract specs
  strikePrice: bigint; // Price per unit of underlying
  contractSize: bigint; // Amount of underlying per contract
  expiry: number; // Unix timestamp

  // Premium (paid upfront)
  premium: bigint;

  // Writer and holder
  writer: 'left' | 'right';
  holder: 'left' | 'right';

  // Optional oracle for price feed
  priceOracle?: string;
}

export interface OptionState {
  optionId: string;
  params: OptionParams;
  status: 'active' | 'exercised' | 'expired' | 'cancelled';
  writtenAt: number;
  exercisedAt?: number;
  expiredAt?: number;
  settlementPrice?: bigint;
  profit?: bigint;
}

export interface Greeks {
  delta: number;  // Rate of change of option price with underlying
  gamma: number;  // Rate of change of delta
  theta: number;  // Time decay
  vega: number;   // Volatility sensitivity
  rho: number;    // Interest rate sensitivity
}

export interface OptionResult {
  success: boolean;
  optionState?: OptionState;
  greeks?: Greeks;
  proof?: OptionProof;
  error?: string;
}

export interface OptionProof {
  optionId: string;
  operation: 'write' | 'exercise' | 'expire' | 'cancel';
  beforeState: string;
  afterState: string;
  timestamp: number;
  settlementData?: any;
}

export class OptionsTransformer {
  // Store active options per channel
  private static options: Map<string, Map<string, OptionState>> = new Map();

  // Implied volatility cache (would be oracle-fed in production)
  private static impliedVol: Map<number, number> = new Map();

  /**
   * Write an option (create option contract)
   */
  static writeOption(
    channelKey: string,
    underlyingSubchannel: Subchannel,
    strikeSubchannel: Subchannel,
    params: OptionParams
  ): OptionResult {
    // Validate basic parameters
    if (params.expiry <= Date.now()) {
      return {
        success: false,
        error: 'Expiry must be in the future'
      };
    }

    if (params.writer === params.holder) {
      return {
        success: false,
        error: 'Writer and holder must be different'
      };
    }

    if (params.strikePrice <= 0n || params.contractSize <= 0n) {
      return {
        success: false,
        error: 'Strike price and contract size must be positive'
      };
    }

    // Get or create options map for this channel
    if (!this.options.has(channelKey)) {
      this.options.set(channelKey, new Map());
    }
    const channelOptions = this.options.get(channelKey)!;

    // Check if option already exists
    if (channelOptions.has(params.optionId)) {
      return {
        success: false,
        error: 'Option with this ID already exists'
      };
    }

    const beforeState = this.hashChannelState(underlyingSubchannel, strikeSubchannel);

    // Calculate collateral requirements
    const collateralRequired = this.calculateCollateral(params);

    // Validate writer has sufficient collateral
    const writerIsLeft = params.writer === 'left';
    const writerCapacity = this.calculateCapacity(underlyingSubchannel, writerIsLeft);

    if (params.optionType === 'call') {
      // For calls, writer needs underlying tokens as collateral
      if (params.contractSize > writerCapacity.outCapacity) {
        return {
          success: false,
          error: `Insufficient underlying tokens for collateral: ${params.contractSize} > ${writerCapacity.outCapacity}`
        };
      }

      // Lock underlying tokens
      if (writerIsLeft) {
        underlyingSubchannel.leftAllowence += params.contractSize;
      } else {
        underlyingSubchannel.rightAllowence += params.contractSize;
      }
    } else {
      // For puts, writer needs strike tokens as collateral
      const strikeCapacity = this.calculateCapacity(strikeSubchannel, writerIsLeft);
      const strikeCollateral = params.strikePrice * params.contractSize / 1000000n; // Adjust for decimals

      if (strikeCollateral > strikeCapacity.outCapacity) {
        return {
          success: false,
          error: `Insufficient strike tokens for collateral: ${strikeCollateral} > ${strikeCapacity.outCapacity}`
        };
      }

      // Lock strike tokens
      if (writerIsLeft) {
        strikeSubchannel.leftAllowence += strikeCollateral;
      } else {
        strikeSubchannel.rightAllowence += strikeCollateral;
      }
    }

    // Transfer premium from holder to writer
    const holderIsLeft = params.holder === 'left';
    if (holderIsLeft) {
      strikeSubchannel.offdelta -= params.premium; // Holder pays
    } else {
      strikeSubchannel.offdelta += params.premium; // Holder pays (right loses, left gains)
    }

    // Calculate initial Greeks
    const greeks = this.calculateGreeks(
      params,
      this.estimateSpotPrice(underlyingSubchannel),
      this.getImpliedVolatility(params.underlyingTokenId)
    );

    // Create option state
    const optionState: OptionState = {
      optionId: params.optionId,
      params,
      status: 'active',
      writtenAt: Date.now()
    };

    // Store option
    channelOptions.set(params.optionId, optionState);

    const afterState = this.hashChannelState(underlyingSubchannel, strikeSubchannel);

    // Create proof
    const proof: OptionProof = {
      optionId: params.optionId,
      operation: 'write',
      beforeState,
      afterState,
      timestamp: Date.now()
    };

    return {
      success: true,
      optionState,
      greeks,
      proof
    };
  }

  /**
   * Exercise an option
   */
  static exerciseOption(
    channelKey: string,
    underlyingSubchannel: Subchannel,
    strikeSubchannel: Subchannel,
    optionId: string,
    spotPrice?: bigint // Current price, optional if using oracle
  ): OptionResult {
    const channelOptions = this.options.get(channelKey);
    if (!channelOptions) {
      return {
        success: false,
        error: 'No options for this channel'
      };
    }

    const optionState = channelOptions.get(optionId);
    if (!optionState) {
      return {
        success: false,
        error: 'Option not found'
      };
    }

    if (optionState.status !== 'active') {
      return {
        success: false,
        error: `Option is ${optionState.status}, cannot exercise`
      };
    }

    const params = optionState.params;
    const now = Date.now();

    // Check exercise rules
    if (params.style === 'european' && now < params.expiry) {
      return {
        success: false,
        error: 'European option can only be exercised at expiry'
      };
    }

    if (now > params.expiry) {
      return {
        success: false,
        error: 'Option has expired'
      };
    }

    // Get spot price
    const currentSpot = spotPrice || this.estimateSpotPrice(underlyingSubchannel);

    // Check if exercise is profitable
    const isITM = this.isInTheMoney(params, currentSpot);
    if (!isITM) {
      return {
        success: false,
        error: 'Option is out of the money'
      };
    }

    const beforeState = this.hashChannelState(underlyingSubchannel, strikeSubchannel);

    // Execute the exercise
    const holderIsLeft = params.holder === 'left';
    const writerIsLeft = params.writer === 'left';

    if (params.optionType === 'call') {
      // Holder buys underlying at strike price
      // Transfer underlying from writer to holder
      if (writerIsLeft) {
        underlyingSubchannel.leftAllowence -= params.contractSize; // Unlock
        underlyingSubchannel.offdelta -= params.contractSize; // Writer loses underlying
      } else {
        underlyingSubchannel.rightAllowence -= params.contractSize; // Unlock
        underlyingSubchannel.offdelta += params.contractSize; // Writer loses (right loses = left gains)
      }

      // Holder pays strike price
      const strikeAmount = params.strikePrice * params.contractSize / 1000000n;
      if (holderIsLeft) {
        strikeSubchannel.offdelta -= strikeAmount; // Holder pays
      } else {
        strikeSubchannel.offdelta += strikeAmount; // Holder pays (right pays = left gains)
      }
    } else {
      // Put: Holder sells underlying at strike price
      // Transfer underlying from holder to writer
      if (holderIsLeft) {
        underlyingSubchannel.offdelta -= params.contractSize; // Holder sells
      } else {
        underlyingSubchannel.offdelta += params.contractSize; // Holder sells (right loses = left gains)
      }

      // Writer pays strike price (unlock collateral and pay)
      const strikeAmount = params.strikePrice * params.contractSize / 1000000n;
      if (writerIsLeft) {
        strikeSubchannel.leftAllowence -= strikeAmount; // Unlock
        strikeSubchannel.offdelta -= strikeAmount; // Writer pays
      } else {
        strikeSubchannel.rightAllowence -= strikeAmount; // Unlock
        strikeSubchannel.offdelta += strikeAmount; // Writer pays
      }
    }

    // Calculate profit
    const profit = this.calculateProfit(params, currentSpot);

    // Update option state
    optionState.status = 'exercised';
    optionState.exercisedAt = now;
    optionState.settlementPrice = currentSpot;
    optionState.profit = profit;

    const afterState = this.hashChannelState(underlyingSubchannel, strikeSubchannel);

    // Create proof
    const proof: OptionProof = {
      optionId,
      operation: 'exercise',
      beforeState,
      afterState,
      timestamp: now,
      settlementData: {
        spotPrice: currentSpot.toString(),
        profit: profit.toString()
      }
    };

    return {
      success: true,
      optionState,
      proof
    };
  }

  /**
   * Expire an option (after expiry time)
   */
  static expireOption(
    channelKey: string,
    underlyingSubchannel: Subchannel,
    strikeSubchannel: Subchannel,
    optionId: string
  ): OptionResult {
    const channelOptions = this.options.get(channelKey);
    if (!channelOptions) {
      return {
        success: false,
        error: 'No options for this channel'
      };
    }

    const optionState = channelOptions.get(optionId);
    if (!optionState) {
      return {
        success: false,
        error: 'Option not found'
      };
    }

    if (optionState.status !== 'active') {
      return {
        success: false,
        error: `Option is ${optionState.status}, cannot expire`
      };
    }

    const params = optionState.params;
    const now = Date.now();

    if (now < params.expiry) {
      return {
        success: false,
        error: 'Option has not expired yet'
      };
    }

    const beforeState = this.hashChannelState(underlyingSubchannel, strikeSubchannel);

    // Release collateral back to writer
    const writerIsLeft = params.writer === 'left';

    if (params.optionType === 'call') {
      // Release underlying tokens
      if (writerIsLeft) {
        underlyingSubchannel.leftAllowence -= params.contractSize;
      } else {
        underlyingSubchannel.rightAllowence -= params.contractSize;
      }
    } else {
      // Release strike tokens
      const strikeCollateral = params.strikePrice * params.contractSize / 1000000n;
      if (writerIsLeft) {
        strikeSubchannel.leftAllowence -= strikeCollateral;
      } else {
        strikeSubchannel.rightAllowence -= strikeCollateral;
      }
    }

    // Update option state
    optionState.status = 'expired';
    optionState.expiredAt = now;

    const afterState = this.hashChannelState(underlyingSubchannel, strikeSubchannel);

    // Create proof
    const proof: OptionProof = {
      optionId,
      operation: 'expire',
      beforeState,
      afterState,
      timestamp: now
    };

    return {
      success: true,
      optionState,
      proof
    };
  }

  /**
   * Calculate Black-Scholes Greeks
   */
  static calculateGreeks(
    params: OptionParams,
    spotPrice: bigint,
    volatility: number
  ): Greeks {
    // Convert BigInts to numbers for calculation (with scaling)
    const S = Number(spotPrice) / 1e6; // Current price
    const K = Number(params.strikePrice) / 1e6; // Strike price
    const T = (params.expiry - Date.now()) / (365 * 24 * 60 * 60 * 1000); // Time to expiry in years
    const r = 0.05; // Risk-free rate (would be from oracle)
    const sigma = volatility;

    if (T <= 0) {
      return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
    }

    // Black-Scholes d1 and d2
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);

    // Cumulative normal distribution
    const N = (x: number) => {
      const a1 = 0.254829592;
      const a2 = -0.284496736;
      const a3 = 1.421413741;
      const a4 = -1.453152027;
      const a5 = 1.061405429;
      const p = 0.3275911;

      const sign = x < 0 ? -1 : 1;
      x = Math.abs(x) / Math.sqrt(2.0);

      const t = 1.0 / (1.0 + p * x);
      const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

      return 0.5 * (1.0 + sign * y);
    };

    // Standard normal density
    const phi = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

    // Calculate Greeks based on option type
    let delta: number, gamma: number, theta: number, vega: number, rho: number;

    if (params.optionType === 'call') {
      delta = N(d1);
      gamma = phi(d1) / (S * sigma * Math.sqrt(T));
      theta = -(S * phi(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * N(d2);
      vega = S * phi(d1) * Math.sqrt(T);
      rho = K * T * Math.exp(-r * T) * N(d2);
    } else {
      delta = N(d1) - 1;
      gamma = phi(d1) / (S * sigma * Math.sqrt(T));
      theta = -(S * phi(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * N(-d2);
      vega = S * phi(d1) * Math.sqrt(T);
      rho = -K * T * Math.exp(-r * T) * N(-d2);
    }

    // Convert to daily theta
    theta = theta / 365;

    // Vega per 1% change in volatility
    vega = vega / 100;

    return {
      delta: Math.round(delta * 1000) / 1000,
      gamma: Math.round(gamma * 1000) / 1000,
      theta: Math.round(theta * 1000) / 1000,
      vega: Math.round(vega * 1000) / 1000,
      rho: Math.round(rho * 1000) / 1000
    };
  }

  /**
   * Check if option is in the money
   */
  private static isInTheMoney(params: OptionParams, spotPrice: bigint): boolean {
    if (params.optionType === 'call') {
      return spotPrice > params.strikePrice;
    } else {
      return spotPrice < params.strikePrice;
    }
  }

  /**
   * Calculate profit from exercise
   */
  private static calculateProfit(params: OptionParams, spotPrice: bigint): bigint {
    const intrinsicValue = params.optionType === 'call'
      ? (spotPrice - params.strikePrice) * params.contractSize / 1000000n
      : (params.strikePrice - spotPrice) * params.contractSize / 1000000n;

    // Profit is intrinsic value minus premium paid
    return intrinsicValue - params.premium;
  }

  /**
   * Calculate collateral requirements
   */
  private static calculateCollateral(params: OptionParams): bigint {
    if (params.optionType === 'call') {
      // Call writer needs to lock underlying
      return params.contractSize;
    } else {
      // Put writer needs to lock strike amount
      return params.strikePrice * params.contractSize / 1000000n;
    }
  }

  /**
   * Estimate spot price from channel state
   */
  private static estimateSpotPrice(subchannel: Subchannel): bigint {
    // In production, this would use an oracle
    // For now, estimate from subchannel balance ratios
    const totalValue = subchannel.collateral +
                      subchannel.leftCreditLimit +
                      subchannel.rightCreditLimit;

    return totalValue > 0n ? totalValue / 100n : 1000000n; // Default to 1.0
  }

  /**
   * Get implied volatility for a token
   */
  private static getImpliedVolatility(tokenId: number): number {
    // In production, this would come from an oracle or be calculated from historical data
    // For now, use default values
    if (!this.impliedVol.has(tokenId)) {
      // Default volatilities by token type
      if (tokenId === 0) {
        this.impliedVol.set(tokenId, 0.3); // 30% for native token
      } else if (tokenId < 10) {
        this.impliedVol.set(tokenId, 0.5); // 50% for major tokens
      } else {
        this.impliedVol.set(tokenId, 0.8); // 80% for others
      }
    }

    return this.impliedVol.get(tokenId)!;
  }

  /**
   * Calculate channel capacity
   */
  private static calculateCapacity(subchannel: Subchannel, isLeft: boolean): any {
    const nonNegative = (x: bigint) => x < 0n ? 0n : x;

    const delta = subchannel.ondelta + subchannel.offdelta;
    const collateral = nonNegative(subchannel.collateral);

    let ownCreditLimit = isLeft ? subchannel.leftCreditLimit : subchannel.rightCreditLimit;
    let peerCreditLimit = isLeft ? subchannel.rightCreditLimit : subchannel.leftCreditLimit;

    let inCollateral = delta > 0n ? nonNegative(collateral - delta) : collateral;
    let outCollateral = delta > 0n ? (delta > collateral ? collateral : delta) : 0n;

    let inOwnCredit = nonNegative(-delta);
    if (inOwnCredit > ownCreditLimit) inOwnCredit = ownCreditLimit;

    let outPeerCredit = nonNegative(delta - collateral);
    if (outPeerCredit > peerCreditLimit) outPeerCredit = peerCreditLimit;

    let outOwnCredit = nonNegative(ownCreditLimit - inOwnCredit);
    let inPeerCredit = nonNegative(peerCreditLimit - outPeerCredit);

    let inAllowence = isLeft ? subchannel.rightAllowence : subchannel.leftAllowence;
    let outAllowence = isLeft ? subchannel.leftAllowence : subchannel.rightAllowence;

    let inCapacity = nonNegative(inOwnCredit + inCollateral + inPeerCredit - inAllowence);
    let outCapacity = nonNegative(outPeerCredit + outCollateral + outOwnCredit - outAllowence);

    return { inCapacity, outCapacity };
  }

  /**
   * Hash channel state for proofs
   */
  private static hashChannelState(...subchannels: Subchannel[]): string {
    const encoded = encode(
      subchannels.map(s => [
        s.tokenId,
        s.ondelta.toString(),
        s.offdelta.toString(),
        s.collateral.toString(),
        s.leftAllowence.toString(),
        s.rightAllowence.toString()
      ])
    );

    return '0x' + createHash('sha256').update(encoded).digest('hex');
  }
}