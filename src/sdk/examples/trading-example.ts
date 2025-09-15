#!/usr/bin/env bun
/**
 * Trading Example - Shows honest spread capture
 *
 * Run: bun run src/sdk/examples/trading-example.ts
 */

import { XLN } from '../XLN';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

async function tradingExample() {
  console.log(colors.cyan + colors.bright);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              XLN TRADING - ZERO FEES FOREVER');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(colors.reset);

  // Initialize traders
  const alice = new XLN({
    hubUrl: 'https://hub.xln.network',
    entityId: 'alice'
  });

  const bob = new XLN({
    hubUrl: 'https://hub.xln.network',
    entityId: 'bob'
  });

  const charlie = new XLN({
    hubUrl: 'https://hub.xln.network',
    entityId: 'charlie'
  });

  console.log(colors.yellow + '\n📊 STEP 1: Alice provides liquidity\n' + colors.reset);

  // Alice places buy orders
  await alice.trade({
    pair: 'USDC/USDT',
    side: 'buy',
    amount: 1000,
    price: 0.9998
  });
  console.log('Alice: BUY 1000 USDC @ 0.9998 USDT');

  await alice.trade({
    pair: 'USDC/USDT',
    side: 'buy',
    amount: 2000,
    price: 0.9997
  });
  console.log('Alice: BUY 2000 USDC @ 0.9997 USDT');

  // Bob places sell orders
  console.log(colors.yellow + '\n📊 STEP 2: Bob provides liquidity on the other side\n' + colors.reset);

  await bob.trade({
    pair: 'USDC/USDT',
    side: 'sell',
    amount: 1000,
    price: 1.0002
  });
  console.log('Bob: SELL 1000 USDC @ 1.0002 USDT');

  await bob.trade({
    pair: 'USDC/USDT',
    side: 'sell',
    amount: 2000,
    price: 1.0003
  });
  console.log('Bob: SELL 2000 USDC @ 1.0003 USDT');

  // Show order book
  console.log(colors.yellow + '\n📊 STEP 3: Order book state\n' + colors.reset);

  const book = alice.getOrderBook('USDC/USDT');
  console.log('USDC/USDT Order Book:');
  console.log('─'.repeat(40));

  // Show asks
  for (const ask of book.asks.reverse()) {
    console.log(colors.red + `  SELL ${ask.amount} @ ${ask.price}` + colors.reset);
  }

  if (book.spread) {
    console.log(colors.yellow + `  ━━━ Spread: ${book.spread} ━━━` + colors.reset);
  }

  // Show bids
  for (const bid of book.bids) {
    console.log(colors.green + `  BUY  ${bid.amount} @ ${bid.price}` + colors.reset);
  }

  console.log(colors.yellow + '\n💱 STEP 4: Charlie places a market order\n' + colors.reset);

  const trade = await charlie.trade({
    pair: 'USDC/USDT',
    side: 'buy',
    amount: 500
    // No price = market order
  });

  if (trade.executed) {
    console.log(colors.green + `✅ Market order executed at ${trade.price} USDT` + colors.reset);
    console.log('\nTrade Receipt:');
    console.log(trade.receipt);
  }

  // Show stats
  console.log(colors.yellow + '\n📊 STEP 5: Trading Statistics\n' + colors.reset);

  const stats = alice.getStats('USDC/USDT');
  console.log(`Total Trades: ${stats.totalTrades}`);
  console.log(`Total Volume: ${stats.totalVolume} USDC`);
  console.log(`Spread Captured: ${stats.totalSpreadCaptured} USDT`);
  console.log(`Average Spread: ${stats.averageSpread} USDT`);
  console.log(`Last Price: ${stats.lastPrice} USDT`);

  console.log(colors.bright + colors.cyan);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        THE TRUTH');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(colors.reset);
  console.log('• Zero fees for traders - revenue from honest spread');
  console.log('• Every receipt shows exactly who earned what');
  console.log('• Bilateral price discovery - no global oracle');
  console.log('• This is how value actually moves between entities');
  console.log('• Not another DEX. Honest infrastructure.\n');
}

tradingExample().catch(console.error);