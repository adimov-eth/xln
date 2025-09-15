#!/usr/bin/env bun
/**
 * B2B Trade Credit Workflow
 *
 * This demonstrates a real B2B scenario:
 * - Supplier extends credit to buyer
 * - Progressive trust reduces collateral over time
 * - Invoice factoring for immediate liquidity
 *
 * Run: bun run src/sdk/examples/b2b-workflow.ts
 */

import { XLN } from '../XLN';
import { ethers } from 'ethers';

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

async function simulateB2BWorkflow() {
  console.log(colors.cyan + colors.bright);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('            B2B TRADE CREDIT - PROGRESSIVE TRUST');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(colors.reset);

  // Initialize supplier and buyer
  const supplier = new XLN({
    hubUrl: 'https://hub.xln.network',
    entityId: 'supplier-inc',
    baseCurrency: 'USDC'
  });

  const buyer = new XLN({
    hubUrl: 'https://hub.xln.network',
    entityId: 'buyer-corp',
    baseCurrency: 'USDC'
  });

  // Establish credit relationship
  console.log(colors.yellow + '\n📋 STEP 1: Establish Credit Relationship\n' + colors.reset);

  const creditLine = await supplier.establishCredit('buyer-corp', 100000, 20);
  console.log(`Supplier extends $100,000 credit line to Buyer`);
  console.log(`Initial collateral requirement: 20%`);
  console.log(`Trust score: ${creditLine.trustScore}/1000 (neutral start)\n`);

  // First invoice - requires 20% collateral
  console.log(colors.yellow + '📋 STEP 2: First Invoice (20% collateral required)\n' + colors.reset);

  const invoice1 = await supplier.createInvoice(10000, 'NET30', 'buyer-corp');
  console.log(`Invoice created: ${invoice1.id}`);
  console.log(`Amount: $10,000 USDC`);
  console.log(`Terms: NET30`);
  console.log(`Collateral required: ${invoice1.collateralRequired}%`);

  await buyer.acceptPayment(invoice1.id, 2000); // 20% of 10,000
  console.log(colors.green + '✅ Buyer accepts with $2,000 collateral\n' + colors.reset);

  // Pay on time to build trust
  console.log(colors.yellow + '📋 STEP 3: Pay On Time to Build Trust\n' + colors.reset);

  const payment1 = await buyer.pay(invoice1.id);
  console.log(`Payment completed!`);
  console.log(`Days late: ${payment1.daysLate}`);
  console.log(colors.green + `New trust score: ${payment1.newTrustScore}/1000 ⬆️\n` + colors.reset);

  // Simulate multiple successful payments
  console.log(colors.yellow + '📋 STEP 4: Build Payment History\n' + colors.reset);

  for (let i = 2; i <= 5; i++) {
    const invoice = await supplier.createInvoice(5000 + i * 1000, 'NET30', 'buyer-corp');
    await buyer.acceptPayment(invoice.id);
    const payment = await buyer.pay(invoice.id);
    console.log(`Invoice ${i}: Paid on time. Trust score: ${payment.newTrustScore}`);
  }

  // Check improved credit status
  console.log(colors.yellow + '\n📊 STEP 5: Check Improved Credit Status\n' + colors.reset);
  console.log(supplier.getCreditStatus('buyer-corp'));

  // Create larger invoice with reduced collateral
  console.log(colors.yellow + '📋 STEP 6: Larger Invoice with Less Collateral\n' + colors.reset);

  const invoice6 = await supplier.createInvoice(25000, 'NET60', 'buyer-corp');
  console.log(`Large invoice created: $25,000`);
  console.log(`Terms: NET60 (longer terms due to trust)`);
  console.log(colors.green + `Collateral required: ${invoice6.collateralRequired}% (reduced!)` + colors.reset);

  await buyer.acceptPayment(invoice6.id);
  console.log('✅ Buyer accepts with reduced collateral\n');

  // Factor invoice for immediate liquidity
  console.log(colors.yellow + '💰 STEP 7: Factor Invoice for Immediate Cash\n' + colors.reset);

  const factored = await supplier.factorInvoice(invoice6.id, 2.5);
  console.log('Supplier factors the invoice:');
  console.log(`Face value: $25,000`);
  console.log(`Immediate payment: $${factored.immediatePayment}`);
  console.log(`Factor's fee: $${factored.discount} (2.5%)`);
  console.log(colors.green + '\n✅ Supplier gets immediate liquidity!\n' + colors.reset);

  // Show the factoring receipt
  console.log(colors.cyan + 'Factoring Receipt:' + colors.reset);
  console.log(factored.receipt);

  // Summary
  console.log(colors.bright + colors.magenta);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                        KEY INSIGHTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(colors.reset);
  console.log('1. Trust builds progressively - collateral drops with good history');
  console.log('2. No 150% overcollateralization like DeFi');
  console.log('3. Invoice factoring provides immediate liquidity');
  console.log('4. This is how $10 trillion in B2B credit actually works');
  console.log('5. XLN digitizes existing trust relationships, not inventing new ones\n');
}

// Run the workflow
simulateB2BWorkflow().catch(console.error);