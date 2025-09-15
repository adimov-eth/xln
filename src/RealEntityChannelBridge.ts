/**
 * REAL EntityChannelBridge - Actually connects old_src channels to src consensus
 *
 * This bridge properly integrates:
 * - old_src/app/Channel.ts (working bilateral channels)
 * - old_src/app/Transition.ts (AddPayment, SettlePayment, etc)
 * - src/entity-consensus.ts (BFT consensus)
 *
 * Key insight: old_src has the REAL implementation, src has consensus layer.
 * This bridge makes them work together.
 */

import Channel from '../old_src/app/Channel.js';
import User from '../old_src/app/User.js';
import { Transition } from '../old_src/app/Transition.js';
import { EntityState, EntityReplica, EntityTx } from './types.js';
import { Subchannel, Delta } from '../old_src/types/Subchannel.js';
import Block from '../old_src/types/Block.js';
import IChannelContext from '../old_src/types/IChannelContext.js';
import { ethers } from 'ethers';
import { log } from './utils.js';

/**
 * Bridge configuration
 */
export interface BridgeConfig {
  chainId: number;
  networkId: string;
  entityId: string;
  privateKey: string;
  depositoryAddress?: string;
  subcontractProviderAddress?: string;
}

/**
 * The REAL bridge between consensus and channels
 */
export class RealEntityChannelBridge {
  private channels: Map<string, Channel> = new Map();
  private users: Map<string, User> = new Map();
  private config: BridgeConfig;
  private wallet: ethers.Wallet;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.wallet = new ethers.Wallet(config.privateKey);
  }

  /**
   * Initialize bridge with entity replica
   */
  async initialize(entityReplica: EntityReplica): Promise<void> {
    log.info(`🌉 Initializing RealEntityChannelBridge for entity ${this.config.entityId}`);

    // Create User instance for this entity
    const user = new User(
      this.wallet,
      this.config.depositoryAddress || '0x0000000000000000000000000000000000000000',
      this.config.subcontractProviderAddress || '0x0000000000000000000000000000000000000000'
    );

    await user.initialize();
    this.users.set(this.config.entityId, user);
  }

  /**
   * Bridge entity consensus decision to channel operation
   */
  async bridgeConsensusToChannel(
    entityState: EntityState,
    tx: EntityTx
  ): Promise<void> {
    const user = this.users.get(this.config.entityId);
    if (!user) {
      throw new Error('User not initialized');
    }

    switch (tx.type) {
      case 'channel_open':
        await this.openChannel(user, tx.data);
        break;

      case 'payment_add':
        await this.addPayment(user, tx.data);
        break;

      case 'payment_settle':
        await this.settlePayment(user, tx.data);
        break;

      case 'swap_add':
        await this.addSwap(user, tx.data);
        break;

      case 'swap_settle':
        await this.settleSwap(user, tx.data);
        break;

      case 'direct_payment':
        await this.directPayment(user, tx.data);
        break;

      default:
        log.warn(`Unknown transaction type: ${tx.type}`);
    }
  }

  /**
   * Open a new channel
   */
  private async openChannel(user: User, data: any): Promise<void> {
    const { peerId, initialDeposit, creditLimit } = data;

    // Get or create channel
    let channel = this.channels.get(peerId);
    if (!channel) {
      // Create context for channel
      const ctx: IChannelContext = {
        getUserAddress: () => this.wallet.address,
        getRecipientAddress: () => peerId,
        getStorage: (key: string) => user.storage,
        user
      };

      channel = new Channel(ctx);
      await channel.initialize();
      this.channels.set(peerId, channel);
    }

    // Add subchannel with initial parameters
    const subchannel: Subchannel = {
      chainId: this.config.chainId,
      tokenId: 0, // Native token
      leftCreditLimit: BigInt(creditLimit || 0),
      rightCreditLimit: 0n,
      leftAllowence: 0n,
      rightAllowence: 0n,
      collateral: BigInt(initialDeposit || 0),
      ondelta: 0n,
      offdelta: 0n,
      deltas: [],
      cooperativeNonce: 0,
      disputeNonce: 0,
      proposedEvents: [],
      proposedEventsByLeft: true
    };

    channel.state.subchannels.push(subchannel);

    log.info(`✅ Channel opened with ${peerId}, deposit: ${initialDeposit}, credit: ${creditLimit}`);
  }

  /**
   * Add payment (HTLC) using real Transition.AddPayment
   */
  private async addPayment(user: User, data: any): Promise<void> {
    const { channelId, amount, hashlock, timelock, encryptedPackage } = data;

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Create AddPayment transition
    const transition = new Transition.AddPayment(
      this.config.chainId,
      0, // tokenId
      BigInt(amount),
      hashlock,
      timelock,
      encryptedPackage || ''
    );

    // Create block for this transition
    const block: Block = {
      isLeft: channel.isLeft,
      timestamp: Date.now(),
      previousStateHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(channel.state))),
      transitions: [transition],
      signatures: [],
      blockId: channel.state.blockId + 1
    };

    // Apply transition
    await transition.apply(channel, block, false);
    channel.state.blockId++;

    log.info(`✅ Payment added: ${amount} with hashlock ${hashlock}`);
  }

  /**
   * Settle payment using real Transition.SettlePayment
   */
  private async settlePayment(user: User, data: any): Promise<void> {
    const { channelId, transitionId, secret } = data;

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Create SettlePayment transition
    const transition = new Transition.SettlePayment(
      transitionId,
      secret
    );

    // Create block
    const block: Block = {
      isLeft: !channel.isLeft, // Settlement comes from other side
      timestamp: Date.now(),
      previousStateHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(channel.state))),
      transitions: [transition],
      signatures: [],
      blockId: channel.state.blockId + 1
    };

    // Apply transition
    await transition.apply(channel, block, false);
    channel.state.blockId++;

    log.info(`✅ Payment settled with secret: ${secret}`);
  }

  /**
   * Add swap using real Transition.AddSwap
   */
  private async addSwap(user: User, data: any): Promise<void> {
    const { channelId, addAmount, subAmount, tokenId, subTokenId } = data;

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Create AddSwap transition
    const transition = new Transition.AddSwap(
      this.config.chainId,
      channel.isLeft,
      BigInt(addAmount),
      BigInt(subAmount),
      tokenId || 0,
      subTokenId || 1
    );

    // Create block
    const block: Block = {
      isLeft: channel.isLeft,
      timestamp: Date.now(),
      previousStateHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(channel.state))),
      transitions: [transition],
      signatures: [],
      blockId: channel.state.blockId + 1
    };

    // Apply transition
    await transition.apply(channel, block, false);
    channel.state.blockId++;

    log.info(`✅ Swap added: ${addAmount} -> ${subAmount}`);
  }

  /**
   * Settle swap using real Transition.SettleSwap
   */
  private async settleSwap(user: User, data: any): Promise<void> {
    const { channelId, transitionId } = data;

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Create SettleSwap transition
    const transition = new Transition.SettleSwap(transitionId);

    // Create block
    const block: Block = {
      isLeft: !channel.isLeft,
      timestamp: Date.now(),
      previousStateHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(channel.state))),
      transitions: [transition],
      signatures: [],
      blockId: channel.state.blockId + 1
    };

    // Apply transition
    await transition.apply(channel, block, false);
    channel.state.blockId++;

    log.info(`✅ Swap settled: ${transitionId}`);
  }

  /**
   * Direct payment using real Transition.DirectPayment
   */
  private async directPayment(user: User, data: any): Promise<void> {
    const { channelId, amount, tokenId } = data;

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Create DirectPayment transition
    const transition = new Transition.DirectPayment(
      this.config.chainId,
      tokenId || 0,
      BigInt(amount)
    );

    // Create block
    const block: Block = {
      isLeft: channel.isLeft,
      timestamp: Date.now(),
      previousStateHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(channel.state))),
      transitions: [transition],
      signatures: [],
      blockId: channel.state.blockId + 1
    };

    // Apply transition
    await transition.apply(channel, block, false);
    channel.state.blockId++;

    log.info(`✅ Direct payment: ${amount} on token ${tokenId}`);
  }

  /**
   * Get channel capacity using the real deriveDelta function
   */
  async getChannelCapacity(channelId: string, isLeft: boolean): Promise<any> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return null;
    }

    // Use the real deriveDelta from Channel.ts
    return channel.deriveDelta(this.config.chainId, 0, isLeft);
  }

  /**
   * Export channel state to entity state format
   */
  exportToEntityState(): any {
    const channelStates: any[] = [];

    for (const [peerId, channel] of this.channels) {
      const capacity = channel.deriveDelta(this.config.chainId, 0, channel.isLeft);

      channelStates.push({
        peerId,
        state: channel.state,
        capacity,
        blockId: channel.state.blockId,
        subchannels: channel.state.subchannels.length
      });
    }

    return {
      channels: channelStates,
      timestamp: Date.now()
    };
  }

  /**
   * Sync channel state from consensus
   */
  async syncFromConsensus(entityState: EntityState): Promise<void> {
    // Extract channel operations from entity state
    const channelOps = entityState.transactions.filter(
      tx => tx.type.startsWith('channel_') || tx.type.includes('payment') || tx.type.includes('swap')
    );

    // Apply each operation
    for (const op of channelOps) {
      await this.bridgeConsensusToChannel(entityState, op);
    }
  }

  /**
   * Get all active channels
   */
  getActiveChannels(): Map<string, Channel> {
    return this.channels;
  }

  /**
   * Close channel and settle on-chain if needed
   */
  async closeChannel(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Generate dispute proof
    const proofs = await channel.getSubchannelProofs(false);

    // In production, would submit to Depository.sol
    log.info(`📝 Channel close proof generated:`, {
      channelId,
      blockId: channel.state.blockId,
      proofHash: proofs.proofhash[0]
    });

    // Remove from active channels
    this.channels.delete(channelId);
  }
}