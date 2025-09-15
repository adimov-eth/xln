/**
 * SimpleOrderBook - The honest trading engine for XLN
 *
 * Zero fees, transparent spread capture, bilateral price discovery.
 * This is NOT another DEX. This is how value actually moves.
 */

import { ethers } from 'ethers';

export interface Order {
  id: string;
  side: 'buy' | 'sell';
  price: bigint;  // Price per unit in quote currency (18 decimals)
  amount: bigint; // Amount in base currency (18 decimals)
  maker: string;  // Entity/hub address
  timestamp: number;
  filled: bigint; // Amount already filled
}

export interface Trade {
  id: string;
  buyOrder: Order;
  sellOrder: Order;
  price: bigint;
  amount: bigint;
  timestamp: number;
  spread: bigint;

  // The honest part - who earned what
  makerEarned: bigint;
  takerEarned: bigint;
  hubEarned: bigint;
  referrerEarned?: bigint;
}

export interface OrderBookConfig {
  // Split configuration (all must sum to 100)
  makerPercent: number;  // Default 45
  takerPercent: number;  // Default 45
  hubPercent: number;    // Default 10
  referralPercent?: number; // Optional, taken from hub share
}

export class SimpleOrderBook {
  private bids: Order[] = [];  // Buy orders (sorted high to low)
  private asks: Order[] = [];  // Sell orders (sorted low to high)
  private trades: Trade[] = [];
  private orderCounter = 0;
  private tradeCounter = 0;

  constructor(
    public readonly baseToken: string,  // e.g., "USDC"
    public readonly quoteToken: string, // e.g., "USDT"
    private config: OrderBookConfig = {
      makerPercent: 45,
      takerPercent: 45,
      hubPercent: 10
    }
  ) {
    // Validate config
    const totalPercent = config.makerPercent + config.takerPercent + config.hubPercent;
    if (totalPercent !== 100) {
      throw new Error(`Split percentages must sum to 100, got ${totalPercent}`);
    }
  }

  /**
   * Add a new order to the book
   */
  addOrder(
    side: 'buy' | 'sell',
    price: bigint,
    amount: bigint,
    maker: string
  ): Order {
    const order: Order = {
      id: `${this.orderCounter++}`,
      side,
      price,
      amount,
      maker,
      timestamp: Date.now(),
      filled: 0n
    };

    if (side === 'buy') {
      // Insert in sorted position (high to low)
      const insertIdx = this.bids.findIndex(o => o.price < price);
      if (insertIdx === -1) {
        this.bids.push(order);
      } else {
        this.bids.splice(insertIdx, 0, order);
      }
    } else {
      // Insert in sorted position (low to high)
      const insertIdx = this.asks.findIndex(o => o.price > price);
      if (insertIdx === -1) {
        this.asks.push(order);
      } else {
        this.asks.splice(insertIdx, 0, order);
      }
    }

    return order;
  }

  /**
   * Match orders using price-time priority
   * This is where the magic happens - transparent spread capture
   */
  match(): Trade[] {
    const newTrades: Trade[] = [];

    while (this.bids.length > 0 && this.asks.length > 0) {
      const bestBid = this.bids[0];
      const bestAsk = this.asks[0];

      // Check if orders cross
      if (bestBid.price >= bestAsk.price) {
        // We have a match! Execute at ask price (price-time priority)
        const executionPrice = bestAsk.price;
        const remainingBid = bestBid.amount - bestBid.filled;
        const remainingAsk = bestAsk.amount - bestAsk.filled;
        const tradeAmount = remainingBid < remainingAsk ? remainingBid : remainingAsk;

        // Calculate the spread captured
        const spread = (bestBid.price - bestAsk.price) * tradeAmount / ethers.parseEther('1');

        // Split the spread according to configuration
        const makerEarned = spread * BigInt(this.config.makerPercent) / 100n;
        const takerEarned = spread * BigInt(this.config.takerPercent) / 100n;
        let hubEarned = spread * BigInt(this.config.hubPercent) / 100n;
        let referrerEarned = 0n;

        // If there's a referral program, take it from hub share
        if (this.config.referralPercent) {
          referrerEarned = hubEarned * BigInt(this.config.referralPercent) / 100n;
          hubEarned = hubEarned - referrerEarned;
        }

        // Create trade record
        const trade: Trade = {
          id: `${this.tradeCounter++}`,
          buyOrder: bestBid,
          sellOrder: bestAsk,
          price: executionPrice,
          amount: tradeAmount,
          timestamp: Date.now(),
          spread,
          makerEarned,
          takerEarned,
          hubEarned,
          referrerEarned
        };

        // Update filled amounts
        bestBid.filled += tradeAmount;
        bestAsk.filled += tradeAmount;

        // Remove fully filled orders
        if (bestBid.filled >= bestBid.amount) {
          this.bids.shift();
        }
        if (bestAsk.filled >= bestAsk.amount) {
          this.asks.shift();
        }

        newTrades.push(trade);
        this.trades.push(trade);
      } else {
        // No more matches possible
        break;
      }
    }

    return newTrades;
  }

  /**
   * Get the current order book state
   */
  getOrderBook(): {
    bids: Order[],
    asks: Order[],
    spread: bigint | null,
    midPrice: bigint | null
  } {
    const spread = this.bids.length > 0 && this.asks.length > 0
      ? this.asks[0].price - this.bids[0].price
      : null;

    const midPrice = this.bids.length > 0 && this.asks.length > 0
      ? (this.bids[0].price + this.asks[0].price) / 2n
      : null;

    return {
      bids: [...this.bids],
      asks: [...this.asks],
      spread,
      midPrice
    };
  }

  /**
   * Cancel an order
   */
  cancelOrder(orderId: string): boolean {
    const bidIndex = this.bids.findIndex(o => o.id === orderId);
    if (bidIndex !== -1) {
      this.bids.splice(bidIndex, 1);
      return true;
    }

    const askIndex = this.asks.findIndex(o => o.id === orderId);
    if (askIndex !== -1) {
      this.asks.splice(askIndex, 1);
      return true;
    }

    return false;
  }

  /**
   * Get market statistics
   */
  getStats(): {
    totalTrades: number,
    totalVolume: bigint,
    totalSpreadCaptured: bigint,
    averageSpread: bigint,
    lastPrice: bigint | null
  } {
    const totalVolume = this.trades.reduce((sum, t) => sum + t.amount, 0n);
    const totalSpreadCaptured = this.trades.reduce((sum, t) => sum + t.spread, 0n);
    const averageSpread = this.trades.length > 0
      ? totalSpreadCaptured / BigInt(this.trades.length)
      : 0n;
    const lastPrice = this.trades.length > 0
      ? this.trades[this.trades.length - 1].price
      : null;

    return {
      totalTrades: this.trades.length,
      totalVolume,
      totalSpreadCaptured,
      averageSpread,
      lastPrice
    };
  }

  /**
   * Generate an honest receipt showing exactly who earned what
   */
  generateReceipt(trade: Trade): string {
    const formatAmount = (amount: bigint) => ethers.formatEther(amount);

    return `
═══════════════════════════════════════════════════════
                HONEST TRADE RECEIPT
═══════════════════════════════════════════════════════

Trade ID: ${trade.id}
Time: ${new Date(trade.timestamp).toISOString()}
Pair: ${this.baseToken}/${this.quoteToken}

EXECUTION:
  Amount: ${formatAmount(trade.amount)} ${this.baseToken}
  Price: ${formatAmount(trade.price)} ${this.quoteToken}
  Total Value: ${formatAmount(trade.price * trade.amount / ethers.parseEther('1'))} ${this.quoteToken}

SPREAD CAPTURED: ${formatAmount(trade.spread)} ${this.quoteToken}

WHO EARNED WHAT (transparent split):
  Maker (${trade.sellOrder.maker}): ${formatAmount(trade.makerEarned)} ${this.quoteToken}
  Taker (${trade.buyOrder.maker}): ${formatAmount(trade.takerEarned)} ${this.quoteToken}
  Hub: ${formatAmount(trade.hubEarned)} ${this.quoteToken}
  ${trade.referrerEarned ? `Referrer: ${formatAmount(trade.referrerEarned)} ${this.quoteToken}` : ''}

YOUR FEE: 0.00 ${this.quoteToken} (We earn from spread, not fees)

═══════════════════════════════════════════════════════
This is honest value movement. No hidden fees. Ever.
═══════════════════════════════════════════════════════
    `;
  }
}

/**
 * Market order implementation - just crosses the spread
 */
export function createMarketOrder(
  book: SimpleOrderBook,
  side: 'buy' | 'sell',
  amount: bigint,
  taker: string
): Trade[] {
  // For market orders, use a price that's just beyond the best opposing order
  const orderBook = book.getOrderBook();

  let marketPrice: bigint;
  if (side === 'buy') {
    // For market buy, use a price slightly above the best ask
    const bestAsk = orderBook.asks[0];
    marketPrice = bestAsk ? bestAsk.price + ethers.parseEther('0.0001') : ethers.parseEther('1.1');
  } else {
    // For market sell, use a price slightly below the best bid
    const bestBid = orderBook.bids[0];
    marketPrice = bestBid ? bestBid.price - ethers.parseEther('0.0001') : ethers.parseEther('0.9');
  }

  book.addOrder(side, marketPrice, amount, taker);
  return book.match();
}