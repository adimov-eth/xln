import { SwapService } from '../services/SwapService';
import { MessageType, IMessage, ISwapRequestMessage, ISwapResponseMessage } from '@xln/types';
import { Logger } from '../utils';
import type { ISwap } from '@xln/types';

/**
 * Swap WebSocket handler configuration
 */
interface ISwapWebSocketConfig {
  swapService: SwapService;
  logger?: Logger;
}

/**
 * Swap WebSocket message handler
 */
export class SwapWebSocketHandler {
  private readonly swapService: SwapService;
  private readonly logger: Logger;

  constructor(config: ISwapWebSocketConfig) {
    this.swapService = config.swapService;
    this.logger = config.logger || new Logger({ name: 'SwapWebSocket' });
  }

  /**
   * Handles swap-related messages
   */
  public async handleMessage(message: IMessage): Promise<IMessage | null> {
    try {
      switch (message.type) {
        case MessageType.SWAP_REQUEST:
          return this.handleSwapRequest(message as ISwapRequestMessage);

        case MessageType.SWAP_RESPONSE:
          return this.handleSwapResponse(message as ISwapResponseMessage);

        default:
          return null;
      }
    } catch (error) {
      this.logger.error('Failed to handle swap message:', error);
      const errorResponse: ISwapResponseMessage = {
        type: MessageType.SWAP_RESPONSE,
        channelId: message.channelId,
        swapId: '',
        status: 'rejected',
        reason: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
        sender: message.recipient,
        recipient: message.sender,
      };
      return errorResponse;
    }
  }

  /**
   * Handles swap request messages
   */
  private async handleSwapRequest(message: ISwapRequestMessage): Promise<ISwapResponseMessage> {
    const { channelId, tokenIdA, tokenIdB, amountA, amountB, timelock } = message;

    const swap = await this.swapService.createSwap({
      channelId,
      chainId: 1, // TODO: Get from message
      tokenIdA,
      tokenIdB,
      amountA,
      amountB,
      initiator: message.sender,
      timelock,
    });

    return {
      type: MessageType.SWAP_RESPONSE,
      channelId,
      swapId: swap.id,
      status: 'accepted',
      timestamp: Date.now(),
      sender: message.recipient,
      recipient: message.sender,
    };
  }

  /**
   * Handles swap response messages
   */
  private async handleSwapResponse(message: ISwapResponseMessage): Promise<IMessage | null> {
    const { channelId, swapId, status } = message;

    if (status === 'accepted') {
      const maybeSwap = await this.swapService.getSwap(swapId);
      if (!maybeSwap) {
        throw new Error('Swap not found');
      }
      const swap = maybeSwap as unknown as ISwap;

      await this.swapService.settleSwap({
        channelId,
        chainId: swap.chainId,
        tokenIdA: swap.tokenIdA,
        tokenIdB: swap.tokenIdB,
        amountA: swap.amountA,
        amountB: swap.amountB,
        initiator: message.sender,
      });
    }

    return null;
  }
}
