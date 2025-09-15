/**
 * Comprehensive tests for the Enhanced MatchingEngine
 *
 * Tests all production-grade features:
 * - Fill ratio tracking and partial execution
 * - Event emission for all state changes
 * - Maker/taker fee differentiation
 * - Order expiry handling
 * - TWAP calculations
 * - Wash trading protection
 * - Thread safety
 */

import { ethers } from 'ethers';
import { MatchingEngine, MatchingEngineConfig, EnhancedOrder, EnhancedTrade } from '../MatchingEngine';

describe('Enhanced MatchingEngine', () => {
  let engine: MatchingEngine;
  let config: MatchingEngineConfig;
  let aliceAddress: string;
  let bobAddress: string;
  let charlieAddress: string;

  beforeEach(() => {
    aliceAddress = '0x123456789abcdef123456789abcdef123456789a';
    bobAddress = '0x987654321fedcba987654321fedcba987654321b';
    charlieAddress = '0x555666777888999aaabbbcccdddeeefff0000111';

    config = {
      supportedPairs: [
        { base: 'WETH', quote: 'USDC' },
        { base: 'WBTC', quote: 'USDC' }
      ],
      defaultSpreadSplit: { maker: 45, taker: 45, hub: 10 },
      makerFeeRate: -0.01, // 1bp rebate
      takerFeeRate: 0.05, // 5bp fee
      enableTradeCredit: false, // Simplified for tests
      defaultCreditTerms: 'NET30',
      maxCreditExposure: ethers.parseEther('1000000'),
      maxOrderValue: ethers.parseEther('100000'),
      maxDailyVolume: ethers.parseEther('10000000'),
      circuitBreakerThreshold: 10,
      defaultOrderTTL: 60 * 60 * 1000, // 1 hour
      maxOrderTTL: 24 * 60 * 60 * 1000, // 24 hours
      hubId: '0x742d35Cc6665C1532c65F1e8F0E7C89Eb9bE2C6a',
      networkId: 'test-network',
      congestionPricing: false,
      enableWashTradingProtection: true,
      maxSelfTradingRatio: 0.1 // 10% for testing
    };

    engine = new MatchingEngine(config);
  });

  afterEach(async () => {
    if (engine) {
      await engine.shutdown();
    }
  });

  describe('Order Placement and Fill Tracking', () => {
    test('should track fill ratios correctly', async () => {
      const aliceSession = await engine.startSession(aliceAddress);
      const bobSession = await engine.startSession(bobAddress);

      // Alice places a large buy order
      const buyOrder = await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('2'), // 2 ETH
        undefined,
        { postOnly: true }
      );

      expect(buyOrder.fillRatio).toBe(0);
      expect(buyOrder.filled).toBe(0n);
      expect(buyOrder.partialFills).toHaveLength(0);

      // Bob places a smaller sell order that will partially fill Alice's order
      const sellOrder = await engine.placeOrder(
        bobSession.sessionId,
        'WETH/USDC',
        'sell',
        'limit',
        ethers.parseEther('2000'), // Same price to ensure match
        ethers.parseEther('0.5') // 0.5 ETH
      );

      // Check that Alice's order is partially filled
      const updatedBuyOrder = engine.getOrder(buyOrder.id);
      expect(updatedBuyOrder).toBeTruthy();
      expect(updatedBuyOrder!.fillRatio).toBeCloseTo(0.25, 5); // 0.5/2 = 25%
      expect(updatedBuyOrder!.filled).toBe(ethers.parseEther('0.5'));
      expect(updatedBuyOrder!.partialFills).toHaveLength(1);
      expect(updatedBuyOrder!.partialFills[0].amount).toBe(ethers.parseEther('0.5'));

      // Bob's order should be fully filled
      const updatedSellOrder = engine.getOrder(sellOrder.id);
      expect(updatedSellOrder).toBeTruthy();
      expect(updatedSellOrder!.fillRatio).toBe(1.0);
      expect(updatedSellOrder!.filled).toBe(ethers.parseEther('0.5'));
    });

    test('should emit correct events for order lifecycle', async () => {
      const events: any[] = [];

      engine.on('order_placed', (event) => events.push({ type: 'placed', ...event }));
      engine.on('order_partially_filled', (event) => events.push({ type: 'partial', ...event }));
      engine.on('order_filled', (event) => events.push({ type: 'filled', ...event }));
      engine.on('trade_executed', (event) => events.push({ type: 'trade', ...event }));

      const aliceSession = await engine.startSession(aliceAddress);
      const bobSession = await engine.startSession(bobAddress);

      // Alice places order
      await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('1'),
        undefined,
        { postOnly: true }
      );

      expect(events.filter(e => e.type === 'placed')).toHaveLength(1);

      // Bob places matching order
      await engine.placeOrder(
        bobSession.sessionId,
        'WETH/USDC',
        'sell',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('1')
      );

      // Should have emitted: placed (Bob's order), filled (both orders), trade_executed
      expect(events.filter(e => e.type === 'placed')).toHaveLength(2);
      expect(events.filter(e => e.type === 'filled')).toHaveLength(2);
      expect(events.filter(e => e.type === 'trade')).toHaveLength(1);
    });
  });

  describe('Maker/Taker Fee Differentiation', () => {
    test('should apply maker rebates and taker fees correctly', async () => {
      const events: any[] = [];
      engine.on('trade_executed', (event) => events.push(event));

      const aliceSession = await engine.startSession(aliceAddress);
      const bobSession = await engine.startSession(bobAddress);

      // Alice places maker order
      await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('1'),
        undefined,
        { postOnly: true }
      );

      // Bob places taker order
      await engine.placeOrder(
        bobSession.sessionId,
        'WETH/USDC',
        'sell',
        'market',
        null,
        ethers.parseEther('1')
      );

      expect(events).toHaveLength(1);
      const trade = events[0].trade;

      // Maker should get rebate (negative fee)
      expect(trade.makerFee).toBeLessThan(0n);

      // Taker should pay fee (positive fee)
      expect(trade.takerFee).toBeGreaterThan(0n);

      // Check fee calculation
      const tradeValue = (trade.price * trade.amount) / ethers.parseEther('1');
      const expectedMakerFee = (tradeValue * BigInt(-100)) / 10000n; // -1bp
      const expectedTakerFee = (tradeValue * BigInt(500)) / 10000n; // 5bp

      expect(trade.makerFee).toBe(expectedMakerFee);
      expect(trade.takerFee).toBe(expectedTakerFee);
    });

    test('should track fee totals correctly', async () => {
      const aliceSession = await engine.startSession(aliceAddress);
      const bobSession = await engine.startSession(bobAddress);

      // Execute several trades
      for (let i = 0; i < 3; i++) {
        await engine.placeOrder(
          aliceSession.sessionId,
          'WETH/USDC',
          'buy',
          'limit',
          ethers.parseEther('2000'),
          ethers.parseEther('0.1'),
          undefined,
          { postOnly: true }
        );

        await engine.placeOrder(
          bobSession.sessionId,
          'WETH/USDC',
          'sell',
          'market',
          null,
          ethers.parseEther('0.1')
        );
      }

      const stats = engine.getStats();
      expect(stats.totalMakerRebates).toBeGreaterThan(0n);
      expect(stats.totalTakerFees).toBeGreaterThan(0n);
      expect(stats.totalTrades).toBe(3);
    });
  });

  describe('Order Expiry Handling', () => {
    test('should expire orders after TTL', async (done) => {
      const aliceSession = await engine.startSession(aliceAddress);

      const events: any[] = [];
      engine.on('order_expired', (event) => {
        events.push(event);

        expect(event.orderId).toBe(order.id);
        expect(event.remainingAmount).toBe(ethers.parseEther('1'));

        // Order should be marked as expired
        const expiredOrder = engine.getOrder(order.id);
        expect(expiredOrder?.isExpired).toBe(true);

        done();
      });

      const order = await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('1'),
        100 // 100ms TTL
      );

      expect(order.expiryTime).toBeDefined();
      expect(order.isExpired).toBe(false);
    }, 1000);

    test('should clean up expired orders periodically', async () => {
      const aliceSession = await engine.startSession(aliceAddress);

      // Create several short-lived orders
      const orders = [];
      for (let i = 0; i < 5; i++) {
        const order = await engine.placeOrder(
          aliceSession.sessionId,
          'WETH/USDC',
          'buy',
          'limit',
          ethers.parseEther('2000'),
          ethers.parseEther('0.1'),
          50 // 50ms TTL
        );
        orders.push(order);
      }

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 200));

      // All orders should be expired but still tracked
      for (const order of orders) {
        const expiredOrder = engine.getOrder(order.id);
        expect(expiredOrder?.isExpired).toBe(true);
      }
    });
  });

  describe('TWAP Calculations', () => {
    test('should calculate TWAP correctly', async () => {
      const aliceSession = await engine.startSession(aliceAddress);
      const bobSession = await engine.startSession(bobAddress);

      // Execute trades at different prices with time gaps
      const prices = [
        ethers.parseEther('2000'),
        ethers.parseEther('2050'),
        ethers.parseEther('1950')
      ];

      for (let i = 0; i < prices.length; i++) {
        await engine.placeOrder(
          aliceSession.sessionId,
          'WETH/USDC',
          'buy',
          'limit',
          prices[i],
          ethers.parseEther('0.1'),
          undefined,
          { postOnly: true }
        );

        await engine.placeOrder(
          bobSession.sessionId,
          'WETH/USDC',
          'sell',
          'limit',
          prices[i],
          ethers.parseEther('0.1')
        );

        // Add time gap between trades
        if (i < prices.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      const twap = engine.getTWAP('WETH/USDC');
      expect(twap).toBeGreaterThan(0n);

      // TWAP should be time-weighted average of the prices
      // With equal time intervals, it should be close to simple average
      const expectedAvg = prices.reduce((sum, p) => sum + p, 0n) / BigInt(prices.length);
      const tolerance = ethers.parseEther('50'); // $50 tolerance

      expect(twap).toBeGreaterThan(expectedAvg - tolerance);
      expect(twap).toBeLessThan(expectedAvg + tolerance);
    });
  });

  describe('Wash Trading Protection', () => {
    test('should detect and prevent excessive self-trading', async () => {
      const aliceSession = await engine.startSession(aliceAddress);

      // Place alternating buy/sell orders from the same entity
      // This should trigger wash trading protection
      let orderCount = 0;
      let protectionTriggered = false;

      try {
        for (let i = 0; i < 20; i++) {
          await engine.placeOrder(
            aliceSession.sessionId,
            'WBTC/USDC',
            i % 2 === 0 ? 'buy' : 'sell',
            'limit',
            ethers.parseEther(i % 2 === 0 ? '50000' : '50100'),
            ethers.parseEther('0.01')
          );
          orderCount++;
        }
      } catch (error) {
        if (error.message.includes('Self-trading ratio')) {
          protectionTriggered = true;
        }
      }

      expect(protectionTriggered).toBe(true);
      expect(orderCount).toBeGreaterThan(0);
      expect(orderCount).toBeLessThan(20);
    });

    test('should allow self-trading when explicitly permitted', async () => {
      const aliceSession = await engine.startSession(aliceAddress);

      // This should succeed because we explicitly allow self-trading
      await expect(engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('0.1'),
        undefined,
        { allowSelfTrade: true }
      )).resolves.toBeDefined();
    });

    test('should track self-trade statistics', async () => {
      const aliceSession = await engine.startSession(aliceAddress);

      // Create a self-trade
      await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('0.1'),
        undefined,
        { postOnly: true, allowSelfTrade: true }
      );

      await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'sell',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('0.1'),
        undefined,
        { allowSelfTrade: true }
      );

      const stats = engine.getStats();
      expect(stats.selfTradeStats['WETH/USDC']).toBeDefined();
      expect(stats.selfTradeStats['WETH/USDC'].count).toBeGreaterThan(0);
      expect(stats.selfTradeStats['WETH/USDC'].ratio).toBeGreaterThan(0);
    });
  });

  describe('Post-Only Orders', () => {
    test('should reject post-only orders that would cross the spread', async () => {
      const aliceSession = await engine.startSession(aliceAddress);
      const bobSession = await engine.startSession(bobAddress);

      // Alice places a sell order at $2000
      await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'sell',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('1'),
        undefined,
        { postOnly: true }
      );

      // Bob tries to place a post-only buy order at $2000 (would cross)
      await expect(engine.placeOrder(
        bobSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('2000'),
        ethers.parseEther('0.5'),
        undefined,
        { postOnly: true }
      )).rejects.toThrow('Post-only buy order would cross spread');

      // But a post-only buy order at $1999 should work
      await expect(engine.placeOrder(
        bobSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('1999'),
        ethers.parseEther('0.5'),
        undefined,
        { postOnly: true }
      )).resolves.toBeDefined();
    });
  });

  describe('Enhanced Market Depth', () => {
    test('should provide enhanced depth with age information', async () => {
      const aliceSession = await engine.startSession(aliceAddress);

      // Place orders at different times
      await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('1999'),
        ethers.parseEther('0.5'),
        undefined,
        { postOnly: true }
      );

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('1998'),
        ethers.parseEther('0.3'),
        undefined,
        { postOnly: true }
      );

      const depth = engine.getEnhancedMarketDepth('WETH/USDC', 5);

      expect(depth.bids).toHaveLength(2);
      expect(depth.bids[0].avgAge).toBeGreaterThan(0);
      expect(depth.bids[0].avgAge).toBeGreaterThanOrEqual(depth.bids[1].avgAge);
      expect(depth.imbalance).toBeDefined();
    });
  });

  describe('Session Statistics', () => {
    test('should calculate comprehensive session statistics', async () => {
      const aliceSession = await engine.startSession(aliceAddress);
      const bobSession = await engine.startSession(bobAddress);

      // Execute multiple trades
      for (let i = 0; i < 3; i++) {
        await engine.placeOrder(
          aliceSession.sessionId,
          'WETH/USDC',
          'buy',
          'limit',
          ethers.parseEther('2000'),
          ethers.parseEther('0.1'),
          undefined,
          { postOnly: true }
        );

        await engine.placeOrder(
          bobSession.sessionId,
          'WETH/USDC',
          'sell',
          'limit',
          ethers.parseEther('2000'),
          ethers.parseEther('0.1')
        );
      }

      const aliceStats = engine.getSessionStats(aliceSession.sessionId);

      expect(aliceStats.session).toBeDefined();
      expect(aliceStats.vwap).toBeGreaterThan(0n);
      expect(aliceStats.fillRate).toBeGreaterThan(0);
      expect(aliceStats.fillRate).toBeLessThanOrEqual(1);

      const sessionOrders = engine.getSessionOrders(aliceSession.sessionId);
      expect(sessionOrders.length).toBeGreaterThan(0);
    });
  });

  describe('Thread Safety and Concurrency', () => {
    test('should handle concurrent order placement safely', async () => {
      const sessions = [];
      const addresses = [aliceAddress, bobAddress, charlieAddress];

      for (const addr of addresses) {
        sessions.push(await engine.startSession(addr));
      }

      // Place many orders concurrently
      const promises = [];
      for (let i = 0; i < 50; i++) {
        const sessionIdx = i % sessions.length;
        const side = i % 2 === 0 ? 'buy' : 'sell';
        const price = side === 'buy'
          ? ethers.parseEther('1999')
          : ethers.parseEther('2001');

        promises.push(engine.placeOrder(
          sessions[sessionIdx].sessionId,
          'WETH/USDC',
          side,
          'limit',
          price,
          ethers.parseEther('0.01'),
          undefined,
          { postOnly: true }
        ));
      }

      // All orders should complete successfully
      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled').length;

      expect(successful).toBeGreaterThan(40); // Most should succeed

      const stats = engine.getStats();
      expect(stats.activeOrders).toBe(successful);
    });
  });

  describe('Shutdown and Cleanup', () => {
    test('should shutdown gracefully and cancel all orders', async () => {
      const aliceSession = await engine.startSession(aliceAddress);

      // Place some orders
      await engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('1999'),
        ethers.parseEther('0.5'),
        undefined,
        { postOnly: true }
      );

      const statsBeforeShutdown = engine.getStats();
      expect(statsBeforeShutdown.activeOrders).toBeGreaterThan(0);

      // Shutdown should complete without errors
      await expect(engine.shutdown()).resolves.toBeUndefined();

      // Engine should no longer accept new orders
      await expect(engine.placeOrder(
        aliceSession.sessionId,
        'WETH/USDC',
        'buy',
        'limit',
        ethers.parseEther('1999'),
        ethers.parseEther('0.5')
      )).rejects.toThrow();
    });
  });
});