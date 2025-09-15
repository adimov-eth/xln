#!/usr/bin/env bun

/**
 * XLN Trade Credit Network
 *
 * This is what XLN should actually be - not another payment network,
 * but the first cryptographic trade credit system.
 *
 * Businesses extend credit to each other all the time. XLN can make
 * this programmable with cryptographic guarantees.
 */

import { ethers } from 'ethers';
import { Level } from 'level';

interface Invoice {
  id: string;
  amount: bigint;
  dueDate: number;
  description: string;
  status: 'pending' | 'accepted' | 'paid' | 'disputed';
  metadata?: any;
}

interface CreditTerms {
  limit: bigint;
  utilized: bigint;
  paymentTerms: number; // days
  interestRate: number; // basis points per year
  collateralRatio: number; // percentage
}

interface TradeRelationship {
  counterparty: string;
  ourCredit: CreditTerms;    // Credit we extend to them
  theirCredit: CreditTerms;  // Credit they extend to us
  invoices: Map<string, Invoice>;
  reputation: number;  // 0-1000 score
  totalVolume: bigint;
  onTimePayments: number;
  latePayments: number;
}

class TradeChannel {
  private db: Level<string, string>;
  private relationships: Map<string, TradeRelationship> = new Map();
  private wallet: ethers.Wallet;

  constructor(
    private businessName: string,
    privateKey: string
  ) {
    this.wallet = new ethers.Wallet(privateKey);
    this.db = new Level(`./trade-data/${businessName}`);
  }

  async initialize(): Promise<void> {
    await this.db.open();

    // Load relationships
    try {
      const data = await this.db.get('relationships');
      const parsed = JSON.parse(data, (k, v) => {
        if (typeof v === 'string' && v.endsWith('n')) {
          return BigInt(v.slice(0, -1));
        }
        return v;
      });

      // Reconstruct Maps
      for (const [key, rel] of Object.entries(parsed)) {
        const relationship = rel as any;
        relationship.invoices = new Map(relationship.invoices || []);
        this.relationships.set(key, relationship as TradeRelationship);
      }

      console.log(`📂 Loaded ${this.relationships.size} trade relationships`);
    } catch {
      console.log('🆕 New trade credit network');
    }
  }

  /**
   * Establish credit relationship with another business
   */
  async establishCredit(
    counterparty: string,
    creditToExtend: bigint,
    paymentTerms: number = 30,
    collateralRequired: number = 20  // 20% collateral
  ): Promise<void> {
    const relationship: TradeRelationship = {
      counterparty,
      ourCredit: {
        limit: creditToExtend,
        utilized: 0n,
        paymentTerms,
        interestRate: 500, // 5% APR
        collateralRatio: collateralRequired
      },
      theirCredit: {
        limit: 0n,
        utilized: 0n,
        paymentTerms: 30,
        interestRate: 500,
        collateralRatio: 20
      },
      invoices: new Map(),
      reputation: 500, // Start neutral
      totalVolume: 0n,
      onTimePayments: 0,
      latePayments: 0
    };

    this.relationships.set(counterparty, relationship);
    await this.save();

    console.log(`🤝 Established credit relationship with ${counterparty}`);
    console.log(`   Credit extended: ${ethers.formatEther(creditToExtend)} ETH`);
    console.log(`   Payment terms: Net ${paymentTerms}`);
    console.log(`   Collateral required: ${collateralRequired}%`);
  }

  /**
   * Create and send an invoice
   */
  async createInvoice(
    counterparty: string,
    amount: bigint,
    description: string,
    metadata?: any
  ): Promise<string> {
    const relationship = this.relationships.get(counterparty);
    if (!relationship) {
      throw new Error(`No relationship with ${counterparty}`);
    }

    const invoiceId = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const invoice: Invoice = {
      id: invoiceId,
      amount,
      dueDate: Date.now() + (relationship.theirCredit.paymentTerms * 86400000),
      description,
      status: 'pending',
      metadata
    };

    relationship.invoices.set(invoiceId, invoice);
    await this.save();

    console.log(`📄 Created invoice ${invoiceId}`);
    console.log(`   Amount: ${ethers.formatEther(amount)} ETH`);
    console.log(`   Due: ${new Date(invoice.dueDate).toLocaleDateString()}`);

    return invoiceId;
  }

  /**
   * Accept an invoice (commit to pay)
   */
  async acceptInvoice(
    counterparty: string,
    invoiceId: string
  ): Promise<void> {
    const relationship = this.relationships.get(counterparty);
    if (!relationship) {
      throw new Error(`No relationship with ${counterparty}`);
    }

    const invoice = relationship.invoices.get(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Check credit limit
    const availableCredit = relationship.theirCredit.limit - relationship.theirCredit.utilized;
    const requiredCollateral = (invoice.amount * BigInt(relationship.theirCredit.collateralRatio)) / 100n;

    if (invoice.amount - requiredCollateral > availableCredit) {
      throw new Error(`Insufficient credit: ${ethers.formatEther(invoice.amount)} > ${ethers.formatEther(availableCredit)}`);
    }

    invoice.status = 'accepted';
    relationship.theirCredit.utilized += invoice.amount;
    await this.save();

    console.log(`✅ Accepted invoice ${invoiceId}`);
    console.log(`   Credit utilized: ${ethers.formatEther(relationship.theirCredit.utilized)}/${ethers.formatEther(relationship.theirCredit.limit)}`);
  }

  /**
   * Pay an invoice
   */
  async payInvoice(
    counterparty: string,
    invoiceId: string
  ): Promise<void> {
    const relationship = this.relationships.get(counterparty);
    if (!relationship) {
      throw new Error(`No relationship with ${counterparty}`);
    }

    const invoice = relationship.invoices.get(invoiceId);
    if (!invoice || invoice.status !== 'accepted') {
      throw new Error(`Invoice ${invoiceId} not accepted`);
    }

    // Update credit utilization
    relationship.theirCredit.utilized -= invoice.amount;
    invoice.status = 'paid';

    // Update reputation
    if (Date.now() <= invoice.dueDate) {
      relationship.onTimePayments++;
      relationship.reputation = Math.min(1000, relationship.reputation + 10);
    } else {
      relationship.latePayments++;
      relationship.reputation = Math.max(0, relationship.reputation - 20);
    }

    relationship.totalVolume += invoice.amount;
    await this.save();

    console.log(`💰 Paid invoice ${invoiceId}`);
    console.log(`   New reputation: ${relationship.reputation}`);
  }

  /**
   * Get credit utilization summary
   */
  getUtilizationSummary(): any {
    const summary = {
      businessName: this.businessName,
      address: this.wallet.address,
      relationships: [] as any[]
    };

    for (const [name, rel] of this.relationships) {
      const pending = Array.from(rel.invoices.values())
        .filter(inv => inv.status === 'accepted')
        .reduce((sum, inv) => sum + inv.amount, 0n);

      summary.relationships.push({
        counterparty: name,
        creditExtended: ethers.formatEther(rel.ourCredit.limit),
        creditReceived: ethers.formatEther(rel.theirCredit.limit),
        utilized: ethers.formatEther(rel.theirCredit.utilized),
        pendingPayments: ethers.formatEther(pending),
        reputation: rel.reputation,
        totalVolume: ethers.formatEther(rel.totalVolume),
        performance: `${rel.onTimePayments}/${rel.onTimePayments + rel.latePayments} on-time`
      });
    }

    return summary;
  }

  /**
   * Adjust credit based on payment history
   */
  async adjustCreditLimit(
    counterparty: string,
    newLimit: bigint
  ): Promise<void> {
    const relationship = this.relationships.get(counterparty);
    if (!relationship) {
      throw new Error(`No relationship with ${counterparty}`);
    }

    const oldLimit = relationship.ourCredit.limit;
    relationship.ourCredit.limit = newLimit;

    // Adjust collateral requirements based on reputation
    if (relationship.reputation > 800) {
      relationship.ourCredit.collateralRatio = 10; // Only 10% for excellent reputation
    } else if (relationship.reputation > 600) {
      relationship.ourCredit.collateralRatio = 20;
    } else if (relationship.reputation < 300) {
      relationship.ourCredit.collateralRatio = 50; // 50% for poor reputation
    }

    await this.save();

    console.log(`📊 Adjusted credit for ${counterparty}`);
    console.log(`   Old limit: ${ethers.formatEther(oldLimit)} ETH`);
    console.log(`   New limit: ${ethers.formatEther(newLimit)} ETH`);
    console.log(`   Collateral: ${relationship.ourCredit.collateralRatio}%`);
  }

  private async save(): Promise<void> {
    // Convert Maps to arrays for serialization
    const toSave: any = {};
    for (const [key, rel] of this.relationships) {
      toSave[key] = {
        ...rel,
        invoices: Array.from(rel.invoices.entries())
      };
    }

    await this.db.put('relationships', JSON.stringify(toSave, (k, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      return v;
    }));
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

/**
 * Demo: Supply chain finance scenario
 */
async function runTradeDemo() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('         XLN TRADE CREDIT NETWORK DEMO');
  console.log('═══════════════════════════════════════════════════════');
  console.log();
  console.log('Scenario: Supply chain with credit relationships');
  console.log();

  // Create three businesses
  const manufacturer = new TradeChannel(
    'AcmeManufacturing',
    '0x0000000000000000000000000000000000000000000000000000000000000001'
  );
  const distributor = new TradeChannel(
    'GlobalDistribution',
    '0x0000000000000000000000000000000000000000000000000000000000000002'
  );
  const retailer = new TradeChannel(
    'MegaRetail',
    '0x0000000000000000000000000000000000000000000000000000000000000003'
  );

  await manufacturer.initialize();
  await distributor.initialize();
  await retailer.initialize();

  console.log('Setting up credit relationships...\n');

  // Manufacturer extends credit to distributor
  await manufacturer.establishCredit(
    'GlobalDistribution',
    ethers.parseEther('100000'), // $100k credit line
    60, // Net 60 terms
    15  // 15% collateral
  );

  // Distributor reciprocates with manufacturer (for returns/adjustments)
  await distributor.establishCredit(
    'AcmeManufacturing',
    ethers.parseEther('20000'), // Smaller reciprocal line
    30,
    20
  );

  // Distributor extends credit to retailer
  await distributor.establishCredit(
    'MegaRetail',
    ethers.parseEther('50000'), // $50k credit line
    30, // Net 30 terms
    20  // 20% collateral
  );

  // Retailer reciprocates with distributor
  await retailer.establishCredit(
    'GlobalDistribution',
    ethers.parseEther('10000'), // Smaller reciprocal line
    15,
    25
  );

  console.log('\n📦 Manufacturer ships goods to distributor...\n');

  const invoice1 = await manufacturer.createInvoice(
    'GlobalDistribution',
    ethers.parseEther('10000'),
    'Industrial equipment shipment',
    { items: 100, weight: '5000kg' }
  );

  console.log('\n🚚 Distributor accepts and ships to retailer...\n');

  // Distributor accepts manufacturer's invoice (FIXED: distributor accepts, not manufacturer)
  await distributor.acceptInvoice('AcmeManufacturing', invoice1);

  // Distributor invoices retailer with markup
  const invoice2 = await distributor.createInvoice(
    'MegaRetail',
    ethers.parseEther('12000'), // 20% markup
    'Equipment for retail',
    { items: 100, source: invoice1 }
  );

  // Retailer accepts distributor's invoice
  await retailer.acceptInvoice('GlobalDistribution', invoice2);

  console.log('\n💰 Retailer pays distributor (on time)...\n');
  await retailer.payInvoice('GlobalDistribution', invoice2);

  console.log('\n💰 Distributor pays manufacturer (on time)...\n');
  await distributor.payInvoice('AcmeManufacturing', invoice1);

  console.log('\n📊 Credit network summary:\n');
  console.log('Manufacturer:', manufacturer.getUtilizationSummary());
  console.log('\nDistributor:', distributor.getUtilizationSummary());
  console.log('\nRetailer:', retailer.getUtilizationSummary());

  console.log('\n🎯 Adjusting credit based on performance...\n');

  // Increase credit for good payment history
  await manufacturer.adjustCreditLimit(
    'GlobalDistribution',
    ethers.parseEther('150000') // Increase to $150k
  );

  // Close connections
  await manufacturer.close();
  await distributor.close();
  await retailer.close();

  console.log('✅ Demo complete!');
  console.log('\nKey insights:');
  console.log('• Credit extends beyond collateral (like real business)');
  console.log('• Payment terms are programmable (Net 30/60/90)');
  console.log('• Reputation affects credit limits and collateral');
  console.log('• No global consensus needed - each relationship is sovereign');
  console.log('• Disputes only hit chain as last resort');
}

if (import.meta.main) {
  runTradeDemo().catch(console.error);
}