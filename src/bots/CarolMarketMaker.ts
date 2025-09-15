/**
 * CarolMarketMaker - Sophisticated Market Making Bot for XLN
 *
 * Carol is the backbone of XLN liquidity. She provides unified liquidity
 * to BOTH custodial accounts AND trustless channels through intelligent
 * market making strategies.
 *
 * Key Features:
 * - Grid trading with dynamic adjustment
 * - Cross-exchange arbitrage simulation
 * - Risk management with position limits
 * - Performance analytics and optimization
 * - Unified liquidity across custodial/trustless systems
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { UnifiedLiquidityBridge, OrderSource, OrderType, UnifiedOrder, CustodialAccount } from '../core/UnifiedLiquidityBridge';
import { MatchingEngine } from '../trading/MatchingEngine';

export interface CarolConfig {
  // Trading pairs to make markets for
  pairs: string[];

  // Capital allocation per pair (in quote token)
  capitalPerPair: bigint;

  // Risk management
  maxPositionSize: bigint;        // Max inventory per asset
  maxDailyDrawdown: number;       // Max % loss per day (0-1)
  gasThreshold: bigint;           // Don't trade if gas > this

  // Grid trading parameters
  gridLevels: number;             // Number of buy/sell levels
  baseSpread: number;             // Base spread in basis points (e.g., 20 = 0.2%)
  gridSpacing: number;            // Price spacing between levels (e.g., 50 = 0.5%)

  // Dynamic adjustment
  volatilityWindow: number;       // Minutes to calculate volatility
  minSpread: number;              // Minimum spread in basis points
  maxSpread: number;              // Maximum spread in basis points
  spreadMultiplier: number;       // How much to increase spread in volatile markets

  // Arbitrage detection
  enableArbitrage: boolean;
  arbThreshold: number;           // Minimum profit threshold for arb (basis points)
  maxArbSize: bigint;             // Max size for arbitrage orders

  // Rebalancing
  targetInventory: number;        // Target inventory ratio (0.5 = balanced)
  rebalanceThreshold: number;     // When to rebalance (0.2 = 20% from target)
  rebalanceSize: bigint;          // Size of rebalance orders

  // Performance optimization
  updateInterval: number;         // How often to update quotes (ms)
  metricsWindow: number;          // Rolling window for performance metrics (minutes)
}

export interface PositionMetrics {
  pair: string;
  baseInventory: bigint;
  quoteInventory: bigint;
  targetBase: bigint;
  targetQuote: bigint;
  imbalance: number;              // -1 to 1, negative = too much base
  unrealizedPnL: bigint;
  realizedPnL: bigint;
}

export interface PerformanceMetrics {
  totalPnL: bigint;
  dailyPnL: bigint;
  maxDrawdown: bigint;
  sharpeRatio: number;
  fillRate: number;               // % of orders that get filled
  inventoryTurnover: number;      // How often inventory turns over
  spreadCaptured: bigint;         // Total spread captured
  arbitragePnL: bigint;          // PnL from arbitrage trades

  // Per-pair metrics
  pairMetrics: Map<string, {
    volume24h: bigint;
    trades24h: number;
    avgSpread: number;
    pnl: bigint;
  }>;
}

export interface MarketData {
  pair: string;
  midPrice: bigint;
  bid: bigint;
  ask: bigint;
  spread: bigint;
  volatility: number;             // Rolling volatility (annualized %)
  volume1h: bigint;
  lastUpdate: number;
}

export interface GridLevel {
  side: 'buy' | 'sell';
  price: bigint;
  size: bigint;
  orderId?: string;
  filled: bigint;
}

/**
 * Carol's sophisticated market making brain
 */
export class CarolMarketMaker extends EventEmitter {
  private bridge: UnifiedLiquidityBridge;
  private config: CarolConfig;

  // State tracking
  private positions: Map<string, PositionMetrics> = new Map();
  private marketData: Map<string, MarketData> = new Map();
  private gridOrders: Map<string, GridLevel[]> = new Map();
  private priceHistory: Map<string, Array<{ price: bigint, timestamp: number }>> = new Map();

  // Performance tracking
  private startTime = Date.now();
  private tradeHistory: Array<{
    timestamp: number;
    pair: string;
    side: 'buy' | 'sell';
    price: bigint;
    size: bigint;
    pnl: bigint;
    type: 'market_making' | 'arbitrage' | 'rebalance';
  }> = [];

  // Risk management
  private dailyStartPnL = 0n;
  private dailyPeakPnL = 0n;
  private isHalted = false;
  private haltReason?: string;

  // Update intervals
  private updateTimer?: NodeJS.Timeout;
  private metricsTimer?: NodeJS.Timeout;
  private rebalanceTimer?: NodeJS.Timeout;

  constructor(
    bridge: UnifiedLiquidityBridge,
    config: CarolConfig
  ) {
    super();

    this.bridge = bridge;
    this.config = config;

    // Initialize positions for each pair
    for (const pair of config.pairs) {
      this.initializePair(pair);
    }

    // Setup event listeners
    this.setupEventListeners();

    // Daily reset timer
    this.scheduleDailyReset();
  }

  /**
   * Start Carol's market making activities
   */
  async start(): Promise<void> {
    console.log('🤖 Carol Market Maker starting...');

    // Initial market data fetch
    await this.updateAllMarketData();

    // Place initial grid orders
    for (const pair of this.config.pairs) {
      await this.updateGridOrders(pair);
    }

    // Start periodic updates
    this.updateTimer = setInterval(() => {
      this.periodicUpdate();
    }, this.config.updateInterval);

    // Start metrics calculation
    this.metricsTimer = setInterval(() => {
      this.calculateMetrics();
    }, 60000); // Every minute

    // Start rebalancing
    this.rebalanceTimer = setInterval(() => {
      this.checkRebalancing();
    }, 300000); // Every 5 minutes

    this.emit('started');
    console.log('✅ Carol is now making markets!');
  }

  /**
   * Stop Carol and cleanup
   */
  async stop(): Promise<void> {
    console.log('🛑 Carol Market Maker stopping...');

    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.rebalanceTimer) clearInterval(this.rebalanceTimer);

    // Cancel all open orders
    for (const pair of this.config.pairs) {
      await this.cancelAllOrders(pair);
    }

    this.emit('stopped');
    console.log('✅ Carol has stopped making markets');
  }

  /**
   * Emergency halt - stop all trading immediately
   */
  async emergencyHalt(reason: string): Promise<void> {
    console.error(`🚨 EMERGENCY HALT: ${reason}`);

    this.isHalted = true;
    this.haltReason = reason;

    // Cancel all orders
    for (const pair of this.config.pairs) {
      await this.cancelAllOrders(pair);
    }

    this.emit('emergency_halt', { reason });
  }

  /**
   * Resume trading after halt
   */
  async resume(): Promise<void> {
    if (!this.isHalted) return;

    console.log('🔄 Carol resuming trading...');
    this.isHalted = false;
    this.haltReason = undefined;

    // Restart grid orders
    for (const pair of this.config.pairs) {
      await this.updateGridOrders(pair);
    }

    this.emit('resumed');
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const totalPnL = this.calculateTotalPnL();
    const dailyPnL = totalPnL - this.dailyStartPnL;

    return {
      totalPnL,
      dailyPnL,
      maxDrawdown: this.calculateMaxDrawdown(),
      sharpeRatio: this.calculateSharpeRatio(),
      fillRate: this.calculateFillRate(),
      inventoryTurnover: this.calculateInventoryTurnover(),
      spreadCaptured: this.calculateSpreadCaptured(),
      arbitragePnL: this.calculateArbitragePnL(),
      pairMetrics: this.calculatePairMetrics()
    };
  }

  /**
   * Get current position information
   */
  getPositions(): PositionMetrics[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get current market data
   */
  getMarketData(): MarketData[] {
    return Array.from(this.marketData.values());
  }

  /**
   * Force update of grid orders for a pair
   */
  async updateGridOrders(pair: string): Promise<void> {
    if (this.isHalted) return;

    // Cancel existing orders
    await this.cancelAllOrders(pair);

    const market = this.marketData.get(pair);
    if (!market) {
      console.warn(`No market data for ${pair}`);
      return;
    }

    const position = this.positions.get(pair);
    if (!position) {
      console.warn(`No position data for ${pair}`);
      return;
    }

    // Calculate dynamic spread based on volatility
    const dynamicSpread = this.calculateDynamicSpread(pair);
    const gridSpacing = BigInt(Math.floor(this.config.gridSpacing * 100)); // Convert to basis points

    const newOrders: GridLevel[] = [];

    // Calculate order sizes based on available capital and inventory imbalance
    const baseOrderSize = this.config.capitalPerPair / BigInt(this.config.gridLevels * 2);

    // Generate buy orders (below mid price)
    for (let i = 1; i <= this.config.gridLevels; i++) {
      const spreadBps = dynamicSpread + (gridSpacing * BigInt(i - 1));
      const price = market.midPrice * (10000n - spreadBps) / 10000n;

      // Adjust size based on inventory imbalance
      let size = baseOrderSize;
      if (position.imbalance < -0.2) {
        // Too much base, reduce buy orders
        size = size / 2n;
      } else if (position.imbalance > 0.2) {
        // Too much quote, increase buy orders
        size = size * 3n / 2n;
      }

      const order: GridLevel = {
        side: 'buy',
        price,
        size,
        filled: 0n
      };

      newOrders.push(order);
    }

    // Generate sell orders (above mid price)
    for (let i = 1; i <= this.config.gridLevels; i++) {
      const spreadBps = dynamicSpread + (gridSpacing * BigInt(i - 1));
      const price = market.midPrice * (10000n + spreadBps) / 10000n;

      // Adjust size based on inventory imbalance
      let size = baseOrderSize;
      if (position.imbalance > 0.2) {
        // Too much quote, reduce sell orders
        size = size / 2n;
      } else if (position.imbalance < -0.2) {
        // Too much base, increase sell orders
        size = size * 3n / 2n;
      }

      const order: GridLevel = {
        side: 'sell',
        price,
        size,
        filled: 0n
      };

      newOrders.push(order);
    }

    // Submit orders to both custodial and trustless sources
    const submittedOrders: GridLevel[] = [];

    for (const order of newOrders) {
      try {
        // Submit to custodial first (faster execution)
        const orderId = await this.bridge.submitOrder({
          id: `carol_${pair}_${order.side}_${Date.now()}_${Math.random()}`,
          source: OrderSource.CUSTODIAL,
          type: OrderType.MAKER,
          accountId: 'carol_custodial',
          pair,
          side: order.side,
          price: order.price,
          amount: order.size / 2n, // Split order between sources
          timestamp: Date.now()
        });

        order.orderId = orderId;
        submittedOrders.push(order);

        // Also submit to trustless (for cross-settlement opportunities)
        if (Math.random() < 0.3) { // 30% chance to provide trustless liquidity
          await this.bridge.submitOrder({
            id: `carol_trustless_${pair}_${order.side}_${Date.now()}_${Math.random()}`,
            source: OrderSource.TRUSTLESS,
            type: OrderType.MAKER,
            channelId: 'carol_channel',
            pair,
            side: order.side,
            price: order.price,
            amount: order.size / 2n,
            timestamp: Date.now()
          });
        }

      } catch (error) {
        console.warn(`Failed to submit order for ${pair}:`, error);
      }
    }

    this.gridOrders.set(pair, submittedOrders);

    this.emit('grid_updated', {
      pair,
      orders: submittedOrders.length,
      spread: dynamicSpread
    });
  }

  /**
   * Calculate dynamic spread based on market conditions
   */
  private calculateDynamicSpread(pair: string): bigint {
    const market = this.marketData.get(pair);
    if (!market) return BigInt(this.config.baseSpread);

    // Base spread
    let spread = this.config.baseSpread;

    // Adjust for volatility
    if (market.volatility > 20) { // High volatility
      spread *= this.config.spreadMultiplier;
    } else if (market.volatility < 5) { // Low volatility
      spread *= 0.8; // Tighter spreads in calm markets
    }

    // Enforce min/max bounds
    spread = Math.max(spread, this.config.minSpread);
    spread = Math.min(spread, this.config.maxSpread);

    return BigInt(Math.floor(spread));
  }

  /**
   * Check for arbitrage opportunities
   */
  private async checkArbitrageOpportunities(): Promise<void> {
    if (!this.config.enableArbitrage) return;

    for (const pair of this.config.pairs) {
      const market = this.marketData.get(pair);
      if (!market) continue;

      // Simulate external exchange prices (in production, fetch from real exchanges)
      const externalMidPrice = this.simulateExternalPrice(pair, market.midPrice);
      const priceDiff = market.midPrice - externalMidPrice;
      const priceDiffBps = (priceDiff * 10000n) / externalMidPrice;

      const absThreshold = BigInt(this.config.arbThreshold);

      if (priceDiffBps > absThreshold) {
        // XLN price higher, sell on XLN, buy external
        await this.executeArbitrage(pair, 'sell', market.midPrice, externalMidPrice);
      } else if (-priceDiffBps > absThreshold) {
        // XLN price lower, buy on XLN, sell external
        await this.executeArbitrage(pair, 'buy', market.midPrice, externalMidPrice);
      }
    }
  }

  /**
   * Execute arbitrage trade
   */
  private async executeArbitrage(
    pair: string,
    side: 'buy' | 'sell',
    xlnPrice: bigint,
    externalPrice: bigint
  ): Promise<void> {
    const size = this.config.maxArbSize;

    try {
      // Place market order on XLN
      await this.bridge.submitOrder({
        id: `carol_arb_${pair}_${side}_${Date.now()}`,
        source: OrderSource.CUSTODIAL,
        type: OrderType.MARKET,
        accountId: 'carol_custodial',
        pair,
        side,
        price: side === 'buy' ? xlnPrice * 101n / 100n : xlnPrice * 99n / 100n, // 1% slippage tolerance
        amount: size,
        timestamp: Date.now()
      });

      // Record arbitrage trade
      const expectedPnL = side === 'buy'
        ? (externalPrice - xlnPrice) * size / 10000n
        : (xlnPrice - externalPrice) * size / 10000n;

      this.tradeHistory.push({
        timestamp: Date.now(),
        pair,
        side,
        price: xlnPrice,
        size,
        pnl: expectedPnL,
        type: 'arbitrage'
      });

      this.emit('arbitrage_executed', {
        pair,
        side,
        xlnPrice,
        externalPrice,
        expectedPnL
      });

    } catch (error) {
      console.warn(`Arbitrage execution failed for ${pair}:`, error);
    }
  }

  /**
   * Check if rebalancing is needed
   */
  private async checkRebalancing(): Promise<void> {
    for (const pair of this.config.pairs) {
      const position = this.positions.get(pair);
      if (!position) continue;

      if (Math.abs(position.imbalance) > this.config.rebalanceThreshold) {
        await this.rebalancePosition(pair);
      }
    }
  }

  /**
   * Rebalance position to target inventory
   */
  private async rebalancePosition(pair: string): Promise<void> {
    const position = this.positions.get(pair);
    const market = this.marketData.get(pair);
    if (!position || !market) return;

    const side = position.imbalance > 0 ? 'sell' : 'buy';
    const size = this.config.rebalanceSize;

    try {
      await this.bridge.submitOrder({
        id: `carol_rebalance_${pair}_${side}_${Date.now()}`,
        source: OrderSource.CUSTODIAL,
        type: OrderType.MARKET,
        accountId: 'carol_custodial',
        pair,
        side,
        price: side === 'buy' ? market.midPrice * 101n / 100n : market.midPrice * 99n / 100n,
        amount: size,
        timestamp: Date.now()
      });

      this.tradeHistory.push({
        timestamp: Date.now(),
        pair,
        side,
        price: market.midPrice,
        size,
        pnl: 0n, // Rebalancing trades don't generate immediate P&L
        type: 'rebalance'
      });

      this.emit('rebalanced', { pair, side, size });

    } catch (error) {
      console.warn(`Rebalancing failed for ${pair}:`, error);
    }
  }

  /**
   * Initialize pair data
   */
  private initializePair(pair: string): void {
    const [baseToken, quoteToken] = pair.split('/');

    this.positions.set(pair, {
      pair,
      baseInventory: this.config.capitalPerPair / 2n,
      quoteInventory: this.config.capitalPerPair / 2n,
      targetBase: this.config.capitalPerPair / 2n,
      targetQuote: this.config.capitalPerPair / 2n,
      imbalance: 0,
      unrealizedPnL: 0n,
      realizedPnL: 0n
    });

    this.marketData.set(pair, {
      pair,
      midPrice: this.getDefaultPrice(pair),
      bid: 0n,
      ask: 0n,
      spread: 0n,
      volatility: 10, // Default 10% volatility
      volume1h: 0n,
      lastUpdate: Date.now()
    });

    this.gridOrders.set(pair, []);
    this.priceHistory.set(pair, []);
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.bridge.on('settlement_event', (event) => {
      this.handleSettlement(event);
    });

    this.bridge.on('order_cancelled', (event) => {
      this.handleOrderCancelled(event.orderId);
    });

    this.bridge.on('cross_settled', (event) => {
      console.log(`🔄 Cross-settlement completed: ${event.matchId}`);
    });
  }

  /**
   * Handle settlement events
   */
  private handleSettlement(event: any): void {
    // Update position based on fills
    // Implementation depends on settlement event structure
    this.emit('trade_filled', event);
  }

  /**
   * Handle order cancellation
   */
  private handleOrderCancelled(orderId: string): void {
    // Remove cancelled order from grid tracking
    for (const [pair, orders] of this.gridOrders) {
      const index = orders.findIndex(o => o.orderId === orderId);
      if (index >= 0) {
        orders.splice(index, 1);
        this.emit('order_cancelled', { pair, orderId });
        break;
      }
    }
  }

  /**
   * Periodic update routine
   */
  private async periodicUpdate(): Promise<void> {
    try {
      // Update market data
      await this.updateAllMarketData();

      // Check for arbitrage opportunities
      await this.checkArbitrageOpportunities();

      // Update grid orders if needed
      for (const pair of this.config.pairs) {
        if (this.shouldUpdateGrid(pair)) {
          await this.updateGridOrders(pair);
        }
      }

      // Risk management checks
      await this.checkRiskLimits();

    } catch (error) {
      console.error('Error in periodic update:', error);
    }
  }

  /**
   * Check if grid should be updated based on price movement
   */
  private shouldUpdateGrid(pair: string): boolean {
    const market = this.marketData.get(pair);
    const orders = this.gridOrders.get(pair) || [];

    if (!market || orders.length === 0) return true;

    // Check if price has moved significantly from grid center
    const buyOrders = orders.filter(o => o.side === 'buy');
    const sellOrders = orders.filter(o => o.side === 'sell');

    if (buyOrders.length === 0 || sellOrders.length === 0) return true;

    const highestBuy = Math.max(...buyOrders.map(o => Number(o.price)));
    const lowestSell = Math.min(...sellOrders.map(o => Number(o.price)));
    const gridCenter = (highestBuy + lowestSell) / 2;
    const currentPrice = Number(market.midPrice);

    const priceMove = Math.abs(currentPrice - gridCenter) / gridCenter;

    return priceMove > 0.02; // Update if price moved more than 2%
  }

  /**
   * Risk management checks
   */
  private async checkRiskLimits(): Promise<void> {
    const metrics = this.getPerformanceMetrics();

    // Check daily drawdown
    const dailyDrawdown = metrics.dailyPnL < 0n ?
      Number(metrics.dailyPnL) / Number(this.config.capitalPerPair * BigInt(this.config.pairs.length)) : 0;

    if (dailyDrawdown < -this.config.maxDailyDrawdown) {
      await this.emergencyHalt(`Daily drawdown limit exceeded: ${(dailyDrawdown * 100).toFixed(2)}%`);
    }

    // Check position sizes
    for (const position of this.positions.values()) {
      if (position.baseInventory > this.config.maxPositionSize) {
        console.warn(`Position size limit exceeded for ${position.pair}`);
      }
    }
  }

  /**
   * Cancel all orders for a pair
   */
  private async cancelAllOrders(pair: string): Promise<void> {
    const orders = this.gridOrders.get(pair) || [];

    for (const order of orders) {
      if (order.orderId) {
        try {
          // Note: Bridge doesn't have cancelOrder method in the interface
          // This would need to be implemented or we track cancellations differently
          console.log(`Would cancel order ${order.orderId}`);
        } catch (error) {
          console.warn(`Failed to cancel order ${order.orderId}:`, error);
        }
      }
    }

    this.gridOrders.set(pair, []);
  }

  /**
   * Update all market data
   */
  private async updateAllMarketData(): Promise<void> {
    for (const pair of this.config.pairs) {
      await this.updateMarketData(pair);
    }
  }

  /**
   * Update market data for a specific pair
   */
  private async updateMarketData(pair: string): Promise<void> {
    // In production, this would fetch from the bridge's order book
    // For now, simulate market data
    const market = this.marketData.get(pair);
    if (!market) return;

    // Simulate price movement
    const priceChange = (Math.random() - 0.5) * 0.02; // ±1% random walk
    const newPrice = BigInt(Math.floor(Number(market.midPrice) * (1 + priceChange)));

    // Update price history for volatility calculation
    const history = this.priceHistory.get(pair) || [];
    history.push({ price: newPrice, timestamp: Date.now() });

    // Keep last hour of data
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    while (history.length > 0 && history[0].timestamp < oneHourAgo) {
      history.shift();
    }

    this.priceHistory.set(pair, history);

    // Calculate volatility
    const volatility = this.calculateVolatility(history);

    // Update market data
    market.midPrice = newPrice;
    market.volatility = volatility;
    market.lastUpdate = Date.now();

    // Update bid/ask based on current spread
    const spread = this.calculateDynamicSpread(pair);
    market.bid = newPrice * (10000n - spread) / 10000n;
    market.ask = newPrice * (10000n + spread) / 10000n;
    market.spread = market.ask - market.bid;
  }

  /**
   * Calculate volatility from price history
   */
  private calculateVolatility(history: Array<{ price: bigint, timestamp: number }>): number {
    if (history.length < 2) return 10; // Default volatility

    const returns = [];
    for (let i = 1; i < history.length; i++) {
      const ret = Math.log(Number(history[i].price) / Number(history[i-1].price));
      returns.push(ret);
    }

    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(365 * 24 * 60); // Annualized

    return volatility * 100; // Convert to percentage
  }

  // Simulation helpers
  private simulateExternalPrice(pair: string, currentPrice: bigint): bigint {
    // Simulate external exchange price with slight difference
    const diff = (Math.random() - 0.5) * 0.005; // ±0.25% difference
    return BigInt(Math.floor(Number(currentPrice) * (1 + diff)));
  }

  private getDefaultPrice(pair: string): bigint {
    // Default prices for testing
    switch (pair) {
      case 'ETH/USD': return ethers.parseUnits('4200', 2); // $4200
      case 'BTC/USD': return ethers.parseUnits('65000', 2); // $65000
      case 'USDT/USD': return ethers.parseUnits('1', 2); // $1
      default: return ethers.parseUnits('100', 2); // $100
    }
  }

  // Performance calculation methods
  private calculateTotalPnL(): bigint {
    let total = 0n;
    for (const position of this.positions.values()) {
      total += position.realizedPnL + position.unrealizedPnL;
    }
    return total;
  }

  private calculateMaxDrawdown(): bigint {
    // Calculate maximum drawdown from peak
    return this.dailyPeakPnL - this.getPerformanceMetrics().dailyPnL;
  }

  private calculateSharpeRatio(): number {
    // Simplified Sharpe ratio calculation
    const dailyReturns = this.tradeHistory
      .filter(t => t.timestamp > Date.now() - 24 * 60 * 60 * 1000)
      .map(t => Number(t.pnl));

    if (dailyReturns.length < 2) return 0;

    const mean = dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev === 0 ? 0 : mean / stdDev;
  }

  private calculateFillRate(): number {
    const totalOrders = this.tradeHistory.length;
    if (totalOrders === 0) return 0;

    const filledOrders = this.tradeHistory.filter(t => t.type === 'market_making').length;
    return filledOrders / totalOrders;
  }

  private calculateInventoryTurnover(): number {
    // Calculate how often inventory turns over
    const totalVolume = this.tradeHistory.reduce((sum, t) => sum + Number(t.size), 0);
    const averageInventory = this.config.pairs.length * Number(this.config.capitalPerPair);

    return averageInventory === 0 ? 0 : totalVolume / averageInventory;
  }

  private calculateSpreadCaptured(): bigint {
    return this.tradeHistory
      .filter(t => t.type === 'market_making')
      .reduce((sum, t) => sum + (t.pnl > 0n ? t.pnl : 0n), 0n);
  }

  private calculateArbitragePnL(): bigint {
    return this.tradeHistory
      .filter(t => t.type === 'arbitrage')
      .reduce((sum, t) => sum + t.pnl, 0n);
  }

  private calculatePairMetrics(): Map<string, any> {
    const metrics = new Map();

    for (const pair of this.config.pairs) {
      const pairTrades = this.tradeHistory.filter(t => t.pair === pair);
      const volume24h = pairTrades
        .filter(t => t.timestamp > Date.now() - 24 * 60 * 60 * 1000)
        .reduce((sum, t) => sum + Number(t.size), 0);

      metrics.set(pair, {
        volume24h: BigInt(volume24h),
        trades24h: pairTrades.filter(t => t.timestamp > Date.now() - 24 * 60 * 60 * 1000).length,
        avgSpread: this.calculateDynamicSpread(pair),
        pnl: pairTrades.reduce((sum, t) => sum + Number(t.pnl), 0)
      });
    }

    return metrics;
  }

  private calculateMetrics(): void {
    const metrics = this.getPerformanceMetrics();

    // Update daily peak
    if (metrics.dailyPnL > this.dailyPeakPnL) {
      this.dailyPeakPnL = metrics.dailyPnL;
    }

    this.emit('metrics_updated', metrics);
  }

  private scheduleDailyReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
      this.dailyStartPnL = this.calculateTotalPnL();
      this.dailyPeakPnL = this.dailyStartPnL;

      // Schedule next reset
      this.scheduleDailyReset();

      this.emit('daily_reset');
    }, msUntilMidnight);
  }
}

/**
 * Factory function to create Carol with sensible defaults
 */
export function createCarolMarketMaker(
  bridge: UnifiedLiquidityBridge,
  overrides?: Partial<CarolConfig>
): CarolMarketMaker {
  const defaultConfig: CarolConfig = {
    pairs: ['ETH/USD', 'BTC/USD'],
    capitalPerPair: ethers.parseEther('100000'), // $100k per pair
    maxPositionSize: ethers.parseEther('50000'),  // $50k max position
    maxDailyDrawdown: 0.05, // 5% max daily loss
    gasThreshold: ethers.parseUnits('50', 'gwei'), // Don't trade if gas > 50 gwei

    // Grid trading
    gridLevels: 5,
    baseSpread: 20, // 0.2%
    gridSpacing: 50, // 0.5% between levels

    // Dynamic adjustment
    volatilityWindow: 60, // 1 hour
    minSpread: 10, // 0.1%
    maxSpread: 200, // 2%
    spreadMultiplier: 1.5,

    // Arbitrage
    enableArbitrage: true,
    arbThreshold: 25, // 0.25%
    maxArbSize: ethers.parseEther('10000'), // $10k max arb

    // Rebalancing
    targetInventory: 0.5, // Balanced
    rebalanceThreshold: 0.2, // Rebalance at ±20%
    rebalanceSize: ethers.parseEther('5000'), // $5k rebalance orders

    // Timing
    updateInterval: 5000, // 5 seconds
    metricsWindow: 60 // 1 hour
  };

  const config = { ...defaultConfig, ...overrides };
  return new CarolMarketMaker(bridge, config);
}