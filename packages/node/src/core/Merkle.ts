import { createHash } from 'crypto';
import MerkleTree from 'merkletreejs';

/**
 * Error class for Merkle tree operations.
 * Provides specific error handling for Merkle tree-related operations
 * such as hashing, proof verification, and tree construction.
 */
export class MerkleError extends Error {
  /**
   * Creates a new Merkle error.
   * @param message - Detailed error message
   * @param code - Error code for programmatic error handling
   */
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'MerkleError';
    Object.setPrototypeOf(this, MerkleError.prototype);
  }
}

/**
 * Configuration options for Merkle tree construction and operation.
 * Allows customization of tree parameters for different use cases.
 */
export interface IMerkleConfig {
  /** Number of leaves to process in each batch */
  batchSize: number;
  /** Cryptographic hash algorithm to use (default: 'sha256') */
  hashAlgorithm?: string;
  /** Whether to use the merkletreejs library implementation (default: true) */
  useLibrary?: boolean;
}

/**
 * Default configuration values for Merkle tree construction.
 * These values provide a balance between security and performance.
 */
const DEFAULT_CONFIG: IMerkleConfig = {
  batchSize: 16,
  hashAlgorithm: 'sha256',
  useLibrary: true,
};

/**
 * Utility function to hash a value using the specified algorithm.
 * Provides a consistent hashing interface across the Merkle tree implementation.
 * 
 * @param value - The buffer to hash
 * @param algorithm - The hash algorithm to use (default: 'sha256')
 * @returns The resulting hash as a Buffer
 * @throws {MerkleError} If hashing fails
 */
export function hashValue(value: Buffer, algorithm: string = 'sha256'): Buffer {
  try {
    return createHash(algorithm).update(value).digest();
  } catch (error) {
    throw new MerkleError(
      `Failed to hash value: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'HASH_FAILED'
    );
  }
}

/**
 * Abstract base class for Merkle tree implementations.
 * Provides common functionality and interface for different Merkle tree variants.
 * This class can be extended to implement specific Merkle tree types (e.g., binary, sparse).
 */
export abstract class BaseMerkleTree {
  protected storage: Map<string, Buffer>;
  protected config: IMerkleConfig;

  constructor(config: Partial<IMerkleConfig> = {}) {
    this.storage = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  abstract build(values: Buffer[]): void;
  abstract getRoot(): Buffer;
  abstract getProof(value: Buffer): Buffer[];
  abstract verify(value: Buffer, proof: Buffer[]): boolean;

  getValue(hash: Buffer): Buffer | undefined {
    return this.storage.get(hash.toString('hex'));
  }

  protected storeValue(value: Buffer): Buffer {
    const hash = hashValue(value, this.config.hashAlgorithm);
    this.storage.set(hash.toString('hex'), value);
    return hash;
  }
}

/**
 * Custom Merkle tree implementation optimized for performance
 */
export class CustomMerkleTree extends BaseMerkleTree {
  private levels: Buffer[][];

  constructor(config: Partial<IMerkleConfig> = {}) {
    super(config);
    this.levels = [];
  }

  private hashNodes(nodes: Buffer[]): Buffer {
    try {
      const concatenated = Buffer.concat(nodes);
      return hashValue(concatenated, this.config.hashAlgorithm);
    } catch (error) {
      throw new MerkleError(
        `Failed to hash nodes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NODE_HASH_FAILED'
      );
    }
  }

  build(values: Buffer[]): void {
    try {
      // Reset state
      this.storage = new Map();
      this.levels = [];

      // Create leaf nodes
      const leaves = values.map((value) => this.storeValue(value));
      this.levels.push(leaves);

      // Build tree levels
      let currentLevel = leaves;
      while (currentLevel.length > 1) {
        const nextLevel: Buffer[] = [];

        for (let i = 0; i < currentLevel.length; i += this.config.batchSize) {
          const batch = currentLevel.slice(i, i + this.config.batchSize);
          if (batch.length < this.config.batchSize) {
            while (batch.length < this.config.batchSize) {
              batch.push(batch[batch.length - 1]);
            }
          }
          const parent = this.hashNodes(batch);
          nextLevel.push(parent);
        }

        this.levels.push(nextLevel);
        currentLevel = nextLevel;
      }
    } catch (error) {
      throw new MerkleError(
        `Failed to build tree: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BUILD_FAILED'
      );
    }
  }

  getRoot(): Buffer {
    if (this.levels.length === 0) {
      throw new MerkleError('Tree is empty', 'EMPTY_TREE');
    }
    return this.levels[this.levels.length - 1][0];
  }

  getProof(value: Buffer): Buffer[] {
    try {
      const valueHash = hashValue(value, this.config.hashAlgorithm);
      const proof: Buffer[] = [];
      let currentIndex = this.levels[0].findIndex((hash) => hash.equals(valueHash));

      if (currentIndex === -1) {
        throw new MerkleError('Value not found in tree', 'VALUE_NOT_FOUND');
      }

      for (let i = 0; i < this.levels.length - 1; i++) {
        const currentLevel = this.levels[i];
        const startIndex = Math.floor(currentIndex / this.config.batchSize) * this.config.batchSize;
        const siblings = currentLevel.slice(startIndex, startIndex + this.config.batchSize);
        siblings.splice(currentIndex % this.config.batchSize, 1);
        proof.push(...siblings);
        currentIndex = Math.floor(currentIndex / this.config.batchSize);
      }

      return proof;
    } catch (error) {
      if (error instanceof MerkleError) throw error;
      throw new MerkleError(
        `Failed to generate proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PROOF_GENERATION_FAILED'
      );
    }
  }

  verify(value: Buffer, proof: Buffer[]): boolean {
    try {
      let currentHash = hashValue(value, this.config.hashAlgorithm);
      let proofIndex = 0;

      for (let level = 0; level < this.levels.length - 1; level++) {
        const siblings = proof.slice(proofIndex, proofIndex + this.config.batchSize - 1);
        proofIndex += this.config.batchSize - 1;

        const batch = [currentHash, ...siblings];
        currentHash = this.hashNodes(batch);
      }

      return currentHash.equals(this.getRoot());
    } catch (error) {
      throw new MerkleError(
        `Failed to verify proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PROOF_VERIFICATION_FAILED'
      );
    }
  }
}

/**
 * Library-based Merkle tree implementation using merkletreejs
 */
export class LibMerkleTree extends BaseMerkleTree {
  private tree: MerkleTree;

  constructor(config: Partial<IMerkleConfig> = {}) {
    super(config);
    this.tree = this.createTree([]);
  }

  private createTree(leaves: Buffer[]): MerkleTree {
    return new MerkleTree(leaves, (value: Buffer) => hashValue(value, this.config.hashAlgorithm), {
      hashLeaves: false,
      sortPairs: false,
      sortLeaves: false,
      fillDefaultHash: undefined,
      duplicateOdd: true,
    });
  }

  build(values: Buffer[]): void {
    try {
      this.storage = new Map();
      const leaves = values.map((value) => this.storeValue(value));
      this.tree = this.createTree(leaves);
    } catch (error) {
      throw new MerkleError(
        `Failed to build tree: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BUILD_FAILED'
      );
    }
  }

  getRoot(): Buffer {
    if (!this.tree.getRoot()) {
      throw new MerkleError('Tree is empty', 'EMPTY_TREE');
    }
    return Buffer.from(this.tree.getRoot());
  }

  getProof(value: Buffer): Buffer[] {
    try {
      const valueHash = hashValue(value, this.config.hashAlgorithm);
      const proof = this.tree.getProof(valueHash);
      return proof.map((item) => Buffer.from(item.data));
    } catch (error) {
      throw new MerkleError(
        `Failed to generate proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PROOF_GENERATION_FAILED'
      );
    }
  }

  verify(value: Buffer, proof: Buffer[]): boolean {
    try {
      const valueHash = hashValue(value, this.config.hashAlgorithm);
      return this.tree.verify(
        proof.map((item) => ({ data: item })),
        valueHash,
        this.getRoot()
      );
    } catch (error) {
      throw new MerkleError(
        `Failed to verify proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PROOF_VERIFICATION_FAILED'
      );
    }
  }
}

/**
 * Factory function to create a Merkle tree instance
 */
export function createMerkleTree(config: Partial<IMerkleConfig> = {}): BaseMerkleTree {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  return finalConfig.useLibrary ? new LibMerkleTree(finalConfig) : new CustomMerkleTree(finalConfig);
}
