/**
 * FuturesTransformer: Perpetual and dated futures within bilateral channels
 *
 * Implements sophisticated futures mechanics:
 * 1. Initial and maintenance margin requirements
 * 2. Mark-to-market settlement every block
 * 3. Automatic liquidation at maintenance margin
 * 4. Funding rate for perpetuals
 * 5. Physical and cash settlement options
 *
 * All positions are bilateral - no centralized clearing house
 */

import { Subchannel } from '../../old_src/types/Subchannel.js';
import { createHash } from 'crypto';
import { encode } from 'rlp';

export interface FuturesParams {
  futuresId: string;
  futuresType: 'perpetual' | 'dated';
  settlementType: 'physical' | 'cash';

  // Contract specifications
  underlyingTokenId: number;
  marginTokenId: number; // Collateral token
  contractSize: bigint; // Size of one contract
  tickSize: bigint; // Minimum price movement

  // For dated futures
  expiry?: number; // Unix timestamp (undefined for perpetuals)
  deliveryPrice?: bigint; // Final settlement price

  // Margin requirements (as percentage * 100, e.g., 500 = 5%)
  initialMarginRate: number; // e.g., 10% = 1000
  maintenanceMarginRate: number; // e.g., 5% = 500

  // Position info
  long: 'left' | 'right';
  short: 'left' | 'right';
  entryPrice: bigint;
  contracts: bigint; // Number of contracts

  // Oracle configuration
  priceOracle?: string;
  fundingOracle?: string; // For perpetual funding rate
}

export interface FuturesPosition {
  futuresId: string;
  params: FuturesParams;
  status: 'active' | 'liquidated' | 'settled' | 'cancelled';

  // Margin tracking
  longMargin: bigint;
  shortMargin: bigint;
  lastMarkPrice: bigint;
  lastMarkTime: number;

  // P&L tracking
  realizedPnL: bigint;
  unrealizedPnL: bigint;
  fundingPaid: bigint; // Total funding paid (perpetuals)

  // Liquidation info
  liquidationPrice?: bigint;
  liquidatedAt?: number;
  liquidationPenalty?: bigint;

  // Settlement info
  settledAt?: number;
  settlementPrice?: bigint;
}

export interface FundingRate {
  rate: number; // Funding rate per period (can be negative)
  period: number; // Period in milliseconds
  lastUpdate: number;
  nextPayment: number;
}

export interface FuturesResult {
  success: boolean;
  position?: FuturesPosition;
  liquidation?: LiquidationInfo;
  proof?: FuturesProof;
  error?: string;
}

export interface LiquidationInfo {
  liquidationPrice: bigint;
  currentPrice: bigint;
  marginRatio: number;
  penalty: bigint;
  returnedCollateral: bigint;
}

export interface FuturesProof {
  futuresId: string;
  operation: 'open' | 'mark' | 'liquidate' | 'settle' | 'funding';
  beforeState: string;
  afterState: string;
  timestamp: number;
  details?: any;
}

export class FuturesTransformer {
  // Store active positions per channel
  private static positions: Map<string, Map<string, FuturesPosition>> = new Map();

  // Funding rates for perpetuals
  private static fundingRates: Map<string, FundingRate> = new Map();

  /**
   * Open a futures position
   */
  static openPosition(
    channelKey: string,
    marginSubchannel: Subchannel,
    params: FuturesParams
  ): FuturesResult {
    // Validate parameters
    if (params.long === params.short) {
      return {
        success: false,
        error: 'Long and short must be different parties'
      };
    }

    if (params.futuresType === 'dated' && !params.expiry) {
      return {
        success: false,
        error: 'Dated futures must have expiry'
      };
    }

    if (params.futuresType === 'dated' && params.expiry! <= Date.now()) {
      return {
        success: false,
        error: 'Expiry must be in the future'
      };
    }

    if (params.initialMarginRate <= params.maintenanceMarginRate) {
      return {
        success: false,
        error: 'Initial margin must be higher than maintenance margin'
      };
    }

    // Get or create positions map
    if (!this.positions.has(channelKey)) {
      this.positions.set(channelKey, new Map());
    }
    const channelPositions = this.positions.get(channelKey)!;

    if (channelPositions.has(params.futuresId)) {
      return {
        success: false,
        error: 'Position with this ID already exists'
      };
    }

    const beforeState = this.hashState(marginSubchannel);

    // Calculate initial margin requirements
    const notionalValue = params.entryPrice * params.contracts * params.contractSize / 1000000n;
    const initialMarginRequired = notionalValue * BigInt(params.initialMarginRate) / 10000n;

    // Validate both parties have sufficient margin
    const longIsLeft = params.long === 'left';
    const longCapacity = this.calculateCapacity(marginSubchannel, longIsLeft);
    const shortCapacity = this.calculateCapacity(marginSubchannel, !longIsLeft);

    if (initialMarginRequired > longCapacity.outCapacity) {
      return {
        success: false,
        error: `Long party has insufficient margin: ${initialMarginRequired} > ${longCapacity.outCapacity}`
      };
    }

    if (initialMarginRequired > shortCapacity.outCapacity) {
      return {
        success: false,
        error: `Short party has insufficient margin: ${initialMarginRequired} > ${shortCapacity.outCapacity}`
      };
    }

    // Lock margin from both parties
    if (longIsLeft) {
      marginSubchannel.leftAllowence += initialMarginRequired;
      marginSubchannel.rightAllowence += initialMarginRequired;
    } else {
      marginSubchannel.rightAllowence += initialMarginRequired;
      marginSubchannel.leftAllowence += initialMarginRequired;
    }

    // Calculate liquidation price
    const liquidationPrice = this.calculateLiquidationPrice(params, true);

    // Create position
    const position: FuturesPosition = {
      futuresId: params.futuresId,
      params,
      status: 'active',
      longMargin: initialMarginRequired,
      shortMargin: initialMarginRequired,
      lastMarkPrice: params.entryPrice,
      lastMarkTime: Date.now(),
      realizedPnL: 0n,
      unrealizedPnL: 0n,
      fundingPaid: 0n,
      liquidationPrice
    };

    // Store position
    channelPositions.set(params.futuresId, position);

    // Initialize funding rate for perpetuals
    if (params.futuresType === 'perpetual') {
      this.fundingRates.set(params.futuresId, {
        rate: 0.0001, // 0.01% per period
        period: 8 * 60 * 60 * 1000, // 8 hours
        lastUpdate: Date.now(),
        nextPayment: Date.now() + 8 * 60 * 60 * 1000
      });
    }

    const afterState = this.hashState(marginSubchannel);

    // Create proof
    const proof: FuturesProof = {
      futuresId: params.futuresId,
      operation: 'open',
      beforeState,
      afterState,
      timestamp: Date.now(),
      details: {
        entryPrice: params.entryPrice.toString(),
        contracts: params.contracts.toString(),
        initialMargin: initialMarginRequired.toString(),
        liquidationPrice: liquidationPrice.toString()
      }
    };

    return {
      success: true,
      position,
      proof
    };
  }

  /**
   * Mark position to market (update unrealized P&L)
   */
  static markToMarket(
    channelKey: string,
    marginSubchannel: Subchannel,
    futuresId: string,
    markPrice: bigint
  ): FuturesResult {
    const channelPositions = this.positions.get(channelKey);
    if (!channelPositions) {
      return {
        success: false,
        error: 'No positions for this channel'
      };
    }

    const position = channelPositions.get(futuresId);
    if (!position) {
      return {
        success: false,
        error: 'Position not found'
      };
    }

    if (position.status !== 'active') {
      return {
        success: false,
        error: `Position is ${position.status}`
      };
    }

    const beforeState = this.hashState(marginSubchannel);
    const params = position.params;

    // Calculate price change and P&L
    const priceChange = markPrice - position.lastMarkPrice;
    const notionalChange = priceChange * params.contracts * params.contractSize / 1000000n;

    // Update unrealized P&L
    const longPnL = notionalChange;
    const shortPnL = -notionalChange;

    // Transfer P&L between margins
    const longIsLeft = params.long === 'left';

    if (longPnL > 0n) {
      // Long profits, short loses
      const transfer = longPnL > position.shortMargin ? position.shortMargin : longPnL;
      position.longMargin += transfer;
      position.shortMargin -= transfer;
    } else if (longPnL < 0n) {
      // Short profits, long loses
      const transfer = -longPnL > position.longMargin ? position.longMargin : -longPnL;
      position.shortMargin += transfer;
      position.longMargin -= transfer;
    }

    // Update tracking
    position.unrealizedPnL = longPnL;
    position.lastMarkPrice = markPrice;
    position.lastMarkTime = Date.now();

    // Check for liquidation
    const longMarginRatio = this.calculateMarginRatio(position, true);
    const shortMarginRatio = this.calculateMarginRatio(position, false);

    if (longMarginRatio < params.maintenanceMarginRate) {
      return this.liquidatePosition(channelKey, marginSubchannel, futuresId, markPrice, true);
    }

    if (shortMarginRatio < params.maintenanceMarginRate) {
      return this.liquidatePosition(channelKey, marginSubchannel, futuresId, markPrice, false);
    }

    // Update liquidation prices
    position.liquidationPrice = this.calculateLiquidationPrice(params, position.longMargin > position.shortMargin);

    const afterState = this.hashState(marginSubchannel);

    // Create proof
    const proof: FuturesProof = {
      futuresId,
      operation: 'mark',
      beforeState,
      afterState,
      timestamp: Date.now(),
      details: {
        markPrice: markPrice.toString(),
        longMargin: position.longMargin.toString(),
        shortMargin: position.shortMargin.toString(),
        unrealizedPnL: position.unrealizedPnL.toString()
      }
    };

    return {
      success: true,
      position,
      proof
    };
  }

  /**
   * Liquidate a position when margin falls below maintenance
   */
  static liquidatePosition(
    channelKey: string,
    marginSubchannel: Subchannel,
    futuresId: string,
    currentPrice: bigint,
    liquidateLong: boolean
  ): FuturesResult {
    const channelPositions = this.positions.get(channelKey);
    if (!channelPositions) {
      return {
        success: false,
        error: 'No positions for this channel'
      };
    }

    const position = channelPositions.get(futuresId);
    if (!position) {
      return {
        success: false,
        error: 'Position not found'
      };
    }

    if (position.status !== 'active') {
      return {
        success: false,
        error: `Position is already ${position.status}`
      };
    }

    const beforeState = this.hashState(marginSubchannel);
    const params = position.params;

    // Calculate liquidation penalty (usually 1-2% of position)
    const notionalValue = currentPrice * params.contracts * params.contractSize / 1000000n;
    const liquidationPenalty = notionalValue * 100n / 10000n; // 1% penalty

    // Determine final margin distribution
    let winnerMargin: bigint;
    let loserReturn: bigint;

    if (liquidateLong) {
      // Long is liquidated, short wins
      winnerMargin = position.longMargin + position.shortMargin - liquidationPenalty;
      loserReturn = 0n; // Long loses everything
    } else {
      // Short is liquidated, long wins
      winnerMargin = position.shortMargin + position.longMargin - liquidationPenalty;
      loserReturn = 0n; // Short loses everything
    }

    // Return margins
    const longIsLeft = params.long === 'left';

    if (longIsLeft) {
      // Unlock allowances
      marginSubchannel.leftAllowence -= position.longMargin;
      marginSubchannel.rightAllowence -= position.shortMargin;

      // Distribute final amounts
      if (liquidateLong) {
        // Short (right) gets winnings
        marginSubchannel.offdelta -= winnerMargin; // Right gains (left loses)
      } else {
        // Long (left) gets winnings
        marginSubchannel.offdelta += winnerMargin; // Left gains
      }
    } else {
      // Unlock allowances
      marginSubchannel.rightAllowence -= position.longMargin;
      marginSubchannel.leftAllowence -= position.shortMargin;

      // Distribute final amounts
      if (liquidateLong) {
        // Short (left) gets winnings
        marginSubchannel.offdelta += winnerMargin; // Left gains
      } else {
        // Long (right) gets winnings
        marginSubchannel.offdelta -= winnerMargin; // Right gains (left loses)
      }
    }

    // Update position
    position.status = 'liquidated';
    position.liquidatedAt = Date.now();
    position.liquidationPenalty = liquidationPenalty;

    // Create liquidation info
    const liquidationInfo: LiquidationInfo = {
      liquidationPrice: position.liquidationPrice || currentPrice,
      currentPrice,
      marginRatio: this.calculateMarginRatio(position, liquidateLong),
      penalty: liquidationPenalty,
      returnedCollateral: loserReturn
    };

    const afterState = this.hashState(marginSubchannel);

    // Create proof
    const proof: FuturesProof = {
      futuresId,
      operation: 'liquidate',
      beforeState,
      afterState,
      timestamp: Date.now(),
      details: {
        liquidatedParty: liquidateLong ? 'long' : 'short',
        currentPrice: currentPrice.toString(),
        penalty: liquidationPenalty.toString()
      }
    };

    return {
      success: true,
      position,
      liquidation: liquidationInfo,
      proof
    };
  }

  /**
   * Process funding payment for perpetual futures
   */
  static processFunding(
    channelKey: string,
    marginSubchannel: Subchannel,
    futuresId: string
  ): FuturesResult {
    const channelPositions = this.positions.get(channelKey);
    if (!channelPositions) {
      return {
        success: false,
        error: 'No positions for this channel'
      };
    }

    const position = channelPositions.get(futuresId);
    if (!position) {
      return {
        success: false,
        error: 'Position not found'
      };
    }

    if (position.status !== 'active') {
      return {
        success: false,
        error: `Position is ${position.status}`
      };
    }

    if (position.params.futuresType !== 'perpetual') {
      return {
        success: false,
        error: 'Only perpetual futures have funding'
      };
    }

    const fundingRate = this.fundingRates.get(futuresId);
    if (!fundingRate) {
      return {
        success: false,
        error: 'No funding rate configured'
      };
    }

    const now = Date.now();
    if (now < fundingRate.nextPayment) {
      return {
        success: false,
        error: `Next funding payment at ${new Date(fundingRate.nextPayment).toISOString()}`
      };
    }

    const beforeState = this.hashState(marginSubchannel);
    const params = position.params;

    // Calculate funding payment
    const notionalValue = position.lastMarkPrice * params.contracts * params.contractSize / 1000000n;
    const fundingPayment = notionalValue * BigInt(Math.floor(fundingRate.rate * 10000)) / 10000n;

    // Transfer funding between long and short
    if (fundingRate.rate > 0) {
      // Longs pay shorts
      const payment = fundingPayment > position.longMargin ? position.longMargin : fundingPayment;
      position.longMargin -= payment;
      position.shortMargin += payment;
      position.fundingPaid += payment;
    } else {
      // Shorts pay longs
      const payment = -fundingPayment > position.shortMargin ? position.shortMargin : -fundingPayment;
      position.shortMargin -= payment;
      position.longMargin += payment;
      position.fundingPaid -= payment;
    }

    // Update funding schedule
    fundingRate.lastUpdate = now;
    fundingRate.nextPayment = now + fundingRate.period;

    // Check for liquidation after funding
    const longMarginRatio = this.calculateMarginRatio(position, true);
    const shortMarginRatio = this.calculateMarginRatio(position, false);

    if (longMarginRatio < params.maintenanceMarginRate) {
      return this.liquidatePosition(channelKey, marginSubchannel, futuresId, position.lastMarkPrice, true);
    }

    if (shortMarginRatio < params.maintenanceMarginRate) {
      return this.liquidatePosition(channelKey, marginSubchannel, futuresId, position.lastMarkPrice, false);
    }

    const afterState = this.hashState(marginSubchannel);

    // Create proof
    const proof: FuturesProof = {
      futuresId,
      operation: 'funding',
      beforeState,
      afterState,
      timestamp: now,
      details: {
        fundingRate: fundingRate.rate,
        fundingPayment: fundingPayment.toString(),
        longMargin: position.longMargin.toString(),
        shortMargin: position.shortMargin.toString()
      }
    };

    return {
      success: true,
      position,
      proof
    };
  }

  /**
   * Settle a dated futures contract at expiry
   */
  static settleFutures(
    channelKey: string,
    marginSubchannel: Subchannel,
    underlyingSubchannel: Subchannel | undefined, // For physical delivery
    futuresId: string,
    settlementPrice: bigint
  ): FuturesResult {
    const channelPositions = this.positions.get(channelKey);
    if (!channelPositions) {
      return {
        success: false,
        error: 'No positions for this channel'
      };
    }

    const position = channelPositions.get(futuresId);
    if (!position) {
      return {
        success: false,
        error: 'Position not found'
      };
    }

    if (position.status !== 'active') {
      return {
        success: false,
        error: `Position is ${position.status}`
      };
    }

    const params = position.params;

    if (params.futuresType !== 'dated') {
      return {
        success: false,
        error: 'Only dated futures can be settled'
      };
    }

    if (Date.now() < params.expiry!) {
      return {
        success: false,
        error: 'Contract has not expired yet'
      };
    }

    const beforeState = this.hashState(marginSubchannel);

    // Calculate final P&L
    const priceDiff = settlementPrice - params.entryPrice;
    const finalPnL = priceDiff * params.contracts * params.contractSize / 1000000n;

    // Determine final margin distribution
    let longFinal: bigint;
    let shortFinal: bigint;

    if (finalPnL > 0n) {
      // Long profits
      const maxProfit = position.shortMargin;
      const profit = finalPnL > maxProfit ? maxProfit : finalPnL;
      longFinal = position.longMargin + profit;
      shortFinal = position.shortMargin - profit;
    } else {
      // Short profits
      const maxProfit = position.longMargin;
      const profit = -finalPnL > maxProfit ? maxProfit : -finalPnL;
      shortFinal = position.shortMargin + profit;
      longFinal = position.longMargin - profit;
    }

    const longIsLeft = params.long === 'left';

    if (params.settlementType === 'cash') {
      // Cash settlement - just transfer margins
      if (longIsLeft) {
        marginSubchannel.leftAllowence -= position.longMargin;
        marginSubchannel.rightAllowence -= position.shortMargin;
        marginSubchannel.offdelta += longFinal - shortFinal;
      } else {
        marginSubchannel.rightAllowence -= position.longMargin;
        marginSubchannel.leftAllowence -= position.shortMargin;
        marginSubchannel.offdelta -= longFinal - shortFinal;
      }
    } else {
      // Physical delivery
      if (!underlyingSubchannel) {
        return {
          success: false,
          error: 'Physical delivery requires underlying subchannel'
        };
      }

      // Unlock margins
      if (longIsLeft) {
        marginSubchannel.leftAllowence -= position.longMargin;
        marginSubchannel.rightAllowence -= position.shortMargin;
      } else {
        marginSubchannel.rightAllowence -= position.longMargin;
        marginSubchannel.leftAllowence -= position.shortMargin;
      }

      // Transfer underlying from short to long
      const deliveryAmount = params.contracts * params.contractSize;
      if (longIsLeft) {
        underlyingSubchannel.offdelta += deliveryAmount; // Long receives
      } else {
        underlyingSubchannel.offdelta -= deliveryAmount; // Long receives (right gets)
      }

      // Long pays settlement price to short
      const paymentAmount = settlementPrice * params.contracts * params.contractSize / 1000000n;
      if (longIsLeft) {
        marginSubchannel.offdelta -= paymentAmount; // Long pays
      } else {
        marginSubchannel.offdelta += paymentAmount; // Long pays (right pays = left gains)
      }
    }

    // Update position
    position.status = 'settled';
    position.settledAt = Date.now();
    position.settlementPrice = settlementPrice;
    position.realizedPnL = finalPnL;

    const afterState = this.hashState(marginSubchannel);

    // Create proof
    const proof: FuturesProof = {
      futuresId,
      operation: 'settle',
      beforeState,
      afterState,
      timestamp: Date.now(),
      details: {
        settlementPrice: settlementPrice.toString(),
        settlementType: params.settlementType,
        finalPnL: finalPnL.toString(),
        longFinal: longFinal.toString(),
        shortFinal: shortFinal.toString()
      }
    };

    return {
      success: true,
      position,
      proof
    };
  }

  /**
   * Calculate liquidation price for a position
   */
  private static calculateLiquidationPrice(params: FuturesParams, longPosition: boolean): bigint {
    // Liquidation occurs when margin ratio falls to maintenance level
    // For long: Price = Entry - (Margin - Maintenance) / Contracts
    // For short: Price = Entry + (Margin - Maintenance) / Contracts

    const maintenanceRequired = params.entryPrice * params.contracts * params.contractSize *
                               BigInt(params.maintenanceMarginRate) / 10000000n;

    const initialMargin = params.entryPrice * params.contracts * params.contractSize *
                         BigInt(params.initialMarginRate) / 10000000n;

    const buffer = initialMargin - maintenanceRequired;
    const bufferPerContract = buffer * 1000000n / (params.contracts * params.contractSize);

    if (longPosition) {
      return params.entryPrice - bufferPerContract;
    } else {
      return params.entryPrice + bufferPerContract;
    }
  }

  /**
   * Calculate current margin ratio
   */
  private static calculateMarginRatio(position: FuturesPosition, isLong: boolean): number {
    const margin = isLong ? position.longMargin : position.shortMargin;
    const notionalValue = position.lastMarkPrice * position.params.contracts *
                         position.params.contractSize / 1000000n;

    if (notionalValue === 0n) return 0;

    return Number(margin * 10000n / notionalValue);
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

    let outCollateral = delta > 0n ? (delta > collateral ? collateral : delta) : 0n;
    let outPeerCredit = nonNegative(delta - collateral);
    if (outPeerCredit > peerCreditLimit) outPeerCredit = peerCreditLimit;

    let inOwnCredit = nonNegative(-delta);
    if (inOwnCredit > ownCreditLimit) inOwnCredit = ownCreditLimit;
    let outOwnCredit = nonNegative(ownCreditLimit - inOwnCredit);

    let outAllowence = isLeft ? subchannel.leftAllowence : subchannel.rightAllowence;
    let outCapacity = nonNegative(outPeerCredit + outCollateral + outOwnCredit - outAllowence);

    return { outCapacity };
  }

  /**
   * Hash state for proofs
   */
  private static hashState(subchannel: Subchannel): string {
    const encoded = encode([
      subchannel.tokenId,
      subchannel.ondelta.toString(),
      subchannel.offdelta.toString(),
      subchannel.collateral.toString(),
      subchannel.leftAllowence.toString(),
      subchannel.rightAllowence.toString()
    ]);

    return '0x' + createHash('sha256').update(encoded).digest('hex');
  }
}