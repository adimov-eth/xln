/**
 * Standalone Channel Implementation
 *
 * This extracts the REAL working channel from old_src and makes it standalone.
 * Uses LevelDB for persistence (already integrated).
 * No consensus layer, no entity layer, just bilateral channels.
 */

import { Level } from 'level';
import { ethers } from 'ethers';
import { encode, decode } from '../old_src/utils/Codec.js';

// Core channel types
export interface Delta {
  tokenId: number;
  ondelta: bigint;    // On-chain delta
  offdelta: bigint;   // Off-chain delta
  collateral: bigint;
  leftCreditLimit: bigint;
  rightCreditLimit: bigint;
  leftAllowence: bigint;
  rightAllowence: bigint;
}

export interface Subchannel {
  chainId: number;
  cooperativeNonce: number;
  disputeNonce: number;
  deltas: Delta[];
  updateType: 'DIRECT' | 'HTLC' | 'SWAP';
  recentTransitionIds: string[];
}

export interface ChannelState {
  channelKey: string;
  blockId: number;
  subchannels: Subchannel[];
  subcontracts: any[];
}

export interface ChannelCapacity {
  inCapacity: bigint;
  outCapacity: bigint;
  inCollateral: bigint;
  outCollateral: bigint;
  inOwnCredit: bigint;
  outOwnCredit: bigint;
  inPeerCredit: bigint;
  outPeerCredit: bigint;
}

/**
 * Standalone bilateral channel with LevelDB persistence
 */
export class BilateralChannel {
  private db: Level<string, Buffer>;
  private state: ChannelState;
  private isLeft: boolean;

  constructor(
    private channelId: string,
    private localWallet: ethers.Wallet,
    private peerAddress: string,
    dbPath?: string
  ) {
    // Initialize LevelDB
    this.db = new Level(dbPath || `./channel-data/${channelId}`);

    // Determine if we're left or right based on address ordering
    this.isLeft = localWallet.address.toLowerCase() < peerAddress.toLowerCase();

    // Initialize empty state
    this.state = {
      channelKey: ethers.id(channelId),
      blockId: 0,
      subchannels: [],
      subcontracts: []
    };
  }

  /**
   * Initialize channel - load from storage or create new
   */
  async initialize(): Promise<void> {
    await this.db.open();

    // Try to load existing state
    try {
      const lastState = await this.loadLastState();
      if (lastState) {
        this.state = lastState;
        console.log(`✅ Loaded channel state at block ${this.state.blockId}`);
      } else {
        console.log(`✅ Created new channel ${this.channelId}`);
      }
    } catch (error) {
      console.log(`⚠️ No existing channel state, creating new`);
    }
  }

  /**
   * Create a new subchannel with initial parameters
   */
  async createSubchannel(
    chainId: number,
    tokenId: number,
    collateral: bigint = 0n,
    creditLimit: bigint = 0n
  ): Promise<void> {
    const delta: Delta = {
      tokenId,
      ondelta: 0n,
      offdelta: 0n,
      collateral,
      leftCreditLimit: creditLimit,  // Both sides can have credit limits
      rightCreditLimit: creditLimit,
      leftAllowence: 0n,
      rightAllowence: 0n
    };

    const subchannel: Subchannel = {
      chainId,
      cooperativeNonce: 0,
      disputeNonce: 0,
      deltas: [delta],
      updateType: 'DIRECT',
      recentTransitionIds: []
    };

    this.state.subchannels.push(subchannel);
    await this.saveState();
  }

  /**
   * Calculate bilateral capacity using the three-zone model
   * This is the CORE innovation - credit beyond collateral
   */
  calculateCapacity(chainId: number, tokenId: number): ChannelCapacity {
    const subchannel = this.state.subchannels.find(s => s.chainId === chainId);
    if (!subchannel) {
      throw new Error(`No subchannel for chain ${chainId}`);
    }

    const delta = subchannel.deltas.find(d => d.tokenId === tokenId);
    if (!delta) {
      throw new Error(`No delta for token ${tokenId}`);
    }

    const nonNegative = (x: bigint) => x < 0n ? 0n : x;
    const totalDelta = delta.ondelta + delta.offdelta;
    const collateral = nonNegative(delta.collateral);

    let ownCreditLimit = this.isLeft ? delta.leftCreditLimit : delta.rightCreditLimit;
    let peerCreditLimit = this.isLeft ? delta.rightCreditLimit : delta.leftCreditLimit;

    // Calculate capacity in each zone
    let inCollateral = totalDelta > 0n ? nonNegative(collateral - totalDelta) : collateral;
    let outCollateral = totalDelta > 0n ? (totalDelta > collateral ? collateral : totalDelta) : 0n;

    let inOwnCredit = nonNegative(-totalDelta);
    if (inOwnCredit > ownCreditLimit) inOwnCredit = ownCreditLimit;

    let outPeerCredit = nonNegative(totalDelta - collateral);
    if (outPeerCredit > peerCreditLimit) outPeerCredit = peerCreditLimit;

    let outOwnCredit = nonNegative(ownCreditLimit - inOwnCredit);
    let inPeerCredit = nonNegative(peerCreditLimit - outPeerCredit);

    // Calculate total capacities
    let inAllowence = this.isLeft ? delta.rightAllowence : delta.leftAllowence;
    let outAllowence = this.isLeft ? delta.leftAllowence : delta.rightAllowence;

    let inCapacity = nonNegative(inOwnCredit + inCollateral + inPeerCredit - inAllowence);
    let outCapacity = nonNegative(outPeerCredit + outCollateral + outOwnCredit - outAllowence);

    return {
      inCapacity,
      outCapacity,
      inCollateral,
      outCollateral,
      inOwnCredit,
      outOwnCredit,
      inPeerCredit,
      outPeerCredit
    };
  }

  /**
   * Make a payment - updates offdelta instantly
   */
  async makePayment(
    chainId: number,
    tokenId: number,
    amount: bigint,
    isIncoming: boolean = false
  ): Promise<void> {
    const subchannel = this.state.subchannels.find(s => s.chainId === chainId);
    if (!subchannel) {
      throw new Error(`No subchannel for chain ${chainId}`);
    }

    const delta = subchannel.deltas.find(d => d.tokenId === tokenId);
    if (!delta) {
      throw new Error(`No delta for token ${tokenId}`);
    }

    // Check capacity
    const capacity = this.calculateCapacity(chainId, tokenId);
    if (!isIncoming && amount > capacity.outCapacity) {
      throw new Error(`Insufficient outbound capacity: ${amount} > ${capacity.outCapacity}`);
    }
    if (isIncoming && amount > capacity.inCapacity) {
      throw new Error(`Insufficient inbound capacity: ${amount} > ${capacity.inCapacity}`);
    }

    // Update offdelta
    if (isIncoming) {
      delta.offdelta -= amount;  // Incoming reduces our delta
    } else {
      delta.offdelta += amount;  // Outgoing increases our delta
    }

    // Update nonce
    subchannel.cooperativeNonce++;

    // Save state
    this.state.blockId++;
    await this.saveState();

    console.log(`💸 Payment ${isIncoming ? 'received' : 'sent'}: ${ethers.formatEther(amount)} ETH`);
    console.log(`   New offdelta: ${ethers.formatEther(delta.offdelta)}`);
  }

  /**
   * Save current state to LevelDB
   */
  private async saveState(): Promise<void> {
    const key = `state:${this.state.blockId.toString().padStart(10, '0')}`;
    await this.db.put(key, encode(this.state));
    console.log(`   💾 Saved state at key: ${key}`);
  }

  /**
   * Load last state from LevelDB
   */
  private async loadLastState(): Promise<ChannelState | null> {
    try {
      // Iterate in reverse to find the latest state
      console.log('   🔍 Looking for existing state...');
      for await (const [key, value] of this.db.iterator({
        gte: 'state:0000000000',
        lte: 'state:9999999999',
        reverse: true,
        limit: 1
      })) {
        console.log(`   📦 Found state at key: ${key}`);
        return decode(value) as ChannelState;
      }
      console.log('   ❌ No state entries found');
    } catch (error) {
      console.log('   ⚠️ Error loading state:', error);
    }
    return null;
  }

  /**
   * Get current state summary
   */
  getStateSummary(): any {
    const summaries = this.state.subchannels.map(subchannel => {
      return subchannel.deltas.map(delta => {
        const capacity = this.calculateCapacity(subchannel.chainId, delta.tokenId);
        return {
          chainId: subchannel.chainId,
          tokenId: delta.tokenId,
          ondelta: ethers.formatEther(delta.ondelta),
          offdelta: ethers.formatEther(delta.offdelta),
          totalDelta: ethers.formatEther(delta.ondelta + delta.offdelta),
          collateral: ethers.formatEther(delta.collateral),
          inCapacity: ethers.formatEther(capacity.inCapacity),
          outCapacity: ethers.formatEther(capacity.outCapacity),
          nonce: subchannel.cooperativeNonce
        };
      });
    }).flat();

    return {
      channelId: this.channelId,
      blockId: this.state.blockId,
      isLeft: this.isLeft,
      subchannels: summaries
    };
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    await this.db.close();
  }
}

/**
 * Demo: Create a working bilateral channel
 */
export async function runChannelDemo() {
  console.log('🚀 XLN Bilateral Channel Demo\n');

  // Create two deterministic wallets for demo
  const alice = new ethers.Wallet('0x0000000000000000000000000000000000000000000000000000000000000001');
  const bob = new ethers.Wallet('0x0000000000000000000000000000000000000000000000000000000000000002');

  console.log(`Alice: ${alice.address}`);
  console.log(`Bob:   ${bob.address}\n`);

  // Create channel from Alice's perspective (fixed ID for demo)
  const channelId = `alice-bob-demo`;
  const aliceChannel = new BilateralChannel(
    channelId,
    alice,
    bob.address,
    `./demo-data/alice/${channelId}`
  );

  await aliceChannel.initialize();

  // Create subchannel with collateral and credit
  const existingSubchannel = aliceChannel.getStateSummary().subchannels.find(
    (s: any) => s.chainId === 1 && s.tokenId === 0
  );

  if (!existingSubchannel) {
    await aliceChannel.createSubchannel(
      1,  // Ethereum mainnet
      0,  // ETH token
      ethers.parseEther('10'),  // 10 ETH collateral
      ethers.parseEther('5')     // 5 ETH credit limit
    );
  }

  // Check initial capacity
  console.log('📊 Initial State:');
  console.log(aliceChannel.getStateSummary());

  // Make some payments
  console.log('\n💸 Making payments...\n');

  await aliceChannel.makePayment(1, 0, ethers.parseEther('1'), false);  // Send 1 ETH
  await aliceChannel.makePayment(1, 0, ethers.parseEther('0.5'), true);  // Receive 0.5 ETH
  await aliceChannel.makePayment(1, 0, ethers.parseEther('2'), false);  // Send 2 ETH

  // Final state
  console.log('\n📊 Final State:');
  console.log(aliceChannel.getStateSummary());

  // Close channel
  await aliceChannel.close();

  console.log('\n✅ Channel persisted to LevelDB at ./demo-data/alice/');
  console.log('   Run again to see state persistence!');
}

// Run demo if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runChannelDemo().catch(console.error);
}