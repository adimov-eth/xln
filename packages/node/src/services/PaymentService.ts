import { ethers } from 'ethers';
import { BaseService, ServiceError, IServiceConfig } from './BaseService';
import { IPayment } from '../core/Channel';
import { createTransition, TransitionType } from '../core/Transition';
import { ChannelService } from './ChannelService';

/**
 * Payment service configuration
 */
export interface IPaymentServiceConfig extends IServiceConfig {
  channelService: ChannelService;
  paymentTTL?: number; // Time in seconds before payment data expires
}

/**
 * Payment metadata interface
 */
export interface IPaymentMetadata {
  createdAt: number;
  updatedAt: number;
  channelId: string;
  subchannelId: string;
  status: 'pending' | 'settled' | 'cancelled';
  settledAt?: number;
  cancelledAt?: number;
}

/**
 * Payment service for managing payments in channels
 */
export class PaymentService extends BaseService {
  private readonly channelService: ChannelService;
  private readonly paymentTTL: number;

  constructor(config: IPaymentServiceConfig) {
    super({
      ...config,
      storageOptions: {
        compression: true, // Enable compression for payment data
        encryption: {
          enabled: true, // Enable encryption for sensitive data
          key: config.storageOptions?.encryption?.key || ethers.hexlify(ethers.randomBytes(32)),
          algorithm: 'aes-256-cbc',
        },
      },
    });
    this.channelService = config.channelService;
    this.paymentTTL = config.paymentTTL || 7 * 24 * 60 * 60; // Default 7 days
  }

  /**
   * Initializes the service
   */
  public async initialize(): Promise<void> {
    await super.initialize();
    this.startCleanupInterval();
  }

  /**
   * Creates a new payment
   */
  public async createPayment(params: {
    channelId: string;
    chainId: number;
    tokenId: string;
    amount: string;
    secret: string;
    timelock: number;
    encryptedData: string;
  }): Promise<IPayment> {
    const channel = await this.channelService.getChannel(params.channelId);
    const hashlock = ethers.keccak256(ethers.toUtf8Bytes(params.secret));

    const transition = createTransition(TransitionType.PAYMENT_CREATE, {
      chainId: params.chainId,
      tokenId: params.tokenId,
      amount: params.amount,
      hashlock,
      timelock: params.timelock,
      encryptedData: params.encryptedData,
    });

    await transition.apply(channel);
    const subchannelId = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [params.channelId, params.chainId, params.tokenId],
    );

    const payment = await channel.getPayment(
      ethers.solidityPackedKeccak256(['string', 'string'], [subchannelId, params.amount]),
    );

    if (!payment) {
      throw new ServiceError('Failed to create payment', 'PAYMENT_CREATE_FAILED');
    }

    // Store payment with TTL
    await this.store(`payment:${payment.id}`, payment, this.paymentTTL);

    // Store payment metadata
    await this.store(`payment:${payment.id}:metadata`, {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      channelId: params.channelId,
      subchannelId,
      status: 'pending',
    } as IPaymentMetadata);

    this.logger.info(`Created payment ${payment.id} in channel ${params.channelId} for amount ${params.amount}`);
    return payment;
  }

  /**
   * Settles a payment
   */
  public async settlePayment(params: {
    channelId: string;
    chainId: number;
    tokenId: string;
    amount: string;
    secret: string;
  }): Promise<void> {
    const channel = await this.channelService.getChannel(params.channelId);

    const transition = createTransition(TransitionType.PAYMENT_SETTLE, {
      chainId: params.chainId,
      tokenId: params.tokenId,
      amount: params.amount,
      secret: params.secret,
    });

    await transition.apply(channel);
    const subchannelId = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [params.channelId, params.chainId, params.tokenId],
    );

    const paymentId = ethers.solidityPackedKeccak256(['string', 'string'], [subchannelId, params.amount]);
    const payment = await channel.getPayment(paymentId);

    if (!payment) {
      throw new ServiceError('Payment not found', 'PAYMENT_NOT_FOUND');
    }

    const now = Date.now();

    // Update payment with TTL
    await this.store(
      `payment:${payment.id}`,
      {
        ...payment,
        status: 'settled',
        updatedAt: now,
      },
      this.paymentTTL,
    );

    // Update payment metadata
    await this.store(`payment:${payment.id}:metadata`, {
      createdAt: payment.createdAt,
      updatedAt: now,
      channelId: params.channelId,
      subchannelId,
      status: 'settled',
      settledAt: now,
    } as IPaymentMetadata);

    this.logger.info(`Settled payment ${payment.id} in channel ${params.channelId}`);
  }

  /**
   * Cancels a payment
   */
  public async cancelPayment(params: {
    channelId: string;
    chainId: number;
    tokenId: string;
    amount: string;
    timelock: number;
  }): Promise<void> {
    const channel = await this.channelService.getChannel(params.channelId);

    const transition = createTransition(TransitionType.PAYMENT_CANCEL, {
      chainId: params.chainId,
      tokenId: params.tokenId,
      amount: params.amount,
      timelock: params.timelock,
    });

    await transition.apply(channel);
    const subchannelId = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [params.channelId, params.chainId, params.tokenId],
    );

    const paymentId = ethers.solidityPackedKeccak256(['string', 'string'], [subchannelId, params.amount]);
    const payment = await channel.getPayment(paymentId);

    if (!payment) {
      throw new ServiceError('Payment not found', 'PAYMENT_NOT_FOUND');
    }

    const now = Date.now();

    // Update payment with TTL
    await this.store(
      `payment:${payment.id}`,
      {
        ...payment,
        status: 'cancelled',
        updatedAt: now,
      },
      this.paymentTTL,
    );

    // Update payment metadata
    await this.store(`payment:${payment.id}:metadata`, {
      createdAt: payment.createdAt,
      updatedAt: now,
      channelId: params.channelId,
      subchannelId,
      status: 'cancelled',
      cancelledAt: now,
    } as IPaymentMetadata);

    this.logger.info(`Cancelled payment ${payment.id} in channel ${params.channelId}`);
  }

  /**
   * Gets a payment by ID
   */
  public async getPayment(paymentId: string): Promise<IPayment | null> {
    const payment = await this.retrieve<IPayment>(`payment:${paymentId}`);
    if (payment) {
      // Update payment TTL on access
      await this.storage.touch(`payment:${paymentId}`, this.paymentTTL);
    }
    return payment;
  }

  /**
   * Gets payment metadata
   */
  public async getPaymentMetadata(paymentId: string): Promise<IPaymentMetadata | null> {
    return this.retrieve<IPaymentMetadata>(`payment:${paymentId}:metadata`);
  }

  /**
   * Lists all payments in a channel
   */
  public async listPayments(channelId: string): Promise<IPayment[]> {
    const channel = await this.channelService.getChannel(channelId);
    const state = channel.getState();
    const payments: IPayment[] = [];

    for (const subchannel of Object.values(state.subchannels)) {
      const keys = await this.listKeys(`payment:${subchannel.id}`);
      for (const key of keys) {
        if (!key.endsWith(':metadata')) {
          const payment = await this.retrieve<IPayment>(key);
          if (payment) {
            payments.push(payment);
          }
        }
      }
    }

    return payments;
  }

  /**
   * Starts the cleanup interval for expired payments
   */
  private startCleanupInterval(): void {
    // Run cleanup every hour
    setInterval(
      async () => {
        try {
          const stats = await this.storage.stats();
          const expiredCount = stats.expiredKeys ?? 0;
          if (expiredCount > 0) {
            await this.storage.cleanup();
            this.logger.info(`Cleaned up ${expiredCount} expired payments`);
          }
        } catch (error) {
          this.logger.error('Failed to cleanup expired payments:', error);
        }
      },
      60 * 60 * 1000,
    );
  }
}
