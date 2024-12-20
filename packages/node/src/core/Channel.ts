import { ethers } from 'ethers';
import { createHash } from 'crypto';
import { BaseMerkleTree, createMerkleTree } from './Merkle';
import { ISTM, createSTM, IStorageService, HSTMError } from './HSTM';
import { Level } from 'level';
import { IBlock } from './Block';
import { createTransition } from './Transition';
import { ITransition } from './Transition';

class LevelStorageService implements IStorageService {
  private db: Level<Buffer, Buffer>;

  constructor(dbPath: string) {
    this.db = new Level<Buffer, Buffer>(dbPath, {
      keyEncoding: 'buffer',
      valueEncoding: 'buffer'
    });
  }

  async get(key: Buffer): Promise<Buffer> {
    try {
      return await this.db.get(key);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'type' in error && error.type === 'NotFoundError') {
        throw new HSTMError('Key not found', 'KEY_NOT_FOUND');
      }
      throw new HSTMError(
        `Failed to get value: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_GET_FAILED'
      );
    }
  }

  async put(key: Buffer, value: Buffer): Promise<void> {
    try {
      await this.db.put(key, value);
    } catch (error: unknown) {
      throw new HSTMError(
        `Failed to put value: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_PUT_FAILED'
      );
    }
  }

  async delete(key: Buffer): Promise<void> {
    try {
      await this.db.del(key);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'type' in error && error.type === 'NotFoundError') {
        throw new HSTMError('Key not found', 'KEY_NOT_FOUND');
      }
      throw new HSTMError(
        `Failed to delete value: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_DELETE_FAILED'
      );
    }
  }
}

/**
 * Error class for Channel operations
 */
export class ChannelError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ChannelError';
  }
}

/**
 * Channel state interface
 */
export interface IChannelState {
  channelId: string;
  left: string;
  right: string;
  nonce: number;
  subchannels: { [key: string]: ISubchannel };
  signatures: ISignature[];
  merkleRoot?: string;
  blockId?: number;
}

/**
 * Subchannel interface
 */
export interface ISubchannel {
  id: string;
  chainId: number;
  tokenId: string;
  capacity: string;
  balance: string;
  nonce: number;
  status: 'active' | 'closed';
  disputePeriod: number;
  lastUpdateTime: number;
}

/**
 * Signature interface
 */
export interface ISignature {
  signer: string;
  signature: string;
  timestamp: number;
}

/**
 * Channel configuration interface
 */
export interface IChannelConfig {
  dbPath: string;
  merkleConfig?: {
    batchSize: number;
    hashAlgorithm: string;
  };
  disputePeriod?: number;
  maxBlockSize?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: IChannelConfig = {
  dbPath: './channel-db',
  merkleConfig: {
    batchSize: 16,
    hashAlgorithm: 'sha256',
  },
  disputePeriod: 60 * 60 * 24, // 24 hours
  maxBlockSize: 1000,
};

/**
 * Interface for swap data
 */
export interface ISwap {
  id: string;
  subchannelIdA: string;
  subchannelIdB: string;
  amountA: string;
  amountB: string;
  initiator: string;
  timelock: number;
  status: 'active' | 'settled' | 'cancelled';
  createdAt: number;
  updatedAt: number;
}

/**
 * Interface for payment data
 */
export interface IPayment {
  id: string;
  subchannelId: string;
  amount: string;
  hashlock: string;
  timelock: number;
  status: 'active' | 'settled' | 'cancelled';
  createdAt: number;
  updatedAt: number;
}

/**
 * Core Channel class implementing the payment channel functionality
 */
export class Channel {
  private state!: IChannelState;
  private stm!: ISTM;
  private merkleTree: BaseMerkleTree;
  private config: IChannelConfig;
  private payments: Map<string, IPayment>;
  private swaps: Map<string, ISwap>;

  constructor(
    private readonly userAddress: string,
    private readonly peerAddress: string,
    config: Partial<IChannelConfig> = {}
  ) {
    if (userAddress === peerAddress) {
      throw new ChannelError('Cannot create channel with self', 'INVALID_PEER');
    }

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.merkleTree = createMerkleTree(this.config.merkleConfig);
    this.payments = new Map();
    this.swaps = new Map();
  }

  /**
   * Initializes the channel
   */
  public async initialize(): Promise<void> {
    try {
      // Initialize state-time machine
      const storage = new LevelStorageService(this.config.dbPath);
      this.stm = await createSTM(storage);

      // Create initial state
      this.state = this.createInitialState();

      // Load persisted payments and swaps
      await this.loadPayments();
      await this.loadSwaps();

      // Store initial state
      await this.saveState();
    } catch (error: unknown) {
      if (error instanceof ChannelError) {
        throw error;
      }
      throw new ChannelError(
        `Failed to initialize channel: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'INITIALIZATION_FAILED'
      );
    }
  }

  /**
   * Loads persisted payments from storage
   */
  private async loadPayments(): Promise<void> {
    try {
      const payments = await this.stm.storage.get(Buffer.from('payments'));
      if (payments) {
        const paymentData = JSON.parse(payments.toString());
        this.payments = new Map(Object.entries(paymentData));
      }
    } catch (error: unknown) {
      if (!(error instanceof HSTMError && error.code === 'KEY_NOT_FOUND')) {
        throw new ChannelError(
          `Failed to load payments: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'PAYMENT_LOAD_FAILED'
        );
      }
    }
  }

  /**
   * Loads persisted swaps from storage
   */
  private async loadSwaps(): Promise<void> {
    try {
      const swaps = await this.stm.storage.get(Buffer.from('swaps'));
      if (swaps) {
        const swapData = JSON.parse(swaps.toString());
        this.swaps = new Map(Object.entries(swapData));
      }
    } catch (error: unknown) {
      if (!(error instanceof HSTMError && error.code === 'KEY_NOT_FOUND')) {
        throw new ChannelError(
          `Failed to load swaps: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'SWAP_LOAD_FAILED'
        );
      }
    }
  }

  /**
   * Saves payments to storage
   */
  private async savePayments(): Promise<void> {
    try {
      const paymentData = Object.fromEntries(this.payments);
      await this.stm.storage.put(
        Buffer.from('payments'),
        Buffer.from(JSON.stringify(paymentData))
      );
    } catch (error: unknown) {
      throw new ChannelError(
        `Failed to save payments: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PAYMENT_SAVE_FAILED'
      );
    }
  }

  /**
   * Saves swaps to storage
   */
  private async saveSwaps(): Promise<void> {
    try {
      const swapData = Object.fromEntries(this.swaps);
      await this.stm.storage.put(
        Buffer.from('swaps'),
        Buffer.from(JSON.stringify(swapData))
      );
    } catch (error: unknown) {
      throw new ChannelError(
        `Failed to save swaps: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SWAP_SAVE_FAILED'
      );
    }
  }

  /**
   * Creates the initial channel state
   */
  private createInitialState(): IChannelState {
    const [left, right] =
      this.userAddress < this.peerAddress ? [this.userAddress, this.peerAddress] : [this.peerAddress, this.userAddress];

    const channelId = ethers.solidityPackedKeccak256(['address', 'address'], [left, right]);

    return {
      channelId,
      left,
      right,
      nonce: 0,
      subchannels: {},
      signatures: [],
    };
  }

  /**
   * Saves the current state to storage
   */
  private async saveState(): Promise<void> {
    try {
      const stateHash = Buffer.from(this.hashState());
      await this.stm.storage.put(
        stateHash,
        Buffer.from(JSON.stringify(this.state))
      );
    } catch (error: unknown) {
      throw new ChannelError(
        `Failed to save state: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STATE_SAVE_FAILED'
      );
    }
  }

  /**
   * Creates a hash of the current state
   */
  private hashState(): string {
    const stateData = {
      ...this.state,
      signatures: [], // Exclude signatures from the hash
    };
    return createHash('sha256').update(JSON.stringify(stateData)).digest('hex');
  }

  /**
   * Opens a new subchannel
   */
  public async openSubchannel(params: { chainId: number; tokenId: string; capacity: string }): Promise<ISubchannel> {
    const subchannelId = ethers.solidityPackedKeccak256(
      ['string', 'uint256', 'string'],
      [this.state.channelId, params.chainId, params.tokenId]
    );

    const existingSubchannel = Object.values(this.state.subchannels).find((s) => s.id === subchannelId);
    if (existingSubchannel) {
      throw new ChannelError('Subchannel already exists', 'SUBCHANNEL_EXISTS');
    }

    const subchannel: ISubchannel = {
      id: subchannelId,
      chainId: params.chainId,
      tokenId: params.tokenId,
      capacity: params.capacity,
      balance: '0',
      nonce: 0,
      status: 'active',
      disputePeriod: this.config.disputePeriod!,
      lastUpdateTime: Date.now(),
    };

    this.state.subchannels[subchannel.id] = subchannel;
    await this.saveState();
    return subchannel;
  }

  /**
   * Gets a subchannel by ID
   */
  public getSubchannel(subchannelId: string): ISubchannel | undefined {
    const subchannel = Object.values(this.state.subchannels).find((s) => s.id === subchannelId);
    if (!subchannel) {
      throw new ChannelError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }
    return subchannel;
  }

  /**
   * Updates subchannel balance
   */
  public async updateBalance(params: { subchannelId: string; newBalance: string }): Promise<void> {
    const subchannel = this.getSubchannel(params.subchannelId);
    if (!subchannel) {
      throw new ChannelError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    if (subchannel.status !== 'active') {
      throw new ChannelError('Subchannel is not active', 'SUBCHANNEL_INACTIVE');
    }

    if (BigInt(params.newBalance) > BigInt(subchannel.capacity)) {
      throw new ChannelError('Balance exceeds capacity', 'BALANCE_EXCEEDS_CAPACITY');
    }

    subchannel.balance = params.newBalance;
    subchannel.nonce += 1;
    subchannel.lastUpdateTime = Date.now();
    await this.saveState();
  }

  /**
   * Closes a subchannel
   */
  public async closeSubchannel(subchannelId: string): Promise<void> {
    const subchannel = this.getSubchannel(subchannelId);
    if (!subchannel) {
      throw new ChannelError('Subchannel not found', 'SUBCHANNEL_NOT_FOUND');
    }

    if (subchannel.status !== 'active') {
      throw new ChannelError('Subchannel is not active', 'SUBCHANNEL_INACTIVE');
    }

    subchannel.status = 'closed';
    subchannel.lastUpdateTime = Date.now();
    await this.saveState();
  }

  /**
   * Gets the current state
   */
  public getState(): IChannelState {
    return { ...this.state };
  }

  /**
   * Signs the current state
   */
  public async signState(signer: ethers.Wallet): Promise<void> {
    const stateHash = this.hashState();
    const signature = await signer.signMessage(stateHash);

    this.state.signatures.push({
      signer: signer.address,
      signature,
      timestamp: Date.now(),
    });

    await this.saveState();
  }

  /**
   * Updates the Merkle tree with current subchannels
   */
  private async updateMerkleTree(): Promise<void> {
    const values = Object.values(this.state.subchannels).map((subchannel: ISubchannel) => 
      Buffer.from(JSON.stringify(subchannel))
    );
    this.merkleTree.build(values);
    this.state.merkleRoot = this.merkleTree.getRoot().toString('hex');
  }

  /**
   * Gets the hashlock for a payment
   */
  public async getPaymentHashlock(subchannelId: string, amount: string): Promise<string> {
    const paymentId = this.getPaymentId(subchannelId, amount);
    const payment = this.payments.get(paymentId);
    if (!payment || payment.status !== 'active') {
      throw new ChannelError('Payment not found', 'PAYMENT_NOT_FOUND');
    }
    return payment.hashlock;
  }

  /**
   * Creates a new swap
   */
  public async createSwap(params: {
    swapId: string;
    subchannelIdA: string;
    subchannelIdB: string;
    amountA: string;
    amountB: string;
    initiator: string;
    timelock: number;
  }): Promise<ISwap> {
    const swap: ISwap = {
      id: params.swapId,
      subchannelIdA: params.subchannelIdA,
      subchannelIdB: params.subchannelIdB,
      amountA: params.amountA,
      amountB: params.amountB,
      initiator: params.initiator,
      timelock: params.timelock,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.swaps.set(params.swapId, swap);
    await this.saveSwaps();
    return swap;
  }

  /**
   * Gets a swap by ID
   */
  public async getSwap(swapId: string): Promise<ISwap | undefined> {
    return this.swaps.get(swapId);
  }

  /**
   * Settles a swap
   */
  public async settleSwap(swapId: string): Promise<void> {
    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new ChannelError('Swap not found', 'SWAP_NOT_FOUND');
    }

    if (swap.status !== 'active') {
      throw new ChannelError('Swap is not active', 'SWAP_INACTIVE');
    }

    swap.status = 'settled';
    swap.updatedAt = Date.now();
    this.swaps.set(swapId, swap);
    await this.saveSwaps();
  }

  /**
   * Gets the payment ID
   */
  private getPaymentId(subchannelId: string, amount: string): string {
    return ethers.solidityPackedKeccak256(['string', 'string'], [subchannelId, amount]);
  }

  /**
   * Stores a payment hashlock
   */
  public async storePaymentHashlock(params: {
    subchannelId: string;
    amount: string;
    hashlock: string;
    timelock: number;
  }): Promise<IPayment> {
    const paymentId = this.getPaymentId(params.subchannelId, params.amount);
    const payment: IPayment = {
      id: paymentId,
      subchannelId: params.subchannelId,
      amount: params.amount,
      hashlock: params.hashlock,
      timelock: params.timelock,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.payments.set(paymentId, payment);
    await this.savePayments();
    return payment;
  }

  /**
   * Gets a payment by ID
   */
  public async getPayment(paymentId: string): Promise<IPayment | undefined> {
    return this.payments.get(paymentId);
  }

  /**
   * Updates payment status
   */
  public async updatePaymentStatus(paymentId: string, status: IPayment['status']): Promise<void> {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      throw new ChannelError('Payment not found', 'PAYMENT_NOT_FOUND');
    }

    payment.status = status;
    payment.updatedAt = Date.now();
    this.payments.set(paymentId, payment);
    await this.savePayments();
  }

  /**
   * Applies all transitions from a block in sequence.
   * This method processes each transition in the block, verifying and applying them
   * according to the channel's rules.
   * 
   * @param block - The block containing transitions to be applied
   * @param dryRun - If true, only verifies transitions without applying them
   * @throws {ChannelError} If any transition verification fails
   */
  public async applyBlock(block: IBlock, dryRun: boolean): Promise<void> {
    // Example of storing or incrementing block info in channel state
    this.state.blockId = block.blockId;
    // If you store timestamps as well:
    // this.state.lastBlockTimestamp = block.timestamp;

    const transitionPromises: Array<Promise<void>> = [];

    // For each transition in the block, apply it
    for (const transitionData of block.transitions) {
      transitionPromises.push(this.applyTransition(transitionData, dryRun));
    }

    // Wait for all transitions to complete
    await Promise.all(transitionPromises);
  }

  /**
   * Applies a single transition to the channel state.
   * This method handles the creation, verification, and application of a transition.
   * 
   * @param transitionData - The raw transition data to be processed
   * @param dryRun - If true, only verifies the transition without applying it
   * @throws {ChannelError} If transition verification fails
   * @private
   */
  private async applyTransition(transitionData: any, dryRun: boolean): Promise<void> {
    // 1) Create an ITransition object
    const transition: ITransition = createTransition(transitionData.type, transitionData);

    // 2) Verify the transition
    const isValid = await transition.verify(this);
    if (!isValid) {
      throw new ChannelError('Transition verification failed', 'VERIFICATION_FAILED');
    }

    // 3) If not a dry run, apply the transition to mutate channel state
    if (!dryRun) {
      await transition.apply(this);
    }
  }
}
