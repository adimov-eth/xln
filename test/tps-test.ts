#!/usr/bin/env bun

/**
 * TPS Performance Test
 *
 * Tests the actual throughput of XLN Core
 */

import { ethers } from 'ethers';

const API_URL = 'http://localhost:8889';

interface TestResult {
  totalOrders: number;
  successfulOrders: number;
  failedOrders: number;
  duration: number;
  tps: number;
  avgLatency: number;
}

// Generate random orders
function generateOrder() {
  const side = Math.random() > 0.5 ? 'buy' : 'sell';
  const price = 4000 + Math.floor(Math.random() * 500);
  const amount = 0.01 + Math.random() * 0.1;

  return {
    source: Math.random() > 0.5 ? 'custodial' : 'trustless',
    account: Math.random() > 0.5 ? 'alice' : 'bob',
    channel: 'alice-bob-channel',
    pair: 'ETH/USDC',
    side,
    price: ethers.parseUnits(price.toString(), 6).toString(),
    amount: ethers.parseEther(amount.toString()).toString()
  };
}

// Submit order via HTTP
async function submitOrder(order: any): Promise<{ success: boolean; latency: number }> {
  const start = performance.now();

  try {
    const response = await fetch(`${API_URL}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });

    const success = response.ok;
    const latency = performance.now() - start;

    return { success, latency };
  } catch (error) {
    return { success: false, latency: performance.now() - start };
  }
}

// Run batch of orders concurrently
async function runBatch(batchSize: number): Promise<{ successful: number; latencies: number[] }> {
  const promises = [];

  for (let i = 0; i < batchSize; i++) {
    const order = generateOrder();
    promises.push(submitOrder(order));
  }

  const results = await Promise.all(promises);

  return {
    successful: results.filter(r => r.success).length,
    latencies: results.map(r => r.latency)
  };
}

// Main test
async function runTest(totalOrders: number, concurrency: number): Promise<TestResult> {
  console.log(`\n🚀 Starting TPS test: ${totalOrders} orders with concurrency ${concurrency}\n`);

  const start = performance.now();
  let successfulOrders = 0;
  let allLatencies: number[] = [];

  // Process in batches
  const batches = Math.ceil(totalOrders / concurrency);

  for (let i = 0; i < batches; i++) {
    const batchSize = Math.min(concurrency, totalOrders - i * concurrency);
    const { successful, latencies } = await runBatch(batchSize);

    successfulOrders += successful;
    allLatencies.push(...latencies);

    // Progress indicator
    if ((i + 1) % 10 === 0) {
      const processed = Math.min((i + 1) * concurrency, totalOrders);
      console.log(`   Processed ${processed}/${totalOrders} orders...`);
    }
  }

  const duration = (performance.now() - start) / 1000; // in seconds
  const tps = successfulOrders / duration;
  const avgLatency = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;

  return {
    totalOrders,
    successfulOrders,
    failedOrders: totalOrders - successfulOrders,
    duration,
    tps,
    avgLatency
  };
}

// Format results
function formatResults(result: TestResult) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('                  TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`📊 Total Orders:      ${result.totalOrders}`);
  console.log(`✅ Successful:        ${result.successfulOrders}`);
  console.log(`❌ Failed:            ${result.failedOrders}`);
  console.log(`⏱️  Duration:          ${result.duration.toFixed(2)} seconds`);
  console.log(`🚀 Throughput:        ${result.tps.toFixed(2)} TPS`);
  console.log(`📏 Avg Latency:       ${result.avgLatency.toFixed(2)} ms`);
  console.log(`💯 Success Rate:      ${((result.successfulOrders / result.totalOrders) * 100).toFixed(1)}%`);

  console.log('\n═══════════════════════════════════════════════════════\n');
}

// Main
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('            XLN PERFORMANCE TEST');
  console.log('═══════════════════════════════════════════════════════');

  // Wait for server to be ready
  console.log('\n⏳ Waiting for XLN Core to be ready...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Run tests with increasing load
  const tests = [
    { orders: 100, concurrency: 10 },
    { orders: 500, concurrency: 50 },
    { orders: 1000, concurrency: 100 },
    { orders: 5000, concurrency: 200 }
  ];

  for (const test of tests) {
    const result = await runTest(test.orders, test.concurrency);
    formatResults(result);

    // Cool down between tests
    if (test !== tests[tests.length - 1]) {
      console.log('⏳ Cooling down...\n');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Get final state
  console.log('📊 Fetching final order book state...\n');

  try {
    const response = await fetch(`${API_URL}/orderbook`);
    const orderbook = await response.json();

    console.log(`Final order book: ${orderbook.bids.length} bids, ${orderbook.asks.length} asks`);

    const matchesResponse = await fetch(`${API_URL}/matches?limit=10`);
    const matches = await matchesResponse.json();

    console.log(`Total matches executed: ${matches.length}`);
  } catch (error) {
    console.error('Failed to fetch final state:', error);
  }

  console.log('\n✅ Performance test complete!\n');
}

// Run if main
if (import.meta.main) {
  main().catch(console.error);
}