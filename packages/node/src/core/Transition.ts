import { ethers } from 'ethers';
import { Channel } from './Channel';

/**
 * Error class for Transition operations
 */
export class TransitionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

/**
 * Base interface for all transitions
 */
export interface ITransition {
  type: TransitionType;
  timestamp: number;
  blockNumber: number;
  apply(channel: Channel): Promise<void>;
  verify(channel: Channel): Promise<boolean>;
}

/**
 * Enum for transition types
 */
export enum TransitionType {
  PAYMENT_CREATE = 'PAYMENT_CREATE',
  PAYMENT_SETTLE = 'PAYMENT_SETTLE',
  PAYMENT_CANCEL = 'PAYMENT_CANCEL',
  SUBCHANNEL_CREATE = 'SUBCHANNEL_CREATE',
  SUBCHANNEL_UPDATE = 'SUBCHANNEL_UPDATE',
  SUBCHANNEL_CLOSE = 'SUBCHANNEL_CLOSE',
  SWAP_CREATE = 'SWAP_CREATE',
  SWAP_SETTLE = 'SWAP_SETTLE',
  DISPUTE_RESOLVE = 'DISPUTE_RESOLVE',
}

/**
 * Interface for payment-related transitions
 */
export interface IPaymentTransition extends ITransition {
  chainId: number;
  tokenId: string;
  amount: string;
  hashlock?: string;
  timelock?: number;
  encryptedData?: string;
}

/**
 * Interface for subchannel-related transitions
 */
export interface ISubchannelTransition extends ITransition {
  chainId: number;
  tokenId: string;
  capacity?: string;
  balance?: string;
}

/**
 * Interface for swap-related transitions
 */
export interface ISwapTransition extends ITransition {
  chainId: number;
  tokenIdA: string;
  tokenIdB: string;
  amountA: string;
  amountB: string;
  initiator: string;
}

/**
 * Base class for all transitions
 */
abstract class BaseTransition implements ITransition {
  constructor(
    public readonly type: TransitionType,
    public readonly timestamp: number = Date.now(),
    public readonly blockNumber: number = 0
  ) {}

  abstract apply(channel: Channel): Promise<void>;
  abstract verify(channel: Channel): Promise<boolean>;

  protected validateChannel(channel: Channel): void {
    if (!channel) {
      throw new TransitionError('Channel is required', 'CHANNEL_REQUIRED');
    }
  }
}

/**
 * Payment creation transition
 */
export class PaymentCreateTransition extends BaseTransition implements IPaymentTransition {
  constructor(
    public readonly chainId: number,
    public readonly tokenId: string,
    public readonly amount: string,
    public readonly hashlock: string,
    public readonly timelock: number,
    public readonly encryptedData?: string
  ) {
    super(TransitionType.PAYMENT_CREATE);
  }

  async apply(channel: Channel): Promise<void> {
    this.validateChannel(channel);
    const subchannel = channel.getSubchannel(this.getSubchannelId(channel));

    if (!subchannel) {
      throw new TransitionError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    if (subchannel.status !== 'active') {
      throw new TransitionError('Subchannel is not active', 'SUBCHANNEL_INACTIVE');
    }

    if (BigInt(subchannel.balance) + BigInt(this.amount) > BigInt(subchannel.capacity)) {
      throw new TransitionError('Payment exceeds capacity', 'PAYMENT_EXCEEDS_CAPACITY');
    }

    // Store payment hashlock
    await channel.storePaymentHashlock({
      subchannelId: subchannel.id,
      amount: this.amount,
      hashlock: this.hashlock,
      timelock: this.timelock,
    });

    await channel.updateBalance({
      subchannelId: subchannel.id,
      newBalance: (BigInt(subchannel.balance) + BigInt(this.amount)).toString(),
    });
  }

  async verify(channel: Channel): Promise<boolean> {
    try {
      this.validateChannel(channel);
      const subchannel = channel.getSubchannel(this.getSubchannelId(channel));
      return Boolean(
        subchannel &&
          subchannel.status === 'active' &&
          BigInt(subchannel.balance) + BigInt(this.amount) <= BigInt(subchannel.capacity)
      );
    } catch (error) {
      return false;
    }
  }

  private getSubchannelId(channel: Channel): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [channel.getState().channelId, this.chainId, this.tokenId]
    );
  }
}

/**
 * Payment settlement transition
 */
export class PaymentSettleTransition extends BaseTransition implements IPaymentTransition {
  constructor(
    public readonly chainId: number,
    public readonly tokenId: string,
    public readonly amount: string,
    public readonly secret: string
  ) {
    super(TransitionType.PAYMENT_SETTLE);
  }

  async apply(channel: Channel): Promise<void> {
    this.validateChannel(channel);
    const subchannel = channel.getSubchannel(this.getSubchannelId(channel));

    if (!subchannel) {
      throw new TransitionError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    if (subchannel.status !== 'active') {
      throw new TransitionError('Subchannel is not active', 'SUBCHANNEL_INACTIVE');
    }

    const hashlock = ethers.keccak256(ethers.toUtf8Bytes(this.secret));
    const expectedHashlock = await channel.getPaymentHashlock(subchannel.id, this.amount);

    if (hashlock !== expectedHashlock) {
      throw new TransitionError('Invalid secret', 'INVALID_SECRET');
    }

    // Update payment status
    const paymentId = ethers.solidityPackedKeccak256(['string', 'string'], [subchannel.id, this.amount]);
    await channel.updatePaymentStatus(paymentId, 'settled');

    await channel.updateBalance({
      subchannelId: subchannel.id,
      newBalance: (BigInt(subchannel.balance) - BigInt(this.amount)).toString(),
    });
  }

  async verify(channel: Channel): Promise<boolean> {
    try {
      this.validateChannel(channel);
      const subchannel = channel.getSubchannel(this.getSubchannelId(channel));
      return Boolean(subchannel && subchannel.status === 'active' && BigInt(subchannel.balance) >= BigInt(this.amount));
    } catch (error) {
      return false;
    }
  }

  private getSubchannelId(channel: Channel): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [channel.getState().channelId, this.chainId, this.tokenId]
    );
  }
}

/**
 * Payment cancellation transition
 */
export class PaymentCancelTransition extends BaseTransition implements IPaymentTransition {
  constructor(
    public readonly chainId: number,
    public readonly tokenId: string,
    public readonly amount: string,
    public readonly timelock: number
  ) {
    super(TransitionType.PAYMENT_CANCEL);
  }

  async apply(channel: Channel): Promise<void> {
    this.validateChannel(channel);
    const subchannel = channel.getSubchannel(this.getSubchannelId(channel));

    if (!subchannel) {
      throw new TransitionError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    if (subchannel.status !== 'active') {
      throw new TransitionError('Subchannel is not active', 'SUBCHANNEL_INACTIVE');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime < this.timelock) {
      throw new TransitionError('Payment timelock not expired', 'TIMELOCK_NOT_EXPIRED');
    }

    // Update payment status
    const paymentId = ethers.solidityPackedKeccak256(['string', 'string'], [subchannel.id, this.amount]);
    await channel.updatePaymentStatus(paymentId, 'cancelled');

    await channel.updateBalance({
      subchannelId: subchannel.id,
      newBalance: (BigInt(subchannel.balance) - BigInt(this.amount)).toString(),
    });
  }

  async verify(channel: Channel): Promise<boolean> {
    try {
      this.validateChannel(channel);
      const subchannel = channel.getSubchannel(this.getSubchannelId(channel));
      const currentTime = Math.floor(Date.now() / 1000);
      return Boolean(
        subchannel &&
          subchannel.status === 'active' &&
          BigInt(subchannel.balance) >= BigInt(this.amount) &&
          currentTime >= this.timelock
      );
    } catch (error) {
      return false;
    }
  }

  private getSubchannelId(channel: Channel): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [channel.getState().channelId, this.chainId, this.tokenId]
    );
  }
}

/**
 * Subchannel creation transition
 */
export class SubchannelCreateTransition extends BaseTransition implements ISubchannelTransition {
  constructor(public readonly chainId: number, public readonly tokenId: string, public readonly capacity: string) {
    super(TransitionType.SUBCHANNEL_CREATE);
  }

  async apply(channel: Channel): Promise<void> {
    this.validateChannel(channel);
    await channel.openSubchannel({
      chainId: this.chainId,
      tokenId: this.tokenId,
      capacity: this.capacity,
    });
  }

  async verify(channel: Channel): Promise<boolean> {
    try {
      this.validateChannel(channel);
      const subchannel = channel.getSubchannel(this.getSubchannelId(channel));
      return !subchannel; // Should not exist yet
    } catch (error) {
      return false;
    }
  }

  private getSubchannelId(channel: Channel): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [channel.getState().channelId, this.chainId, this.tokenId]
    );
  }
}

/**
 * Swap creation transition
 */
export class SwapCreateTransition extends BaseTransition implements ISwapTransition {
  constructor(
    public readonly chainId: number,
    public readonly tokenIdA: string,
    public readonly tokenIdB: string,
    public readonly amountA: string,
    public readonly amountB: string,
    public readonly initiator: string,
    public readonly timelock: number
  ) {
    super(TransitionType.SWAP_CREATE);
  }

  async apply(channel: Channel): Promise<void> {
    this.validateChannel(channel);
    const subchannelA = channel.getSubchannel(this.getSubchannelId(channel, this.tokenIdA));
    const subchannelB = channel.getSubchannel(this.getSubchannelId(channel, this.tokenIdB));

    if (!subchannelA || !subchannelB) {
      throw new TransitionError('Subchannels not found', 'SUBCHANNEL_NOT_FOUND');
    }

    if (subchannelA.status !== 'active' || subchannelB.status !== 'active') {
      throw new TransitionError('Subchannels must be active', 'SUBCHANNEL_INACTIVE');
    }

    // Lock amounts in both subchannels
    await channel.updateBalance({
      subchannelId: subchannelA.id,
      newBalance: (BigInt(subchannelA.balance) + BigInt(this.amountA)).toString(),
    });

    await channel.updateBalance({
      subchannelId: subchannelB.id,
      newBalance: (BigInt(subchannelB.balance) + BigInt(this.amountB)).toString(),
    });

    await channel.createSwap({
      swapId: this.getSwapId(channel),
      subchannelIdA: subchannelA.id,
      subchannelIdB: subchannelB.id,
      amountA: this.amountA,
      amountB: this.amountB,
      initiator: this.initiator,
      timelock: this.timelock,
    });
  }

  async verify(channel: Channel): Promise<boolean> {
    try {
      this.validateChannel(channel);
      const subchannelA = channel.getSubchannel(this.getSubchannelId(channel, this.tokenIdA));
      const subchannelB = channel.getSubchannel(this.getSubchannelId(channel, this.tokenIdB));

      return Boolean(
        subchannelA &&
          subchannelB &&
          subchannelA.status === 'active' &&
          subchannelB.status === 'active' &&
          BigInt(subchannelA.balance) + BigInt(this.amountA) <= BigInt(subchannelA.capacity) &&
          BigInt(subchannelB.balance) + BigInt(this.amountB) <= BigInt(subchannelB.capacity)
      );
    } catch (error) {
      return false;
    }
  }

  private getSubchannelId(channel: Channel, tokenId: string): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [channel.getState().channelId, this.chainId, tokenId]
    );
  }

  private getSwapId(channel: Channel): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string', 'string', 'string', 'string', 'address'],
      [
        channel.getState().channelId,
        this.chainId,
        this.tokenIdA,
        this.tokenIdB,
        this.amountA,
        this.amountB,
        this.initiator,
      ]
    );
  }
}

/**
 * Swap settlement transition
 */
export class SwapSettleTransition extends BaseTransition implements ISwapTransition {
  constructor(
    public readonly chainId: number,
    public readonly tokenIdA: string,
    public readonly tokenIdB: string,
    public readonly amountA: string,
    public readonly amountB: string,
    public readonly initiator: string
  ) {
    super(TransitionType.SWAP_SETTLE);
  }

  async apply(channel: Channel): Promise<void> {
    this.validateChannel(channel);
    const subchannelA = channel.getSubchannel(this.getSubchannelId(channel, this.tokenIdA));
    const subchannelB = channel.getSubchannel(this.getSubchannelId(channel, this.tokenIdB));

    if (!subchannelA || !subchannelB) {
      throw new TransitionError('Subchannels not found', 'SUBCHANNEL_NOT_FOUND');
    }

    const swap = await channel.getSwap(this.getSwapId(channel));
    if (!swap) {
      throw new TransitionError('Swap not found', 'SWAP_NOT_FOUND');
    }

    if (swap.status !== 'active') {
      throw new TransitionError('Swap is not active', 'SWAP_INACTIVE');
    }

    // Execute the swap by updating balances
    await channel.updateBalance({
      subchannelId: subchannelA.id,
      newBalance: (BigInt(subchannelA.balance) - BigInt(this.amountA)).toString(),
    });

    await channel.updateBalance({
      subchannelId: subchannelB.id,
      newBalance: (BigInt(subchannelB.balance) - BigInt(this.amountB)).toString(),
    });

    await channel.settleSwap(this.getSwapId(channel));
  }

  async verify(channel: Channel): Promise<boolean> {
    try {
      this.validateChannel(channel);
      const subchannelA = channel.getSubchannel(this.getSubchannelId(channel, this.tokenIdA));
      const subchannelB = channel.getSubchannel(this.getSubchannelId(channel, this.tokenIdB));
      const swap = await channel.getSwap(this.getSwapId(channel));

      return Boolean(
        subchannelA &&
          subchannelB &&
          swap &&
          swap.status === 'active' &&
          BigInt(subchannelA.balance) >= BigInt(this.amountA) &&
          BigInt(subchannelB.balance) >= BigInt(this.amountB)
      );
    } catch (error) {
      return false;
    }
  }

  private getSubchannelId(channel: Channel, tokenId: string): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [channel.getState().channelId, this.chainId, tokenId]
    );
  }

  private getSwapId(channel: Channel): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string', 'string', 'string', 'string', 'address'],
      [
        channel.getState().channelId,
        this.chainId,
        this.tokenIdA,
        this.tokenIdB,
        this.amountA,
        this.amountB,
        this.initiator,
      ]
    );
  }
}

/**
 * Subchannel update transition
 */
export class SubchannelUpdateTransition extends BaseTransition implements ISubchannelTransition {
  constructor(public readonly chainId: number, public readonly tokenId: string, public readonly balance: string) {
    super(TransitionType.SUBCHANNEL_UPDATE);
  }

  async apply(channel: Channel): Promise<void> {
    this.validateChannel(channel);
    const subchannel = channel.getSubchannel(this.getSubchannelId(channel));

    if (!subchannel) {
      throw new TransitionError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    if (subchannel.status !== 'active') {
      throw new TransitionError('Subchannel is not active', 'SUBCHANNEL_INACTIVE');
    }

    if (BigInt(this.balance) > BigInt(subchannel.capacity)) {
      throw new TransitionError('Balance exceeds capacity', 'BALANCE_EXCEEDS_CAPACITY');
    }

    await channel.updateBalance({
      subchannelId: subchannel.id,
      newBalance: this.balance,
    });
  }

  async verify(channel: Channel): Promise<boolean> {
    try {
      this.validateChannel(channel);
      const subchannel = channel.getSubchannel(this.getSubchannelId(channel));
      return Boolean(
        subchannel && subchannel.status === 'active' && BigInt(this.balance) <= BigInt(subchannel.capacity)
      );
    } catch (error) {
      return false;
    }
  }

  private getSubchannelId(channel: Channel): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [channel.getState().channelId, this.chainId, this.tokenId]
    );
  }
}

/**
 * Subchannel close transition
 */
export class SubchannelCloseTransition extends BaseTransition implements ISubchannelTransition {
  constructor(public readonly chainId: number, public readonly tokenId: string, public readonly finalBalance: string) {
    super(TransitionType.SUBCHANNEL_CLOSE);
  }

  async apply(channel: Channel): Promise<void> {
    this.validateChannel(channel);
    const subchannel = channel.getSubchannel(this.getSubchannelId(channel));

    if (!subchannel) {
      throw new TransitionError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    if (subchannel.status !== 'active') {
      throw new TransitionError('Subchannel is not active', 'SUBCHANNEL_INACTIVE');
    }

    // Update final balance before closing
    if (this.finalBalance !== subchannel.balance) {
      await channel.updateBalance({
        subchannelId: subchannel.id,
        newBalance: this.finalBalance,
      });
    }

    await channel.closeSubchannel(subchannel.id);
  }

  async verify(channel: Channel): Promise<boolean> {
    try {
      this.validateChannel(channel);
      const subchannel = channel.getSubchannel(this.getSubchannelId(channel));
      return Boolean(
        subchannel && subchannel.status === 'active' && BigInt(this.finalBalance) <= BigInt(subchannel.capacity)
      );
    } catch (error) {
      return false;
    }
  }

  private getSubchannelId(channel: Channel): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [channel.getState().channelId, this.chainId, this.tokenId]
    );
  }
}

/**
 * Factory function to create transitions
 */
export function createTransition(type: TransitionType, params: Record<string, unknown>): ITransition {
  switch (type) {
    case TransitionType.PAYMENT_CREATE:
      return new PaymentCreateTransition(
        params.chainId as number,
        params.tokenId as string,
        params.amount as string,
        params.hashlock as string,
        params.timelock as number,
        params.encryptedData as string
      );

    case TransitionType.PAYMENT_SETTLE:
      return new PaymentSettleTransition(
        params.chainId as number,
        params.tokenId as string,
        params.amount as string,
        params.secret as string
      );

    case TransitionType.PAYMENT_CANCEL:
      return new PaymentCancelTransition(
        params.chainId as number,
        params.tokenId as string,
        params.amount as string,
        params.timelock as number
      );

    case TransitionType.SUBCHANNEL_CREATE:
      return new SubchannelCreateTransition(
        params.chainId as number,
        params.tokenId as string,
        params.capacity as string
      );

    case TransitionType.SWAP_CREATE:
      return new SwapCreateTransition(
        params.chainId as number,
        params.tokenIdA as string,
        params.tokenIdB as string,
        params.amountA as string,
        params.amountB as string,
        params.initiator as string,
        params.timelock as number
      );

    case TransitionType.SWAP_SETTLE:
      return new SwapSettleTransition(
        params.chainId as number,
        params.tokenIdA as string,
        params.tokenIdB as string,
        params.amountA as string,
        params.amountB as string,
        params.initiator as string
      );

    case TransitionType.SUBCHANNEL_UPDATE:
      return new SubchannelUpdateTransition(
        params.chainId as number,
        params.tokenId as string,
        params.balance as string
      );

    case TransitionType.SUBCHANNEL_CLOSE:
      return new SubchannelCloseTransition(
        params.chainId as number,
        params.tokenId as string,
        params.finalBalance as string
      );

    default:
      throw new TransitionError(`Unsupported transition type: ${type}`, 'UNSUPPORTED_TRANSITION');
  }
}
