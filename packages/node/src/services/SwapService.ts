import { ethers } from 'ethers';
import { BaseService, ServiceError, IServiceConfig } from './BaseService';
import { ISwap } from '../core/Channel';
import { createTransition, TransitionType } from '../core/Transition';
import { ChannelService } from './ChannelService';
import crypto from 'crypto';

/**
 * Swap service configuration
 */
export interface ISwapServiceConfig extends IServiceConfig {
  channelService: ChannelService;
  swapTTL?: number; // Time in seconds before swap data expires
}

/**
 * Swap metadata interface
 */
export interface ISwapMetadata {
  createdAt: number;
  updatedAt: number;
  channelId: string;
  subchannelIdA: string;
  subchannelIdB: string;
  status: 'pending' | 'settled' | 'cancelled';
  settledAt?: number;
  cancelledAt?: number;
}

/**
 * Swap service for managing atomic swaps in channels
 */
export class SwapService extends BaseService {
  private readonly channelService: ChannelService;
  private readonly swapTTL: number;

  constructor(config: ISwapServiceConfig) {
    super({
      ...config,
      storageOptions: {
        compression: true, // Enable compression for swap data
        encryption: {
          enabled: true, // Enable encryption for sensitive data
          key: config.storageOptions?.encryption?.key || crypto.randomBytes(32).toString('hex'),
          algorithm: 'aes-256-cbc',
        },
      },
    });
    this.channelService = config.channelService;
    this.swapTTL = config.swapTTL || 7 * 24 * 60 * 60; // Default 7 days
  }

  /**
   * Initializes the service
   */
  public async initialize(): Promise<void> {
    await super.initialize();
    this.startCleanupInterval();
  }

  /**
   * Creates a new swap
   */
  public async createSwap(params: {
    channelId: string;
    chainId: number;
    tokenIdA: string;
    tokenIdB: string;
    amountA: string;
    amountB: string;
    initiator: string;
    timelock: number;
  }): Promise<ISwap> {
    const channel = await this.channelService.getChannel(params.channelId);

    const transition = createTransition(TransitionType.SWAP_CREATE, {
      chainId: params.chainId,
      tokenIdA: params.tokenIdA,
      tokenIdB: params.tokenIdB,
      amountA: params.amountA,
      amountB: params.amountB,
      initiator: params.initiator,
      timelock: params.timelock,
    });

    await transition.apply(channel);
    const swapId = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string', 'string', 'string', 'string', 'address'],
      [
        params.channelId,
        params.chainId,
        params.tokenIdA,
        params.tokenIdB,
        params.amountA,
        params.amountB,
        params.initiator,
      ],
    );

    const swap = await channel.getSwap(swapId);
    if (!swap) {
      throw new ServiceError('Failed to create swap', 'SWAP_CREATE_FAILED');
    }

    const subchannelIdA = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [params.channelId, params.chainId, params.tokenIdA],
    );

    const subchannelIdB = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [params.channelId, params.chainId, params.tokenIdB],
    );

    // Store swap with TTL
    await this.store(`swap:${swap.id}`, swap, this.swapTTL);

    // Store swap metadata
    await this.store(`swap:${swap.id}:metadata`, {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      channelId: params.channelId,
      subchannelIdA,
      subchannelIdB,
      status: 'pending',
    } as ISwapMetadata);

    this.logger.info(
      `Created swap ${swap.id} in channel ${params.channelId} between ${params.tokenIdA} and ${params.tokenIdB}`,
    );

    return swap;
  }

  /**
   * Settles a swap
   */
  public async settleSwap(params: {
    channelId: string;
    chainId: number;
    tokenIdA: string;
    tokenIdB: string;
    amountA: string;
    amountB: string;
    initiator: string;
  }): Promise<void> {
    const channel = await this.channelService.getChannel(params.channelId);

    const transition = createTransition(TransitionType.SWAP_SETTLE, {
      chainId: params.chainId,
      tokenIdA: params.tokenIdA,
      tokenIdB: params.tokenIdB,
      amountA: params.amountA,
      amountB: params.amountB,
      initiator: params.initiator,
    });

    await transition.apply(channel);
    const swapId = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string', 'string', 'string', 'string', 'address'],
      [
        params.channelId,
        params.chainId,
        params.tokenIdA,
        params.tokenIdB,
        params.amountA,
        params.amountB,
        params.initiator,
      ],
    );

    const swap = await channel.getSwap(swapId);
    if (!swap) {
      throw new ServiceError('Swap not found', 'SWAP_NOT_FOUND');
    }

    const now = Date.now();

    // Update swap with TTL
    await this.store(
      `swap:${swap.id}`,
      {
        ...swap,
        status: 'settled',
        updatedAt: now,
      },
      this.swapTTL,
    );

    // Update swap metadata
    await this.store(`swap:${swap.id}:metadata`, {
      createdAt: swap.createdAt,
      updatedAt: now,
      channelId: params.channelId,
      subchannelIdA: swap.subchannelIdA,
      subchannelIdB: swap.subchannelIdB,
      status: 'settled',
      settledAt: now,
    } as ISwapMetadata);

    this.logger.info(`Settled swap ${swap.id} in channel ${params.channelId}`);
  }

  /**
   * Gets a swap by ID
   */
  public async getSwap(swapId: string): Promise<ISwap | null> {
    const swap = await this.retrieve<ISwap>(`swap:${swapId}`);
    if (swap) {
      // Update swap TTL on access
      await this.storage.touch(`swap:${swapId}`, this.swapTTL);
    }
    return swap;
  }

  /**
   * Gets swap metadata
   */
  public async getSwapMetadata(swapId: string): Promise<ISwapMetadata | null> {
    return this.retrieve<ISwapMetadata>(`swap:${swapId}:metadata`);
  }

  /**
   * Lists all swaps in a channel
   */
  public async listSwaps(channelId: string): Promise<ISwap[]> {
    const channel = await this.channelService.getChannel(channelId);
    const state = channel.getState();
    const swaps: ISwap[] = [];

    for (const subchannel of Object.values(state.subchannels)) {
      const keys = await this.listKeys(`swap:${subchannel.id}`);
      for (const key of keys) {
        if (!key.endsWith(':metadata')) {
          const swap = await this.retrieve<ISwap>(key);
          if (swap) {
            swaps.push(swap);
          }
        }
      }
    }

    return swaps;
  }

  /**
   * Starts the cleanup interval for expired swaps
   */
  private startCleanupInterval(): void {
    // Run cleanup every hour
    setInterval(
      () => {
        this.storage
          .stats()
          .then((stats) => {
            const expiredCount = stats.expiredKeys ?? 0;
            if (expiredCount > 0) {
              return this.storage.cleanup().then(() => {
                this.logger.info(`Cleaned up ${expiredCount} expired swaps`);
              });
            }
          })
          .catch((error) => {
            this.logger.error('Failed to cleanup expired swaps:', error);
          });
      },
      60 * 60 * 1000,
    );
  }
}
