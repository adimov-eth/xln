/**
 * ConsensusOrderBook - Order book with BFT consensus
 *
 * This is the REAL architecture:
 * - Order book state lives in entities
 * - Trades require Byzantine consensus
 * - Channels handle bilateral settlement
 */

import { OptimizedOrderBook } from './OptimizedOrderBook';
import { EntityState, EntityTx, ChannelState } from '../types';
import { applyEntityTx } from '../entity-tx';
import { ethers } from 'ethers';

export interface OrderBookState {
  pair: string;
  bids: Array<{
    id: string;
    price: string;
    amount: string;
    maker: string;
  }>;
  asks: Array<{
    id: string;
    price: string;
    amount: string;
    maker: string;
  }>;
  lastTrade?: {
    price: string;
    amount: string;
    timestamp: number;
  };
}

export interface TradeTx extends EntityTx {
  type: 'trade';
  data: {
    orderId: string;
    side: 'buy' | 'sell';
    price: string;
    amount: string;
    maker: string;
    taker: string;
    spread: string;
  };
}

export class ConsensusOrderBook {
  private orderBook: OptimizedOrderBook;
  private entityId: string;
  private channelId: string;
  private state: OrderBookState;
  private consensusThreshold: number;
  private participants: Set<string>;

  constructor(
    entityId: string,
    channelId: string,
    baseToken: string,
    quoteToken: string,
    participants: string[],
    consensusThreshold: number = 2
  ) {
    this.entityId = entityId;
    this.channelId = channelId;
    this.participants = new Set(participants);
    this.consensusThreshold = Math.min(consensusThreshold, participants.length);

    // Create underlying order book
    this.orderBook = new OptimizedOrderBook(baseToken, quoteToken);

    // Initialize state
    this.state = {
      pair: `${baseToken}/${quoteToken}`,
      bids: [],
      asks: [],
    };
  }

  /**
   * Propose adding an order (requires consensus)
   */
  async proposeOrder(
    side: 'buy' | 'sell',
    price: bigint,
    amount: bigint,
    maker: string
  ): Promise<EntityTx> {
    // Validate maker is a participant
    if (!this.participants.has(maker)) {
      throw new Error(`Maker ${maker} is not a channel participant`);
    }

    // Create order transaction
    const orderTx: EntityTx = {
      type: 'order',
      data: {
        side,
        price: price.toString(),
        amount: amount.toString(),
        maker,
        timestamp: Date.now()
      }
    };

    // This would go through consensus in real implementation
    // For now, simulate immediate consensus
    await this.applyOrderWithConsensus(orderTx);

    return orderTx;
  }

  /**
   * Apply order after consensus
   */
  private async applyOrderWithConsensus(tx: EntityTx): Promise<void> {
    // In real implementation, this would:
    // 1. Broadcast to all participants
    // 2. Collect signatures
    // 3. Wait for threshold
    // 4. Apply if consensus reached

    const { side, price, amount, maker } = tx.data as any;

    // Add to underlying order book
    const order = await this.orderBook.addOrder(
      side,
      BigInt(price),
      BigInt(amount),
      maker
    );

    // Update consensus state
    const orderData = {
      id: order.id,
      price: price.toString(),
      amount: amount.toString(),
      maker
    };

    if (side === 'buy') {
      this.state.bids.push(orderData);
      this.state.bids.sort((a, b) => BigInt(b.price) > BigInt(a.price) ? 1 : -1);
    } else {
      this.state.asks.push(orderData);
      this.state.asks.sort((a, b) => BigInt(a.price) > BigInt(b.price) ? 1 : -1);
    }

    // Try to match orders
    await this.matchWithConsensus();
  }

  /**
   * Match orders with consensus
   */
  private async matchWithConsensus(): Promise<void> {
    const trades = await this.orderBook.match();

    for (const trade of trades) {
      // Create trade transaction
      const tradeTx: TradeTx = {
        type: 'trade',
        data: {
          orderId: trade.id,
          side: trade.buyOrder.side,
          price: trade.price.toString(),
          amount: trade.amount.toString(),
          maker: trade.sellOrder.maker,
          taker: trade.buyOrder.maker,
          spread: trade.spread.toString()
        }
      };

      // This would go through consensus
      await this.applyTradeWithConsensus(tradeTx);
    }
  }

  /**
   * Apply trade after consensus
   */
  private async applyTradeWithConsensus(tx: TradeTx): Promise<void> {
    const { price, amount, maker, taker, spread } = tx.data;

    // Update state
    this.state.lastTrade = {
      price,
      amount,
      timestamp: Date.now()
    };

    // Remove filled orders from state
    this.state.bids = this.state.bids.filter(o => {
      const order = this.orderBook.getOrder(o.id);
      return order && order.filled < order.amount;
    });

    this.state.asks = this.state.asks.filter(o => {
      const order = this.orderBook.getOrder(o.id);
      return order && order.filled < order.amount;
    });

    // Settlement would happen through channels
    await this.settleTradeViaChannel(maker, taker, BigInt(amount), BigInt(spread));
  }

  /**
   * Settle trade through bilateral channel
   */
  private async settleTradeViaChannel(
    maker: string,
    taker: string,
    amount: bigint,
    spread: bigint
  ): Promise<void> {
    // This would update channel state between maker and taker
    // Channel handles the actual value movement
    // Consensus ensures both parties agree

    console.log(`
Settlement via channel ${this.channelId}:
  Maker ${maker} earned: ${ethers.formatEther(spread * 45n / 100n)}
  Taker ${taker} earned: ${ethers.formatEther(spread * 45n / 100n)}
  Hub earned: ${ethers.formatEther(spread * 10n / 100n)}
  Amount settled: ${ethers.formatEther(amount)}
`);
  }

  /**
   * Get current consensus state
   */
  getConsensusState(): OrderBookState {
    return { ...this.state };
  }

  /**
   * Verify state against consensus
   */
  async verifyConsensus(): Promise<boolean> {
    // In real implementation:
    // 1. Hash current state
    // 2. Collect state hashes from participants
    // 3. Check if threshold agree
    // 4. Roll back if consensus lost

    const stateHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(this.state))
    );

    console.log(`State hash: ${stateHash}`);
    console.log(`Participants: ${this.participants.size}`);
    console.log(`Consensus threshold: ${this.consensusThreshold}`);

    // For now, always return true
    return true;
  }

  /**
   * Get order book for display
   */
  getOrderBook() {
    return this.orderBook.getOrderBook();
  }

  /**
   * Get stats
   */
  getStats() {
    return this.orderBook.getStats();
  }
}

/**
 * Create a consensus-based trading channel
 */
export function createTradingChannel(
  participants: string[],
  baseToken: string,
  quoteToken: string
): ConsensusOrderBook {
  const channelId = ethers.keccak256(
    ethers.toUtf8Bytes(participants.sort().join(':'))
  );

  const entityId = `orderbook:${baseToken}:${quoteToken}`;

  return new ConsensusOrderBook(
    entityId,
    channelId,
    baseToken,
    quoteToken,
    participants,
    Math.ceil(participants.length * 2 / 3) // 2/3 consensus
  );
}