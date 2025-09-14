/**
 * LiquidityPoolTransformer: Bilateral AMM pools within channels
 *
 * Revolutionary approach - AMMs without global pools:
 * 1. Each channel can host multiple liquidity curves
 * 2. Constant product, stableswap, concentrated liquidity
 * 3. LP tokens represent bilateral pool shares
 * 4. Impermanent loss tracking per position
 * 5. Multi-asset pools (weighted like Balancer)
 *
 * This is NOT a global DEX - it's bilateral liquidity provision
 */

import { Subchannel } from '../../old_src/types/Subchannel.js';
import { createHash } from 'crypto';
import { encode } from 'rlp';

export type CurveType = 'constant_product' | 'stableswap' | 'concentrated' | 'weighted';

export interface PoolParams {
  poolId: string;
  curveType: CurveType;

  // Tokens in the pool
  tokenIds: number[];
  weights?: number[]; // For weighted pools (must sum to 100)

  // Curve parameters
  amplificationFactor?: number; // For stableswap (e.g., 100)
  tickLower?: number; // For concentrated liquidity
  tickUpper?: number; // For concentrated liquidity
  currentTick?: number; // Current price tick

  // Fee configuration (basis points, e.g., 30 = 0.3%)
  swapFee: number;
  protocolFee: number; // Part of swap fee that goes to protocol

  // LP token configuration
  lpTokenId: number; // Token ID for LP shares
  totalSupply: bigint; // Total LP tokens minted
}

export interface PoolState {
  poolId: string;
  params: PoolParams;
  status: 'active' | 'paused' | 'deprecated';

  // Reserves for each token
  reserves: Map<number, bigint>;

  // Liquidity tracking
  constantProduct?: bigint; // k value for x*y=k
  sqrtPriceX96?: bigint; // For Uniswap V3 style
  liquidity?: bigint; // Active liquidity in current tick

  // Metrics
  totalVolume: Map<number, bigint>;
  totalFees: Map<number, bigint>;
  lastUpdate: number;

  // LP positions
  lpPositions: Map<string, LPPosition>; // LP holder -> position
}

export interface LPPosition {
  holder: 'left' | 'right';
  lpTokens: bigint;
  depositedAmounts: Map<number, bigint>; // Original deposits
  depositTime: number;
  impermanentLoss?: bigint; // Calculated on withdrawal
  claimedFees: bigint;
}

export interface SwapRoute {
  tokenIn: number;
  tokenOut: number;
  amountIn: bigint;
  expectedOut: bigint;
  priceImpact: number; // Percentage * 100
  fee: bigint;
}

export interface PoolResult {
  success: boolean;
  poolState?: PoolState;
  swapRoute?: SwapRoute;
  lpPosition?: LPPosition;
  proof?: PoolProof;
  error?: string;
}

export interface PoolProof {
  poolId: string;
  operation: 'create' | 'deposit' | 'withdraw' | 'swap';
  beforeState: string;
  afterState: string;
  timestamp: number;
  details?: any;
}

export class LiquidityPoolTransformer {
  // Store pools per channel
  private static pools: Map<string, Map<string, PoolState>> = new Map();

  /**
   * Create a new liquidity pool
   */
  static createPool(
    channelKey: string,
    subchannels: Subchannel[],
    params: PoolParams
  ): PoolResult {
    // Validate parameters
    if (params.tokenIds.length < 2) {
      return {
        success: false,
        error: 'Pool must have at least 2 tokens'
      };
    }

    if (params.curveType === 'weighted' && !params.weights) {
      return {
        success: false,
        error: 'Weighted pools require weights array'
      };
    }

    if (params.weights && params.weights.reduce((a, b) => a + b, 0) !== 100) {
      return {
        success: false,
        error: 'Weights must sum to 100'
      };
    }

    // Get or create pools map
    if (!this.pools.has(channelKey)) {
      this.pools.set(channelKey, new Map());
    }
    const channelPools = this.pools.get(channelKey)!;

    if (channelPools.has(params.poolId)) {
      return {
        success: false,
        error: 'Pool with this ID already exists'
      };
    }

    // Initialize pool state
    const poolState: PoolState = {
      poolId: params.poolId,
      params,
      status: 'active',
      reserves: new Map(),
      totalVolume: new Map(),
      totalFees: new Map(),
      lastUpdate: Date.now(),
      lpPositions: new Map()
    };

    // Initialize reserves and metrics
    for (const tokenId of params.tokenIds) {
      poolState.reserves.set(tokenId, 0n);
      poolState.totalVolume.set(tokenId, 0n);
      poolState.totalFees.set(tokenId, 0n);
    }

    // Store pool
    channelPools.set(params.poolId, poolState);

    const proof: PoolProof = {
      poolId: params.poolId,
      operation: 'create',
      beforeState: '0x0',
      afterState: this.hashPoolState(poolState),
      timestamp: Date.now(),
      details: {
        curveType: params.curveType,
        tokens: params.tokenIds,
        fee: params.swapFee
      }
    };

    return {
      success: true,
      poolState,
      proof
    };
  }

  /**
   * Add liquidity to pool
   */
  static addLiquidity(
    channelKey: string,
    subchannels: Subchannel[],
    poolId: string,
    provider: 'left' | 'right',
    amounts: Map<number, bigint>
  ): PoolResult {
    const channelPools = this.pools.get(channelKey);
    if (!channelPools) {
      return {
        success: false,
        error: 'No pools for this channel'
      };
    }

    const poolState = channelPools.get(poolId);
    if (!poolState) {
      return {
        success: false,
        error: 'Pool not found'
      };
    }

    if (poolState.status !== 'active') {
      return {
        success: false,
        error: `Pool is ${poolState.status}`
      };
    }

    const beforeState = this.hashPoolState(poolState);
    const params = poolState.params;
    const providerIsLeft = provider === 'left';

    // Validate amounts for all tokens
    for (const tokenId of params.tokenIds) {
      if (!amounts.has(tokenId) || amounts.get(tokenId)! <= 0n) {
        return {
          success: false,
          error: `Must provide positive amount for token ${tokenId}`
        };
      }

      // Find subchannel and check capacity
      const subchannel = subchannels.find(s => s.tokenId === tokenId);
      if (!subchannel) {
        return {
          success: false,
          error: `Subchannel not found for token ${tokenId}`
        };
      }

      const capacity = this.calculateCapacity(subchannel, providerIsLeft);
      if (amounts.get(tokenId)! > capacity.outCapacity) {
        return {
          success: false,
          error: `Insufficient balance for token ${tokenId}`
        };
      }
    }

    // Calculate LP tokens to mint
    let lpTokensToMint: bigint;
    const firstDeposit = poolState.params.totalSupply === 0n;

    if (firstDeposit) {
      // First deposit - mint based on geometric mean
      lpTokensToMint = this.calculateInitialLP(amounts, params);
      poolState.params.totalSupply = lpTokensToMint;

      // Initialize curve parameters
      if (params.curveType === 'constant_product') {
        const tokens = Array.from(amounts.values());
        poolState.constantProduct = tokens.reduce((a, b) => a * b, 1n);
      }
    } else {
      // Subsequent deposits - maintain ratios
      const currentRatios = this.calculateRatios(poolState);
      const depositRatios = this.calculateDepositRatios(amounts, poolState);

      // Check if ratios match (within 1% tolerance)
      if (!this.ratiosMatch(currentRatios, depositRatios)) {
        return {
          success: false,
          error: 'Deposit amounts must match current pool ratios'
        };
      }

      // Mint proportional LP tokens
      const shareOfPool = amounts.get(params.tokenIds[0])! * 1000000n /
                         poolState.reserves.get(params.tokenIds[0])!;
      lpTokensToMint = poolState.params.totalSupply * shareOfPool / 1000000n;
      poolState.params.totalSupply += lpTokensToMint;
    }

    // Transfer tokens from provider to pool
    for (const [tokenId, amount] of amounts) {
      const subchannel = subchannels.find(s => s.tokenId === tokenId)!;

      // Lock tokens in pool
      if (providerIsLeft) {
        subchannel.leftAllowence += amount;
      } else {
        subchannel.rightAllowence += amount;
      }

      // Update reserves
      const currentReserve = poolState.reserves.get(tokenId) || 0n;
      poolState.reserves.set(tokenId, currentReserve + amount);
    }

    // Update constant product if applicable
    if (params.curveType === 'constant_product') {
      const tokens = Array.from(poolState.reserves.values());
      poolState.constantProduct = tokens.reduce((a, b) => a * b, 1n);
    }

    // Create or update LP position
    const positionKey = provider;
    let position = poolState.lpPositions.get(positionKey);

    if (!position) {
      position = {
        holder: provider,
        lpTokens: lpTokensToMint,
        depositedAmounts: new Map(amounts),
        depositTime: Date.now(),
        claimedFees: 0n
      };
      poolState.lpPositions.set(positionKey, position);
    } else {
      position.lpTokens += lpTokensToMint;
      for (const [tokenId, amount] of amounts) {
        const current = position.depositedAmounts.get(tokenId) || 0n;
        position.depositedAmounts.set(tokenId, current + amount);
      }
    }

    // Mint LP tokens to provider
    const lpSubchannel = subchannels.find(s => s.tokenId === params.lpTokenId);
    if (lpSubchannel) {
      if (providerIsLeft) {
        lpSubchannel.offdelta += lpTokensToMint;
      } else {
        lpSubchannel.offdelta -= lpTokensToMint;
      }
    }

    poolState.lastUpdate = Date.now();
    const afterState = this.hashPoolState(poolState);

    const proof: PoolProof = {
      poolId,
      operation: 'deposit',
      beforeState,
      afterState,
      timestamp: Date.now(),
      details: {
        provider,
        amounts: Object.fromEntries(amounts),
        lpTokensMinted: lpTokensToMint.toString()
      }
    };

    return {
      success: true,
      poolState,
      lpPosition: position,
      proof
    };
  }

  /**
   * Swap tokens through the pool
   */
  static swap(
    channelKey: string,
    subchannels: Subchannel[],
    poolId: string,
    trader: 'left' | 'right',
    tokenIn: number,
    tokenOut: number,
    amountIn: bigint,
    minAmountOut?: bigint
  ): PoolResult {
    const channelPools = this.pools.get(channelKey);
    if (!channelPools) {
      return {
        success: false,
        error: 'No pools for this channel'
      };
    }

    const poolState = channelPools.get(poolId);
    if (!poolState) {
      return {
        success: false,
        error: 'Pool not found'
      };
    }

    if (poolState.status !== 'active') {
      return {
        success: false,
        error: `Pool is ${poolState.status}`
      };
    }

    // Validate tokens are in pool
    if (!poolState.params.tokenIds.includes(tokenIn) ||
        !poolState.params.tokenIds.includes(tokenOut)) {
      return {
        success: false,
        error: 'Invalid token pair for this pool'
      };
    }

    const beforeState = this.hashPoolState(poolState);
    const params = poolState.params;
    const traderIsLeft = trader === 'left';

    // Calculate swap output
    const reserveIn = poolState.reserves.get(tokenIn)!;
    const reserveOut = poolState.reserves.get(tokenOut)!;

    if (reserveIn === 0n || reserveOut === 0n) {
      return {
        success: false,
        error: 'Insufficient liquidity'
      };
    }

    // Apply fee
    const feeAmount = amountIn * BigInt(params.swapFee) / 10000n;
    const amountInAfterFee = amountIn - feeAmount;

    // Calculate output based on curve type
    let amountOut: bigint;

    if (params.curveType === 'constant_product') {
      // x * y = k formula
      const k = poolState.constantProduct!;
      const newReserveIn = reserveIn + amountInAfterFee;
      const newReserveOut = k / newReserveIn;
      amountOut = reserveOut - newReserveOut;
    } else if (params.curveType === 'stableswap') {
      // Stableswap formula (simplified)
      amountOut = this.calculateStableswapOutput(
        reserveIn,
        reserveOut,
        amountInAfterFee,
        params.amplificationFactor || 100
      );
    } else if (params.curveType === 'weighted') {
      // Weighted pool formula
      const weightIn = params.weights![params.tokenIds.indexOf(tokenIn)];
      const weightOut = params.weights![params.tokenIds.indexOf(tokenOut)];
      amountOut = this.calculateWeightedOutput(
        reserveIn,
        reserveOut,
        amountInAfterFee,
        weightIn,
        weightOut
      );
    } else {
      // Concentrated liquidity
      amountOut = this.calculateConcentratedOutput(
        poolState,
        tokenIn,
        tokenOut,
        amountInAfterFee
      );
    }

    // Check slippage protection
    if (minAmountOut && amountOut < minAmountOut) {
      return {
        success: false,
        error: `Insufficient output: ${amountOut} < ${minAmountOut}`
      };
    }

    // Calculate price impact
    const priceImpact = this.calculatePriceImpact(
      reserveIn,
      reserveOut,
      amountIn,
      amountOut
    );

    // Execute swap
    const inSubchannel = subchannels.find(s => s.tokenId === tokenIn)!;
    const outSubchannel = subchannels.find(s => s.tokenId === tokenOut)!;

    // Check trader has sufficient balance
    const inCapacity = this.calculateCapacity(inSubchannel, traderIsLeft);
    if (amountIn > inCapacity.outCapacity) {
      return {
        success: false,
        error: 'Insufficient balance for swap'
      };
    }

    // Transfer tokens
    if (traderIsLeft) {
      inSubchannel.offdelta -= amountIn; // Left sends tokenIn
      outSubchannel.offdelta += amountOut; // Left receives tokenOut
    } else {
      inSubchannel.offdelta += amountIn; // Right sends tokenIn (left gains)
      outSubchannel.offdelta -= amountOut; // Right receives tokenOut (left loses)
    }

    // Update reserves
    poolState.reserves.set(tokenIn, reserveIn + amountIn);
    poolState.reserves.set(tokenOut, reserveOut - amountOut);

    // Update constant product
    if (params.curveType === 'constant_product') {
      const tokens = Array.from(poolState.reserves.values());
      poolState.constantProduct = tokens.reduce((a, b) => a * b, 1n);
    }

    // Track fees and volume
    const currentFees = poolState.totalFees.get(tokenIn) || 0n;
    poolState.totalFees.set(tokenIn, currentFees + feeAmount);

    const currentVolumeIn = poolState.totalVolume.get(tokenIn) || 0n;
    poolState.totalVolume.set(tokenIn, currentVolumeIn + amountIn);

    const currentVolumeOut = poolState.totalVolume.get(tokenOut) || 0n;
    poolState.totalVolume.set(tokenOut, currentVolumeOut + amountOut);

    // Distribute protocol fee
    if (params.protocolFee > 0) {
      const protocolFeeAmount = feeAmount * BigInt(params.protocolFee) / BigInt(params.swapFee);
      // In production, this would go to a protocol address
    }

    poolState.lastUpdate = Date.now();
    const afterState = this.hashPoolState(poolState);

    const swapRoute: SwapRoute = {
      tokenIn,
      tokenOut,
      amountIn,
      expectedOut: amountOut,
      priceImpact,
      fee: feeAmount
    };

    const proof: PoolProof = {
      poolId,
      operation: 'swap',
      beforeState,
      afterState,
      timestamp: Date.now(),
      details: {
        trader,
        swapRoute
      }
    };

    return {
      success: true,
      poolState,
      swapRoute,
      proof
    };
  }

  /**
   * Remove liquidity from pool
   */
  static removeLiquidity(
    channelKey: string,
    subchannels: Subchannel[],
    poolId: string,
    provider: 'left' | 'right',
    lpTokenAmount: bigint
  ): PoolResult {
    const channelPools = this.pools.get(channelKey);
    if (!channelPools) {
      return {
        success: false,
        error: 'No pools for this channel'
      };
    }

    const poolState = channelPools.get(poolId);
    if (!poolState) {
      return {
        success: false,
        error: 'Pool not found'
      };
    }

    const position = poolState.lpPositions.get(provider);
    if (!position) {
      return {
        success: false,
        error: 'No LP position found'
      };
    }

    if (lpTokenAmount > position.lpTokens) {
      return {
        success: false,
        error: 'Insufficient LP tokens'
      };
    }

    const beforeState = this.hashPoolState(poolState);
    const params = poolState.params;
    const providerIsLeft = provider === 'left';

    // Calculate share of pool
    const shareOfPool = lpTokenAmount * 1000000n / params.totalSupply;

    // Calculate amounts to return
    const amountsOut = new Map<number, bigint>();
    for (const tokenId of params.tokenIds) {
      const reserve = poolState.reserves.get(tokenId)!;
      const amountOut = reserve * shareOfPool / 1000000n;
      amountsOut.set(tokenId, amountOut);

      // Update reserves
      poolState.reserves.set(tokenId, reserve - amountOut);
    }

    // Calculate impermanent loss
    const impermanentLoss = this.calculateImpermanentLoss(
      position.depositedAmounts,
      amountsOut,
      shareOfPool
    );

    // Transfer tokens back to provider
    for (const [tokenId, amount] of amountsOut) {
      const subchannel = subchannels.find(s => s.tokenId === tokenId)!;

      // Unlock tokens from pool
      if (providerIsLeft) {
        subchannel.leftAllowence -= amount;
        subchannel.offdelta += amount; // Provider receives
      } else {
        subchannel.rightAllowence -= amount;
        subchannel.offdelta -= amount; // Provider receives (right gets)
      }
    }

    // Burn LP tokens
    const lpSubchannel = subchannels.find(s => s.tokenId === params.lpTokenId);
    if (lpSubchannel) {
      if (providerIsLeft) {
        lpSubchannel.offdelta -= lpTokenAmount;
      } else {
        lpSubchannel.offdelta += lpTokenAmount;
      }
    }

    // Update LP position
    position.lpTokens -= lpTokenAmount;
    position.impermanentLoss = impermanentLoss;

    // Update total supply
    params.totalSupply -= lpTokenAmount;

    // Update constant product
    if (params.curveType === 'constant_product' && params.totalSupply > 0n) {
      const tokens = Array.from(poolState.reserves.values());
      poolState.constantProduct = tokens.reduce((a, b) => a * b, 1n);
    }

    poolState.lastUpdate = Date.now();
    const afterState = this.hashPoolState(poolState);

    const proof: PoolProof = {
      poolId,
      operation: 'withdraw',
      beforeState,
      afterState,
      timestamp: Date.now(),
      details: {
        provider,
        lpTokensBurned: lpTokenAmount.toString(),
        amountsOut: Object.fromEntries(amountsOut),
        impermanentLoss: impermanentLoss.toString()
      }
    };

    return {
      success: true,
      poolState,
      lpPosition: position,
      proof
    };
  }

  /**
   * Calculate initial LP tokens for first deposit
   */
  private static calculateInitialLP(amounts: Map<number, bigint>, params: PoolParams): bigint {
    // Geometric mean of amounts
    const values = Array.from(amounts.values());
    let product = 1n;
    for (const value of values) {
      product *= value;
    }

    // Approximate nth root using Newton's method
    const n = BigInt(values.length);
    let x = product / n;
    for (let i = 0; i < 10; i++) {
      x = ((n - 1n) * x + product / (x ** (n - 1n))) / n;
    }

    return x * 1000000n; // Scale up for precision
  }

  /**
   * Calculate pool ratios
   */
  private static calculateRatios(poolState: PoolState): Map<number, number> {
    const ratios = new Map<number, number>();
    const baseToken = poolState.params.tokenIds[0];
    const baseReserve = poolState.reserves.get(baseToken)!;

    for (const tokenId of poolState.params.tokenIds) {
      const reserve = poolState.reserves.get(tokenId)!;
      const ratio = Number(reserve * 1000000n / baseReserve) / 1000000;
      ratios.set(tokenId, ratio);
    }

    return ratios;
  }

  /**
   * Calculate deposit ratios
   */
  private static calculateDepositRatios(
    amounts: Map<number, bigint>,
    poolState: PoolState
  ): Map<number, number> {
    const ratios = new Map<number, number>();
    const baseToken = poolState.params.tokenIds[0];
    const baseAmount = amounts.get(baseToken)!;

    for (const tokenId of poolState.params.tokenIds) {
      const amount = amounts.get(tokenId)!;
      const ratio = Number(amount * 1000000n / baseAmount) / 1000000;
      ratios.set(tokenId, ratio);
    }

    return ratios;
  }

  /**
   * Check if ratios match within tolerance
   */
  private static ratiosMatch(
    current: Map<number, number>,
    deposit: Map<number, number>
  ): boolean {
    for (const [tokenId, currentRatio] of current) {
      const depositRatio = deposit.get(tokenId)!;
      const deviation = Math.abs(currentRatio - depositRatio) / currentRatio;
      if (deviation > 0.01) return false; // 1% tolerance
    }
    return true;
  }

  /**
   * Calculate stableswap output
   */
  private static calculateStableswapOutput(
    reserveIn: bigint,
    reserveOut: bigint,
    amountIn: bigint,
    amp: number
  ): bigint {
    // Simplified stableswap formula
    // In production, use full Curve formula
    const sum = reserveIn + reserveOut;
    const product = reserveIn * reserveOut;
    const ampBig = BigInt(amp);

    const newReserveIn = reserveIn + amountIn;
    const invariant = ampBig * sum + product / sum;
    const newReserveOut = invariant * sum / (ampBig * sum + newReserveIn);

    return reserveOut - newReserveOut;
  }

  /**
   * Calculate weighted pool output
   */
  private static calculateWeightedOutput(
    reserveIn: bigint,
    reserveOut: bigint,
    amountIn: bigint,
    weightIn: number,
    weightOut: number
  ): bigint {
    // Balancer weighted pool formula
    const ratio = Number(amountIn) / Number(reserveIn);
    const exponent = weightIn / weightOut;
    const factor = Math.pow(1 + ratio, exponent) - 1;

    return BigInt(Math.floor(Number(reserveOut) * factor));
  }

  /**
   * Calculate concentrated liquidity output
   */
  private static calculateConcentratedOutput(
    poolState: PoolState,
    tokenIn: number,
    tokenOut: number,
    amountIn: bigint
  ): bigint {
    // Simplified Uniswap V3 formula
    // In production, implement full tick math
    const params = poolState.params;
    const currentTick = params.currentTick || 0;
    const tickLower = params.tickLower || -887272;
    const tickUpper = params.tickUpper || 887272;

    if (currentTick < tickLower || currentTick > tickUpper) {
      return 0n; // No liquidity in range
    }

    // Use constant product within tick range
    const reserveIn = poolState.reserves.get(tokenIn)!;
    const reserveOut = poolState.reserves.get(tokenOut)!;
    const k = reserveIn * reserveOut;
    const newReserveIn = reserveIn + amountIn;
    const newReserveOut = k / newReserveIn;

    return reserveOut - newReserveOut;
  }

  /**
   * Calculate price impact
   */
  private static calculatePriceImpact(
    reserveIn: bigint,
    reserveOut: bigint,
    amountIn: bigint,
    amountOut: bigint
  ): number {
    const spotPrice = Number(reserveOut) / Number(reserveIn);
    const executionPrice = Number(amountOut) / Number(amountIn);
    const impact = Math.abs(spotPrice - executionPrice) / spotPrice;

    return Math.floor(impact * 10000); // Basis points
  }

  /**
   * Calculate impermanent loss
   */
  private static calculateImpermanentLoss(
    deposited: Map<number, bigint>,
    withdrawn: Map<number, bigint>,
    shareOfPool: bigint
  ): bigint {
    // Calculate value if held vs value withdrawn
    let valueIfHeld = 0n;
    let valueWithdrawn = 0n;

    for (const [tokenId, depositAmount] of deposited) {
      const proportionalDeposit = depositAmount * shareOfPool / 1000000n;
      const withdrawnAmount = withdrawn.get(tokenId) || 0n;

      // Assume 1:1 price for simplicity (in production, use oracle prices)
      valueIfHeld += proportionalDeposit;
      valueWithdrawn += withdrawnAmount;
    }

    const loss = valueIfHeld > valueWithdrawn ? valueIfHeld - valueWithdrawn : 0n;
    return loss;
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
   * Hash pool state for proofs
   */
  private static hashPoolState(poolState: PoolState): string {
    const reserves = Array.from(poolState.reserves.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => [k, v.toString()]);

    const encoded = encode([
      poolState.poolId,
      poolState.status,
      reserves,
      poolState.params.totalSupply.toString(),
      poolState.lastUpdate
    ]);

    return '0x' + createHash('sha256').update(encoded).digest('hex');
  }
}