/**
 * SubcontractProvider TypeScript Wrapper
 *
 * Bridges the Solidity SubcontractProvider with TypeScript channels
 * Enables atomic swaps, HTLCs, and cross-settlement between
 * custodial and trustless systems.
 */

import { ethers } from 'ethers';
import { SubcontractProvider__factory } from '../../contracts/typechain-types';
import type { SubcontractProvider as SubcontractProviderContract } from '../../contracts/typechain-types';

export interface Payment {
  deltaIndex: number;
  amount: bigint;
  revealedUntilBlock: number;
  hash: string; // bytes32
}

export interface Swap {
  ownerIsLeft: boolean;
  addDeltaIndex: number;
  addAmount: bigint;
  subDeltaIndex: number;
  subAmount: bigint;
}

export interface CreditDefaultSwap {
  deltaIndex: number;
  amount: bigint;
  referenceEntity: string; // address
  tokenId: number;
  exerciseUntilBlock: number;
}

export interface Batch {
  payment: Payment[];
  swap: Swap[];
}

export interface DeltaState {
  tokenId: number;
  amount: bigint;
  owner: 'left' | 'right';
}

/**
 * SubcontractProvider manages delta transformations for bilateral channels
 * This is the "mini-EVM" that executes subcontracts within channels
 */
export class SubcontractProvider {
  private contract?: SubcontractProviderContract;
  private provider: ethers.Provider;
  private signer?: ethers.Signer;
  private contractAddress?: string;

  // Cache for revealed secrets
  private revealedSecrets: Map<string, number> = new Map(); // hash -> block number

  constructor(
    providerOrSigner: ethers.Provider | ethers.Signer,
    contractAddress?: string
  ) {
    if ('_isSigner' in providerOrSigner && providerOrSigner._isSigner) {
      this.signer = providerOrSigner as ethers.Signer;
      this.provider = this.signer.provider!;
    } else {
      this.provider = providerOrSigner as ethers.Provider;
    }

    if (contractAddress) {
      this.contractAddress = contractAddress;
      this.initContract();
    }
  }

  /**
   * Initialize contract connection
   */
  private initContract(): void {
    if (!this.contractAddress) {
      throw new Error('Contract address not set');
    }

    if (this.signer) {
      this.contract = SubcontractProvider__factory.connect(
        this.contractAddress,
        this.signer
      );
    } else {
      this.contract = SubcontractProvider__factory.connect(
        this.contractAddress,
        this.provider
      );
    }
  }

  /**
   * Deploy a new SubcontractProvider contract
   */
  async deploy(): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for deployment');
    }

    const factory = new SubcontractProvider__factory(this.signer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    this.contractAddress = await contract.getAddress();
    this.contract = contract;

    // Initialize by revealing null secret
    await this.revealSecret(ethers.ZeroHash);

    return this.contractAddress;
  }

  /**
   * Apply a batch of subcontracts to delta states
   * This is called off-chain to compute new state
   */
  async applyBatch(
    deltas: bigint[],
    batch: Batch,
    leftArguments: number[] = [], // Fill ratios for left's swaps
    rightArguments: number[] = [] // Fill ratios for right's swaps
  ): Promise<bigint[]> {
    // Local simulation for off-chain execution
    const newDeltas = [...deltas];

    // Apply payments
    for (const payment of batch.payment) {
      if (this.isPaymentRevealed(payment.hash, payment.revealedUntilBlock)) {
        newDeltas[payment.deltaIndex] = newDeltas[payment.deltaIndex] + payment.amount;
      }
    }

    // Apply swaps
    let leftSwapIndex = 0;
    let rightSwapIndex = 0;

    for (const swap of batch.swap) {
      const fillRatio = swap.ownerIsLeft
        ? leftArguments[leftSwapIndex++] || 0xffffffff
        : rightArguments[rightSwapIndex++] || 0xffffffff;

      const fillRatioMax = 0xffffffff; // uint32 max

      // Calculate filled amounts
      const addAmount = (swap.addAmount * BigInt(fillRatio)) / BigInt(fillRatioMax);
      const subAmount = (swap.subAmount * BigInt(fillRatio)) / BigInt(fillRatioMax);

      newDeltas[swap.addDeltaIndex] = newDeltas[swap.addDeltaIndex] + addAmount;
      newDeltas[swap.subDeltaIndex] = newDeltas[swap.subDeltaIndex] - subAmount;
    }

    return newDeltas;
  }

  /**
   * Apply batch on-chain (for dispute resolution)
   */
  async applyBatchOnChain(
    deltas: bigint[],
    batch: Batch,
    leftArguments: bigint[] = [],
    rightArguments: bigint[] = []
  ): Promise<bigint[]> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    const encodedBatch = this.encodeBatch(batch);
    const encodedLeft = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [leftArguments]);
    const encodedRight = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [rightArguments]);

    // Call contract (view function for testing)
    const result = await this.contract.applyBatch(
      deltas,
      encodedBatch,
      encodedLeft,
      encodedRight
    );

    return result.map(d => BigInt(d.toString()));
  }

  /**
   * Reveal a secret for HTLC payment
   */
  async revealSecret(secret: string): Promise<void> {
    const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [secret]));

    if (this.contract && this.signer) {
      // On-chain reveal
      const tx = await this.contract.revealSecret(secret);
      const receipt = await tx.wait();
      this.revealedSecrets.set(hash, receipt!.blockNumber!);
    } else {
      // Off-chain tracking
      const currentBlock = await this.provider.getBlockNumber();
      this.revealedSecrets.set(hash, currentBlock);
    }
  }

  /**
   * Check if a payment is revealed
   */
  isPaymentRevealed(hash: string, revealedUntilBlock: number): boolean {
    const revealedAt = this.revealedSecrets.get(hash);
    if (!revealedAt) return false;
    return revealedAt <= revealedUntilBlock;
  }

  /**
   * Create an HTLC payment
   */
  createHTLCPayment(
    deltaIndex: number,
    amount: bigint,
    timeoutBlocks: number = 144 // ~1 hour on Ethereum
  ): { payment: Payment; secret: string } {
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const hash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [secret])
    );

    const currentBlock = this.provider.getBlockNumber();

    const payment: Payment = {
      deltaIndex,
      amount,
      revealedUntilBlock: Number(currentBlock) + timeoutBlocks,
      hash
    };

    return { payment, secret };
  }

  /**
   * Create a swap with partial fill ratio
   */
  createSwap(
    ownerIsLeft: boolean,
    addToken: { deltaIndex: number; amount: bigint },
    subToken: { deltaIndex: number; amount: bigint }
  ): Swap {
    return {
      ownerIsLeft,
      addDeltaIndex: addToken.deltaIndex,
      addAmount: addToken.amount,
      subDeltaIndex: subToken.deltaIndex,
      subAmount: subToken.amount
    };
  }

  /**
   * Encode a batch for on-chain submission
   */
  encodeBatch(batch: Batch): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'tuple(tuple(uint256 deltaIndex, int256 amount, uint256 revealedUntilBlock, bytes32 hash)[] payment, tuple(bool ownerIsLeft, uint256 addDeltaIndex, uint256 addAmount, uint256 subDeltaIndex, uint256 subAmount)[] swap)'
      ],
      [batch]
    );
  }

  /**
   * Decode a batch from on-chain data
   */
  decodeBatch(encodedBatch: string): Batch {
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      [
        'tuple(tuple(uint256 deltaIndex, int256 amount, uint256 revealedUntilBlock, bytes32 hash)[] payment, tuple(bool ownerIsLeft, uint256 addDeltaIndex, uint256 addAmount, uint256 subDeltaIndex, uint256 subAmount)[] swap)'
      ],
      encodedBatch
    );

    return decoded[0] as Batch;
  }

  /**
   * Calculate the net effect of a batch on deltas
   * Useful for validating trades before applying
   */
  calculateNetEffect(batch: Batch, fillRatios?: Map<number, number>): Map<number, bigint> {
    const effects = new Map<number, bigint>();

    // Payments (assuming all revealed)
    for (const payment of batch.payment) {
      const current = effects.get(payment.deltaIndex) || 0n;
      effects.set(payment.deltaIndex, current + payment.amount);
    }

    // Swaps
    for (let i = 0; i < batch.swap.length; i++) {
      const swap = batch.swap[i];
      const fillRatio = fillRatios?.get(i) || 0xffffffff;
      const fillRatioMax = 0xffffffff;

      const addAmount = (swap.addAmount * BigInt(fillRatio)) / BigInt(fillRatioMax);
      const subAmount = (swap.subAmount * BigInt(fillRatio)) / BigInt(fillRatioMax);

      const currentAdd = effects.get(swap.addDeltaIndex) || 0n;
      effects.set(swap.addDeltaIndex, currentAdd + addAmount);

      const currentSub = effects.get(swap.subDeltaIndex) || 0n;
      effects.set(swap.subDeltaIndex, currentSub - subAmount);
    }

    return effects;
  }

  /**
   * Validate that a batch doesn't create negative deltas
   */
  validateBatch(
    currentDeltas: bigint[],
    batch: Batch,
    fillRatios?: Map<number, number>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const effects = this.calculateNetEffect(batch, fillRatios);

    for (const [index, effect] of effects) {
      if (index >= currentDeltas.length) {
        errors.push(`Delta index ${index} out of range`);
        continue;
      }

      const newValue = currentDeltas[index] + effect;
      if (newValue < 0n) {
        errors.push(`Delta ${index} would go negative: ${currentDeltas[index]} + ${effect} = ${newValue}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get contract address
   */
  getAddress(): string | undefined {
    return this.contractAddress;
  }

  /**
   * Set contract address (for connecting to existing deployment)
   */
  setAddress(address: string): void {
    this.contractAddress = address;
    this.initContract();
  }
}

/**
 * Helper to create a SubcontractProvider for testing
 */
export async function createTestProvider(): Promise<SubcontractProvider> {
  // Use in-memory provider for testing
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const signer = await provider.getSigner();

  const subcontractProvider = new SubcontractProvider(signer);
  await subcontractProvider.deploy();

  return subcontractProvider;
}