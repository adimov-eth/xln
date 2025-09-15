/**
 * Enhanced Bilateral Channel with SubcontractProvider Integration
 *
 * This bridges the old Channel implementation with the new unified liquidity system.
 * Channels can now participate in the shared order book through delta transformations.
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { SubcontractProvider, Batch, Payment, Swap } from '../contracts/SubcontractProvider';

export interface ChannelState {
  channelId: string;
  leftAddress: string;
  rightAddress: string;
  deltas: bigint[]; // Current delta values
  tokens: string[]; // Token addresses for each delta
  nonce: bigint;
  lockedUntil?: number; // Block number if channel is locked
  pendingBatch?: Batch; // Batch awaiting confirmation
}

export interface ChannelUpdate {
  nonce: bigint;
  batch: Batch;
  leftSignature?: string;
  rightSignature?: string;
  leftArguments?: number[]; // Fill ratios for left's swaps
  rightArguments?: number[]; // Fill ratios for right's swaps
}

export enum ChannelStatus {
  OPEN = 'open',
  LOCKED = 'locked', // During update negotiation
  CLOSING = 'closing',
  CLOSED = 'closed'
}

/**
 * Enhanced bilateral state channel with subcontract support
 */
export class EnhancedChannel extends EventEmitter {
  private state: ChannelState;
  private status: ChannelStatus = ChannelStatus.OPEN;
  private subcontractProvider: SubcontractProvider;
  private pendingUpdates: Map<string, ChannelUpdate> = new Map();
  private isLeft: boolean;

  // For unified liquidity integration
  private orderIds: Set<string> = new Set();
  private activeSwaps: Map<string, Swap> = new Map();
  private activePayments: Map<string, Payment> = new Map();

  constructor(
    channelId: string,
    leftAddress: string,
    rightAddress: string,
    myAddress: string,
    tokens: string[],
    initialDeltas: bigint[],
    subcontractProvider: SubcontractProvider
  ) {
    super();

    this.isLeft = myAddress.toLowerCase() === leftAddress.toLowerCase();

    this.state = {
      channelId,
      leftAddress,
      rightAddress,
      deltas: initialDeltas,
      tokens,
      nonce: 0n
    };

    this.subcontractProvider = subcontractProvider;
  }

  /**
   * Get current channel state
   */
  getState(): ChannelState {
    return { ...this.state };
  }

  /**
   * Get channel ID
   */
  getId(): string {
    return this.state.channelId;
  }

  /**
   * Get available balance for a token
   */
  getBalance(tokenAddress: string): bigint {
    const index = this.state.tokens.indexOf(tokenAddress);
    if (index === -1) return 0n;

    const delta = this.state.deltas[index];
    // Positive delta means we have balance
    return delta > 0n ? delta : 0n;
  }

  /**
   * Create a swap offer for the unified liquidity pool
   */
  async createSwapOffer(
    sellToken: string,
    sellAmount: bigint,
    buyToken: string,
    buyAmount: bigint
  ): Promise<{ swap: Swap; updateId: string }> {
    const sellIndex = this.state.tokens.indexOf(sellToken);
    const buyIndex = this.state.tokens.indexOf(buyToken);

    if (sellIndex === -1 || buyIndex === -1) {
      throw new Error('Token not supported in channel');
    }

    // Check we have sufficient balance
    if (this.state.deltas[sellIndex] < sellAmount) {
      throw new Error('Insufficient balance for swap');
    }

    const swap: Swap = {
      ownerIsLeft: this.isLeft,
      addDeltaIndex: buyIndex,
      addAmount: buyAmount,
      subDeltaIndex: sellIndex,
      subAmount: sellAmount
    };

    const updateId = ethers.id(`${this.state.channelId}_${Date.now()}`);
    this.activeSwaps.set(updateId, swap);

    this.emit('swap_created', { updateId, swap });

    return { swap, updateId };
  }

  /**
   * Create an HTLC payment for cross-settlement
   */
  async createHTLCPayment(
    tokenAddress: string,
    amount: bigint,
    timeoutBlocks: number = 144
  ): Promise<{ payment: Payment; secret: string; updateId: string }> {
    const tokenIndex = this.state.tokens.indexOf(tokenAddress);
    if (tokenIndex === -1) {
      throw new Error('Token not supported in channel');
    }

    const { payment, secret } = this.subcontractProvider.createHTLCPayment(
      tokenIndex,
      amount,
      timeoutBlocks
    );

    const updateId = ethers.id(`${this.state.channelId}_htlc_${Date.now()}`);
    this.activePayments.set(updateId, payment);

    this.emit('htlc_created', { updateId, payment, secret });

    return { payment, secret, updateId };
  }

  /**
   * Apply a batch update to the channel
   */
  async applyUpdate(update: ChannelUpdate): Promise<void> {
    // Validate nonce
    if (update.nonce !== this.state.nonce + 1n) {
      throw new Error(`Invalid nonce: expected ${this.state.nonce + 1n}, got ${update.nonce}`);
    }

    // Validate signatures
    if (!this.validateSignatures(update)) {
      throw new Error('Invalid signatures on update');
    }

    // Apply batch to deltas
    const newDeltas = await this.subcontractProvider.applyBatch(
      this.state.deltas,
      update.batch,
      update.leftArguments || [],
      update.rightArguments || []
    );

    // Check no negative deltas
    for (let i = 0; i < newDeltas.length; i++) {
      if (newDeltas[i] < 0n) {
        throw new Error(`Update would create negative delta at index ${i}`);
      }
    }

    // Update state
    this.state.deltas = newDeltas;
    this.state.nonce = update.nonce;
    this.state.pendingBatch = undefined;

    this.emit('update_applied', {
      channelId: this.state.channelId,
      nonce: this.state.nonce,
      deltas: this.state.deltas
    });
  }

  /**
   * Propose a new batch update
   */
  async proposeUpdate(batch: Batch): Promise<ChannelUpdate> {
    if (this.status !== ChannelStatus.OPEN) {
      throw new Error('Channel not open for updates');
    }

    // Lock channel during negotiation
    this.status = ChannelStatus.LOCKED;
    this.state.lockedUntil = (await this.getCurrentBlock()) + 10;

    const update: ChannelUpdate = {
      nonce: this.state.nonce + 1n,
      batch,
      leftArguments: [],
      rightArguments: []
    };

    // Sign if we're proposing
    const signature = await this.signUpdate(update);
    if (this.isLeft) {
      update.leftSignature = signature;
    } else {
      update.rightSignature = signature;
    }

    this.state.pendingBatch = batch;
    const updateId = ethers.id(`${this.state.channelId}_${update.nonce}`);
    this.pendingUpdates.set(updateId, update);

    this.emit('update_proposed', { updateId, update });

    return update;
  }

  /**
   * Accept a proposed update
   */
  async acceptUpdate(updateId: string, fillRatios?: number[]): Promise<void> {
    const update = this.pendingUpdates.get(updateId);
    if (!update) {
      throw new Error('Update not found');
    }

    // Add our fill ratios
    if (fillRatios) {
      if (this.isLeft) {
        update.leftArguments = fillRatios;
      } else {
        update.rightArguments = fillRatios;
      }
    }

    // Add our signature
    const signature = await this.signUpdate(update);
    if (this.isLeft) {
      update.leftSignature = signature;
    } else {
      update.rightSignature = signature;
    }

    // Apply if both signed
    if (update.leftSignature && update.rightSignature) {
      await this.applyUpdate(update);
      this.pendingUpdates.delete(updateId);
      this.status = ChannelStatus.OPEN;
    }

    this.emit('update_accepted', { updateId, update });
  }

  /**
   * Reject a proposed update
   */
  rejectUpdate(updateId: string): void {
    this.pendingUpdates.delete(updateId);
    this.state.pendingBatch = undefined;
    this.status = ChannelStatus.OPEN;
    this.emit('update_rejected', { updateId });
  }

  /**
   * Reveal an HTLC secret
   */
  async revealHTLCSecret(secret: string): Promise<void> {
    await this.subcontractProvider.revealSecret(secret);
    this.emit('htlc_revealed', { secret });
  }

  /**
   * Sign a channel update
   */
  private async signUpdate(update: ChannelUpdate): Promise<string> {
    const message = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'bytes'],
      [
        this.state.channelId,
        update.nonce,
        this.subcontractProvider.encodeBatch(update.batch)
      ]
    );

    // In production, use proper key management
    const wallet = ethers.Wallet.createRandom();
    return wallet.signMessage(ethers.getBytes(message));
  }

  /**
   * Validate signatures on an update
   */
  private validateSignatures(update: ChannelUpdate): boolean {
    // In production, properly validate signatures
    // For now, just check they exist
    return !!(update.leftSignature && update.rightSignature);
  }

  /**
   * Get current block number
   */
  private async getCurrentBlock(): Promise<number> {
    // In production, get from provider
    return Math.floor(Date.now() / 12000); // Simulated ~12s blocks
  }

  /**
   * Get channel metrics
   */
  getMetrics() {
    const totalValue = this.state.deltas.reduce((sum, delta) => {
      return sum + (delta > 0n ? delta : -delta);
    }, 0n);

    return {
      channelId: this.state.channelId,
      status: this.status,
      nonce: this.state.nonce.toString(),
      numTokens: this.state.tokens.length,
      totalValue: totalValue.toString(),
      pendingUpdates: this.pendingUpdates.size,
      activeSwaps: this.activeSwaps.size,
      activePayments: this.activePayments.size
    };
  }

  /**
   * Close the channel cooperatively
   */
  async closeCooperatively(): Promise<void> {
    if (this.status !== ChannelStatus.OPEN) {
      throw new Error('Channel must be open to close cooperatively');
    }

    this.status = ChannelStatus.CLOSING;

    // Create final state update
    const finalUpdate: ChannelUpdate = {
      nonce: this.state.nonce + 1n,
      batch: { payment: [], swap: [] }, // Empty batch for final state
      leftSignature: undefined,
      rightSignature: undefined
    };

    // Both parties sign
    const signature = await this.signUpdate(finalUpdate);
    if (this.isLeft) {
      finalUpdate.leftSignature = signature;
    } else {
      finalUpdate.rightSignature = signature;
    }

    // In production, coordinate with counterparty
    // For now, mark as closed
    this.status = ChannelStatus.CLOSED;

    this.emit('channel_closed', {
      channelId: this.state.channelId,
      finalDeltas: this.state.deltas,
      finalNonce: this.state.nonce
    });
  }

  /**
   * Force close the channel (dispute)
   */
  async forceClose(): Promise<void> {
    if (this.status === ChannelStatus.CLOSED) {
      throw new Error('Channel already closed');
    }

    this.status = ChannelStatus.CLOSING;

    // In production, submit to on-chain contract
    // Start challenge period
    const challengePeriod = 144; // blocks
    this.state.lockedUntil = (await this.getCurrentBlock()) + challengePeriod;

    this.emit('channel_disputed', {
      channelId: this.state.channelId,
      lockedUntil: this.state.lockedUntil,
      currentDeltas: this.state.deltas
    });
  }
}

/**
 * Factory for creating enhanced channels
 */
export class EnhancedChannelFactory {
  private channels: Map<string, EnhancedChannel> = new Map();

  constructor(
    private subcontractProvider: SubcontractProvider,
    private myAddress: string
  ) {}

  /**
   * Create a new enhanced channel
   */
  async createChannel(
    counterparty: string,
    tokens: string[],
    initialDeposits?: Map<string, bigint>
  ): Promise<EnhancedChannel> {
    const leftAddress = this.myAddress.toLowerCase() < counterparty.toLowerCase()
      ? this.myAddress
      : counterparty;
    const rightAddress = leftAddress === this.myAddress ? counterparty : this.myAddress;

    const channelId = ethers.solidityPackedKeccak256(
      ['address', 'address', 'uint256'],
      [leftAddress, rightAddress, Date.now()]
    );

    // Initialize deltas based on deposits
    const initialDeltas: bigint[] = tokens.map(token => {
      const deposit = initialDeposits?.get(token) || 0n;
      // If we're left, positive delta for our deposit
      // If we're right, negative delta for their deposit
      return this.myAddress === leftAddress ? deposit : -deposit;
    });

    const channel = new EnhancedChannel(
      channelId,
      leftAddress,
      rightAddress,
      this.myAddress,
      tokens,
      initialDeltas,
      this.subcontractProvider
    );

    this.channels.set(channelId, channel);

    return channel;
  }

  /**
   * Get existing channel
   */
  getChannel(channelId: string): EnhancedChannel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Get all channels
   */
  getAllChannels(): EnhancedChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get channels with a specific counterparty
   */
  getChannelsWithCounterparty(counterparty: string): EnhancedChannel[] {
    return this.getAllChannels().filter(channel => {
      const state = channel.getState();
      return state.leftAddress === counterparty || state.rightAddress === counterparty;
    });
  }
}