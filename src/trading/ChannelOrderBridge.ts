/**
 * ChannelOrderBridge - Connects SimpleOrderBook to Channel.ts
 *
 * This bridges the order book trading with the bilateral channel capacity.
 * When trades execute, they update channel deltas.
 */

import Channel from '../../old_src/app/Channel';
import { SimpleOrderBook, Trade, Order } from './SimpleOrderBook';
import { Transition } from '../../old_src/app/Transition';
import { ethers } from 'ethers';
import Block from '../../old_src/types/Block';

export interface TradingHub {
  hubId: string;
  channels: Map<string, Channel>;
  orderBooks: Map<string, SimpleOrderBook>; // pair -> book

  // Hub configuration
  creditLines: Map<string, bigint>; // entity -> credit limit
  collateralRatios: Map<string, number>; // entity -> required collateral %
}

export class ChannelOrderBridge {
  constructor(
    private hub: TradingHub
  ) {}

  /**
   * Process a trade order through the channel system
   */
  async processTradeOrder(
    channelId: string,
    order: {
      pair: string,
      side: 'buy' | 'sell',
      price: bigint,
      amount: bigint,
      isMarket?: boolean
    }
  ): Promise<{
    trades: Trade[],
    capacityBefore: any,
    capacityAfter: any,
    receipt: string
  }> {
    // Get the channel
    const channel = this.hub.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Get or create order book for this pair
    let orderBook = this.hub.orderBooks.get(order.pair);
    if (!orderBook) {
      const [base, quote] = order.pair.split('/');
      orderBook = new SimpleOrderBook(base, quote);
      this.hub.orderBooks.set(order.pair, orderBook);
    }

    // Check channel capacity BEFORE trade
    const tokenId = this.getTokenIdForPair(order.pair);
    const chainId = 1; // Default to mainnet
    const capacityBefore = channel.deriveDelta(chainId, tokenId, channel.isLeft);

    // Verify we have capacity for this trade
    const requiredCapacity = order.side === 'sell' ? order.amount : 0n;
    if (requiredCapacity > capacityBefore.outCapacity) {
      throw new Error(`Insufficient channel capacity: ${capacityBefore.outCapacity} < ${requiredCapacity}`);
    }

    // Add order to book
    const bookOrder = orderBook.addOrder(
      order.side,
      order.price,
      order.amount,
      channel.thisUserAddress
    );

    // Match orders
    const trades = orderBook.match();

    // Update channel deltas for each trade
    for (const trade of trades) {
      await this.updateChannelForTrade(channel, trade, chainId, tokenId);
    }

    // Check capacity AFTER trade
    const capacityAfter = channel.deriveDelta(chainId, tokenId, channel.isLeft);

    // Generate combined receipt
    const receipt = this.generateTradingReceipt(
      trades,
      capacityBefore,
      capacityAfter,
      orderBook
    );

    return {
      trades,
      capacityBefore,
      capacityAfter,
      receipt
    };
  }

  /**
   * Update channel state after a trade executes
   */
  private async updateChannelForTrade(
    channel: Channel,
    trade: Trade,
    chainId: number,
    tokenId: number
  ): Promise<void> {
    const delta = channel.getDelta(chainId, tokenId, false);
    if (!delta) {
      throw new Error(`Delta not found for chainId ${chainId}, tokenId ${tokenId}`);
    }

    // Determine if we're buyer or seller in this trade
    const isBuyer = trade.buyOrder.maker === channel.thisUserAddress;
    const deltaChange = isBuyer ? trade.amount : -trade.amount;

    // Update offdelta (instant off-chain balance)
    delta.offdelta += channel.isLeft ? deltaChange : -deltaChange;

    // If this brings us into credit territory, check credit limits
    const newDerived = channel.deriveDelta(chainId, tokenId, channel.isLeft);

    // Emit state change (this would trigger consensus in production)
    await this.emitStateChange(channel, {
      type: 'trade',
      trade,
      deltaChange,
      newCapacity: newDerived
    });
  }

  /**
   * Check if we need to rebalance after trades
   */
  async checkRebalancing(channelId: string): Promise<{
    needsRebalance: boolean,
    suggestion: string
  }> {
    const channel = this.hub.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const allDeltas = [];
    // Check all token pairs
    for (let tokenId = 0; tokenId < 5; tokenId++) {
      const derived = channel.deriveDelta(1, tokenId, channel.isLeft);
      const utilization = derived.totalCapacity > 0n
        ? Number((derived.outCapacity * 100n) / derived.totalCapacity)
        : 0;

      allDeltas.push({
        tokenId,
        utilization,
        inCapacity: derived.inCapacity,
        outCapacity: derived.outCapacity
      });
    }

    // Find most imbalanced channel
    const mostImbalanced = allDeltas.reduce((max, d) =>
      Math.abs(50 - d.utilization) > Math.abs(50 - max.utilization) ? d : max
    );

    const needsRebalance = Math.abs(50 - mostImbalanced.utilization) > 30;
    const suggestion = needsRebalance
      ? `Token ${mostImbalanced.tokenId} at ${mostImbalanced.utilization}% utilization. Consider ${mostImbalanced.utilization > 50 ? 'receiving' : 'sending'} to rebalance.`
      : 'Channels are well balanced';

    return { needsRebalance, suggestion };
  }

  /**
   * Calculate dynamic routing fee based on channel imbalance
   */
  calculateRoutingFee(
    channel: Channel,
    amount: bigint,
    tokenId: number
  ): bigint {
    const derived = channel.deriveDelta(1, tokenId, channel.isLeft);
    const utilization = derived.totalCapacity > 0n
      ? Number((derived.outCapacity * 1000n) / derived.totalCapacity) / 1000
      : 0;

    // Simple congestion pricing
    if (utilization < 0.2) return 0n; // Free when balanced
    if (utilization < 0.6) return amount / 10000n; // 0.01%
    if (utilization < 0.8) return amount / 1000n; // 0.1%
    return amount / 100n; // 1% when very congested
  }

  /**
   * Generate a comprehensive trading receipt
   */
  private generateTradingReceipt(
    trades: Trade[],
    capacityBefore: any,
    capacityAfter: any,
    orderBook: SimpleOrderBook
  ): string {
    const formatAmount = (amount: bigint) => ethers.formatEther(amount);
    const stats = orderBook.getStats();

    let receipt = `
═══════════════════════════════════════════════════════
           XLN TRADING - BILATERAL SOVEREIGNTY
═══════════════════════════════════════════════════════

TRADES EXECUTED: ${trades.length}
`;

    for (const trade of trades) {
      receipt += orderBook.generateReceipt(trade);
    }

    receipt += `
CHANNEL CAPACITY:
  Before Trade:
    In:  ${formatAmount(capacityBefore.inCapacity)}
    Out: ${formatAmount(capacityBefore.outCapacity)}

  After Trade:
    In:  ${formatAmount(capacityAfter.inCapacity)}
    Out: ${formatAmount(capacityAfter.outCapacity)}

MARKET STATS:
  Total Volume: ${formatAmount(stats.totalVolume)}
  Total Spread Captured: ${formatAmount(stats.totalSpreadCaptured)}
  Average Spread: ${formatAmount(stats.averageSpread)}
  Last Price: ${stats.lastPrice ? formatAmount(stats.lastPrice) : 'N/A'}

THREE-ZONE VISUALIZATION:
${capacityAfter.ascii}
[credit | collateral | credit]
         ^
       delta

═══════════════════════════════════════════════════════
Every trade is bilateral. Every price is local.
No global consensus needed.
═══════════════════════════════════════════════════════
`;

    return receipt;
  }

  /**
   * Emit state change for consensus layer
   */
  private async emitStateChange(channel: Channel, change: any): Promise<void> {
    // In production, this would:
    // 1. Sign the state change
    // 2. Send to counterparty for signature
    // 3. Optionally anchor to L1

    console.log('State change:', {
      channelId: channel.channelId,
      timestamp: Date.now(),
      change
    });
  }

  /**
   * Map trading pairs to token IDs
   */
  private getTokenIdForPair(pair: string): number {
    const tokenMap: Record<string, number> = {
      'USDC/USDT': 0,
      'USDC/DAI': 1,
      'ETH/USDC': 2,
      'BTC/USDC': 3
    };

    return tokenMap[pair] || 0;
  }
}

/**
 * Create a simple trading hub with initial configuration
 */
export function createTradingHub(hubId: string): TradingHub {
  return {
    hubId,
    channels: new Map(),
    orderBooks: new Map(),
    creditLines: new Map(),
    collateralRatios: new Map()
  };
}