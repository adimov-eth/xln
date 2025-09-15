/**
 * TradeCredit - The REAL XLN vision
 *
 * Not another payment network. The first cryptographic trade credit system.
 * $10 trillion B2B market waiting to be digitized.
 */

import { ethers } from 'ethers';
import { SimpleOrderBook } from './SimpleOrderBook';

export interface Invoice {
  id: string;
  from: string;
  to: string;
  amount: bigint;
  currency: string;
  terms: 'NET15' | 'NET30' | 'NET60' | 'NET90';
  dueDate: number;
  status: 'pending' | 'accepted' | 'paid' | 'overdue' | 'disputed';
  collateralRequired: number; // Percentage (0-100)
  items: InvoiceItem[];
  metadata: Record<string, any>;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: bigint;
  total: bigint;
}

export interface CreditLine {
  counterparty: string;
  limit: bigint;
  utilized: bigint;
  collateralRatio: number; // Starting collateral requirement
  paymentHistory: PaymentRecord[];
  trustScore: number; // 0-1000
}

export interface PaymentRecord {
  invoiceId: string;
  amount: bigint;
  dueDate: number;
  paidDate: number | null;
  daysLate: number;
}

export class TradeCredit {
  private invoices: Map<string, Invoice> = new Map();
  private creditLines: Map<string, CreditLine> = new Map();
  private orderBook: SimpleOrderBook;
  private invoiceCounter = 0;

  constructor(
    private entityId: string,
    private baseCurrency: string = 'USDC'
  ) {
    // Create order book for invoice factoring
    this.orderBook = new SimpleOrderBook('INVOICE', baseCurrency, {
      makerPercent: 40,  // Invoice seller gets less
      takerPercent: 50,  // Factor gets more for risk
      hubPercent: 10
    });
  }

  /**
   * Create an invoice with dynamic collateral based on trust
   */
  createInvoice(
    to: string,
    items: InvoiceItem[],
    terms: Invoice['terms'] = 'NET30'
  ): Invoice {
    const creditLine = this.creditLines.get(to);
    const amount = items.reduce((sum, item) => sum + item.total, 0n);

    // Calculate collateral requirement based on payment history
    let collateralRequired = 20; // Default 20%

    if (creditLine) {
      const trustScore = this.calculateTrustScore(creditLine);
      creditLine.trustScore = trustScore;

      // Progressive trust - less collateral with good history
      if (trustScore > 900) collateralRequired = 0;      // No collateral!
      else if (trustScore > 800) collateralRequired = 5;  // 5%
      else if (trustScore > 700) collateralRequired = 10; // 10%
      else if (trustScore > 600) collateralRequired = 15; // 15%
      // Below 600 stays at 20%

      // Check credit limit
      if (creditLine.utilized + amount > creditLine.limit) {
        throw new Error(`Credit limit exceeded: ${ethers.formatEther(creditLine.limit)} ${this.baseCurrency}`);
      }
    }

    // Calculate due date
    const daysMap = { NET15: 15, NET30: 30, NET60: 60, NET90: 90 };
    const dueDate = Date.now() + (daysMap[terms] * 24 * 60 * 60 * 1000);

    const invoice: Invoice = {
      id: `INV-${Date.now()}-${this.invoiceCounter++}`,
      from: this.entityId,
      to,
      amount,
      currency: this.baseCurrency,
      terms,
      dueDate,
      status: 'pending',
      collateralRequired,
      items,
      metadata: {}
    };

    this.invoices.set(invoice.id, invoice);

    // Update credit utilization
    if (creditLine) {
      creditLine.utilized += amount;
    }

    return invoice;
  }

  /**
   * Accept an invoice (buyer commits to pay)
   */
  acceptInvoice(invoiceId: string, collateral: bigint): void {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    const requiredCollateral = (invoice.amount * BigInt(invoice.collateralRequired)) / 100n;

    if (collateral < requiredCollateral) {
      throw new Error(`Insufficient collateral: ${ethers.formatEther(collateral)} < ${ethers.formatEther(requiredCollateral)}`);
    }

    invoice.status = 'accepted';
  }

  /**
   * Factor an invoice (sell it for immediate cash)
   */
  factorInvoice(
    invoiceId: string,
    discountRate: number // Percentage discount (e.g., 3 = 3% discount)
  ): {
    immediatePayment: bigint,
    factorProfit: bigint,
    receipt: string
  } {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'accepted') throw new Error('Invoice must be accepted first');

    const faceValue = invoice.amount;
    // Handle decimal discount rates by multiplying by 100
    const discountAmount = (faceValue * BigInt(Math.floor(discountRate * 100))) / 10000n;
    const immediatePayment = faceValue - discountAmount;

    // Add to order book for secondary market
    const order = this.orderBook.addOrder(
      'sell',
      immediatePayment, // Price (what seller gets)
      faceValue,         // Amount (face value)
      invoice.from
    );

    // Try to match with factors
    const trades = this.orderBook.match();

    const receipt = this.generateFactoringReceipt(
      invoice,
      immediatePayment,
      discountAmount,
      trades.length > 0
    );

    return {
      immediatePayment,
      factorProfit: discountAmount,
      receipt
    };
  }

  /**
   * Pay an invoice
   */
  payInvoice(invoiceId: string): PaymentRecord {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    const now = Date.now();
    const daysLate = Math.max(0, Math.floor((now - invoice.dueDate) / (24 * 60 * 60 * 1000)));

    invoice.status = 'paid';

    const paymentRecord: PaymentRecord = {
      invoiceId,
      amount: invoice.amount,
      dueDate: invoice.dueDate,
      paidDate: now,
      daysLate
    };

    // Update credit line
    const creditLine = this.creditLines.get(invoice.to);
    if (creditLine) {
      creditLine.utilized -= invoice.amount;
      creditLine.paymentHistory.push(paymentRecord);
    }

    return paymentRecord;
  }

  /**
   * Calculate trust score based on payment history
   */
  private calculateTrustScore(creditLine: CreditLine): number {
    if (creditLine.paymentHistory.length === 0) return 500; // Neutral start

    let score = 600; // Base score

    // Analyze payment history
    const totalPayments = creditLine.paymentHistory.length;
    const onTimePayments = creditLine.paymentHistory.filter(p => p.daysLate === 0).length;
    const latePayments = creditLine.paymentHistory.filter(p => p.daysLate > 0 && p.daysLate <= 7).length;
    const veryLatePayments = creditLine.paymentHistory.filter(p => p.daysLate > 7).length;

    // On-time payment ratio
    const onTimeRatio = onTimePayments / totalPayments;
    score += Math.floor(onTimeRatio * 300);

    // Penalize late payments
    score -= latePayments * 20;
    score -= veryLatePayments * 50;

    // Bonus for consistent history
    if (totalPayments >= 10 && onTimeRatio > 0.9) score += 100;
    if (totalPayments >= 20 && onTimeRatio > 0.95) score += 100;

    return Math.max(0, Math.min(1000, score));
  }

  /**
   * Establish a credit line with another entity
   */
  establishCreditLine(
    counterparty: string,
    limit: bigint,
    initialCollateralRatio: number = 20
  ): CreditLine {
    const creditLine: CreditLine = {
      counterparty,
      limit,
      utilized: 0n,
      collateralRatio: initialCollateralRatio,
      paymentHistory: [],
      trustScore: 500
    };

    this.creditLines.set(counterparty, creditLine);
    return creditLine;
  }

  /**
   * Generate factoring receipt
   */
  private generateFactoringReceipt(
    invoice: Invoice,
    immediatePayment: bigint,
    discount: bigint,
    matched: boolean
  ): string {
    const formatAmount = (amount: bigint) => ethers.formatEther(amount);
    const daysUntilDue = Math.floor((invoice.dueDate - Date.now()) / (24 * 60 * 60 * 1000));

    return `
═══════════════════════════════════════════════════════
              INVOICE FACTORING RECEIPT
═══════════════════════════════════════════════════════

Invoice: ${invoice.id}
Face Value: ${formatAmount(invoice.amount)} ${invoice.currency}
Terms: ${invoice.terms} (${daysUntilDue} days remaining)

FACTORING DETAILS:
  Immediate Payment: ${formatAmount(immediatePayment)} ${invoice.currency}
  Discount: ${formatAmount(discount)} ${invoice.currency}
  Effective Rate: ${(Number(discount) * 100 / Number(invoice.amount)).toFixed(2)}%

COLLATERAL REQUIRED: ${invoice.collateralRequired}%
  (Low collateral due to trust score)

STATUS: ${matched ? '✅ MATCHED - Funds available immediately' : '⏳ Listed on secondary market'}

═══════════════════════════════════════════════════════
This is how B2B credit actually works.
No 150% overcollateralization. Just trust and history.
═══════════════════════════════════════════════════════
    `;
  }

  /**
   * Get credit status for an entity
   */
  getCreditStatus(counterparty: string): string {
    const creditLine = this.creditLines.get(counterparty);
    if (!creditLine) return 'No credit line established';

    const utilization = creditLine.limit > 0n
      ? Number((creditLine.utilized * 100n) / creditLine.limit)
      : 0;

    const formatAmount = (amount: bigint) => ethers.formatEther(amount);

    return `
Credit Line: ${counterparty}
─────────────────────────────
Limit: ${formatAmount(creditLine.limit)} ${this.baseCurrency}
Utilized: ${formatAmount(creditLine.utilized)} ${this.baseCurrency} (${utilization.toFixed(1)}%)
Available: ${formatAmount(creditLine.limit - creditLine.utilized)} ${this.baseCurrency}

Trust Score: ${creditLine.trustScore}/1000
Collateral Required: ${this.getCollateralRequirement(creditLine.trustScore)}%
Payment History: ${creditLine.paymentHistory.length} invoices

Progressive Trust:
  0-10 payments:  20% collateral
  10+ payments:   15% collateral (score > 600)
  20+ payments:   10% collateral (score > 700)
  50+ payments:   5% collateral (score > 800)
  100+ payments:  0% collateral (score > 900)
    `;
  }

  private getCollateralRequirement(trustScore: number): number {
    if (trustScore > 900) return 0;
    if (trustScore > 800) return 5;
    if (trustScore > 700) return 10;
    if (trustScore > 600) return 15;
    return 20;
  }
}