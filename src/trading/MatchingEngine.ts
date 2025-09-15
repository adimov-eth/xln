/**
 * MatchingEngine - Production-ready trading engine for XLN
 *
 * This combines order books with trade credit to create the complete
 * B2B value movement system. Zero fees, progressive trust, bilateral sovereignty.
 *
 * The REAL implementation that connects to XLN's J/E/A architecture.
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { OptimizedOrderBook, Order, Trade } from './OptimizedOrderBook';
import { OptimizedTradeCredit, Invoice, CreditLine } from './OptimizedTradeCredit';

export interface MatchingEngineConfig {
  // Order book settings
  supportedPairs: Array<{ base: string, quote: string }>;
  defaultSpreadSplit: { maker: number, taker: number, hub: number };

  // Fee configuration
  makerFeeRate: number; // Negative values mean rebates (e.g., -0.01 for 1bp rebate)
  takerFeeRate: number; // Positive values are fees (e.g., 0.05 for 5bp fee)

  // Trade credit settings
  enableTradeCredit: boolean;
  defaultCreditTerms: 'NET15' | 'NET30' | 'NET60' | 'NET90';
  maxCreditExposure: bigint;

  // Risk management
  maxOrderValue: bigint;
  maxDailyVolume: bigint;
  circuitBreakerThreshold: number; // Percentage price move to halt

  // Order expiry
  defaultOrderTTL: number; // Default order time-to-live in milliseconds
  maxOrderTTL: number; // Maximum allowed TTL

  // Network settings
  hubId: string;
  networkId: string;
  congestionPricing: boolean;

  // Wash trading protection
  enableWashTradingProtection: boolean;
  maxSelfTradingRatio: number; // Max percentage of trades that can be self-trades
}

export interface MarketData {
  pair: string;
  lastPrice: bigint;
  volume24h: bigint;
  high24h: bigint;
  low24h: bigint;
  spread: bigint;
  depth: {
    bids: Array<{ price: bigint, amount: bigint }>;
    asks: Array<{ price: bigint, amount: bigint }>;
  };
}

export interface TradingSession {
  sessionId: string;
  entityId: string;
  startTime: number;
  orders: string[]; // Order IDs
  trades: string[]; // Trade IDs
  invoices: string[]; // Invoice IDs
  pnl: bigint;
  status: 'active' | 'closed' | 'suspended';
  // Fill tracking
  totalFilled: bigint;
  totalFees: bigint;
  makerRebates: bigint;
  // TWAP calculation
  vwapNumerator: bigint; // Sum of (price * volume)
  vwapDenominator: bigint; // Sum of volumes
  twapSum: bigint; // Time-weighted price sum
  twapTimeSum: number; // Total time for TWAP calculation
  lastTradeTime: number;
  // Statistics
  selfTradeCount: number;
  totalTradeCount: number;
}

// Enhanced Order interface with expiry and fill tracking
export interface EnhancedOrder extends Order {
  expiryTime?: number; // Unix timestamp when order expires
  fillRatio: number; // filled / amount (0.0 to 1.0)
  partialFills: Array<{
    amount: bigint;
    price: bigint;
    timestamp: number;
    tradeId: string;
  }>;
  isExpired: boolean;
  lastUpdateTime: number;
}

// Enhanced Trade interface with maker/taker identification and fees
export interface EnhancedTrade extends Trade {
  makerOrderId: string;
  takerOrderId: string;
  makerFee: bigint; // Negative for rebates
  takerFee: bigint;
  isSelfTrade: boolean;
  liquidityType: 'maker' | 'taker';
  // TWAP contribution
  twapWeight: number;
}

// Event interfaces for type-safe event emission
export interface OrderPlacedEvent {
  order: EnhancedOrder;
  pair: string;
  sessionId: string;
}

export interface OrderPartiallyFilledEvent {
  orderId: string;
  fillAmount: bigint;
  fillPrice: bigint;
  newFillRatio: number;
  tradeId: string;
  pair: string;
}

export interface OrderFilledEvent {
  orderId: string;
  totalFillAmount: bigint;
  averageFillPrice: bigint;
  finalTradeId: string;
  pair: string;
}

export interface OrderCancelledEvent {
  orderId: string;
  reason: 'user_cancelled' | 'expired' | 'system_cancelled';
  remainingAmount: bigint;
  pair: string;
}

export interface OrderExpiredEvent {
  orderId: string;
  expiryTime: number;
  remainingAmount: bigint;
  pair: string;
}

export interface TradeExecutedEvent {
  trade: EnhancedTrade;
  pair: string;
  makerSession?: string;
  takerSession?: string;
}

// Constants
const DEFAULT_MAX_ORDER = ethers.parseEther('100000'); // $100k
const DEFAULT_MAX_DAILY = ethers.parseEther('10000000'); // $10M
const CIRCUIT_BREAKER_THRESHOLD = 10; // 10% price move
const DEFAULT_ORDER_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ORDER_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAKER_FEE = -0.01; // 1bp rebate for makers
const DEFAULT_TAKER_FEE = 0.05; // 5bp fee for takers
const MAX_SELF_TRADING_RATIO = 0.05; // Max 5% self-trading

export class MatchingEngine extends EventEmitter {
  private orderBooks: Map<string, OptimizedOrderBook> = new Map();
  private tradeCredit: OptimizedTradeCredit;
  private sessions: Map<string, TradingSession> = new Map();

  // Enhanced order tracking
  private orders: Map<string, EnhancedOrder> = new Map();
  private expiredOrders: Set<string> = new Set();
  private orderExpiryTimer: NodeJS.Timeout;

  // Market data tracking
  private marketData: Map<string, MarketData> = new Map();
  private dailyVolume: Map<string, bigint> = new Map();
  private lastResetTime: number = Date.now();

  // Circuit breaker state
  private haltedPairs: Set<string> = new Set();
  private priceHistory: Map<string, bigint[]> = new Map();

  // TWAP tracking
  private twapData: Map<string, {
    priceSum: bigint;
    timeSum: number;
    lastUpdate: number;
    currentPrice: bigint;
  }> = new Map();

  // Wash trading protection
  private selfTradeStats: Map<string, {
    totalTrades: number;
    selfTrades: number;
  }> = new Map();

  // Metrics
  private totalTrades = 0;
  private totalVolume = 0n;
  private totalSpreadCaptured = 0n;
  private totalMakerRebates = 0n;
  private totalTakerFees = 0n;

  constructor(
    private config: MatchingEngineConfig
  ) {
    super(); // Initialize EventEmitter
    // Validate hub ID
    if (!ethers.isAddress(config.hubId)) {
      throw new Error(`Invalid hub ID: ${config.hubId}`);
    }

    // Set default fee rates if not provided
    if (config.makerFeeRate === undefined) config.makerFeeRate = DEFAULT_MAKER_FEE;
    if (config.takerFeeRate === undefined) config.takerFeeRate = DEFAULT_TAKER_FEE;
    if (config.defaultOrderTTL === undefined) config.defaultOrderTTL = DEFAULT_ORDER_TTL;
    if (config.maxOrderTTL === undefined) config.maxOrderTTL = MAX_ORDER_TTL;
    if (config.enableWashTradingProtection === undefined) config.enableWashTradingProtection = true;
    if (config.maxSelfTradingRatio === undefined) config.maxSelfTradingRatio = MAX_SELF_TRADING_RATIO;

    // Initialize order books for each pair
    for (const pair of config.supportedPairs) {
      const pairKey = `${pair.base}/${pair.quote}`;
      const book = new OptimizedOrderBook(
        pair.base,
        pair.quote,
        {
          makerPercent: config.defaultSpreadSplit.maker,
          takerPercent: config.defaultSpreadSplit.taker,
          hubPercent: config.defaultSpreadSplit.hub,
          maxOrdersPerSide: 10000,
          minOrderAmount: ethers.parseEther('10'), // $10 min
          maxOrderAmount: config.maxOrderValue || DEFAULT_MAX_ORDER,
          maxPriceDeviation: 50
        }
      );

      this.orderBooks.set(pairKey, book);
      this.dailyVolume.set(pairKey, 0n);
      this.priceHistory.set(pairKey, []);

      // Initialize market data
      this.marketData.set(pairKey, {
        pair: pairKey,
        lastPrice: 0n,
        volume24h: 0n,
        high24h: 0n,
        low24h: 0n,
        spread: 0n,
        depth: { bids: [], asks: [] }
      });

      // Initialize TWAP data
      this.twapData.set(pairKey, {
        priceSum: 0n,
        timeSum: 0,
        lastUpdate: Date.now(),
        currentPrice: 0n
      });

      // Initialize self-trade stats
      this.selfTradeStats.set(pairKey, {
        totalTrades: 0,
        selfTrades: 0
      });
    }

    // Initialize trade credit if enabled
    if (config.enableTradeCredit) {
      this.tradeCredit = new OptimizedTradeCredit(config.hubId, {
        baseCurrency: 'USDC',
        defaultCollateralRatio: 20,
        maxCreditLines: 1000,
        trustScoreDecayDays: 90
      });
    }

    // Start periodic tasks
    this.startPeriodicTasks();

    // Start order expiry checking
    this.startOrderExpiryCheck();
  }

  /**
   * Create or resume a trading session
   */
  async startSession(entityId: string): Promise<TradingSession> {
    if (!ethers.isAddress(entityId)) {
      throw new Error(`Invalid entity ID: ${entityId}`);
    }

    // Check for existing session
    let session = this.sessions.get(entityId);
    if (session && session.status === 'active') {
      return session;
    }

    // Create new session
    session = {
      sessionId: `session-${entityId}-${Date.now()}`,
      entityId,
      startTime: Date.now(),
      orders: [],
      trades: [],
      invoices: [],
      pnl: 0n,
      status: 'active',
      totalFilled: 0n,
      totalFees: 0n,
      makerRebates: 0n,
      vwapNumerator: 0n,
      vwapDenominator: 0n,
      twapSum: 0n,
      twapTimeSum: 0,
      lastTradeTime: Date.now(),
      selfTradeCount: 0,
      totalTradeCount: 0
    };

    this.sessions.set(entityId, session);
    return session;
  }

  /**
   * Place an order with circuit breaker protection, fill ratio tracking, and event emission
   */
  async placeOrder(
    sessionId: string,
    pair: string,
    side: 'buy' | 'sell',
    orderType: 'limit' | 'market',
    price: bigint | null, // null for market orders
    amount: bigint,
    timeToLive?: number, // TTL in milliseconds
    options?: {
      postOnly?: boolean; // Only add liquidity, don't take
      reduceOnly?: boolean; // Only reduce position
      allowSelfTrade?: boolean; // Override wash trading protection
    }
  ): Promise<EnhancedOrder> {
    // Validate session
    const session = Array.from(this.sessions.values())
      .find(s => s.sessionId === sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('Invalid or inactive session');
    }

    // Check if pair is halted
    if (this.haltedPairs.has(pair)) {
      throw new Error(`Trading halted for ${pair} due to circuit breaker`);
    }

    // Get order book
    const book = this.orderBooks.get(pair);
    if (!book) {
      throw new Error(`Unsupported pair: ${pair}`);
    }

    // Validate TTL
    if (timeToLive && timeToLive > this.config.maxOrderTTL) {
      throw new Error(`Order TTL ${timeToLive}ms exceeds maximum ${this.config.maxOrderTTL}ms`);
    }

    const ttl = timeToLive || this.config.defaultOrderTTL;
    const expiryTime = Date.now() + ttl;

    // Check daily volume limit
    const currentVolume = this.dailyVolume.get(pair) || 0n;
    const orderValue = orderType === 'market'
      ? amount // Approximate for market orders
      : (price! * amount) / ethers.parseEther('1');

    if (currentVolume + orderValue > this.config.maxDailyVolume) {
      throw new Error('Daily volume limit exceeded');
    }

    // Check wash trading protection
    if (this.config.enableWashTradingProtection && !options?.allowSelfTrade) {
      const stats = this.selfTradeStats.get(pair);
      if (stats && stats.totalTrades > 100) { // Only check after sufficient trades
        const selfTradeRatio = stats.selfTrades / stats.totalTrades;
        if (selfTradeRatio > this.config.maxSelfTradingRatio) {
          throw new Error(`Self-trading ratio ${(selfTradeRatio * 100).toFixed(2)}% exceeds maximum ${(this.config.maxSelfTradingRatio * 100).toFixed(2)}%`);
        }
      }
    }

    // Handle market vs limit orders
    let baseOrder: Order;
    if (orderType === 'market') {
      if (!price) {
        // Calculate market price from book
        const bookState = book.getOrderBook();
        if (side === 'buy' && bookState.asks.length > 0) {
          // For market buy, use a price slightly higher than best ask to ensure crossing
          price = bookState.asks[0].price + ethers.parseEther('0.01');
        } else if (side === 'sell' && bookState.bids.length > 0) {
          // For market sell, use a price slightly lower than best bid to ensure crossing
          price = bookState.bids[0].price - ethers.parseEther('0.01');
        } else {
          throw new Error('No liquidity available for market order');
        }
      }
    } else {
      if (!price || price <= 0n) {
        throw new Error('Limit order requires valid price');
      }

      // Post-only orders shouldn't cross the spread
      if (options?.postOnly) {
        const bookState = book.getOrderBook();
        if (side === 'buy' && bookState.asks.length > 0 && price >= bookState.asks[0].price) {
          throw new Error('Post-only buy order would cross spread');
        }
        if (side === 'sell' && bookState.bids.length > 0 && price <= bookState.bids[0].price) {
          throw new Error('Post-only sell order would cross spread');
        }
      }
    }

    // Place the base order
    baseOrder = await book.addOrder(side, price!, amount, session.entityId);

    // Create enhanced order with additional tracking
    const enhancedOrder: EnhancedOrder = {
      ...baseOrder,
      expiryTime,
      fillRatio: 0,
      partialFills: [],
      isExpired: false,
      lastUpdateTime: Date.now()
    };

    // Store enhanced order
    this.orders.set(baseOrder.id, enhancedOrder);
    session.orders.push(baseOrder.id);

    // Emit order placed event
    this.emit('order_placed', {
      order: enhancedOrder,
      pair,
      sessionId
    } as OrderPlacedEvent);

    // Try to match immediately (unless post-only)
    let trades: EnhancedTrade[] = [];
    if (!options?.postOnly) {
      trades = await this.matchAndSettle(pair, baseOrder.id);
    }

    // Update session trades
    session.trades.push(...trades.map(t => t.id));

    // Update market data
    await this.updateMarketData(pair, trades);

    return enhancedOrder;
  }

  /**
   * Match orders and handle settlement with enhanced tracking
   */
  private async matchAndSettle(pair: string, triggeringOrderId?: string): Promise<EnhancedTrade[]> {
    const book = this.orderBooks.get(pair);
    if (!book) return [];

    // Match orders
    const baseTrades = await book.match();
    const enhancedTrades: EnhancedTrade[] = [];

    // Process each trade with enhanced features
    for (const trade of baseTrades) {
      const enhancedTrade = await this.processTradeEnhancements(pair, trade, triggeringOrderId);
      enhancedTrades.push(enhancedTrade);

      // Update order fill tracking
      await this.updateOrderFills(trade);

      // Update metrics
      this.totalTrades++;
      this.totalVolume += trade.amount;
      this.totalSpreadCaptured += trade.spread;

      // Update daily volume
      const currentVolume = this.dailyVolume.get(pair) || 0n;
      this.dailyVolume.set(pair, currentVolume + trade.amount);

      // Update TWAP
      this.updateTWAP(pair, trade.price, trade.amount, trade.timestamp);

      // Check circuit breaker
      await this.checkCircuitBreaker(pair, trade.price);

      // Emit trade event
      this.emit('trade_executed', {
        trade: enhancedTrade,
        pair,
        makerSession: this.getSessionForEntity(trade.buyOrder.maker),
        takerSession: this.getSessionForEntity(trade.sellOrder.maker)
      } as TradeExecutedEvent);
    }

    return enhancedTrades;
  }

  /**
   * Process trade enhancements - fees, maker/taker identification, etc.
   */
  private async processTradeEnhancements(
    pair: string,
    trade: Trade,
    triggeringOrderId?: string
  ): Promise<EnhancedTrade> {
    // Determine maker/taker
    const isTriggeredByBuy = triggeringOrderId === trade.buyOrder.id;
    const makerOrder = isTriggeredByBuy ? trade.sellOrder : trade.buyOrder;
    const takerOrder = isTriggeredByBuy ? trade.buyOrder : trade.sellOrder;

    // Check for self-trading
    const isSelfTrade = trade.buyOrder.maker === trade.sellOrder.maker;

    // Update self-trade statistics
    const stats = this.selfTradeStats.get(pair)!;
    stats.totalTrades++;
    if (isSelfTrade) {
      stats.selfTrades++;
    }

    // Calculate fees
    const tradeValue = (trade.price * trade.amount) / ethers.parseEther('1');
    const makerFee = (tradeValue * BigInt(Math.floor(this.config.makerFeeRate * 10000))) / 10000n;
    const takerFee = (tradeValue * BigInt(Math.floor(this.config.takerFeeRate * 10000))) / 10000n;

    // Update fee totals
    this.totalMakerRebates += makerFee < 0n ? -makerFee : 0n;
    this.totalTakerFees += takerFee;

    // Calculate TWAP weight (time since last trade)
    const twapWeight = this.calculateTWAPWeight(pair, trade.timestamp);

    return {
      ...trade,
      makerOrderId: makerOrder.id,
      takerOrderId: takerOrder.id,
      makerFee,
      takerFee,
      isSelfTrade,
      liquidityType: isTriggeredByBuy ? 'taker' : 'maker',
      twapWeight
    };
  }

  /**
   * Update order fill tracking and emit events
   */
  private async updateOrderFills(trade: Trade): Promise<void> {
    const buyOrder = this.orders.get(trade.buyOrder.id);
    const sellOrder = this.orders.get(trade.sellOrder.id);

    if (buyOrder) {
      this.updateSingleOrderFill(buyOrder, trade, 'buy');
    }
    if (sellOrder) {
      this.updateSingleOrderFill(sellOrder, trade, 'sell');
    }
  }

  private updateSingleOrderFill(order: EnhancedOrder, trade: Trade, side: 'buy' | 'sell'): void {
    const fillAmount = trade.amount;
    const fillPrice = trade.price;

    // Update fill tracking
    order.filled += fillAmount;
    order.fillRatio = Number(order.filled * 1000000n / order.amount) / 1000000; // 6 decimal precision
    order.lastUpdateTime = Date.now();

    // Add to partial fills history
    order.partialFills.push({
      amount: fillAmount,
      price: fillPrice,
      timestamp: trade.timestamp,
      tradeId: trade.id
    });

    // Emit appropriate events
    if (order.fillRatio >= 1.0) {
      // Order fully filled
      this.emit('order_filled', {
        orderId: order.id,
        totalFillAmount: order.filled,
        averageFillPrice: this.calculateAverageFillPrice(order),
        finalTradeId: trade.id,
        pair: `${order.side === 'buy' ? 'buy' : 'sell'}`
      } as OrderFilledEvent);
    } else {
      // Partial fill
      this.emit('order_partially_filled', {
        orderId: order.id,
        fillAmount,
        fillPrice,
        newFillRatio: order.fillRatio,
        tradeId: trade.id,
        pair: `${order.side === 'buy' ? 'buy' : 'sell'}`
      } as OrderPartiallyFilledEvent);
    }
  }

  /**
   * Calculate average fill price for an order
   */
  private calculateAverageFillPrice(order: EnhancedOrder): bigint {
    if (order.partialFills.length === 0) return 0n;

    let totalValue = 0n;
    let totalAmount = 0n;

    for (const fill of order.partialFills) {
      totalValue += (fill.price * fill.amount) / ethers.parseEther('1');
      totalAmount += fill.amount;
    }

    return totalAmount > 0n ? (totalValue * ethers.parseEther('1')) / totalAmount : 0n;
  }

  /**
   * Update TWAP calculation
   */
  private updateTWAP(pair: string, price: bigint, volume: bigint, timestamp: number): void {
    const twapData = this.twapData.get(pair)!;
    const timeDelta = timestamp - twapData.lastUpdate;

    // Add previous price's contribution to TWAP
    if (twapData.currentPrice > 0n && timeDelta > 0) {
      twapData.priceSum += twapData.currentPrice * BigInt(timeDelta);
      twapData.timeSum += timeDelta;
    }

    twapData.currentPrice = price;
    twapData.lastUpdate = timestamp;
  }

  /**
   * Calculate TWAP weight for trade
   */
  private calculateTWAPWeight(pair: string, timestamp: number): number {
    const twapData = this.twapData.get(pair)!;
    const timeDelta = timestamp - twapData.lastUpdate;
    return Math.min(timeDelta / 1000, 300); // Max 5 minute weight
  }

  /**
   * Get session ID for an entity
   */
  private getSessionForEntity(entityId: string): string | undefined {
    for (const session of this.sessions.values()) {
      if (session.entityId === entityId && session.status === 'active') {
        return session.sessionId;
      }
    }
    return undefined;
  }

  /**
   * Start order expiry checking
   */
  private startOrderExpiryCheck(): void {
    this.orderExpiryTimer = setInterval(() => {
      this.checkExpiredOrders();
    }, 1000); // Check every second
  }

  /**
   * Check for expired orders and handle them
   */
  private async checkExpiredOrders(): Promise<void> {
    const now = Date.now();
    const expiredOrderIds: string[] = [];

    for (const [orderId, order] of this.orders.entries()) {
      if (!order.isExpired && order.expiryTime && now >= order.expiryTime) {
        expiredOrderIds.push(orderId);
      }
    }

    // Process expired orders
    for (const orderId of expiredOrderIds) {
      await this.expireOrder(orderId);
    }
  }

  /**
   * Expire a specific order
   */
  private async expireOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order || order.isExpired) return;

    order.isExpired = true;
    this.expiredOrders.add(orderId);

    // Cancel the order in all order books
    for (const book of this.orderBooks.values()) {
      await book.cancelOrder(orderId);
    }

    // Emit expiry event
    this.emit('order_expired', {
      orderId,
      expiryTime: order.expiryTime!,
      remainingAmount: order.amount - order.filled,
      pair: 'unknown' // Would need to track pair per order
    } as OrderExpiredEvent);
  }

  /**
   * Check and trigger circuit breaker if needed
   */
  private async checkCircuitBreaker(pair: string, newPrice: bigint): Promise<void> {
    const history = this.priceHistory.get(pair) || [];
    history.push(newPrice);

    // Keep last 100 prices
    if (history.length > 100) {
      history.shift();
    }

    if (history.length >= 2) {
      const oldPrice = history[history.length - 10] || history[0];
      const priceChange = ((newPrice - oldPrice) * 100n) / oldPrice;
      const absChange = priceChange < 0n ? -priceChange : priceChange;

      if (absChange > BigInt(this.config.circuitBreakerThreshold || CIRCUIT_BREAKER_THRESHOLD)) {
        this.haltedPairs.add(pair);

        // Auto-resume after 5 minutes
        setTimeout(() => {
          this.haltedPairs.delete(pair);
        }, 5 * 60 * 1000);

        console.warn(`Circuit breaker triggered for ${pair}: ${absChange}% price move`);
      }
    }
  }

  /**
   * Create invoice for B2B trade credit
   */
  async createInvoice(
    sessionId: string,
    counterparty: string,
    items: Array<{ description: string, quantity: number, unitPrice: bigint }>,
    terms?: 'NET15' | 'NET30' | 'NET60' | 'NET90'
  ): Promise<Invoice> {
    if (!this.config.enableTradeCredit) {
      throw new Error('Trade credit is not enabled');
    }

    const session = Array.from(this.sessions.values())
      .find(s => s.sessionId === sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('Invalid or inactive session');
    }

    // Convert items to required format
    const invoiceItems = items.map(item => ({
      ...item,
      total: item.unitPrice * BigInt(item.quantity)
    }));

    const invoice = await this.tradeCredit.createInvoice(
      counterparty,
      invoiceItems,
      terms || this.config.defaultCreditTerms
    );

    session.invoices.push(invoice.id);
    return invoice;
  }

  /**
   * Factor an invoice for immediate liquidity
   */
  async factorInvoice(
    sessionId: string,
    invoiceId: string,
    maxDiscount: number = 5
  ): Promise<{
    immediatePayment: bigint,
    receipt: string
  }> {
    if (!this.config.enableTradeCredit) {
      throw new Error('Trade credit is not enabled');
    }

    const session = Array.from(this.sessions.values())
      .find(s => s.sessionId === sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('Invalid or inactive session');
    }

    const result = await this.tradeCredit.factorInvoice(invoiceId, maxDiscount);

    // Add to session P&L
    session.pnl += result.immediatePayment;

    return {
      immediatePayment: result.immediatePayment,
      receipt: result.receipt
    };
  }

  /**
   * Establish credit line for progressive trust
   */
  async establishCreditLine(
    sessionId: string,
    counterparty: string,
    limit: bigint
  ): Promise<CreditLine> {
    if (!this.config.enableTradeCredit) {
      throw new Error('Trade credit is not enabled');
    }

    const session = Array.from(this.sessions.values())
      .find(s => s.sessionId === sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('Invalid or inactive session');
    }

    // Check exposure limits
    const summary = this.tradeCredit.getCreditSummary();
    if (summary.totalCreditExtended + limit > this.config.maxCreditExposure) {
      throw new Error('Credit exposure limit exceeded');
    }

    return this.tradeCredit.establishCreditLine(counterparty, limit);
  }

  /**
   * Update market data after trades
   */
  private async updateMarketData(pair: string, trades: Trade[]): Promise<void> {
    const data = this.marketData.get(pair);
    if (!data) return;

    const book = this.orderBooks.get(pair);
    if (!book) return;

    const bookState = book.getOrderBook();
    const depth = book.getDepth(5);

    // Update price data
    if (trades.length > 0) {
      const lastTrade = trades[trades.length - 1];
      data.lastPrice = lastTrade.price;

      // Update 24h high/low
      if (data.high24h === 0n || lastTrade.price > data.high24h) {
        data.high24h = lastTrade.price;
      }
      if (data.low24h === 0n || lastTrade.price < data.low24h) {
        data.low24h = lastTrade.price;
      }
    }

    // Update spread and depth
    data.spread = bookState.spread;
    data.depth = {
      bids: depth.bids.map(l => ({ price: l.price, amount: l.amount })),
      asks: depth.asks.map(l => ({ price: l.price, amount: l.amount }))
    };

    // Volume is updated in matchAndSettle
    data.volume24h = this.dailyVolume.get(pair) || 0n;
  }

  /**
   * Get market data for a pair
   */
  getMarketData(pair: string): MarketData | null {
    return this.marketData.get(pair) || null;
  }

  /**
   * Get all market data
   */
  getAllMarketData(): MarketData[] {
    return Array.from(this.marketData.values());
  }

  /**
   * Get enhanced engine statistics
   */
  getStats(): {
    totalTrades: number,
    totalVolume: bigint,
    totalSpreadCaptured: bigint,
    totalMakerRebates: bigint,
    totalTakerFees: bigint,
    activeSessions: number,
    haltedPairs: string[],
    activeOrders: number,
    expiredOrders: number,
    selfTradeStats: { [pair: string]: { ratio: number, count: number } },
    twapData: { [pair: string]: { twap: string, lastUpdate: number } },
    creditSummary?: any
  } {
    // Calculate self-trade statistics
    const selfTradeStats: { [pair: string]: { ratio: number, count: number } } = {};
    for (const [pair, stats] of this.selfTradeStats.entries()) {
      selfTradeStats[pair] = {
        ratio: stats.totalTrades > 0 ? stats.selfTrades / stats.totalTrades : 0,
        count: stats.selfTrades
      };
    }

    // Get TWAP data
    const twapData: { [pair: string]: { twap: string, lastUpdate: number } } = {};
    for (const pair of this.orderBooks.keys()) {
      const twap = this.getTWAP(pair);
      const data = this.twapData.get(pair)!;
      twapData[pair] = {
        twap: ethers.formatEther(twap),
        lastUpdate: data.lastUpdate
      };
    }

    const stats: any = {
      totalTrades: this.totalTrades,
      totalVolume: this.totalVolume,
      totalSpreadCaptured: this.totalSpreadCaptured,
      totalMakerRebates: this.totalMakerRebates,
      totalTakerFees: this.totalTakerFees,
      activeSessions: Array.from(this.sessions.values())
        .filter(s => s.status === 'active').length,
      haltedPairs: Array.from(this.haltedPairs),
      activeOrders: this.orders.size,
      expiredOrders: this.expiredOrders.size,
      selfTradeStats,
      twapData
    };

    if (this.config.enableTradeCredit) {
      stats.creditSummary = this.tradeCredit.getCreditSummary();
    }

    return stats;
  }

  /**
   * AMM-based congestion pricing for inter-hub routing
   */
  calculateCongestionFee(
    fromHub: string,
    toHub: string,
    amount: bigint,
    currentImbalance: bigint,
    creditLimit: bigint
  ): bigint {
    if (!this.config.congestionPricing) {
      return 0n;
    }

    // Calculate utilization after this payment
    const newImbalance = currentImbalance + amount;
    const utilization = (newImbalance * 100n) / creditLimit;

    // Congestion pricing: fee = α / (1 - u)²
    // Simplified to avoid complex math
    let feeRate = 0n;

    if (utilization < 50n) {
      feeRate = 0n; // Free when balanced
    } else if (utilization < 70n) {
      feeRate = 1n; // 0.01% = 1 basis point
    } else if (utilization < 85n) {
      feeRate = 10n; // 0.1% = 10 basis points
    } else if (utilization < 95n) {
      feeRate = 100n; // 1% = 100 basis points
    } else {
      feeRate = 1000n; // 10% = 1000 basis points (prohibitive)
    }

    return (amount * feeRate) / 10000n;
  }

  /**
   * Get TWAP for a trading pair
   */
  getTWAP(pair: string): bigint {
    const twapData = this.twapData.get(pair);
    if (!twapData || twapData.timeSum === 0) return 0n;

    const now = Date.now();
    let totalPriceTime = twapData.priceSum;
    let totalTime = twapData.timeSum;

    // Add current price contribution if we have a current price
    if (twapData.currentPrice > 0n) {
      const currentContribution = BigInt(now - twapData.lastUpdate);
      totalPriceTime += twapData.currentPrice * currentContribution;
      totalTime += (now - twapData.lastUpdate);
    }

    return totalTime > 0 ? totalPriceTime / BigInt(totalTime) : 0n;
  }

  /**
   * Get enhanced order by ID
   */
  getOrder(orderId: string): EnhancedOrder | null {
    return this.orders.get(orderId) || null;
  }

  /**
   * Cancel an order with proper event emission
   */
  async cancelOrder(orderId: string, reason: 'user_cancelled' | 'expired' | 'system_cancelled' = 'user_cancelled'): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) return false;

    // Cancel in order books
    let cancelled = false;
    for (const book of this.orderBooks.values()) {
      if (await book.cancelOrder(orderId)) {
        cancelled = true;
        break;
      }
    }

    if (cancelled) {
      // Emit cancellation event
      this.emit('order_cancelled', {
        orderId,
        reason,
        remainingAmount: order.amount - order.filled,
        pair: 'unknown' // Would need pair tracking per order
      } as OrderCancelledEvent);

      // Mark as cancelled in our tracking
      this.orders.delete(orderId);
    }

    return cancelled;
  }

  /**
   * Periodic tasks (volume reset, etc)
   */
  private startPeriodicTasks(): void {
    // Reset daily volume at midnight
    setInterval(() => {
      const now = Date.now();
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);

      if (now >= midnight.getTime() && now - this.lastResetTime > 23 * 60 * 60 * 1000) {
        for (const pair of this.dailyVolume.keys()) {
          this.dailyVolume.set(pair, 0n);
        }
        this.lastResetTime = now;
      }
    }, 60 * 1000); // Check every minute

    // Check overdue invoices
    if (this.config.enableTradeCredit) {
      setInterval(async () => {
        await this.tradeCredit.checkOverdueInvoices();
      }, 60 * 60 * 1000); // Check every hour
    }

    // Cleanup expired orders periodically
    setInterval(() => {
      const expiredIds = Array.from(this.expiredOrders);
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

      for (const orderId of expiredIds) {
        const order = this.orders.get(orderId);
        if (order && order.expiryTime && order.expiryTime < cutoff) {
          this.orders.delete(orderId);
          this.expiredOrders.delete(orderId);
        }
      }
    }, 60 * 60 * 1000); // Cleanup every hour
  }

  /**
   * Close a trading session
   */
  async closeSession(sessionId: string): Promise<TradingSession> {
    const session = Array.from(this.sessions.values())
      .find(s => s.sessionId === sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    // Cancel all open orders
    for (const orderId of session.orders) {
      for (const book of this.orderBooks.values()) {
        await book.cancelOrder(orderId);
      }
    }

    session.status = 'closed';
    return session;
  }

  /**
   * Emergency halt all trading
   */
  emergencyHalt(): void {
    for (const pair of this.orderBooks.keys()) {
      this.haltedPairs.add(pair);
    }

    for (const session of this.sessions.values()) {
      if (session.status === 'active') {
        session.status = 'suspended';
      }
    }

    console.error('EMERGENCY HALT: All trading suspended');
  }

  /**
   * Resume trading after halt
   */
  /**
   * Get order book state for a pair (maintained for backward compatibility)
   */
  getOrderBook(pair: string): { bids: Order[], asks: Order[] } {
    const book = this.orderBooks.get(pair);
    if (!book) {
      return { bids: [], asks: [] };
    }
    return book.getOrderBook();
  }

  resumeTrading(): void {
    this.haltedPairs.clear();

    for (const session of this.sessions.values()) {
      if (session.status === 'suspended') {
        session.status = 'active';
      }
    }

    console.log('Trading resumed');
  }

  /**
   * Get comprehensive session statistics
   */
  getSessionStats(sessionId: string): {
    session: TradingSession | null,
    vwap: bigint, // Volume-weighted average price
    twap: bigint, // Time-weighted average price
    fillRate: number, // Percentage of orders filled
    avgFillTime: number, // Average time to fill in ms
    makerTakerRatio: number, // Ratio of maker vs taker trades
    selfTradeRatio: number
  } {
    const session = Array.from(this.sessions.values())
      .find(s => s.sessionId === sessionId);

    if (!session) {
      return {
        session: null,
        vwap: 0n,
        twap: 0n,
        fillRate: 0,
        avgFillTime: 0,
        makerTakerRatio: 0,
        selfTradeRatio: 0
      };
    }

    // Calculate VWAP
    const vwap = session.vwapDenominator > 0n
      ? session.vwapNumerator / session.vwapDenominator
      : 0n;

    // Calculate TWAP
    const twap = session.twapTimeSum > 0
      ? session.twapSum / BigInt(session.twapTimeSum)
      : 0n;

    // Calculate fill rate (assuming we track filled orders)
    const totalOrders = session.orders.length;
    const filledOrders = Array.from(this.orders.values())
      .filter(o => session.orders.includes(o.id) && o.fillRatio >= 1.0).length;
    const fillRate = totalOrders > 0 ? filledOrders / totalOrders : 0;

    // Calculate average fill time (would need more tracking)
    const avgFillTime = 0; // Placeholder

    // Calculate maker/taker ratio (would need more tracking)
    const makerTakerRatio = 0; // Placeholder

    // Calculate self-trade ratio
    const selfTradeRatio = session.totalTradeCount > 0
      ? session.selfTradeCount / session.totalTradeCount
      : 0;

    return {
      session,
      vwap,
      twap,
      fillRate,
      avgFillTime,
      makerTakerRatio,
      selfTradeRatio
    };
  }

  /**
   * Get all active orders for a session
   */
  getSessionOrders(sessionId: string): EnhancedOrder[] {
    const session = Array.from(this.sessions.values())
      .find(s => s.sessionId === sessionId);

    if (!session) return [];

    return session.orders
      .map(orderId => this.orders.get(orderId))
      .filter((order): order is EnhancedOrder => order !== undefined && !order.isExpired);
  }

  /**
   * Get order fill history
   */
  getOrderFillHistory(orderId: string): Array<{
    amount: bigint;
    price: bigint;
    timestamp: number;
    tradeId: string;
  }> {
    const order = this.orders.get(orderId);
    return order ? order.partialFills : [];
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    // Clear timers
    if (this.orderExpiryTimer) {
      clearInterval(this.orderExpiryTimer);
    }

    // Cancel all active orders
    const activeOrderIds = Array.from(this.orders.keys())
      .filter(id => !this.expiredOrders.has(id));

    for (const orderId of activeOrderIds) {
      await this.cancelOrder(orderId, 'system_cancelled');
    }

    // Close all active sessions
    for (const session of this.sessions.values()) {
      if (session.status === 'active') {
        await this.closeSession(session.sessionId);
      }
    }

    // Remove all event listeners
    this.removeAllListeners();

    console.log('MatchingEngine shutdown complete');
  }

  /**
   * Get market depth with enhanced information
   */
  getEnhancedMarketDepth(pair: string, levels: number = 10): {
    bids: Array<{ price: bigint, amount: bigint, orders: number, avgAge: number }>,
    asks: Array<{ price: bigint, amount: bigint, orders: number, avgAge: number }>,
    spread: bigint | null,
    midPrice: bigint | null,
    imbalance: number // -1 to 1, negative means more sell pressure
  } {
    const book = this.orderBooks.get(pair);
    if (!book) {
      return {
        bids: [],
        asks: [],
        spread: null,
        midPrice: null,
        imbalance: 0
      };
    }

    const depth = book.getDepth(levels);
    const bookState = book.getOrderBook();

    // Enhance with age information
    const now = Date.now();
    const enhancedBids = depth.bids.map(level => ({
      ...level,
      avgAge: this.calculateLevelAverageAge(bookState.bids, level.price, now)
    }));

    const enhancedAsks = depth.asks.map(level => ({
      ...level,
      avgAge: this.calculateLevelAverageAge(bookState.asks, level.price, now)
    }));

    // Calculate imbalance
    const totalBidVolume = enhancedBids.reduce((sum, level) => sum + level.amount, 0n);
    const totalAskVolume = enhancedAsks.reduce((sum, level) => sum + level.amount, 0n);
    const totalVolume = totalBidVolume + totalAskVolume;
    const imbalance = totalVolume > 0n
      ? Number((totalBidVolume - totalAskVolume) * 1000n / totalVolume) / 1000
      : 0;

    return {
      bids: enhancedBids,
      asks: enhancedAsks,
      spread: bookState.spread,
      midPrice: bookState.midPrice,
      imbalance
    };
  }

  /**
   * Calculate average age of orders at a price level
   */
  private calculateLevelAverageAge(orders: readonly Order[], price: bigint, now: number): number {
    const ordersAtLevel = orders.filter(o => o.price === price);
    if (ordersAtLevel.length === 0) return 0;

    const totalAge = ordersAtLevel.reduce((sum, order) => sum + (now - order.timestamp), 0);
    return totalAge / ordersAtLevel.length;
  }
}