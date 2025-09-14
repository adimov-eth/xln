/**
 * EntityChannelBridge: Connects Entity governance with Channel operations
 * 
 * This bridges the gap between:
 * - Entity layer (governance, proposals, consensus)
 * - Account/Channel layer (bilateral state, deltas, transformers)
 * 
 * Key responsibilities:
 * 1. Route entity decisions to channel operations
 * 2. Aggregate channel proofs for entity consensus
 * 3. Manage channel lifecycle through entity governance
 * 4. Handle dispute escalation from channels to entities
 */

import { EntityState, EntityTx, EntityReplica, Env } from './types.js';
import { ChannelState, ChannelData, createChannelKey } from '../old_src/channel.js';
import { Delta, Subchannel } from '../old_src/types/Subchannel.js';
import { log } from './utils.js';
import { createHash } from 'crypto';
import { encode, decode } from 'rlp';

export interface ChannelOperation {
  type: 'open' | 'update' | 'close' | 'dispute';
  channelKey: string;
  data: any;
  signatures: Map<string, string>;
}

export interface ChannelProof {
  channelKey: string;
  seq: number;
  stateHash: string;
  leftSig: string;
  rightSig: string;
  timestamp: number;
}

export class EntityChannelBridge {
  private entityReplicas: Map<string, EntityReplica> = new Map();
  private channels: Map<string, ChannelState> = new Map();
  private channelData: Map<string, ChannelData> = new Map();
  private pendingOperations: Map<string, ChannelOperation[]> = new Map();
  
  constructor(private env: Env) {}

  /**
   * Initialize bridge with entity and channel states
   */
  async initialize(entityId: string, replica: EntityReplica): Promise<void> {
    this.entityReplicas.set(entityId, replica);
    
    // Load existing channels for this entity
    const channels = await this.loadEntityChannels(entityId);
    for (const [key, state] of channels) {
      this.channels.set(key, state);
      const isLeft = this.isEntityLeft(entityId, state);
      this.channelData.set(key, {
        isLeft,
        rollbacks: 0,
        sentTransitions: 0,
        pendingBlock: null,
        pendingSignatures: [],
        sendCounter: 0,
        receiveCounter: 0
      });
    }
    
    log.info(`🌉 Bridge initialized for entity ${entityId} with ${channels.size} channels`);
  }

  /**
   * Process entity transaction that affects channels
   */
  async processEntityTx(entityId: string, tx: EntityTx): Promise<void> {
    switch (tx.type) {
      case 'channel_open':
        await this.handleChannelOpen(entityId, tx.data);
        break;
      
      case 'channel_update':
        await this.handleChannelUpdate(entityId, tx.data);
        break;
      
      case 'channel_close':
        await this.handleChannelClose(entityId, tx.data);
        break;
      
      case 'channel_dispute':
        await this.handleChannelDispute(entityId, tx.data);
        break;
      
      default:
        // Not a channel operation
        break;
    }
  }

  /**
   * Handle channel open request from entity
   */
  private async handleChannelOpen(entityId: string, data: any): Promise<void> {
    const { peerId, initialDeposit, creditLimit } = data;
    const channelKey = createChannelKey(entityId, peerId);
    
    if (this.channels.has(channelKey)) {
      log.warn(`Channel ${channelKey} already exists`);
      return;
    }
    
    // Create initial channel state
    const state: ChannelState = {
      left: entityId < peerId ? entityId : peerId,
      right: entityId < peerId ? peerId : entityId,
      channelKey,
      previousBlockHash: '0x0',
      previousStateHash: '0x0',
      blockId: 0,
      timestamp: Date.now(),
      transitionId: 0,
      subchannels: [],
      subcontracts: []
    };
    
    // Add initial subchannel with deposits and credit limits
    const subchannel: Subchannel = {
      chainId: this.env.chainId || 1,
      tokenId: 0, // Native token
      leftCreditLimit: entityId < peerId ? BigInt(creditLimit) : 0n,
      rightCreditLimit: entityId < peerId ? 0n : BigInt(creditLimit),
      leftAllowence: 0n,
      rightAllowence: 0n,
      collateral: BigInt(initialDeposit),
      ondelta: 0n,
      offdelta: 0n,
      cooperativeNonce: 0,
      disputeNonce: 0,
      deltas: [],
      proposedEvents: [],
      proposedEventsByLeft: false
    };
    
    state.subchannels.push(subchannel);
    
    this.channels.set(channelKey, state);
    const isLeft = this.isEntityLeft(entityId, state);
    this.channelData.set(channelKey, {
      isLeft,
      rollbacks: 0,
      sentTransitions: 0,
      pendingBlock: null,
      pendingSignatures: [],
      sendCounter: 0,
      receiveCounter: 0
    });
    
    log.info(`📂 Opened channel ${channelKey.slice(0, 10)}... between ${entityId} and ${peerId}`);
    
    // Create channel proof for entity consensus
    const proof = await this.createChannelProof(state);
    await this.submitProofToEntity(entityId, proof);
  }

  /**
   * Handle channel update from entity
   */
  private async handleChannelUpdate(entityId: string, data: any): Promise<void> {
    const { channelKey, delta, isOndelta } = data;
    
    const state = this.channels.get(channelKey);
    if (!state) {
      log.error(`Channel ${channelKey} not found`);
      return;
    }
    
    const channelData = this.channelData.get(channelKey)!;
    const subchannel = state.subchannels[0]; // Assuming single subchannel for now
    
    if (isOndelta) {
      // On-chain delta update (slower, final)
      subchannel.ondelta += BigInt(delta);
      log.info(`⛓️ Updated ondelta by ${delta} for channel ${channelKey.slice(0, 10)}...`);
    } else {
      // Off-chain delta update (fast, bilateral)
      subchannel.offdelta += BigInt(delta);
      log.info(`⚡ Updated offdelta by ${delta} for channel ${channelKey.slice(0, 10)}...`);
    }
    
    // Update state
    state.blockId++;
    state.timestamp = Date.now();
    state.transitionId++;
    state.previousStateHash = this.hashChannelState(state);
    
    // Create and submit proof
    const proof = await this.createChannelProof(state);
    await this.submitProofToEntity(entityId, proof);
  }

  /**
   * Handle cooperative channel close
   */
  private async handleChannelClose(entityId: string, data: any): Promise<void> {
    const { channelKey, finalState } = data;
    
    const state = this.channels.get(channelKey);
    if (!state) {
      log.error(`Channel ${channelKey} not found`);
      return;
    }
    
    // Mark channel as closing
    const subchannel = state.subchannels[0];
    subchannel.cooperativeNonce++;
    
    // Calculate final settlement
    const totalDelta = subchannel.ondelta + subchannel.offdelta;
    const leftFinal = this.calculateSettlement(totalDelta, subchannel.collateral, true);
    const rightFinal = this.calculateSettlement(totalDelta, subchannel.collateral, false);
    
    log.info(`🤝 Cooperative close for channel ${channelKey.slice(0, 10)}...`);
    log.info(`   Left receives: ${leftFinal}, Right receives: ${rightFinal}`);
    
    // Submit final proof to entity
    const proof = await this.createChannelProof(state);
    await this.submitProofToEntity(entityId, proof);
    
    // Clean up
    this.channels.delete(channelKey);
    this.channelData.delete(channelKey);
  }

  /**
   * Handle channel dispute
   */
  private async handleChannelDispute(entityId: string, data: any): Promise<void> {
    const { channelKey, disputeProof } = data;
    
    const state = this.channels.get(channelKey);
    if (!state) {
      log.error(`Channel ${channelKey} not found`);
      return;
    }
    
    const subchannel = state.subchannels[0];
    subchannel.disputeNonce++;
    
    log.warn(`⚠️ Dispute initiated for channel ${channelKey.slice(0, 10)}...`);
    
    // In a real implementation, this would:
    // 1. Submit proof to J-machine (Depository.sol)
    // 2. Start challenge period
    // 3. Allow counter-proofs
    // 4. Final settlement after timeout
    
    const proof = await this.createChannelProof(state);
    await this.submitProofToEntity(entityId, proof);
  }

  /**
   * Create channel proof for entity consensus
   */
  private async createChannelProof(state: ChannelState): Promise<ChannelProof> {
    const stateHash = this.hashChannelState(state);
    
    // In production, these would be real signatures
    const leftSig = this.createMockSignature(state.left, stateHash);
    const rightSig = this.createMockSignature(state.right, stateHash);
    
    return {
      channelKey: state.channelKey,
      seq: state.blockId,
      stateHash,
      leftSig,
      rightSig,
      timestamp: state.timestamp
    };
  }

  /**
   * Submit channel proof to entity for consensus
   */
  private async submitProofToEntity(entityId: string, proof: ChannelProof): Promise<void> {
    const replica = this.entityReplicas.get(entityId);
    if (!replica) {
      log.error(`Entity replica ${entityId} not found`);
      return;
    }
    
    // Add proof as entity transaction
    const proofTx: EntityTx = {
      type: 'channel_proof' as any,
      data: proof
    };
    
    replica.mempool.push(proofTx);
    log.info(`📝 Submitted channel proof to entity ${entityId}`);
  }

  /**
   * Calculate settlement amount based on delta and collateral
   */
  private calculateSettlement(delta: bigint, collateral: bigint, isLeft: boolean): bigint {
    const halfCollateral = collateral / 2n;
    
    if (isLeft) {
      // Left gets: (collateral / 2) - delta
      const settlement = halfCollateral - delta;
      return settlement < 0n ? 0n : settlement > collateral ? collateral : settlement;
    } else {
      // Right gets: (collateral / 2) + delta
      const settlement = halfCollateral + delta;
      return settlement < 0n ? 0n : settlement > collateral ? collateral : settlement;
    }
  }

  /**
   * Hash channel state for proof generation
   */
  private hashChannelState(state: ChannelState): string {
    const encoded = encode([
      state.channelKey,
      state.blockId,
      state.timestamp,
      state.subchannels.map(s => [
        s.ondelta.toString(),
        s.offdelta.toString(),
        s.collateral.toString()
      ])
    ]);
    
    return '0x' + createHash('sha256').update(encoded).digest('hex');
  }

  /**
   * Check if entity is left side of channel
   */
  private isEntityLeft(entityId: string, state: ChannelState): boolean {
    return state.left === entityId;
  }

  /**
   * Load existing channels for an entity
   */
  private async loadEntityChannels(entityId: string): Promise<Map<string, ChannelState>> {
    // In production, this would load from database
    return new Map();
  }

  /**
   * Create mock signature for testing
   */
  private createMockSignature(signer: string, data: string): string {
    return '0x' + createHash('sha256')
      .update(Buffer.concat([
        Buffer.from(signer.slice(2), 'hex'),
        Buffer.from(data.slice(2), 'hex')
      ]))
      .digest('hex');
  }

  /**
   * Get channel capacity information
   */
  async getChannelCapacity(channelKey: string, isLeft: boolean): Promise<any> {
    const state = this.channels.get(channelKey);
    if (!state) return null;
    
    const subchannel = state.subchannels[0];
    const delta = subchannel.ondelta + subchannel.offdelta;
    
    return this.deriveCapacity(subchannel, delta, isLeft);
  }

  /**
   * Derive capacity metrics from channel state
   */
  private deriveCapacity(subchannel: Subchannel, delta: bigint, isLeft: boolean): any {
    const nonNegative = (x: bigint) => x < 0n ? 0n : x;
    
    const collateral = nonNegative(subchannel.collateral);
    
    let ownCreditLimit = isLeft ? subchannel.leftCreditLimit : subchannel.rightCreditLimit;
    let peerCreditLimit = isLeft ? subchannel.rightCreditLimit : subchannel.leftCreditLimit;
    
    let inCollateral = delta > 0n ? nonNegative(collateral - delta) : collateral;
    let outCollateral = delta > 0n ? (delta > collateral ? collateral : delta) : 0n;
    
    let inOwnCredit = nonNegative(-delta);
    if (inOwnCredit > ownCreditLimit) inOwnCredit = ownCreditLimit;
    
    let outPeerCredit = nonNegative(delta - collateral);
    if (outPeerCredit > peerCreditLimit) outPeerCredit = peerCreditLimit;
    
    let outOwnCredit = nonNegative(ownCreditLimit - inOwnCredit);
    let inPeerCredit = nonNegative(peerCreditLimit - outPeerCredit);
    
    const totalCapacity = collateral + ownCreditLimit + peerCreditLimit;
    
    let inCapacity = nonNegative(inOwnCredit + inCollateral + inPeerCredit);
    let outCapacity = nonNegative(outPeerCredit + outCollateral + outOwnCredit);
    
    return {
      delta,
      collateral,
      inCollateral,
      outCollateral,
      inOwnCredit,
      outPeerCredit,
      totalCapacity,
      ownCreditLimit,
      peerCreditLimit,
      inCapacity,
      outCapacity
    };
  }
}