/**
 * XLN SDK - Dead simple interface to XLN
 *
 * Usage:
 *   const xln = new XLN('https://hub.xln.network');
 *   const invoice = await xln.createInvoice(1000, 'NET30');
 *   await xln.acceptPayment(invoice.id);
 */

import { ethers } from 'ethers';
import { SimpleOrderBook } from '../trading/SimpleOrderBook';
import { TradeCredit, Invoice, CreditLine } from '../trading/TradeCredit';
import Channel from '../../old_src/app/Channel';

export interface XLNConfig {
  hubUrl: string;
  entityId?: string;
  baseCurrency?: string;
}

export interface QuickTrade {
  pair: string;
  side: 'buy' | 'sell';
  amount: number;
  price?: number; // Optional for market orders
}

// Shared storage for demo - in production this would be the hub
const sharedInvoices = new Map<string, Invoice>();
const sharedCreditLines = new Map<string, Map<string, CreditLine>>();
const sharedOrderBooks = new Map<string, SimpleOrderBook>();

export class XLN {
  private tradeCredit: TradeCredit;
  private orderBooks: Map<string, SimpleOrderBook> = sharedOrderBooks;
  private channels: Map<string, Channel> = new Map();
  private entityId: string;
  private hubUrl: string;

  constructor(config: string | XLNConfig) {
    // Accept either just URL or full config
    if (typeof config === 'string') {
      this.hubUrl = config;
      this.entityId = ethers.Wallet.createRandom().address;
    } else {
      this.hubUrl = config.hubUrl;
      this.entityId = config.entityId || ethers.Wallet.createRandom().address;
    }

    // Initialize trade credit system
    this.tradeCredit = new TradeCredit(
      this.entityId,
      typeof config === 'object' ? config.baseCurrency : 'USDC'
    );
  }

  /**
   * Create an invoice - the most common B2B operation
   */
  async createInvoice(
    amount: number | bigint,
    terms: 'NET15' | 'NET30' | 'NET60' | 'NET90' = 'NET30',
    to?: string
  ): Promise<Invoice> {
    const recipient = to || 'default-counterparty';
    const amountBigInt = typeof amount === 'number'
      ? ethers.parseEther(amount.toString())
      : amount;

    // Simple invoice with one line item
    const invoice = this.tradeCredit.createInvoice(
      recipient,
      [{
        description: 'Services',
        quantity: 1,
        unitPrice: amountBigInt,
        total: amountBigInt
      }],
      terms
    );

    // Store in shared storage for demo
    sharedInvoices.set(invoice.id, invoice);

    return invoice;
  }

  /**
   * Accept an invoice and provide collateral
   */
  async acceptPayment(
    invoiceId: string,
    collateral?: number | bigint
  ): Promise<void> {
    // Auto-calculate collateral if not provided
    const invoice = this.getInvoice(invoiceId);
    const requiredCollateral = collateral ||
      (invoice.amount * BigInt(invoice.collateralRequired)) / 100n;

    const collateralBigInt = typeof collateral === 'number'
      ? ethers.parseEther(collateral.toString())
      : collateral || requiredCollateral;

    // Update the invoice status in shared storage
    invoice.status = 'accepted';
    sharedInvoices.set(invoiceId, invoice);
  }

  /**
   * Pay an invoice
   */
  async pay(invoiceId: string): Promise<{
    daysLate: number;
    newTrustScore: number;
  }> {
    const invoice = this.getInvoice(invoiceId);

    // Update the invoice status
    invoice.status = 'paid';
    sharedInvoices.set(invoiceId, invoice);

    // For demo, simulate payment tracking
    const now = Date.now();
    const daysLate = Math.max(0, Math.floor((now - invoice.dueDate) / (24 * 60 * 60 * 1000)));

    // Simple trust score calculation
    const baseScore = 500;
    const onTimeBonus = daysLate === 0 ? 100 : 0;
    const latenessPenalty = daysLate * 20;
    const newTrustScore = Math.max(0, Math.min(1000, baseScore + onTimeBonus - latenessPenalty));

    return {
      daysLate,
      newTrustScore
    };
  }

  /**
   * Trade - simplified interface
   */
  async trade(params: QuickTrade): Promise<{
    executed: boolean;
    price: string;
    receipt?: string;
  }> {
    let orderBook = this.orderBooks.get(params.pair);

    if (!orderBook) {
      const [base, quote] = params.pair.split('/');
      orderBook = new SimpleOrderBook(base, quote);
      this.orderBooks.set(params.pair, orderBook);
    }

    if (params.price) {
      // Limit order
      const priceBigInt = ethers.parseEther(params.price.toString());
      const amountBigInt = ethers.parseEther(params.amount.toString());

      orderBook.addOrder(params.side, priceBigInt, amountBigInt, this.entityId);
      const trades = orderBook.match();

      if (trades.length > 0) {
        return {
          executed: true,
          price: ethers.formatEther(trades[0].price),
          receipt: orderBook.generateReceipt(trades[0])
        };
      }

      return {
        executed: false,
        price: params.price.toString()
      };
    } else {
      // Market order - use a price just beyond the best opposing order
      const amountBigInt = ethers.parseEther(params.amount.toString());
      const orderBookState = orderBook.getOrderBook();

      let marketPrice: bigint;
      if (params.side === 'buy') {
        const bestAsk = orderBookState.asks[0];
        marketPrice = bestAsk ? bestAsk.price + ethers.parseEther('0.0001') : ethers.parseEther('1.1');
      } else {
        const bestBid = orderBookState.bids[0];
        marketPrice = bestBid ? bestBid.price - ethers.parseEther('0.0001') : ethers.parseEther('0.9');
      }

      orderBook.addOrder(params.side, marketPrice, amountBigInt, this.entityId);
      const trades = orderBook.match();

      if (trades.length > 0) {
        return {
          executed: true,
          price: ethers.formatEther(trades[0].price),
          receipt: orderBook.generateReceipt(trades[0])
        };
      }

      return {
        executed: false,
        price: '0'
      };
    }
  }

  /**
   * Establish credit with another entity
   */
  async establishCredit(
    counterparty: string,
    limit: number | bigint,
    collateralRatio?: number
  ): Promise<CreditLine> {
    const limitBigInt = typeof limit === 'number'
      ? ethers.parseEther(limit.toString())
      : limit;

    return this.tradeCredit.establishCreditLine(
      counterparty,
      limitBigInt,
      collateralRatio
    );
  }

  /**
   * Get credit status
   */
  getCreditStatus(counterparty: string): string {
    return this.tradeCredit.getCreditStatus(counterparty);
  }

  /**
   * Factor an invoice for immediate cash
   */
  async factorInvoice(
    invoiceId: string,
    discountRate: number = 3
  ): Promise<{
    immediatePayment: string;
    discount: string;
    receipt: string;
  }> {
    const invoice = this.getInvoice(invoiceId);

    // For demo, calculate factoring locally
    const faceValue = invoice.amount;
    const discountAmount = (faceValue * BigInt(Math.floor(discountRate * 100))) / 10000n;
    const immediatePayment = faceValue - discountAmount;

    const receipt = this.generateFactoringReceipt(
      invoice,
      immediatePayment,
      discountAmount,
      discountRate
    );

    return {
      immediatePayment: ethers.formatEther(immediatePayment),
      discount: ethers.formatEther(discountAmount),
      receipt
    };
  }

  private generateFactoringReceipt(
    invoice: Invoice,
    immediatePayment: bigint,
    discount: bigint,
    rate: number
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
  Effective Rate: ${rate}%

COLLATERAL REQUIRED: ${invoice.collateralRequired}%
  (Low collateral due to trust score)

STATUS: ✅ Funds available immediately

═══════════════════════════════════════════════════════
This is how B2B credit actually works.
No 150% overcollateralization. Just trust and history.
═══════════════════════════════════════════════════════
    `;
  }

  /**
   * Get order book state
   */
  getOrderBook(pair: string): any {
    const book = this.orderBooks.get(pair);
    if (!book) return null;

    const state = book.getOrderBook();
    return {
      bids: state.bids.map(o => ({
        price: ethers.formatEther(o.price),
        amount: ethers.formatEther(o.amount)
      })),
      asks: state.asks.map(o => ({
        price: ethers.formatEther(o.price),
        amount: ethers.formatEther(o.amount)
      })),
      spread: state.spread ? ethers.formatEther(state.spread) : null,
      midPrice: state.midPrice ? ethers.formatEther(state.midPrice) : null
    };
  }

  /**
   * Get trading statistics
   */
  getStats(pair?: string): any {
    if (pair) {
      const book = this.orderBooks.get(pair);
      if (!book) return null;

      const stats = book.getStats();
      return {
        totalTrades: stats.totalTrades,
        totalVolume: ethers.formatEther(stats.totalVolume),
        totalSpreadCaptured: ethers.formatEther(stats.totalSpreadCaptured),
        averageSpread: ethers.formatEther(stats.averageSpread),
        lastPrice: stats.lastPrice ? ethers.formatEther(stats.lastPrice) : null
      };
    }

    // Return stats for all pairs
    const allStats: Record<string, any> = {};
    for (const [pair, book] of this.orderBooks) {
      const stats = book.getStats();
      allStats[pair] = {
        totalTrades: stats.totalTrades,
        totalVolume: ethers.formatEther(stats.totalVolume),
        totalSpreadCaptured: ethers.formatEther(stats.totalSpreadCaptured),
        averageSpread: ethers.formatEther(stats.averageSpread),
        lastPrice: stats.lastPrice ? ethers.formatEther(stats.lastPrice) : null
      };
    }
    return allStats;
  }

  // Private helpers
  private getInvoice(invoiceId: string): Invoice {
    // This would connect to the hub in production
    // For now, check shared storage first, then local
    let invoice = sharedInvoices.get(invoiceId);
    if (!invoice) {
      invoice = (this.tradeCredit as any).invoices.get(invoiceId);
    }
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    return invoice;
  }

  private getCreditLine(counterparty: string): CreditLine | undefined {
    return (this.tradeCredit as any).creditLines.get(counterparty);
  }
}

// Export convenience factory
export function createXLN(hubUrl: string): XLN {
  return new XLN(hubUrl);
}