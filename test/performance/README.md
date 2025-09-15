# XLN TPS Benchmark Suite

Comprehensive performance tests proving XLN can handle 18+ TPS under realistic conditions.

## 🎯 What This Proves

### Core Objectives
- **18+ TPS**: Real transaction throughput under load
- **Mixed Users**: Custodial and trustless users trading seamlessly
- **Byzantine Tolerance**: Consensus works despite malicious actors
- **Cross-Settlement**: HTLCs enable trustless cross-chain trades
- **Zero Costs**: Only gas for channel operations, no per-trade fees
- **Real Load**: Power-law order distribution, network latency, burst traffic

### Architecture Validated
- **J-Layer**: Collateral requirements and slashing for misbehavior
- **E-Layer**: Entity consensus with Byzantine fault tolerance
- **A-Layer**: Bilateral payment channels with credit extensions
- **Integration**: Seamless bridging between layers

## 🚀 Quick Start

```bash
# Run standard benchmark (60s, 100 users)
bun run benchmark

# Quick test (30s, 50 users)
bun run benchmark:quick

# Full stress test (2min + additional scenarios)
bun run benchmark:stress

# Run individual tests
bun run test:tps          # Main TPS benchmark
bun run test:stress       # Stress scenarios
```

## 📊 Test Components

### 1. Main TPS Benchmark (`tps-benchmark.ts`)
The primary test that simulates realistic trading conditions:

- **100 Users**: 50 custodial (zero gas), 50 trustless (channel gas only)
- **Realistic Orders**: Power-law distribution (80% small, 15% medium, 5% whale)
- **Multiple Pairs**: ETH/USDC, BTC/USDC, SOL/USDC, AVAX/USDC
- **Network Latency**: 0-50ms simulated network delays
- **Byzantine Validators**: 7 validators with 2 Byzantine actors
- **Cross-Settlement**: 20% of trades use HTLCs
- **Market Orders**: 30% market, 70% limit orders

**Success Criteria:**
- ≥18.0 TPS sustained throughput
- <500ms P95 latency
- >95% order success rate
- >95% HTLC success rate
- >90% consensus success despite Byzantine behavior

### 2. Stress Scenarios (`stress-scenarios.ts`)
Additional edge case testing:

- **Network Partitions**: Split-brain scenarios
- **Large Orders**: Market impact from whale trades
- **Mass Cancellations**: 1000+ order cancellations
- **Byzantine Attacks**: Coordinated malicious behavior
- **Memory Pressure**: Performance under resource constraints

### 3. Test Infrastructure
- **`test-validator-node.ts`**: Lightweight consensus simulator
- **`run-benchmark.ts`**: CLI runner with options
- **Interactive Reports**: HTML charts showing performance

## 📈 Generated Reports

### HTML Report (`tps-benchmark-report.html`)
Interactive report with visualizations:
- Real-time TPS over time
- Consensus round performance
- Latency distribution histograms
- Memory usage tracking
- Byzantine activity detection

### Summary Report (`benchmark-summary.md`)
Key metrics and pass/fail results for each objective.

## 🏗️ Simulated Architecture

### Users (100 total)
```
Custodial (50):          Trustless (50):
┌─────────────────┐      ┌─────────────────────────────┐
│ No gas costs    │      │ Entity + Channel Bridge     │
│ Hub liquidity   │      │ Self-sovereign              │
│ Instant trades  │      │ Channel gas only            │
└─────────────────┘      └─────────────────────────────┘
```

### Matching Engine
```
┌─────────────────────────────────────────┐
│ OptimizedOrderBook                      │
│ ├── ETH/USDC, BTC/USDC, SOL/USDC       │
│ ├── Circuit breakers                    │
│ ├── Congestion pricing                  │
│ └── Cross-settlement HTLCs              │
└─────────────────────────────────────────┘
```

### Consensus Layer (7 validators)
```
Honest (5):              Byzantine (2):
┌─────────────────┐      ┌─────────────────────────────┐
│ Always vote     │      │ 30% fault probability      │
│ Follow protocol │      │ Double-vote, withhold, etc  │
│ Propose fairly  │      │ Test BFT resilience        │
└─────────────────┘      └─────────────────────────────┘
```

## 🎮 Usage Examples

### Standard Benchmark
```bash
bun run benchmark
# Runs 60-second test with 100 users
# Generates HTML report and summary
```

### Custom Duration
```bash
bun test/performance/run-benchmark.ts --duration 120
# 2-minute test for more data points
```

### Stress Testing
```bash
bun run benchmark:stress
# Includes network partitions, Byzantine attacks
# Mass cancellations, memory pressure
```

### Quick Validation
```bash
bun run benchmark:quick
# 30-second test with 50 users
# Faster feedback during development
```

## 📋 Interpreting Results

### Success Indicators
- **TPS ≥ 18.0**: Core objective met
- **P95 < 500ms**: Acceptable latency
- **Success Rate > 95%**: High reliability
- **Consensus > 90%**: Byzantine fault tolerance
- **Gas < $20k total**: Cost efficiency

### Warning Signs
- TPS < 18.0: Performance bottleneck
- P95 > 1000ms: Latency issues
- Success < 90%: Reliability problems
- Consensus < 80%: Byzantine vulnerability
- Memory growth: Leak or inefficiency

### Charts to Check
- **Order Flow**: Should show consistent growth
- **Consensus**: Should have high success rate despite Byzantine rounds
- **Latency**: Should cluster in 0-100ms range
- **Memory**: Should be stable over time

## 🔧 Configuration

### Environment Variables
```bash
BENCHMARK_DURATION=60    # Test duration in seconds
BENCHMARK_USERS=100      # Number of simulated users
```

### Test Parameters
Edit test files to adjust:
- Order size distribution
- Byzantine fault probability
- Network latency ranges
- Circuit breaker thresholds
- HTLC success rates

## 🐛 Troubleshooting

### Low TPS
- Check order matching logic
- Verify consensus isn't blocking
- Look for bottlenecks in critical paths

### High Latency
- Network simulation too aggressive
- Consensus rounds taking too long
- Memory pressure slowing operations

### Test Failures
- Byzantine actors too aggressive
- Unrealistic network conditions
- System resource constraints

### Report Generation Issues
- Check file permissions
- Verify Chart.js CDN access
- Ensure sufficient disk space

## 🚀 Future Enhancements

### Potential Additions
- Multi-hub routing tests
- Cross-chain settlement validation
- Real network testing (not just simulation)
- Economic attack simulations
- Hardware performance profiling

### Scalability Testing
- 1000+ user scenarios
- Multi-datacenter simulation
- Regional network partitions
- Database performance under load

---

*This benchmark suite provides comprehensive validation of XLN's ability to handle production-scale trading loads while maintaining decentralization, security, and cost efficiency.*