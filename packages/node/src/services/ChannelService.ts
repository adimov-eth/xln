import { ethers } from 'ethers';
import { BaseService, ServiceError, IServiceConfig } from './BaseService';
import { Channel, IChannelState, ISubchannel } from '../core/Channel';
import { createTransition, TransitionType } from '../core/Transition';

/**
 * Channel service configuration
 */
export interface IChannelServiceConfig extends IServiceConfig {
  disputePeriod?: number;
  maxBlockSize?: number;
  channelTTL?: number;
}

/**
 * Channel metadata interface
 */
export interface IChannelMetadata {
  createdAt: number;
  updatedAt: number;
  left: string;
  right: string;
  lastSignedAt?: number;
  lastSigner?: string;
}

/**
 * Channel service for managing payment channels
 */
export class ChannelService extends BaseService {
  private readonly channelTTL: number;
  private readonly channels: Map<string, Channel>;

  constructor(config: IChannelServiceConfig) {
    super(config);
    this.channelTTL = config.channelTTL || 30 * 24 * 60 * 60; // Default 30 days
    this.channels = new Map();
  }

  /**
   * Initializes the service
   */
  public async initialize(): Promise<void> {
    await super.initialize();
    await this.loadChannels();
    this.startCleanupInterval();
  }

  /**
   * Creates a new channel
   */
  public async createChannel(params: { userAddress: string; peerAddress: string }): Promise<IChannelState> {
    const channel = new Channel(params.userAddress, params.peerAddress, {
      dbPath: `${this.storage.getPrefixedKey('channels')}/${params.userAddress}-${params.peerAddress}`,
    });

    await channel.initialize();
    const state = channel.getState();
    this.channels.set(state.channelId, channel);

    // Store channel state with TTL
    await this.store(`channel:${state.channelId}`, state, this.channelTTL);

    // Store channel metadata
    await this.store(`channel:${state.channelId}:metadata`, {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      left: params.userAddress,
      right: params.peerAddress,
    });

    this.logger.info(`Created channel ${state.channelId} between ${params.userAddress} and ${params.peerAddress}`);
    return state;
  }

  /**
   * Gets a channel by ID
   */
  public async getChannel(channelId: string): Promise<Channel> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new ServiceError('Channel not found', 'CHANNEL_NOT_FOUND');
    }

    // Update channel TTL on access
    await this.storage.touch(`channel:${channelId}`, this.channelTTL);
    return channel;
  }

  /**
   * Lists all channels for a user
   */
  public async listChannels(userAddress: string): Promise<IChannelState[]> {
    const states: IChannelState[] = [];
    for (const channel of this.channels.values()) {
      const state = channel.getState();
      if (state.left === userAddress || state.right === userAddress) {
        states.push(state);
      }
    }
    return states;
  }

  /**
   * Opens a subchannel
   */
  public async openSubchannel(params: {
    channelId: string;
    chainId: number;
    tokenId: string;
    capacity: string;
  }): Promise<ISubchannel> {
    const channel = await this.getChannel(params.channelId);
    const transition = createTransition(TransitionType.SUBCHANNEL_CREATE, {
      chainId: params.chainId,
      tokenId: params.tokenId,
      capacity: params.capacity,
    });

    await transition.apply(channel);

    // Store updated channel state with TTL
    await this.store(`channel:${params.channelId}`, channel.getState(), this.channelTTL);

    // Update metadata
    const metadata = await this.retrieve(`channel:${params.channelId}:metadata`);
    if (metadata) {
      await this.store(`channel:${params.channelId}:metadata`, {
        ...metadata,
        updatedAt: Date.now(),
      });
    }

    const subchannel = channel.getSubchannel(
      ethers.solidityPackedKeccak256(
        ['string', 'uint256', 'string'],
        [params.channelId, params.chainId, params.tokenId],
      ),
    );

    if (!subchannel) {
      throw new ServiceError('Failed to create subchannel', 'SUBCHANNEL_CREATE_FAILED');
    }

    this.logger.info(`Opened subchannel ${subchannel.id} in channel ${params.channelId} for token ${params.tokenId}`);
    return subchannel;
  }

  /**
   * Updates subchannel balance
   */
  public async updateBalance(params: { channelId: string; subchannelId: string; newBalance: string }): Promise<void> {
    const channel = await this.getChannel(params.channelId);
    const subchannel = channel.getSubchannel(params.subchannelId);

    if (!subchannel) {
      throw new ServiceError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    const transition = createTransition(TransitionType.SUBCHANNEL_UPDATE, {
      chainId: subchannel.chainId,
      tokenId: subchannel.tokenId,
      balance: params.newBalance,
    });

    await transition.apply(channel);

    // Store updated channel state with TTL
    await this.store(`channel:${params.channelId}`, channel.getState(), this.channelTTL);

    // Update metadata
    const metadata = await this.retrieve(`channel:${params.channelId}:metadata`);
    if (metadata) {
      await this.store(`channel:${params.channelId}:metadata`, {
        ...metadata,
        updatedAt: Date.now(),
      });
    }

    this.logger.info(
      `Updated balance of subchannel ${params.subchannelId} in channel ${params.channelId} to ${params.newBalance}`,
    );
  }

  /**
   * Closes a subchannel
   */
  public async closeSubchannel(params: {
    channelId: string;
    subchannelId: string;
    finalBalance: string;
  }): Promise<void> {
    const channel = await this.getChannel(params.channelId);
    const subchannel = channel.getSubchannel(params.subchannelId);

    if (!subchannel) {
      throw new ServiceError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    const transition = createTransition(TransitionType.SUBCHANNEL_CLOSE, {
      chainId: subchannel.chainId,
      tokenId: subchannel.tokenId,
      finalBalance: params.finalBalance,
    });

    await transition.apply(channel);

    // Store updated channel state with TTL
    await this.store(`channel:${params.channelId}`, channel.getState(), this.channelTTL);

    // Update metadata
    const metadata = await this.retrieve(`channel:${params.channelId}:metadata`);
    if (metadata) {
      await this.store(`channel:${params.channelId}:metadata`, {
        ...metadata,
        updatedAt: Date.now(),
      });
    }

    this.logger.info(
      `Closed subchannel ${params.subchannelId} in channel ${params.channelId} with final balance ${params.finalBalance}`,
    );
  }

  /**
   * Signs the current state
   */
  public async signState(params: { channelId: string; signer: ethers.Wallet }): Promise<void> {
    const channel = await this.getChannel(params.channelId);
    await channel.signState(params.signer);

    // Store updated channel state with TTL
    await this.store(`channel:${params.channelId}`, channel.getState(), this.channelTTL);

    // Update metadata
    const metadata = await this.retrieve(`channel:${params.channelId}:metadata`);
    if (metadata) {
      await this.store(`channel:${params.channelId}:metadata`, {
        ...metadata,
        updatedAt: Date.now(),
        lastSignedAt: Date.now(),
        lastSigner: params.signer.address,
      });
    }

    this.logger.info(`Signed state of channel ${params.channelId} by ${params.signer.address}`);
  }

  /**
   * Gets channel metadata
   */
  public async getChannelMetadata(channelId: string): Promise<IChannelMetadata | null> {
    return this.retrieve<IChannelMetadata>(`channel:${channelId}:metadata`);
  }

  /**
   * Loads channels from storage
   */
  private async loadChannels(): Promise<void> {
    const keys = await this.listKeys('channel:');
    for (const key of keys) {
      if (!key.endsWith(':metadata')) {
        const state = await this.retrieve<IChannelState>(key);
        if (state) {
          const channel = new Channel(state.left, state.right, {
            dbPath: `${this.storage.getPrefixedKey('channels')}/${state.left}-${state.right}`,
          });
          await channel.initialize();
          this.channels.set(state.channelId, channel);
        }
      }
    }
    this.logger.info(`Loaded ${this.channels.size} channels`);
  }

  /**
   * Starts the cleanup interval for expired channels
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
            this.logger.info(`Cleaned up ${expiredCount} expired channel states`);
          }
        } catch (error) {
          this.logger.error('Failed to cleanup expired channels:', error);
        }
      },
      60 * 60 * 1000,
    );
  }
}
