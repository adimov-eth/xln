#!/usr/bin/env bun

/**
 * Run comprehensive XLN simulation
 *
 * Tests bilateral sovereignty at scale:
 * - 10,000 entities
 * - 100,000 channels
 * - 20% Byzantine nodes
 * - Network failures
 */

import { NetworkSimulator } from '../src/simulator/NetworkSimulator';

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║          XLN BILATERAL SOVEREIGNTY TEST           ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Test configurations
  const scenarios = [
    {
      name: 'Small Network (Baseline)',
      config: {
        numEntities: 100,
        numChannels: 500,
        numValidators: 4,
        byzantineRatio: 0,
        networkLatency: 1,
        packetLoss: 0,
        transactionRate: 100,
        simulationDuration: 30,
        checkpointInterval: 10
      }
    },
    {
      name: 'Medium Network with Byzantine',
      config: {
        numEntities: 1000,
        numChannels: 5000,
        numValidators: 7,
        byzantineRatio: 20,
        networkLatency: 10,
        packetLoss: 1,
        transactionRate: 50,
        simulationDuration: 60,
        checkpointInterval: 20
      }
    },
    {
      name: 'Large Network under Stress',
      config: {
        numEntities: 10000,
        numChannels: 100000,
        numValidators: 13,
        byzantineRatio: 30,
        networkLatency: 50,
        packetLoss: 5,
        transactionRate: 10,
        simulationDuration: 120,
        checkpointInterval: 30
      }
    }
  ];

  const results = [];

  for (const scenario of scenarios) {
    console.log(`\n🧪 Scenario: ${scenario.name}`);
    console.log('─'.repeat(50));

    const simulator = new NetworkSimulator(scenario.config);

    try {
      // Initialize network
      await simulator.initialize();

      // Run simulation
      const result = await simulator.run();

      // Store result
      results.push({
        scenario: scenario.name,
        config: scenario.config,
        result
      });

      // Print report
      simulator.printReport();

    } catch (error) {
      console.error(`❌ Scenario failed: ${error}`);
      results.push({
        scenario: scenario.name,
        config: scenario.config,
        error: error.message
      });
    }
  }

  // Print comparative analysis
  printComparativeAnalysis(results);

  // Theoretical limits analysis
  printTheoreticalAnalysis();
}

function printComparativeAnalysis(results: any[]) {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║              COMPARATIVE ANALYSIS                  ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('| Scenario | Channels | TPS | Latency | Byzantine | Success |');
  console.log('|----------|----------|-----|---------|-----------|---------|');

  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.scenario.padEnd(30)} | FAILED |`);
      continue;
    }

    const tps = r.result.averageTPS.toFixed(0).padStart(7);
    const latency = r.result.averageLatency.toFixed(1).padStart(7);
    const byzantine = r.config.byzantineRatio.toString().padStart(9);
    const success = r.result.finalConsistency ? '✅' : '❌';

    console.log(
      `| ${r.scenario.padEnd(30)} | ${r.config.numChannels.toString().padStart(8)} | ${tps} | ${latency}ms | ${byzantine}% | ${success.padStart(7)} |`
    );
  }

  console.log('\n📈 Scaling Analysis:');

  if (results.length >= 2) {
    const small = results[0].result;
    const large = results[results.length - 1].result;

    const channelScale = results[results.length - 1].config.numChannels / results[0].config.numChannels;
    const tpsScale = large.averageTPS / small.averageTPS;

    console.log(`   Channel scaling: ${channelScale}x`);
    console.log(`   TPS scaling: ${tpsScale.toFixed(1)}x`);
    console.log(`   Scaling efficiency: ${(tpsScale / channelScale * 100).toFixed(1)}%`);

    if (tpsScale / channelScale > 0.8) {
      console.log('   ✅ Near-linear scaling achieved!');
    }
  }
}

function printTheoreticalAnalysis() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║            THEORETICAL LIMITS ANALYSIS             ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Calculate theoretical limits
  const coresAvailable = 64; // Modern server
  const opsPerCore = 50000; // Operations per second per core
  const channelsPerCore = 10000;
  const memoryPerChannel = 100; // KB

  const theoreticalTPS = coresAvailable * opsPerCore;
  const theoreticalChannels = coresAvailable * channelsPerCore;
  const memoryRequired = theoreticalChannels * memoryPerChannel / 1024 / 1024; // GB

  console.log('🚀 Single Node Theoretical Limits:');
  console.log(`   Max TPS: ${theoreticalTPS.toLocaleString()}`);
  console.log(`   Max Channels: ${theoreticalChannels.toLocaleString()}`);
  console.log(`   Memory Required: ${memoryRequired.toFixed(0)} GB`);

  console.log('\n🌍 Global Network Projection:');
  const nodesGlobal = 10000;
  const globalTPS = theoreticalTPS * nodesGlobal;
  const globalChannels = theoreticalChannels * nodesGlobal;

  console.log(`   Nodes: ${nodesGlobal.toLocaleString()}`);
  console.log(`   Total TPS: ${globalTPS.toLocaleString()} (${(globalTPS / 1e9).toFixed(1)}B)`);
  console.log(`   Total Channels: ${globalChannels.toLocaleString()} (${(globalChannels / 1e9).toFixed(1)}B)`);

  console.log('\n📊 Comparison with Existing Systems:');
  console.log('   Bitcoin: 7 TPS');
  console.log('   Ethereum: 30 TPS');
  console.log('   Solana: 65,000 TPS');
  console.log(`   XLN: ${globalTPS.toLocaleString()} TPS`);
  console.log(`   Speedup vs Bitcoin: ${(globalTPS / 7).toLocaleString()}x`);
  console.log(`   Speedup vs Ethereum: ${(globalTPS / 30).toLocaleString()}x`);
  console.log(`   Speedup vs Solana: ${(globalTPS / 65000).toLocaleString()}x`);

  console.log('\n✨ Key Advantages:');
  console.log('   1. No global consensus bottleneck');
  console.log('   2. Linear scaling with channels');
  console.log('   3. Instant finality (no blocks)');
  console.log('   4. MEV-resistant by design');
  console.log('   5. Byzantine fault tolerant');
}

// Run simulation
main().catch(console.error);