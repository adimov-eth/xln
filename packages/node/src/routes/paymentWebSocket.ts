import { PaymentService } from '../services/PaymentService';
import { MessageType, IMessage, IPaymentRequestMessage, IPaymentResponseMessage } from '@xln/types';
import { Logger } from '../utils/Logger';
import type { IPayment } from '@xln/types';

/**
 * Payment WebSocket handler configuration
 */
interface IPaymentWebSocketConfig {
  paymentService: PaymentService;
  logger?: Logger;
}

/**
 * Payment WebSocket message handler
 */
export class PaymentWebSocketHandler {
  private readonly paymentService: PaymentService;
  private readonly logger: Logger;

  constructor(config: IPaymentWebSocketConfig) {
    this.paymentService = config.paymentService;
    this.logger = config.logger || new Logger({ name: 'PaymentWebSocket' });
  }

  /**
   * Handles payment-related messages
   */
  public async handleMessage(message: IMessage): Promise<IMessage | null> {
    try {
      switch (message.type) {
        case MessageType.PAYMENT_REQUEST:
          return this.handlePaymentRequest(message as IPaymentRequestMessage);

        case MessageType.PAYMENT_RESPONSE:
          return this.handlePaymentResponse(message as IPaymentResponseMessage);

        default:
          return null;
      }
    } catch (error) {
      this.logger.error('Failed to handle payment message:', error);
      const errorResponse: IPaymentResponseMessage = {
        type: MessageType.PAYMENT_RESPONSE,
        channelId: message.channelId,
        paymentId: '',
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
   * Handles payment request messages
   */
  private async handlePaymentRequest(message: IPaymentRequestMessage): Promise<IPaymentResponseMessage> {
    const { channelId, amount, tokenId, hashlock: secret, timelock, encryptedData } = message;

    const paymentParams = {
      channelId,
      chainId: 1, // or get your chainId from the message
      tokenId,
      amount,
      secret,
      timelock,
      encryptedData: encryptedData ?? ''  // ensure encryptedData is never missing
    };

    const payment = await this.paymentService.createPayment(paymentParams);

    return {
      type: MessageType.PAYMENT_RESPONSE,
      channelId,
      paymentId: payment.id,
      status: 'accepted',
      timestamp: Date.now(),
      sender: message.recipient,
      recipient: message.sender,
    };
  }

  /**
   * Handles payment response messages
   */
  private async handlePaymentResponse(message: IPaymentResponseMessage): Promise<IMessage | null> {
    const { channelId, paymentId, status } = message;

    if (status === 'accepted') {
      const maybePayment = await this.paymentService.getPayment(paymentId);
      if (!maybePayment) {
        throw new Error('Payment not found');
      }
      const payment = maybePayment as unknown as IPayment;

      await this.paymentService.settlePayment({
        channelId,
        chainId: payment.chainId,
        tokenId: payment.tokenId,
        amount: payment.amount,
        secret: payment.secret ?? '',
      });
    } else {
      const maybePayment = await this.paymentService.getPayment(paymentId);
      if (!maybePayment) {
        throw new Error('Payment not found');
      }
      const payment = maybePayment as unknown as IPayment;

      await this.paymentService.cancelPayment({
        channelId,
        chainId: payment.chainId,
        tokenId: payment.tokenId,
        amount: payment.amount,
        timelock: payment.timelock,
      });
    }

    return null;
  }
}
