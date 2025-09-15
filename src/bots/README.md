# Carol Market Maker Bot

**Carol is the backbone of XLN liquidity** - a sophisticated market making bot that provides unified liquidity across both custodial accounts and trustless bilateral channels.

## 🚀 Key Features

### Unified Liquidity Provision
- **Custodial Integration**: Fast execution through trusted accounts
- **Trustless Integration**: Cryptographic settlement through bilateral channels
- **Cross-Settlement**: Seamlessly bridges liquidity between both systems
- **Capital Efficiency**: Single capital pool serves both markets

### Advanced Market Making Strategies

#### 🔲 Grid Trading
- Dynamic grid levels with configurable spacing
- Inventory-aware position sizing
- Automatic grid rebalancing on price moves
- Volatility-adjusted spread widening

#### ⚡ Arbitrage Detection
- Real-time cross-exchange price monitoring
- Automated arbitrage execution
- Configurable profit thresholds
- Risk-adjusted position sizing

#### ⚖️ Risk Management
- Position limits per asset
- Daily drawdown protection
- Automatic emergency halts
- Gas price monitoring

#### 📊 Performance Analytics
- Real-time P&L tracking
- Sharpe ratio calculation
- Fill rate monitoring
- Inventory turnover metrics

## 📋 Configuration

Carol uses JSON configuration files with multiple strategy profiles:

```bash
# Development (moderate risk)
npm run carol:dev

# Production (balanced)
npm run carol:prod

# Conservative (low risk, stable markets)
npm run carol:conservative

# Aggressive (high risk, volatile markets)
npm run carol:aggressive
```

### Configuration Parameters

```json
{
  "pairs": ["ETH/USD", "BTC/USD"],           // Trading pairs
  "capitalPerPair": "100000",                // Capital allocation per pair
  "maxPositionSize": "50000",                // Max inventory per asset
  "maxDailyDrawdown": 0.05,                  // Max 5% daily loss

  "gridLevels": 5,                           // Number of price levels
  "baseSpread": 20,                          // Base spread in basis points
  "gridSpacing": 50,                         // Spacing between levels

  "enableArbitrage": true,                   // Enable arbitrage
  "arbThreshold": 25,                        // Min arbitrage profit (bps)

  "updateInterval": 5000                     // Quote update frequency (ms)
}
```

## 🎯 Usage

### Basic Setup

```typescript
import { CarolMarketMaker, createCarolMarketMaker } from './CarolMarketMaker';
import { UnifiedLiquidityBridge } from '../core/UnifiedLiquidityBridge';

// Create bridge
const bridge = new UnifiedLiquidityBridge();

// Create Carol with default config
const carol = createCarolMarketMaker(bridge);

// Setup accounts
bridge.addCustodialAccount({
  id: 'carol_custodial',
  balances: new Map([
    ['ETH', ethers.parseEther('1000')],
    ['USD', ethers.parseUnits('5000000', 6)]
  ]),
  nonce: 0n,
  tradingEnabled: true
});

// Start market making
await carol.start();
```

### Custom Configuration

```typescript
const customConfig = {
  pairs: ['ETH/USD', 'BTC/USD', 'USDT/USD'],
  capitalPerPair: ethers.parseEther('500000'),
  gridLevels: 8,
  baseSpread: 15,
  enableArbitrage: true,
  maxDailyDrawdown: 0.03
};

const carol = createCarolMarketMaker(bridge, customConfig);
```

### Event Monitoring

```typescript
carol.on('grid_updated', (event) => {
  console.log(`Grid updated for ${event.pair}: ${event.orders} orders`);
});

carol.on('arbitrage_executed', (event) => {
  console.log(`Arbitrage: ${event.side} ${event.pair} @ ${event.price}`);
});

carol.on('emergency_halt', (event) => {
  console.error(`HALT: ${event.reason}`);
});
```

### Performance Metrics

```typescript
const metrics = carol.getPerformanceMetrics();

console.log(`Total P&L: ${metrics.totalPnL}`);
console.log(`Sharpe Ratio: ${metrics.sharpeRatio}`);
console.log(`Fill Rate: ${metrics.fillRate * 100}%`);
console.log(`Spread Captured: ${metrics.spreadCaptured}`);
```

## 🧠 Strategy Deep Dive

### Grid Trading Algorithm

1. **Price Discovery**: Fetch mid price from order book
2. **Volatility Adjustment**: Calculate rolling volatility
3. **Dynamic Spread**: Adjust spread based on market conditions
4. **Grid Generation**: Create buy/sell orders at regular intervals
5. **Inventory Management**: Adjust order sizes based on current position
6. **Continuous Monitoring**: Update grid when price moves significantly

### Risk Management Framework

```typescript
// Position limits
if (position.baseInventory > config.maxPositionSize) {
  await carol.emergencyHalt('Position limit exceeded');
}

// Drawdown protection
if (dailyDrawdown < -config.maxDailyDrawdown) {
  await carol.emergencyHalt('Daily drawdown limit exceeded');
}

// Gas price monitoring
if (gasPrice > config.gasThreshold) {
  // Skip trading until gas normalizes
}
```

### Cross-Settlement Innovation

Carol's key innovation is providing liquidity that works for BOTH custodial and trustless trades:

```typescript
// Custodial order
await bridge.submitOrder({
  source: OrderSource.CUSTODIAL,
  accountId: 'carol_custodial',
  // ... order details
});

// Trustless order
await bridge.submitOrder({
  source: OrderSource.TRUSTLESS,
  channelId: 'carol_channel',
  // ... order details
});
```

When custodial traders match with trustless traders, the UnifiedLiquidityBridge handles cross-settlement using HTLCs (Hash Time Locked Contracts).

## 📊 Performance Metrics

### Core Metrics

- **Total P&L**: Cumulative profit/loss across all pairs
- **Daily P&L**: Today's profit/loss
- **Max Drawdown**: Largest peak-to-trough decline
- **Sharpe Ratio**: Risk-adjusted return measure
- **Fill Rate**: Percentage of orders that execute
- **Inventory Turnover**: How frequently capital cycles

### Per-Pair Metrics

- **Volume 24h**: Trading volume per pair
- **Average Spread**: Mean spread captured
- **Trade Count**: Number of executed trades
- **Pair P&L**: Profit/loss per trading pair

### Risk Metrics

- **Position Imbalance**: Deviation from target inventory
- **Volatility Exposure**: Risk from price movements
- **Gas Efficiency**: Cost of transaction execution

## 🚀 Demo & Testing

### Quick Demo
```bash
# Run development demo
npm run demo:carol

# Run with specific strategy
npm run demo:carol conservative

# Compare strategies
npm run demo:carol compare
```

### Performance Testing
```bash
# Load test with high-frequency trading
npm run test:carol:performance

# Stress test with extreme market conditions
npm run test:carol:stress

# Backtest on historical data
npm run test:carol:backtest
```

## 🔧 Advanced Features

### Custom Strategies

Implement custom market making strategies by extending the base class:

```typescript
class CarolArbitrageBot extends CarolMarketMaker {
  protected async checkArbitrageOpportunities(): Promise<void> {
    // Custom arbitrage logic
    const opportunities = await this.scanMultipleExchanges();
    for (const opp of opportunities) {
      await this.executeArbitrage(opp);
    }
  }
}
```

### Plugin Architecture

Add custom indicators and signals:

```typescript
carol.addIndicator('RSI', new RSIIndicator(14));
carol.addIndicator('MACD', new MACDIndicator(12, 26, 9));

carol.on('indicator_signal', (signal) => {
  if (signal.indicator === 'RSI' && signal.value < 30) {
    // Increase buy orders in oversold market
  }
});
```

## 🏗️ Architecture

```
CarolMarketMaker
├── Grid Trading Engine
│   ├── Price Discovery
│   ├── Volatility Calculation
│   ├── Dynamic Spread Adjustment
│   └── Order Placement
├── Arbitrage Engine
│   ├── Cross-Exchange Monitoring
│   ├── Opportunity Detection
│   └── Execution Logic
├── Risk Management
│   ├── Position Monitoring
│   ├── Drawdown Protection
│   └── Emergency Halt System
└── Performance Analytics
    ├── Real-time Metrics
    ├── Historical Analysis
    └── Reporting Dashboard
```

## 🔮 Future Enhancements

### Planned Features

- **Machine Learning**: Neural network for spread optimization
- **Multi-Chain**: Cross-chain arbitrage opportunities
- **Advanced Orders**: Stop-loss, take-profit, iceberg orders
- **Social Trading**: Copy trading and strategy sharing
- **Yield Farming**: Automated liquidity provision rewards

### Integration Roadmap

- **DeFi Protocols**: Integration with Uniswap, Curve, Balancer
- **CeFi Exchanges**: Binance, Coinbase, Kraken connectivity
- **Oracle Networks**: Chainlink, Band Protocol price feeds
- **Analytics Platforms**: Integration with DeFiPulse, DexTools

## 📚 References

- [XLN Unified Liquidity Architecture](../core/UnifiedLiquidityBridge.ts)
- [Matching Engine Implementation](../trading/MatchingEngine.ts)
- [Order Book Optimization](../trading/OptimizedOrderBook.ts)
- [Trade Credit System](../trading/OptimizedTradeCredit.ts)

---

**Carol represents the future of market making** - unified liquidity across custodial and trustless systems, powered by sophisticated algorithms and comprehensive risk management.

*Built with ❤️ for the XLN ecosystem*