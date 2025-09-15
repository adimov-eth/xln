#!/usr/bin/env bun
/**
 * XLN Quickstart - Shows how simple XLN can be
 *
 * Run: bun run src/sdk/examples/quickstart.ts
 */

import { XLN } from '../XLN';

async function quickstart() {
  console.log('🚀 XLN Quickstart - Trade Credit in 3 Lines\n');

  // 1. Initialize XLN (one line)
  const xln = new XLN('https://hub.xln.network');

  // 2. Create an invoice (one line)
  const invoice = await xln.createInvoice(1000, 'NET30');

  // 3. Accept payment (one line)
  await xln.acceptPayment(invoice.id);

  console.log('✅ Done! Invoice created and accepted.');
  console.log(`Invoice ID: ${invoice.id}`);
  console.log(`Amount: $1000 USDC`);
  console.log(`Terms: NET30`);
  console.log(`Collateral Required: ${invoice.collateralRequired}%\n`);

  // That's it! Everything else is optional...

  console.log('📊 Optional: More Operations\n');

  // Trading
  const trade = await xln.trade({
    pair: 'USDC/USDT',
    side: 'buy',
    amount: 100,
    price: 0.9999
  });
  console.log(`Trade executed: ${trade.executed}`);
  if (trade.executed) {
    console.log(`Price: ${trade.price}`);
  }

  // Establish credit line
  const creditLine = await xln.establishCredit('partner-entity', 50000);
  console.log(`\nCredit line established: $50,000`);
  console.log(`Trust score: ${creditLine.trustScore}/1000`);

  // Factor an invoice for immediate cash
  const factored = await xln.factorInvoice(invoice.id, 3);
  console.log(`\nInvoice factored:`);
  console.log(`Immediate payment: $${factored.immediatePayment}`);
  console.log(`Discount: $${factored.discount}`);

  // Get credit status
  console.log('\n' + xln.getCreditStatus('partner-entity'));
}

// Run the quickstart
quickstart().catch(console.error);