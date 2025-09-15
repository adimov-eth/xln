/**
 * Carol Market Maker Demo
 *
 * Demonstrates Carol's sophisticated market making capabilities
 * across both custodial and trustless systems
 */

import { CarolMarketMaker, createCarolMarketMaker, CarolConfig } from './CarolMarketMaker';
import { UnifiedLiquidityBridge, CustodialAccount } from '../core/UnifiedLiquidityBridge';
import { ethers } from 'ethers';
import * as fs from 'fs';

/**
 * Setup demo environment with mock accounts and channels
 */
async function setupDemoEnvironment(): Promise<UnifiedLiquidityBridge> {
  const bridge = new UnifiedLiquidityBridge({
    feeRate: 5n, // 0.05% fee
    settlementTimeout: 30000 // 30 second timeout
  });

  // Create Carol's custodial account with substantial capital
  const carolAccount: CustodialAccount = {
    id: 'carol_custodial',
    balances: new Map([
      ['ETH', ethers.parseEther('1000')],      // 1000 ETH
      ['BTC', ethers.parseEther('50')],        // 50 BTC (using ETH decimals for demo)
      ['USD', ethers.parseUnits('5000000', 6)], // $5M USD (6 decimals)
      ['USDT', ethers.parseUnits('2000000', 6)] // $2M USDT
    ]),
    nonce: 0n,
    tradingEnabled: true
  };

  bridge.addCustodialAccount(carolAccount);

  // Create some demo traders
  const traders = [
    {
      id: 'alice_trader',
      balances: new Map([
        ['ETH', ethers.parseEther('100')],
        ['USD', ethers.parseUnits('500000', 6)]
      ])
    },
    {
      id: 'bob_trader',
      balances: new Map([
        ['BTC', ethers.parseEther('5')],
        ['USD', ethers.parseUnits('300000', 6)]
      ])
    },
    {
      id: 'charlie_trader',
      balances: new Map([
        ['USDT', ethers.parseUnits('100000', 6)],
        ['ETH', ethers.parseEther('20')]
      ])
    }
  ];

  for (const trader of traders) {
    bridge.addCustodialAccount({
      id: trader.id,
      balances: trader.balances,
      nonce: 0n,
      tradingEnabled: true
    });
  }

  console.log('✅ Demo environment setup complete');
  console.log(`   - Carol's account: ${carolAccount.balances.size} assets`);
  console.log(`   - ${traders.length} demo traders created`);

  return bridge;
}

/**
 * Load Carol configuration from JSON
 */
function loadCarolConfig(profile: string = 'development'): CarolConfig {
  const configPath = __dirname + '/carol-config.json';
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const config = configData[profile];
  if (!config) {
    throw new Error(`Configuration profile '${profile}' not found`);
  }

  // Convert string amounts to BigInt
  const processedConfig = {
    ...config,
    capitalPerPair: BigInt(config.capitalPerPair),
    maxPositionSize: BigInt(config.maxPositionSize),
    gasThreshold: BigInt(config.gasThreshold),
    maxArbSize: BigInt(config.maxArbSize),
    rebalanceSize: BigInt(config.rebalanceSize)
  };

  console.log(`📋 Loaded '${profile}' configuration:`);
  console.log(`   - Pairs: ${config.pairs.join(', ')}`);
  console.log(`   - Capital per pair: ${ethers.formatUnits(config.capitalPerPair, 6)} USD`);
  console.log(`   - Grid levels: ${config.gridLevels}`);
  console.log(`   - Base spread: ${config.baseSpread} bps`);
  console.log(`   - Arbitrage: ${config.enableArbitrage ? 'enabled' : 'disabled'}`);

  return processedConfig;
}

/**
 * Simulate market trading activity
 */
async function simulateMarketActivity(
  bridge: UnifiedLiquidityBridge,
  durationMs: number = 60000
): Promise<void> {
  console.log(`🎭 Starting market simulation for ${durationMs/1000} seconds...`);

  const traderIds = ['alice_trader', 'bob_trader', 'charlie_trader'];
  const pairs = ['ETH/USD', 'BTC/USD', 'USDT/USD'];

  const startTime = Date.now();
  let tradeCount = 0;

  const simulateInterval = setInterval(async () => {
    if (Date.now() - startTime > durationMs) {
      clearInterval(simulateInterval);
      console.log(`✅ Market simulation complete. ${tradeCount} trades executed.`);
      return;
    }

    // Random trader places random order
    const traderId = traderIds[Math.floor(Math.random() * traderIds.length)];
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const side = Math.random() > 0.5 ? 'buy' : 'sell';

    // Random order size between $100 and $10,000
    const orderValue = Math.random() * 9900 + 100;
    const amount = ethers.parseUnits(orderValue.toString(), 6);

    try {
      await bridge.submitOrder({
        id: `sim_${traderId}_${Date.now()}_${Math.random()}`,
        source: 'custodial',
        type: 'market',
        accountId: traderId,
        pair,
        side,
        price: 0n, // Market order
        amount,
        timestamp: Date.now()
      });

      tradeCount++;
      if (tradeCount % 5 === 0) {
        console.log(`   📊 ${tradeCount} simulated trades executed...`);
      }

    } catch (error) {
      // Ignore failed trades (likely insufficient balance)
    }

  }, 2000 + Math.random() * 3000); // 2-5 second intervals
}

/**
 * Monitor Carol's performance
 */
function startPerformanceMonitoring(carol: CarolMarketMaker): void {
  console.log('📈 Starting performance monitoring...');

  setInterval(() => {
    const metrics = carol.getPerformanceMetrics();
    const positions = carol.getPositions();
    const marketData = carol.getMarketData();

    console.log('\n📊 CAROL PERFORMANCE METRICS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💰 Total P&L: ${ethers.formatUnits(metrics.totalPnL, 6)} USD`);
    console.log(`📅 Daily P&L: ${ethers.formatUnits(metrics.dailyPnL, 6)} USD`);
    console.log(`📉 Max Drawdown: ${ethers.formatUnits(metrics.maxDrawdown, 6)} USD`);
    console.log(`📈 Sharpe Ratio: ${metrics.sharpeRatio.toFixed(3)}`);
    console.log(`🎯 Fill Rate: ${(metrics.fillRate * 100).toFixed(1)}%`);
    console.log(`🔄 Inventory Turnover: ${metrics.inventoryTurnover.toFixed(2)}x`);
    console.log(`💸 Spread Captured: ${ethers.formatUnits(metrics.spreadCaptured, 6)} USD`);
    console.log(`⚡ Arbitrage P&L: ${ethers.formatUnits(metrics.arbitragePnL, 6)} USD`);

    console.log('\n💼 POSITIONS:');
    positions.forEach(pos => {
      console.log(`   ${pos.pair}:`);
      console.log(`     Base: ${ethers.formatUnits(pos.baseInventory, 6)}`);
      console.log(`     Quote: ${ethers.formatUnits(pos.quoteInventory, 6)}`);
      console.log(`     Imbalance: ${(pos.imbalance * 100).toFixed(1)}%`);
      console.log(`     P&L: ${ethers.formatUnits(pos.realizedPnL + pos.unrealizedPnL, 6)} USD`);
    });

    console.log('\n📊 MARKET DATA:');
    marketData.forEach(market => {
      console.log(`   ${market.pair}:`);
      console.log(`     Mid: ${ethers.formatUnits(market.midPrice, 2)}`);
      console.log(`     Spread: ${ethers.formatUnits(market.spread, 2)} (${Number(market.spread * 10000n / market.midPrice)}bps)`);
      console.log(`     Volatility: ${market.volatility.toFixed(1)}%`);
      console.log(`     Volume 1h: ${ethers.formatUnits(market.volume1h, 6)}`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  }, 15000); // Every 15 seconds
}

/**
 * Setup event logging
 */
function setupEventLogging(carol: CarolMarketMaker): void {
  carol.on('started', () => {
    console.log('🚀 Carol has started making markets!');
  });

  carol.on('grid_updated', (event) => {
    console.log(`🔄 Grid updated for ${event.pair}: ${event.orders} orders, spread: ${event.spread}bps`);
  });

  carol.on('arbitrage_executed', (event) => {
    console.log(`⚡ Arbitrage executed for ${event.pair}: ${event.side} @ ${ethers.formatUnits(event.xlnPrice, 2)}, expected P&L: ${ethers.formatUnits(event.expectedPnL, 6)}`);
  });

  carol.on('rebalanced', (event) => {
    console.log(`⚖️  Position rebalanced for ${event.pair}: ${event.side} ${ethers.formatUnits(event.size, 6)}`);
  });

  carol.on('emergency_halt', (event) => {
    console.error(`🚨 EMERGENCY HALT: ${event.reason}`);
  });

  carol.on('trade_filled', (event) => {
    console.log(`✅ Trade filled: ${JSON.stringify(event)}`);
  });

  carol.on('metrics_updated', () => {
    // Metrics are logged separately
  });

  carol.on('daily_reset', () => {
    console.log('🔄 Daily metrics reset');
  });
}

/**
 * Main demo function
 */
async function runCarolDemo(): Promise<void> {
  console.log('🤖 Carol Market Maker Demo Starting...\n');

  try {
    // Setup environment
    const bridge = await setupDemoEnvironment();

    // Load configuration (try different profiles: development, production, conservative, aggressive)
    const profile = process.argv[2] || 'development';
    const config = loadCarolConfig(profile);

    // Create Carol
    console.log('\n🧠 Creating Carol with sophisticated strategies...');
    const carol = createCarolMarketMaker(bridge, config);

    // Setup event logging
    setupEventLogging(carol);

    // Start performance monitoring
    startPerformanceMonitoring(carol);

    // Start Carol
    await carol.start();

    // Run market simulation
    await simulateMarketActivity(bridge, 120000); // 2 minutes

    // Let Carol continue running for a bit
    console.log('\n⏳ Letting Carol continue market making...');
    await new Promise(resolve => setTimeout(resolve, 60000)); // 1 more minute

    // Final performance report
    console.log('\n📊 FINAL PERFORMANCE REPORT:');
    const finalMetrics = carol.getPerformanceMetrics();
    const positions = carol.getPositions();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🏆 Total P&L: ${ethers.formatUnits(finalMetrics.totalPnL, 6)} USD`);
    console.log(`📅 Daily P&L: ${ethers.formatUnits(finalMetrics.dailyPnL, 6)} USD`);
    console.log(`📈 Sharpe Ratio: ${finalMetrics.sharpeRatio.toFixed(3)}`);
    console.log(`🎯 Fill Rate: ${(finalMetrics.fillRate * 100).toFixed(1)}%`);
    console.log(`💸 Spread Captured: ${ethers.formatUnits(finalMetrics.spreadCaptured, 6)} USD`);
    console.log(`⚡ Arbitrage P&L: ${ethers.formatUnits(finalMetrics.arbitragePnL, 6)} USD`);

    console.log('\n💼 Final Positions:');
    let totalValue = 0n;
    positions.forEach(pos => {
      const posValue = pos.baseInventory + pos.quoteInventory;
      totalValue += posValue;
      console.log(`   ${pos.pair}: ${ethers.formatUnits(posValue, 6)} USD (${(pos.imbalance * 100).toFixed(1)}% imbalance)`);
    });
    console.log(`   💎 Total Portfolio Value: ${ethers.formatUnits(totalValue, 6)} USD`);

    console.log('\n📊 Bridge Metrics:');
    const bridgeMetrics = bridge.getMetrics();
    console.log(`   Total Volume: ${bridgeMetrics.totalVolume} wei`);
    console.log(`   Total Trades: ${bridgeMetrics.totalTrades}`);
    console.log(`   Cross Settlements: ${bridgeMetrics.crossSettlements}`);
    console.log(`   Active Market Makers: ${bridgeMetrics.marketMakers}`);

    // Stop Carol
    await carol.stop();

    console.log('\n✅ Carol Market Maker Demo Complete!');
    console.log('🔑 Key takeaways:');
    console.log('   • Carol provides unified liquidity across custodial and trustless');
    console.log('   • Sophisticated grid trading with dynamic spread adjustment');
    console.log('   • Real-time risk management and position rebalancing');
    console.log('   • Arbitrage detection and execution capabilities');
    console.log('   • Comprehensive performance analytics and monitoring');
    console.log('   • Configurable strategies for different market conditions');

  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

/**
 * Helper to demonstrate different strategies
 */
async function compareStrategies(): Promise<void> {
  console.log('📊 STRATEGY COMPARISON DEMO\n');

  const profiles = ['conservative', 'development', 'aggressive'];
  const bridge = await setupDemoEnvironment();

  for (const profile of profiles) {
    console.log(`\n🔍 Testing ${profile} strategy:`);

    try {
      const config = loadCarolConfig(profile);
      const carol = createCarolMarketMaker(bridge, config);

      await carol.start();

      // Run short simulation
      await simulateMarketActivity(bridge, 30000); // 30 seconds

      const metrics = carol.getPerformanceMetrics();
      console.log(`   P&L: ${ethers.formatUnits(metrics.totalPnL, 6)} USD`);
      console.log(`   Sharpe: ${metrics.sharpeRatio.toFixed(3)}`);
      console.log(`   Fill Rate: ${(metrics.fillRate * 100).toFixed(1)}%`);

      await carol.stop();

    } catch (error) {
      console.error(`   ❌ ${profile} strategy failed:`, error.message);
    }
  }
}

// Run demo if called directly
if (require.main === module) {
  const command = process.argv[3];

  if (command === 'compare') {
    compareStrategies().catch(console.error);
  } else {
    runCarolDemo().catch(console.error);
  }
}