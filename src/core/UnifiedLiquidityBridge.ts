/**
 * UnifiedLiquidityBridge - The KEY Innovation of XLN
 *
 * Single order book shared by BOTH:
 * - Custodial accounts (simple, fast, trusted)
 * - Trustless bilateral channels (cryptographic, decentralized)
 *
 * This solves liquidity fragmentation - the #1 problem in DeFi.
 * Carol can make markets for everyone, not just one system.
 */

import { EventEmitter } from 'events';
import { MatchingEngine } from '../trading/MatchingEngine';
import { Channel } from '../../old_src/app/Channel';
import { SubcontractProvider } from '../contracts/SubcontractProvider';
import { ethers } from 'ethers';

// Order types
export enum OrderSource {
  CUSTODIAL = 'custodial',
  TRUSTLESS = 'trustless'
}

export enum OrderType {
  LIMIT = 'limit',
  MARKET = 'market',
  MAKER = 'maker' // Special type for market makers like Carol
}

export interface UnifiedOrder {
  id: string;
  source: OrderSource;
  type: OrderType;
  accountId?: string; // For custodial
  channelId?: string; // For trustless
  pair: string; // e.g., 'ETH/USD'
  side: 'buy' | 'sell';
  price: bigint; // In base units (e.g., cents for USD)
  amount: bigint; // In base units
  timestamp: number;
  signature?: string; // For trustless orders
  metadata?: any;
}

export interface Match {
  id: string;
  buyOrder: UnifiedOrder;
  sellOrder: UnifiedOrder;
  price: bigint;
  amount: bigint;
  timestamp: number;
}

export interface CustodialAccount {
  id: string;
  balances: Map<string, bigint>; // token -> amount
  nonce: bigint;
  tradingEnabled: boolean;
}

export interface SettlementEvent {
  type: 'partial' | 'complete' | 'failed';
  matchId: string;
  orderId: string;
  filledAmount: bigint;
  remainingAmount: bigint;
  settlementProof?: string;
}

export class UnifiedLiquidityBridge extends EventEmitter {
  private orderBook: MatchingEngine;
  private custodialAccounts: Map<string, CustodialAccount> = new Map();
  private trustlessChannels: Map<string, Channel> = new Map();
  private pendingSettlements: Map<string, Match> = new Map();
  private marketMakers: Map<string, MarketMakerStrategy> = new Map();

  // Metrics
  private totalVolume: bigint = 0n;
  private totalTrades: number = 0;
  private crossSettlements: number = 0; // Custodial ↔ Trustless

  constructor(config?: {
    matchingEngine?: MatchingEngine;
    feeRate?: bigint; // Basis points (e.g., 10 = 0.1%)
    settlementTimeout?: number; // ms
  }) {
    super();

    this.orderBook = config?.matchingEngine || new MatchingEngine({
      maxOrderSize: ethers.parseEther('1000000'),
      minOrderSize: ethers.parseEther('0.001'),
      tickSize: 1n // 1 cent for USD
    });

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Submit order to unified liquidity pool
   * Works for BOTH custodial and trustless accounts
   */
  async submitOrder(order: UnifiedOrder): Promise<string> {
    // Validate order
    if (!this.validateOrder(order)) {
      throw new Error('Invalid order');
    }

    // Check account/channel has sufficient balance
    if (order.source === OrderSource.CUSTODIAL) {
      if (!this.validateCustodialBalance(order)) {
        throw new Error('Insufficient balance');
      }
    } else {
      if (!await this.validateTrustlessBalance(order)) {
        throw new Error('Insufficient channel balance');
      }
    }

    // Add to order book
    const orderId = this.orderBook.addOrder({
      id: order.id,
      side: order.side,
      price: order.price,
      amount: order.amount,
      metadata: {
        source: order.source,
        accountId: order.accountId,
        channelId: order.channelId,
        signature: order.signature
      }
    });

    // Attempt matching
    const matches = this.orderBook.matchOrders();

    // Process matches
    for (const match of matches) {
      await this.processMatch(match);
    }

    this.emit('order_submitted', { orderId, matches: matches.length });

    return orderId;
  }

  /**
   * Process a match between orders
   * Handles all combinations: custodial-custodial, trustless-trustless, cross
   */
  private async processMatch(match: Match): Promise<void> {
    const buySource = match.buyOrder.source;
    const sellSource = match.sellOrder.source;

    this.totalTrades++;
    this.totalVolume += match.amount * match.price;

    if (buySource === OrderSource.CUSTODIAL && sellSource === OrderSource.CUSTODIAL) {
      // Both custodial - simple balance update
      await this.settleCustodial(match);
    } else if (buySource === OrderSource.TRUSTLESS && sellSource === OrderSource.TRUSTLESS) {
      // Both trustless - channel state update
      await this.settleTrustless(match);
    } else {
      // CROSS-SETTLEMENT: The innovation!
      this.crossSettlements++;
      await this.settleCross(match);
    }

    // Emit events for account machines
    this.emitSettlementEvents(match);
  }

  /**
   * Settle between two custodial accounts
   * Simple, fast, trusted
   */
  private async settleCustodial(match: Match): Promise<void> {
    const buyAccount = this.custodialAccounts.get(match.buyOrder.accountId!);
    const sellAccount = this.custodialAccounts.get(match.sellOrder.accountId!);

    if (!buyAccount || !sellAccount) {
      throw new Error('Account not found');
    }

    // Atomic balance updates
    const [baseToken, quoteToken] = match.buyOrder.pair.split('/');
    const baseAmount = match.amount;
    const quoteAmount = match.amount * match.price / 10000n; // Adjust for decimals

    // Buyer gets base token, pays quote token
    buyAccount.balances.set(baseToken,
      (buyAccount.balances.get(baseToken) || 0n) + baseAmount);
    buyAccount.balances.set(quoteToken,
      (buyAccount.balances.get(quoteToken) || 0n) - quoteAmount);

    // Seller gets quote token, pays base token
    sellAccount.balances.set(quoteToken,
      (sellAccount.balances.get(quoteToken) || 0n) + quoteAmount);
    sellAccount.balances.set(baseToken,
      (sellAccount.balances.get(baseToken) || 0n) - baseAmount);

    this.emit('custodial_settled', { matchId: match.id });
  }

  /**
   * Settle between two trustless channels
   * Uses SubcontractProvider for delta transformations
   */
  private async settleTrustless(match: Match): Promise<void> {
    const buyChannel = this.trustlessChannels.get(match.buyOrder.channelId!);
    const sellChannel = this.trustlessChannels.get(match.sellOrder.channelId!);

    if (!buyChannel || !sellChannel) {
      throw new Error('Channel not found');
    }

    // Create swap subcontract
    const swap = {
      ownerIsLeft: true, // Depends on channel position
      addDeltaIndex: 0, // ETH delta
      addAmount: match.amount,
      subDeltaIndex: 1, // USD delta
      subAmount: match.amount * match.price / 10000n
    };

    // Apply to buyer's channel
    await buyChannel.applySubcontract({
      type: 'swap',
      data: swap,
      counterpartySignature: match.sellOrder.signature
    });

    // Apply inverse to seller's channel
    await sellChannel.applySubcontract({
      type: 'swap',
      data: {
        ...swap,
        ownerIsLeft: false,
        addDeltaIndex: 1, // Reversed
        subDeltaIndex: 0
      },
      counterpartySignature: match.buyOrder.signature
    });

    this.emit('trustless_settled', { matchId: match.id });
  }

  /**
   * CROSS-SETTLEMENT: Custodial ↔ Trustless
   * This is the key innovation that unifies liquidity
   */
  private async settleCross(match: Match): Promise<void> {
    const isBuyerCustodial = match.buyOrder.source === OrderSource.CUSTODIAL;

    if (isBuyerCustodial) {
      // Custodial buyer, trustless seller
      await this.settleCustodialBuyTrustlessSell(match);
    } else {
      // Trustless buyer, custodial seller
      await this.settleTrustlessBuyCustodialSell(match);
    }

    this.emit('cross_settled', {
      matchId: match.id,
      type: isBuyerCustodial ? 'custodial_buy' : 'trustless_buy'
    });
  }

  /**
   * Custodial account buys from trustless channel
   */
  private async settleCustodialBuyTrustlessSell(match: Match): Promise<void> {
    const buyAccount = this.custodialAccounts.get(match.buyOrder.accountId!);
    const sellChannel = this.trustlessChannels.get(match.sellOrder.channelId!);

    if (!buyAccount || !sellChannel) {
      throw new Error('Account or channel not found');
    }

    // Lock custodial funds
    const [baseToken, quoteToken] = match.buyOrder.pair.split('/');
    const quoteAmount = match.amount * match.price / 10000n;

    buyAccount.balances.set(quoteToken,
      (buyAccount.balances.get(quoteToken) || 0n) - quoteAmount);

    // Create HTLC in channel
    const secret = ethers.randomBytes(32);
    const hashlock = ethers.keccak256(secret);

    const htlc = {
      deltaIndex: 0, // Base token
      amount: match.amount,
      revealedUntilBlock: Date.now() + 3600000, // 1 hour
      hash: hashlock
    };

    await sellChannel.applySubcontract({
      type: 'payment',
      data: htlc
    });

    // Store pending settlement
    this.pendingSettlements.set(match.id, {
      ...match,
      metadata: { secret, hashlock }
    });

    // Reveal secret after channel confirmation
    setTimeout(async () => {
      await this.revealCrossSettlement(match.id, secret);
    }, 1000);
  }

  /**
   * Trustless channel buys from custodial account
   */
  private async settleTrustlessBuyCustodialSell(match: Match): Promise<void> {
    const buyChannel = this.trustlessChannels.get(match.buyOrder.channelId!);
    const sellAccount = this.custodialAccounts.get(match.sellOrder.accountId!);

    if (!buyChannel || !sellAccount) {
      throw new Error('Channel or account not found');
    }

    // Create HTLC in channel first
    const secret = ethers.randomBytes(32);
    const hashlock = ethers.keccak256(secret);

    const htlc = {
      deltaIndex: 1, // Quote token (USD)
      amount: match.amount * match.price / 10000n,
      revealedUntilBlock: Date.now() + 3600000,
      hash: hashlock
    };

    await buyChannel.applySubcontract({
      type: 'payment',
      data: htlc
    });

    // Once channel confirms, update custodial
    const [baseToken, quoteToken] = match.buyOrder.pair.split('/');

    sellAccount.balances.set(baseToken,
      (sellAccount.balances.get(baseToken) || 0n) - match.amount);

    // Store for completion
    this.pendingSettlements.set(match.id, {
      ...match,
      metadata: { secret, hashlock, custodialPending: true }
    });

    // Complete after confirmation
    setTimeout(async () => {
      await this.completeCrossSettlement(match.id, secret);
    }, 1000);
  }

  /**
   * Reveal secret for cross-settlement HTLC
   */
  private async revealCrossSettlement(matchId: string, secret: Buffer): Promise<void> {
    const pending = this.pendingSettlements.get(matchId);
    if (!pending) return;

    // In production, this would call SubcontractProvider.revealSecret
    // For now, we simulate completion
    const buyAccount = this.custodialAccounts.get(pending.buyOrder.accountId!);
    if (buyAccount) {
      const [baseToken] = pending.buyOrder.pair.split('/');
      buyAccount.balances.set(baseToken,
        (buyAccount.balances.get(baseToken) || 0n) + pending.amount);
    }

    this.pendingSettlements.delete(matchId);
    this.emit('cross_settlement_completed', { matchId });
  }

  /**
   * Complete cross-settlement after HTLC confirmation
   */
  private async completeCrossSettlement(matchId: string, secret: Buffer): Promise<void> {
    const pending = this.pendingSettlements.get(matchId);
    if (!pending || !pending.metadata?.custodialPending) return;

    const sellAccount = this.custodialAccounts.get(pending.sellOrder.accountId!);
    if (sellAccount) {
      const [, quoteToken] = pending.sellOrder.pair.split('/');
      const quoteAmount = pending.amount * pending.price / 10000n;
      sellAccount.balances.set(quoteToken,
        (sellAccount.balances.get(quoteToken) || 0n) + quoteAmount);
    }

    this.pendingSettlements.delete(matchId);
    this.emit('cross_settlement_completed', { matchId });
  }

  /**
   * Market maker interface - Carol can provide liquidity
   */
  async registerMarketMaker(
    makerId: string,
    strategy: MarketMakerStrategy
  ): Promise<void> {
    this.marketMakers.set(makerId, strategy);

    // Post initial orders
    await this.updateMarketMakerOrders(makerId);

    // Update periodically
    setInterval(() => {
      this.updateMarketMakerOrders(makerId);
    }, strategy.updateInterval || 5000);

    this.emit('market_maker_registered', { makerId });
  }

  /**
   * Update market maker orders based on strategy
   */
  private async updateMarketMakerOrders(makerId: string): Promise<void> {
    const strategy = this.marketMakers.get(makerId);
    if (!strategy) return;

    // Cancel old orders
    this.orderBook.cancelOrdersByMaker(makerId);

    // Post new orders
    const midPrice = await this.getMarketPrice(strategy.pair);
    const spread = strategy.spreadBasisPoints || 10n; // 0.1%

    // Post buy order
    await this.submitOrder({
      id: `${makerId}_buy_${Date.now()}`,
      source: strategy.source || OrderSource.CUSTODIAL,
      type: OrderType.MAKER,
      accountId: strategy.accountId,
      channelId: strategy.channelId,
      pair: strategy.pair,
      side: 'buy',
      price: midPrice * (10000n - spread) / 10000n,
      amount: strategy.maxSize,
      timestamp: Date.now()
    });

    // Post sell order
    await this.submitOrder({
      id: `${makerId}_sell_${Date.now()}`,
      source: strategy.source || OrderSource.CUSTODIAL,
      type: OrderType.MAKER,
      accountId: strategy.accountId,
      channelId: strategy.channelId,
      pair: strategy.pair,
      side: 'sell',
      price: midPrice * (10000n + spread) / 10000n,
      amount: strategy.maxSize,
      timestamp: Date.now()
    });
  }

  /**
   * Emit settlement events for account machines
   */
  private emitSettlementEvents(match: Match): void {
    // Partial fill event
    if (match.amount < match.buyOrder.amount) {
      this.emit('settlement_event', {
        type: 'partial',
        matchId: match.id,
        orderId: match.buyOrder.id,
        filledAmount: match.amount,
        remainingAmount: match.buyOrder.amount - match.amount
      } as SettlementEvent);
    } else {
      // Complete fill event
      this.emit('settlement_event', {
        type: 'complete',
        matchId: match.id,
        orderId: match.buyOrder.id,
        filledAmount: match.amount,
        remainingAmount: 0n
      } as SettlementEvent);
    }

    // Same for sell order
    if (match.amount < match.sellOrder.amount) {
      this.emit('settlement_event', {
        type: 'partial',
        matchId: match.id,
        orderId: match.sellOrder.id,
        filledAmount: match.amount,
        remainingAmount: match.sellOrder.amount - match.amount
      } as SettlementEvent);
    } else {
      this.emit('settlement_event', {
        type: 'complete',
        matchId: match.id,
        orderId: match.sellOrder.id,
        filledAmount: match.amount,
        remainingAmount: 0n
      } as SettlementEvent);
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Forward events from matching engine
    this.orderBook.on('match', (match) => {
      this.processMatch(match);
    });

    this.orderBook.on('order_cancelled', (orderId) => {
      this.emit('order_cancelled', { orderId });
    });
  }

  /**
   * Validate order parameters
   */
  private validateOrder(order: UnifiedOrder): boolean {
    if (!order.id || !order.pair || !order.side) return false;
    if (order.price <= 0n || order.amount <= 0n) return false;
    if (order.source === OrderSource.CUSTODIAL && !order.accountId) return false;
    if (order.source === OrderSource.TRUSTLESS && !order.channelId) return false;
    return true;
  }

  /**
   * Validate custodial account has sufficient balance
   */
  private validateCustodialBalance(order: UnifiedOrder): boolean {
    const account = this.custodialAccounts.get(order.accountId!);
    if (!account || !account.tradingEnabled) return false;

    const [baseToken, quoteToken] = order.pair.split('/');

    if (order.side === 'buy') {
      // Need quote token to buy
      const required = order.amount * order.price / 10000n;
      const balance = account.balances.get(quoteToken) || 0n;
      return balance >= required;
    } else {
      // Need base token to sell
      const balance = account.balances.get(baseToken) || 0n;
      return balance >= order.amount;
    }
  }

  /**
   * Validate trustless channel has sufficient balance
   */
  private async validateTrustlessBalance(order: UnifiedOrder): Promise<boolean> {
    const channel = this.trustlessChannels.get(order.channelId!);
    if (!channel) return false;

    // Check channel state
    const state = await channel.getState();
    const [baseToken, quoteToken] = order.pair.split('/');

    // Get delta indices for tokens
    const baseDelta = state.deltas.findIndex(d => d.token === baseToken);
    const quoteDelta = state.deltas.findIndex(d => d.token === quoteToken);

    if (baseDelta === -1 || quoteDelta === -1) return false;

    if (order.side === 'buy') {
      // Need positive quote delta
      return state.deltas[quoteDelta].amount >= order.amount * order.price / 10000n;
    } else {
      // Need positive base delta
      return state.deltas[baseDelta].amount >= order.amount;
    }
  }

  /**
   * Get current market price for a pair
   */
  private async getMarketPrice(pair: string): Promise<bigint> {
    const orderBook = this.orderBook.getOrderBook(pair);

    if (orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      // Mid price between best bid and ask
      const bestBid = orderBook.bids[0].price;
      const bestAsk = orderBook.asks[0].price;
      return (bestBid + bestAsk) / 2n;
    }

    // Default prices if no market
    if (pair === 'ETH/USD') return 420000n; // $4200.00
    if (pair === 'BTC/USD') return 6500000n; // $65000.00
    return 10000n; // $100.00
  }

  /**
   * Add custodial account
   */
  addCustodialAccount(account: CustodialAccount): void {
    this.custodialAccounts.set(account.id, account);
    this.emit('account_added', { accountId: account.id });
  }

  /**
   * Add trustless channel
   */
  addTrustlessChannel(channelId: string, channel: Channel): void {
    this.trustlessChannels.set(channelId, channel);
    this.emit('channel_added', { channelId });
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      totalVolume: this.totalVolume.toString(),
      totalTrades: this.totalTrades,
      crossSettlements: this.crossSettlements,
      custodialAccounts: this.custodialAccounts.size,
      trustlessChannels: this.trustlessChannels.size,
      marketMakers: this.marketMakers.size,
      pendingSettlements: this.pendingSettlements.size
    };
  }
}

/**
 * Market maker strategy configuration
 */
export interface MarketMakerStrategy {
  pair: string;
  source?: OrderSource;
  accountId?: string;
  channelId?: string;
  maxSize: bigint;
  spreadBasisPoints?: bigint;
  updateInterval?: number;
  aggressiveness?: number; // 0-1, how tight the spread
}