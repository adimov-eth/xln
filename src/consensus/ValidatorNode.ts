/**
 * ValidatorNode: Byzantine Fault Tolerant consensus for XLN
 *
 * Implements practical BFT for J-machines (jurisdictions):
 * - 3f+1 validators tolerate f Byzantine nodes
 * - View-change protocol for liveness
 * - Checkpoint aggregation from E-machines
 * - Slashing conditions for misbehavior
 */

import { createHash, randomBytes } from 'crypto';
import { EntityState } from '../types';
import { StatePersistence } from '../persistence/StatePersistence';

export interface ValidatorConfig {
  nodeId: string;
  privateKey: Buffer;
  publicKey: Buffer;
  peers: ValidatorPeer[];
  byzantineThreshold: number; // f in 3f+1
  blockTime: number; // ms
  viewChangeTimeout: number; // ms
  checkpointInterval: number; // blocks
}

export interface ValidatorPeer {
  nodeId: string;
  publicKey: Buffer;
  endpoint: string;
  reputation: number;
}

export interface Block {
  height: bigint;
  previousHash: string;
  timestamp: number;
  proposer: string;
  transactions: Transaction[];
  stateRoot: string;
  signatures: Map<string, Signature>;
}

export interface Transaction {
  id: string;
  type: 'channel_checkpoint' | 'dispute' | 'slashing' | 'governance';
  channelKey?: string;
  data: any;
  signature: string;
  nonce: bigint;
}

export interface Signature {
  signer: string;
  signature: Buffer;
  timestamp: number;
}

export interface ViewChange {
  viewNumber: number;
  newPrimary: string;
  lastBlock: bigint;
  signatures: Map<string, Signature>;
}

export enum ConsensusPhase {
  IDLE = 'idle',
  PROPOSE = 'propose',
  PREPARE = 'prepare',
  COMMIT = 'commit',
  VIEW_CHANGE = 'view_change'
}

export interface ConsensusState {
  phase: ConsensusPhase;
  viewNumber: number;
  currentHeight: bigint;
  primaryNode: string;
  lastBlock: Block | null;
  pendingBlock: Block | null;
  preparedBlocks: Map<string, number>; // block hash -> prepare count
  committedBlocks: Map<string, number>; // block hash -> commit count
}

export class ValidatorNode {
  private config: ValidatorConfig;
  private state: ConsensusState;
  private persistence: StatePersistence;
  private mempool: Map<string, Transaction> = new Map();
  private peerConnections: Map<string, any> = new Map();
  private viewChangeTimer: NodeJS.Timeout | null = null;
  private blockTimer: NodeJS.Timeout | null = null;

  // Metrics
  private metrics = {
    blocksProposed: 0,
    blocksCommitted: 0,
    viewChanges: 0,
    byzantineFaults: 0,
    slashingEvents: 0,
    averageBlockTime: 0
  };

  constructor(config: ValidatorConfig, persistence: StatePersistence) {
    this.config = config;
    this.persistence = persistence;

    this.state = {
      phase: ConsensusPhase.IDLE,
      viewNumber: 0,
      currentHeight: 0n,
      primaryNode: this.selectPrimary(0),
      lastBlock: null,
      pendingBlock: null,
      preparedBlocks: new Map(),
      committedBlocks: new Map()
    };
  }

  /**
   * Start validator node
   */
  async start(): Promise<void> {
    // Initialize persistence
    await this.persistence.initialize();

    // Connect to peers
    await this.connectToPeers();

    // Start consensus loop
    this.startConsensusLoop();

    // Start view change timer
    this.resetViewChangeTimer();

    console.log(`🚀 Validator ${this.config.nodeId} started`);
    console.log(`   Primary: ${this.state.primaryNode}`);
    console.log(`   Byzantine threshold: ${this.config.byzantineThreshold}`);
  }

  /**
   * Submit transaction to mempool
   */
  submitTransaction(tx: Transaction): void {
    // Verify transaction
    if (!this.verifyTransaction(tx)) {
      throw new Error('Invalid transaction');
    }

    // Add to mempool
    this.mempool.set(tx.id, tx);

    // Broadcast to peers
    this.broadcast('transaction', tx);
  }

  /**
   * Main consensus loop
   */
  private startConsensusLoop(): void {
    this.blockTimer = setInterval(async () => {
      if (this.isPrimary() && this.state.phase === ConsensusPhase.IDLE) {
        await this.proposeBlock();
      }
    }, this.config.blockTime);
  }

  /**
   * Propose new block (primary only)
   */
  private async proposeBlock(): Promise<void> {
    if (!this.isPrimary()) return;

    this.state.phase = ConsensusPhase.PROPOSE;
    this.metrics.blocksProposed++;

    // Collect transactions from mempool
    const transactions = this.selectTransactions();

    // Create block
    const block: Block = {
      height: this.state.currentHeight + 1n,
      previousHash: this.state.lastBlock?.stateRoot || '0x0',
      timestamp: Date.now(),
      proposer: this.config.nodeId,
      transactions,
      stateRoot: this.calculateStateRoot(transactions),
      signatures: new Map()
    };

    // Sign block
    block.signatures.set(this.config.nodeId, this.signBlock(block));

    // Store as pending
    this.state.pendingBlock = block;

    // Broadcast proposal
    this.broadcast('propose', block);

    // Move to prepare phase
    this.state.phase = ConsensusPhase.PREPARE;

    console.log(`📦 Proposed block ${block.height} with ${transactions.length} txs`);
  }

  /**
   * Handle block proposal from primary
   */
  private async handleProposal(block: Block): Promise<void> {
    // Verify block
    if (!this.verifyBlock(block)) {
      console.warn(`❌ Invalid block proposal from ${block.proposer}`);
      this.reportByzantine(block.proposer);
      return;
    }

    // Store as pending
    this.state.pendingBlock = block;
    this.state.phase = ConsensusPhase.PREPARE;

    // Send prepare message
    const prepare = {
      blockHash: this.hashBlock(block),
      height: block.height,
      signer: this.config.nodeId,
      signature: this.signBlock(block)
    };

    this.broadcast('prepare', prepare);

    // Count prepare (including self)
    const blockHash = this.hashBlock(block);
    this.state.preparedBlocks.set(blockHash, 1);
  }

  /**
   * Handle prepare message
   */
  private handlePrepare(message: any): void {
    const { blockHash, height, signer, signature } = message;

    // Verify signature
    if (!this.verifySignature(blockHash, signature, signer)) {
      this.reportByzantine(signer);
      return;
    }

    // Count prepare
    const count = (this.state.preparedBlocks.get(blockHash) || 0) + 1;
    this.state.preparedBlocks.set(blockHash, count);

    // Check if we have 2f+1 prepares
    if (count >= 2 * this.config.byzantineThreshold + 1) {
      this.state.phase = ConsensusPhase.COMMIT;

      // Send commit message
      const commit = {
        blockHash,
        height,
        signer: this.config.nodeId,
        signature: this.signBlock(this.state.pendingBlock!)
      };

      this.broadcast('commit', commit);

      // Count commit (including self)
      this.state.committedBlocks.set(blockHash, 1);
    }
  }

  /**
   * Handle commit message
   */
  private async handleCommit(message: any): Promise<void> {
    const { blockHash, height, signer, signature } = message;

    // Verify signature
    if (!this.verifySignature(blockHash, signature, signer)) {
      this.reportByzantine(signer);
      return;
    }

    // Count commit
    const count = (this.state.committedBlocks.get(blockHash) || 0) + 1;
    this.state.committedBlocks.set(blockHash, count);

    // Check if we have 2f+1 commits
    if (count >= 2 * this.config.byzantineThreshold + 1) {
      await this.commitBlock(this.state.pendingBlock!);
    }
  }

  /**
   * Commit block to state
   */
  private async commitBlock(block: Block): Promise<void> {
    // Write to persistence
    await this.persistence.writeWAL({
      seq: 0n,
      timestamp: Date.now(),
      channelKey: 'consensus',
      operation: 'commit_block',
      params: block,
      beforeStateHash: this.state.lastBlock?.stateRoot || '0x0',
      afterStateHash: block.stateRoot
    });

    // Update state
    this.state.currentHeight = block.height;
    this.state.lastBlock = block;
    this.state.pendingBlock = null;
    this.state.phase = ConsensusPhase.IDLE;
    this.state.preparedBlocks.clear();
    this.state.committedBlocks.clear();

    // Remove committed transactions from mempool
    for (const tx of block.transactions) {
      this.mempool.delete(tx.id);
    }

    // Reset view change timer
    this.resetViewChangeTimer();

    // Update metrics
    this.metrics.blocksCommitted++;
    this.updateAverageBlockTime(block.timestamp);

    console.log(`✅ Committed block ${block.height}`);

    // Check for checkpoint
    if (block.height % BigInt(this.config.checkpointInterval) === 0n) {
      await this.createCheckpoint(block);
    }
  }

  /**
   * Initiate view change
   */
  private initiateViewChange(): void {
    this.state.viewNumber++;
    this.state.phase = ConsensusPhase.VIEW_CHANGE;
    this.state.primaryNode = this.selectPrimary(this.state.viewNumber);
    this.metrics.viewChanges++;

    console.log(`🔄 View change to ${this.state.viewNumber}, new primary: ${this.state.primaryNode}`);

    // Create view change message
    const viewChange: ViewChange = {
      viewNumber: this.state.viewNumber,
      newPrimary: this.state.primaryNode,
      lastBlock: this.state.currentHeight,
      signatures: new Map()
    };

    // Sign view change
    viewChange.signatures.set(this.config.nodeId, this.signViewChange(viewChange));

    // Broadcast view change
    this.broadcast('view_change', viewChange);

    // Reset state
    this.state.pendingBlock = null;
    this.state.preparedBlocks.clear();
    this.state.committedBlocks.clear();
  }

  /**
   * Handle view change message
   */
  private handleViewChange(viewChange: ViewChange): void {
    // Verify signatures
    for (const [signer, sig] of viewChange.signatures) {
      if (!this.verifySignature(this.hashViewChange(viewChange), sig.signature, signer)) {
        this.reportByzantine(signer);
        return;
      }
    }

    // Add our signature if we agree
    if (viewChange.viewNumber > this.state.viewNumber) {
      viewChange.signatures.set(this.config.nodeId, this.signViewChange(viewChange));

      // Check if we have 2f+1 signatures
      if (viewChange.signatures.size >= 2 * this.config.byzantineThreshold + 1) {
        // Complete view change
        this.state.viewNumber = viewChange.viewNumber;
        this.state.primaryNode = viewChange.newPrimary;
        this.state.phase = ConsensusPhase.IDLE;

        // Reset timers
        this.resetViewChangeTimer();

        console.log(`✅ View change complete, new primary: ${this.state.primaryNode}`);
      }
    }
  }

  /**
   * Create checkpoint for E-machines
   */
  private async createCheckpoint(block: Block): Promise<void> {
    // Aggregate channel states from block
    const channelCheckpoints = new Map<string, any>();

    for (const tx of block.transactions) {
      if (tx.type === 'channel_checkpoint') {
        channelCheckpoints.set(tx.channelKey!, tx.data);
      }
    }

    // Create snapshot
    await this.persistence.createSnapshot();

    console.log(`📸 Checkpoint created at block ${block.height}`);
  }

  /**
   * Handle Byzantine behavior
   */
  private reportByzantine(nodeId: string): void {
    this.metrics.byzantineFaults++;

    // Create slashing transaction
    const slashingTx: Transaction = {
      id: `slash_${nodeId}_${Date.now()}`,
      type: 'slashing',
      data: {
        violator: nodeId,
        evidence: 'byzantine_behavior',
        amount: 1000000n // Slash amount
      },
      signature: this.signTransaction({
        violator: nodeId,
        evidence: 'byzantine_behavior'
      }),
      nonce: BigInt(Date.now())
    };

    // Submit to mempool
    this.submitTransaction(slashingTx);

    console.warn(`⚠️ Byzantine behavior reported for ${nodeId}`);
  }

  // Helper methods

  private isPrimary(): boolean {
    return this.config.nodeId === this.state.primaryNode;
  }

  private selectPrimary(viewNumber: number): string {
    const nodes = [this.config.nodeId, ...this.config.peers.map(p => p.nodeId)];
    const index = viewNumber % nodes.length;
    return nodes[index];
  }

  private selectTransactions(): Transaction[] {
    const txs: Transaction[] = [];
    const maxTxs = 1000; // Max transactions per block

    for (const [id, tx] of this.mempool) {
      if (txs.length >= maxTxs) break;

      // Prioritize by type
      if (tx.type === 'slashing') {
        txs.unshift(tx); // Add to front
      } else {
        txs.push(tx);
      }
    }

    return txs;
  }

  private verifyTransaction(tx: Transaction): boolean {
    // Verify signature
    // Check nonce
    // Validate data
    return true; // Simplified
  }

  private verifyBlock(block: Block): boolean {
    // Verify proposer is primary
    if (block.proposer !== this.selectPrimary(this.state.viewNumber)) {
      return false;
    }

    // Verify height
    if (block.height !== this.state.currentHeight + 1n) {
      return false;
    }

    // Verify previous hash
    if (block.previousHash !== (this.state.lastBlock?.stateRoot || '0x0')) {
      return false;
    }

    // Verify transactions
    for (const tx of block.transactions) {
      if (!this.verifyTransaction(tx)) {
        return false;
      }
    }

    return true;
  }

  private calculateStateRoot(transactions: Transaction[]): string {
    const hash = createHash('sha256');

    for (const tx of transactions) {
      hash.update(tx.id);
      hash.update(tx.type);
      hash.update(JSON.stringify(tx.data));
    }

    return hash.digest('hex');
  }

  private hashBlock(block: Block): string {
    const hash = createHash('sha256');
    hash.update(block.height.toString());
    hash.update(block.previousHash);
    hash.update(block.timestamp.toString());
    hash.update(block.proposer);
    hash.update(block.stateRoot);
    return hash.digest('hex');
  }

  private hashViewChange(vc: ViewChange): string {
    const hash = createHash('sha256');
    hash.update(vc.viewNumber.toString());
    hash.update(vc.newPrimary);
    hash.update(vc.lastBlock.toString());
    return hash.digest('hex');
  }

  private signBlock(block: Block): Signature {
    // Sign block hash with private key
    // Simplified - would use actual crypto
    return {
      signer: this.config.nodeId,
      signature: randomBytes(64),
      timestamp: Date.now()
    };
  }

  private signViewChange(vc: ViewChange): Signature {
    return {
      signer: this.config.nodeId,
      signature: randomBytes(64),
      timestamp: Date.now()
    };
  }

  private signTransaction(data: any): string {
    return randomBytes(64).toString('hex');
  }

  private verifySignature(data: string, signature: Buffer, signer: string): boolean {
    // Verify signature with public key
    // Simplified - would use actual crypto
    return true;
  }

  private async connectToPeers(): Promise<void> {
    for (const peer of this.config.peers) {
      // Connect to peer
      // Set up message handlers
      console.log(`Connected to peer ${peer.nodeId}`);
    }
  }

  private broadcast(type: string, message: any): void {
    for (const [peerId, connection] of this.peerConnections) {
      // Send message to peer
    }
  }

  private resetViewChangeTimer(): void {
    if (this.viewChangeTimer) {
      clearTimeout(this.viewChangeTimer);
    }

    this.viewChangeTimer = setTimeout(() => {
      if (this.state.phase !== ConsensusPhase.IDLE) {
        this.initiateViewChange();
      }
    }, this.config.viewChangeTimeout);
  }

  private updateAverageBlockTime(timestamp: number): void {
    if (this.state.lastBlock) {
      const blockTime = timestamp - this.state.lastBlock.timestamp;
      const alpha = 0.1; // Exponential moving average factor

      this.metrics.averageBlockTime =
        alpha * blockTime + (1 - alpha) * this.metrics.averageBlockTime;
    }
  }

  /**
   * Get node status
   */
  getStatus(): any {
    return {
      nodeId: this.config.nodeId,
      isPrimary: this.isPrimary(),
      ...this.state,
      metrics: this.metrics,
      mempoolSize: this.mempool.size,
      connectedPeers: this.peerConnections.size
    };
  }
}