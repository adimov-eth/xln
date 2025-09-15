#!/usr/bin/env bun
/**
 * Integration test: Proves the three engines can actually work together
 */

import { SimpleOrderBook } from '../../src/trading/SimpleOrderBook';
import { applyEntityInput } from '../../src/entity-consensus';
import { EntityReplica, EntityState, ConsensusConfig } from '../../src/types';
import { connectEngines } from '../../src/protocol/glue';
import { ethers } from 'ethers';

async function testEngineIntegration() {
  console.log('🔧 Testing engine integration...\n');

  // 1. Initialize the three engines
  console.log('1️⃣ Initializing isolated engines...');

  // Trading engine
  const orderBook = new SimpleOrderBook('USDC', 'USDT');

  // Channel engine - simplified mock for testing
  const channel = {
    channelId: 'channel-123',
    capacity: {
      inbound: ethers.parseEther('1000'),
      outbound: ethers.parseEther('500')
    },
    getDelta: (chainId: number, tokenId: number, isLeft: boolean) => ({
      ondelta: ethers.parseEther('1000'),
      offdelta: ethers.parseEther('500')
    }),
    deriveDelta: (chainId: number, tokenId: number, isLeft: boolean) => ({
      inCapacity: ethers.parseEther('1500'),
      outCapacity: ethers.parseEther('500'),
      totalCapacity: ethers.parseEther('2000')
    }),
    toJSON: () => ({ channelId: 'channel-123', capacity: 'mock' })
  } as any;

  // Consensus engine
  const consensusEnv = {
    timestamp: Date.now(),
    randomBytes: () => Buffer.from('mock-random-bytes')
  } as any;

  const consensusConfig: ConsensusConfig = {
    threshold: BigInt(1), // Single node for testing
    validators: ['test-validator'],
    shares: { 'test-validator': BigInt(1) },
    mode: 'proposer-based'
  };

  const consensusState: EntityState = {
    height: 0,
    timestamp: Date.now(),
    config: consensusConfig,
    messages: [],
    nonces: {}
  };

  const consensusReplica: EntityReplica = {
    entityId: '0x' + '0'.repeat(64), // Valid hex entity ID
    signerId: 'test-validator',
    isProposer: true,
    state: consensusState,
    mempool: [],
    proposal: undefined,
    lockedFrame: undefined
  };

  console.log('✅ Engines initialized\n');

  // 2. Connect them with glue
  console.log('2️⃣ Connecting engines with glue...');
  const glue = connectEngines(orderBook, channel, consensusEnv, consensusReplica);

  // Track events
  const events: any[] = [];
  glue.on('settlementComplete', (e) => events.push({ type: 'settlement', ...e }));
  glue.on('liquidityUpdated', (e) => events.push({ type: 'liquidity', ...e }));
  glue.on('consensusRecorded', (e) => events.push({ type: 'consensus', ...e }));

  console.log('✅ Engines connected\n');

  // 3. Execute a trade
  console.log('3️⃣ Executing trade...');

  // Add orders
  const alice = ethers.Wallet.createRandom().address;
  const bob = ethers.Wallet.createRandom().address;

  // Create crossing orders - buy price > sell price for match
  orderBook.addOrder('buy', ethers.parseEther('1.0002'), ethers.parseEther('100'), alice);
  orderBook.addOrder('sell', ethers.parseEther('0.9998'), ethers.parseEther('100'), bob);

  // Match orders
  const trades = orderBook.match();
  if (trades.length > 0) {
    console.log(`✅ Trade matched: ${trades[0].id}`);
    console.log(`   Amount: ${ethers.formatEther(trades[0].amount)} USDC`);
    console.log(`   Price: ${ethers.formatEther(trades[0].price)} USDT\n`);

    // Trigger settlement through glue
    glue.executeTrade(trades[0]);
  } else {
    console.log(`❌ No trades matched - orders don't cross\n`);
  }

  // 4. Simulate channel capacity change
  console.log('4️⃣ Simulating channel capacity change...');

  const channelState = channel.deriveDelta(1, 0, true);
  console.log(`   Previous capacity: In=${ethers.formatEther(channelState.inCapacity)}, Out=${ethers.formatEther(channelState.outCapacity)}`);

  // Simulate reduced capacity
  const newState = {
    inCapacity: ethers.parseEther('1500'),
    outCapacity: ethers.parseEther('50'), // Reduced from 500 to 50
    totalCapacity: ethers.parseEther('1550')
  };
  console.log(`   New capacity: In=${ethers.formatEther(newState.inCapacity)}, Out=${ethers.formatEther(newState.outCapacity)}\n`);

  glue.updateChannel(newState);

  // 5. Simulate a dispute
  console.log('5️⃣ Simulating dispute...');

  const disputeEvidence = {
    channelId: channel.channelId,
    reason: 'Invalid state transition',
    disputedState: channel.toJSON(),
    timestamp: Date.now()
  };

  glue.reportDispute(disputeEvidence);

  // Wait for async events
  await new Promise(resolve => setTimeout(resolve, 100));

  // 6. Verify integration
  console.log('\n📊 Integration Results:');
  console.log('─'.repeat(50));

  console.log(`Events captured: ${events.length}`);
  for (const event of events) {
    console.log(`  - ${event.type}: ${event.channelId || event.tradeId || 'recorded'}`);
  }

  // Verify each engine was affected
  const hasSettlement = events.some(e => e.type === 'settlement');
  const hasLiquidity = events.some(e => e.type === 'liquidity');
  const hasConsensus = events.some(e => e.type === 'consensus');

  console.log('\n✅ Verification:');
  console.log(`  Trade → Channel settlement: ${hasSettlement ? '✓' : '✗'}`);
  console.log(`  Channel → Order book update: ${hasLiquidity ? '✓' : '✗'}`);
  console.log(`  Dispute → Consensus record: ${hasConsensus ? '✓' : '✗'}`);

  if (hasSettlement && hasLiquidity && hasConsensus) {
    console.log('\n🎉 SUCCESS: All three engines are connected and communicating!');
  } else {
    console.log('\n❌ FAILURE: Some connections are not working');
  }
}

// Run the test
testEngineIntegration().catch(console.error);