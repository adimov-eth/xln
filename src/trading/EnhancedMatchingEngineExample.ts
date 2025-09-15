/**
 * Enhanced MatchingEngine Usage Example
 *
 * This example demonstrates all the new production-grade features:
 * - Fill ratio tracking
 * - Event-driven architecture
 * - Maker/taker fee differentiation
 * - Order expiry handling
 * - TWAP calculations
 * - Wash trading protection
 */

import { ethers } from 'ethers';
import { MatchingEngine, MatchingEngineConfig, OrderPlacedEvent, OrderPartiallyFilledEvent, OrderFilledEvent, OrderCancelledEvent, OrderExpiredEvent, TradeExecutedEvent } from './MatchingEngine';

async function demonstrateEnhancedMatchingEngine() {
  // Configuration with all new features enabled
  const config: MatchingEngineConfig = {
    supportedPairs: [
      { base: 'WETH', quote: 'USDC' },
      { base: 'WBTC', quote: 'USDC' }
    ],
    defaultSpreadSplit: { maker: 45, taker: 45, hub: 10 },

    // Fee configuration (makers get rebates, takers pay fees)
    makerFeeRate: -0.01, // 1 basis point rebate for makers
    takerFeeRate: 0.05,  // 5 basis point fee for takers

    // Trade credit settings
    enableTradeCredit: true,
    defaultCreditTerms: 'NET30',
    maxCreditExposure: ethers.parseEther('1000000'), // $1M max exposure

    // Risk management
    maxOrderValue: ethers.parseEther('100000'), // $100k max order
    maxDailyVolume: ethers.parseEther('10000000'), // $10M daily volume limit
    circuitBreakerThreshold: 10, // 10% price move triggers halt

    // Order expiry configuration
    defaultOrderTTL: 24 * 60 * 60 * 1000, // 24 hours default
    maxOrderTTL: 7 * 24 * 60 * 60 * 1000, // 7 days maximum

    // Network settings
    hubId: '0x742d35Cc6665C1532c65F1e8F0E7C89Eb9bE2C6a', // Example hub address
    networkId: 'ethereum-mainnet',
    congestionPricing: true,

    // Wash trading protection
    enableWashTradingProtection: true,
    maxSelfTradingRatio: 0.05 // Max 5% self-trading allowed
  };

  // Create the enhanced matching engine
  const engine = new MatchingEngine(config);

  // Set up comprehensive event listeners
  setupEventListeners(engine);

  try {
    // Example 1: Start trading sessions for two entities
    console.log('=== Starting Trading Sessions ===');

    const aliceAddress = '0x123456789abcdef123456789abcdef123456789a';
    const bobAddress = '0x987654321fedcba987654321fedcba987654321b';

    const aliceSession = await engine.startSession(aliceAddress);
    const bobSession = await engine.startSession(bobAddress);

    console.log(`Alice session: ${aliceSession.sessionId}`);
    console.log(`Bob session: ${bobSession.sessionId}`);

    // Example 2: Place orders with different features
    console.log('\n=== Placing Orders with Enhanced Features ===');

    // Alice places a maker order (post-only to ensure maker status)
    const aliceBuyOrder = await engine.placeOrder(
      aliceSession.sessionId,
      'WETH/USDC',
      'buy',
      'limit',
      ethers.parseEther('2000'), // $2000 per ETH
      ethers.parseEther('1'), // 1 ETH
      2 * 60 * 60 * 1000, // 2 hour expiry
      { postOnly: true } // Ensure this is a maker order
    );

    console.log(`Alice buy order placed: ${aliceBuyOrder.id}, fillRatio: ${aliceBuyOrder.fillRatio}`);

    // Bob places a market order that will cross the spread (taker)
    const bobSellOrder = await engine.placeOrder(
      bobSession.sessionId,
      'WETH/USDC',
      'sell',
      'market',
      null, // Market price
      ethers.parseEther('0.5'), // 0.5 ETH
      60 * 60 * 1000 // 1 hour expiry
    );

    console.log(`Bob sell order placed: ${bobSellOrder.id}, fillRatio: ${bobSellOrder.fillRatio}`);

    // Example 3: Monitor order fills and calculate metrics
    console.log('\n=== Order Fill Monitoring ===');

    setTimeout(async () => {
      // Check fill status
      const updatedAliceOrder = engine.getOrder(aliceBuyOrder.id);
      if (updatedAliceOrder) {
        console.log(`Alice order fill ratio: ${updatedAliceOrder.fillRatio.toFixed(4)}`);
        console.log(`Alice partial fills: ${updatedAliceOrder.partialFills.length}`);

        // Get fill history
        const fillHistory = engine.getOrderFillHistory(aliceBuyOrder.id);
        console.log('Fill history:', fillHistory.map(f => ({
          amount: ethers.formatEther(f.amount),
          price: ethers.formatEther(f.price),
          timestamp: new Date(f.timestamp).toISOString()
        })));
      }

      // Get TWAP for the pair
      const twap = engine.getTWAP('WETH/USDC');
      console.log(`WETH/USDC TWAP: ${ethers.formatEther(twap)}`);

      // Get comprehensive stats
      const stats = engine.getStats();
      console.log('\n=== Engine Statistics ===');
      console.log(`Total trades: ${stats.totalTrades}`);
      console.log(`Total volume: ${ethers.formatEther(stats.totalVolume)} ETH`);
      console.log(`Maker rebates paid: ${ethers.formatEther(stats.totalMakerRebates)} USDC`);
      console.log(`Taker fees collected: ${ethers.formatEther(stats.totalTakerFees)} USDC`);
      console.log(`Self-trade statistics:`, stats.selfTradeStats);

      // Get session-specific statistics
      const aliceStats = engine.getSessionStats(aliceSession.sessionId);
      console.log('\n=== Alice Session Stats ===');
      console.log(`VWAP: ${ethers.formatEther(aliceStats.vwap)}`);
      console.log(`Fill rate: ${(aliceStats.fillRate * 100).toFixed(2)}%`);
      console.log(`Self-trade ratio: ${(aliceStats.selfTradeRatio * 100).toFixed(2)}%`);

      // Get enhanced market depth
      const depth = engine.getEnhancedMarketDepth('WETH/USDC', 5);
      console.log('\n=== Enhanced Market Depth ===');
      console.log('Bids:', depth.bids.map(b => ({
        price: ethers.formatEther(b.price),
        amount: ethers.formatEther(b.amount),
        orders: b.orders,
        avgAge: `${(b.avgAge / 1000).toFixed(1)}s`
      })));
      console.log('Asks:', depth.asks.map(a => ({
        price: ethers.formatEther(a.price),
        amount: ethers.formatEther(a.amount),
        orders: a.orders,
        avgAge: `${(a.avgAge / 1000).toFixed(1)}s`
      })));
      console.log(`Market imbalance: ${(depth.imbalance * 100).toFixed(2)}% (negative = sell pressure)`);

    }, 1000); // Check after 1 second

    // Example 4: Test order expiry
    console.log('\n=== Testing Order Expiry ===');

    const shortLivedOrder = await engine.placeOrder(
      aliceSession.sessionId,
      'WETH/USDC',
      'buy',
      'limit',
      ethers.parseEther('1900'), // $1900 per ETH (below market)
      ethers.parseEther('0.1'), // 0.1 ETH
      2000 // 2 second expiry
    );

    console.log(`Short-lived order placed: ${shortLivedOrder.id}, expires in 2 seconds`);

    // Wait for expiry
    setTimeout(() => {
      const expiredOrder = engine.getOrder(shortLivedOrder.id);
      if (expiredOrder) {
        console.log(`Order ${shortLivedOrder.id} expired: ${expiredOrder.isExpired}`);
      } else {
        console.log(`Order ${shortLivedOrder.id} was cleaned up after expiry`);
      }
    }, 3000);

    // Example 5: Demonstrate wash trading protection
    console.log('\n=== Testing Wash Trading Protection ===');

    try {
      // Try to place many orders from the same entity (should eventually fail)
      for (let i = 0; i < 10; i++) {
        await engine.placeOrder(
          aliceSession.sessionId,
          'WBTC/USDC',
          i % 2 === 0 ? 'buy' : 'sell',
          'limit',
          ethers.parseEther(i % 2 === 0 ? '50000' : '50100'), // Alternating buy/sell prices
          ethers.parseEther('0.01'),
          60 * 60 * 1000
        );
      }
    } catch (error) {
      console.log('Wash trading protection triggered:', error.message);
    }

    // Example 6: Graceful shutdown after demo
    setTimeout(async () => {
      console.log('\n=== Shutting Down ===');
      await engine.shutdown();
      console.log('Demo completed successfully');
    }, 10000); // Shutdown after 10 seconds

  } catch (error) {
    console.error('Demo error:', error);
  }
}

function setupEventListeners(engine: MatchingEngine) {
  console.log('Setting up event listeners...');

  engine.on('order_placed', (event: OrderPlacedEvent) => {
    console.log(`📝 ORDER PLACED: ${event.order.id} | ${event.order.side} ${ethers.formatEther(event.order.amount)} @ ${ethers.formatEther(event.order.price)} | Pair: ${event.pair}`);
  });

  engine.on('order_partially_filled', (event: OrderPartiallyFilledEvent) => {
    console.log(`📊 PARTIAL FILL: ${event.orderId} | Filled ${ethers.formatEther(event.fillAmount)} @ ${ethers.formatEther(event.fillPrice)} | Fill Ratio: ${(event.newFillRatio * 100).toFixed(2)}%`);
  });

  engine.on('order_filled', (event: OrderFilledEvent) => {
    console.log(`✅ ORDER FILLED: ${event.orderId} | Total: ${ethers.formatEther(event.totalFillAmount)} | Avg Price: ${ethers.formatEther(event.averageFillPrice)}`);
  });

  engine.on('order_cancelled', (event: OrderCancelledEvent) => {
    console.log(`❌ ORDER CANCELLED: ${event.orderId} | Reason: ${event.reason} | Remaining: ${ethers.formatEther(event.remainingAmount)}`);
  });

  engine.on('order_expired', (event: OrderExpiredEvent) => {
    console.log(`⏰ ORDER EXPIRED: ${event.orderId} | Expired at: ${new Date(event.expiryTime).toISOString()} | Remaining: ${ethers.formatEther(event.remainingAmount)}`);
  });

  engine.on('trade_executed', (event: TradeExecutedEvent) => {
    const isSelfTrade = event.trade.isSelfTrade ? ' [SELF-TRADE]' : '';
    const makerFee = event.trade.makerFee < 0n ? `rebate: ${ethers.formatUnits(-event.trade.makerFee, 6)}` : `fee: ${ethers.formatUnits(event.trade.makerFee, 6)}`;
    const takerFee = `fee: ${ethers.formatUnits(event.trade.takerFee, 6)}`;

    console.log(`🤝 TRADE EXECUTED: ${event.trade.id} | ${ethers.formatEther(event.trade.amount)} @ ${ethers.formatEther(event.trade.price)} | Maker ${makerFee} | Taker ${takerFee}${isSelfTrade}`);
  });

  engine.on('circuit_breaker', (event: any) => {
    console.log(`🚨 CIRCUIT BREAKER: ${event.pair} halted due to ${event.priceMove}% price movement`);
  });
}

// Export for testing
export { demonstrateEnhancedMatchingEngine };

// Run the demo if this file is executed directly
if (require.main === module) {
  demonstrateEnhancedMatchingEngine().catch(console.error);
}