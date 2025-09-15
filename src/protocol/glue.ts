/**
 * The Glue - Minimal wiring between isolated engines
 *
 * No frameworks. No abstractions. Just three event handlers.
 */

import { EventEmitter } from 'events';
import { SimpleOrderBook, Trade } from '../trading/SimpleOrderBook';
import { applyEntityInput } from '../entity-consensus';
import { EntityReplica } from '../types';

/**
 * The simplest possible connector
 */
export class EngineGlue extends EventEmitter {
  constructor(
    private orderBook: SimpleOrderBook,
    private channel: any, // Can be real Channel or mock
    private consensus: { env: any, replica: EntityReplica }
  ) {
    super();
    this.wireConnections();
  }

  private wireConnections() {
    // 1. When trade happens → settle in channel
    this.on('trade', (trade: Trade) => {
      this.settleTradeInChannel(trade);
    });

    // 2. When channel capacity changes → update order book
    this.on('channelUpdate', (channelState: any) => {
      this.updateOrderBookLiquidity(channelState);
    });

    // 3. When dispute occurs → record in consensus
    this.on('dispute', (evidence: any) => {
      this.submitToConsensus('dispute', evidence);
    });
  }

  /**
   * Trade executed → Update channel capacity
   */
  private settleTradeInChannel(trade: Trade) {
    // Extract trade details
    const { buyOrder, sellOrder, amount, price } = trade;

    // Calculate value movement
    const baseAmount = amount; // Amount of base currency traded
    const quoteAmount = (amount * price) / BigInt(10 ** 18); // Amount of quote currency

    // Update channel deltas
    // Buyer loses quote, gains base
    // Seller loses base, gains quote
    const chainId = 1;
    const baseTokenId = 0; // Assuming token IDs
    const quoteTokenId = 1;

    try {
      // Update buyer's channel (if they're using channels)
      const buyerDelta = this.channel.getDelta(chainId, baseTokenId, false);
      if (buyerDelta) {
        buyerDelta.offdelta += baseAmount; // Gained base
      }

      const buyerQuoteDelta = this.channel.getDelta(chainId, quoteTokenId, false);
      if (buyerQuoteDelta) {
        buyerQuoteDelta.offdelta -= quoteAmount; // Lost quote
      }

      // Log the settlement
      console.log(`✅ Trade settled in channel: ${trade.id}`);
      console.log(`   Buyer gained ${baseAmount} base, lost ${quoteAmount} quote`);

      // Emit settlement complete
      this.emit('settlementComplete', {
        tradeId: trade.id,
        channelId: this.channel.channelId,
        baseMovement: baseAmount,
        quoteMovement: quoteAmount
      });
    } catch (error) {
      console.error('Channel settlement failed:', error);
      this.emit('settlementFailed', { tradeId: trade.id, error });
    }
  }

  /**
   * Channel updated → Adjust order book liquidity
   */
  private updateOrderBookLiquidity(channelState: any) {
    const { inCapacity, outCapacity } = channelState;

    // Cancel orders that exceed new capacity
    const orders = this.orderBook.getOrderBook();

    for (const order of [...orders.bids, ...orders.asks]) {
      const orderValue = (order.amount * order.price) / BigInt(10 ** 18);

      if (order.side === 'buy' && orderValue > outCapacity) {
        // Cancel buy order if we can't pay for it
        this.orderBook.cancelOrder(order.id);
        console.log(`⚠️ Cancelled order ${order.id} - exceeds channel capacity`);
      } else if (order.side === 'sell' && order.amount > outCapacity) {
        // Cancel sell order if we don't have the base currency
        this.orderBook.cancelOrder(order.id);
        console.log(`⚠️ Cancelled order ${order.id} - exceeds channel capacity`);
      }
    }

    this.emit('liquidityUpdated', {
      channelId: this.channel.channelId,
      newInCapacity: inCapacity,
      newOutCapacity: outCapacity
    });
  }

  /**
   * Submit evidence to consensus
   */
  private submitToConsensus(type: string, data: any) {
    const input = {
      kind: 'collective_message' as const,
      entityId: this.consensus.replica.entityId,
      signerId: this.consensus.replica.signerId,
      from: this.consensus.replica.signerId,
      nonce: BigInt(Date.now()),
      message: JSON.stringify({
        type,
        data,
        timestamp: Date.now()
      })
    };

    const outputs = applyEntityInput(this.consensus.env, this.consensus.replica, input);

    // Check if consensus was reached
    if (outputs && outputs.length > 0) {
      console.log(`📝 Consensus recorded: ${type}`);
      console.log(`   Outputs: ${outputs.map(o => o.kind).join(', ')}`);

      this.emit('consensusRecorded', {
        type,
        outputs
      });
    }

    return outputs;
  }

  /**
   * Public methods to trigger events
   */
  executeTrade(trade: Trade) {
    this.emit('trade', trade);
  }

  updateChannel(state: any) {
    this.emit('channelUpdate', state);
  }

  reportDispute(evidence: any) {
    this.emit('dispute', evidence);
  }
}

/**
 * Factory function for simple setup
 */
export function connectEngines(
  orderBook: SimpleOrderBook,
  channel: any,
  consensusEnv: any,
  consensusReplica: EntityReplica
): EngineGlue {
  return new EngineGlue(
    orderBook,
    channel,
    { env: consensusEnv, replica: consensusReplica }
  );
}