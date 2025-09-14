/**
 * HTLCTransformer: Hash Time-Locked Contracts for atomic cross-channel swaps
 *
 * Enables Lightning Network style payments through XLN's bilateral channels
 */

import { BaseTransformer, TransformContext, TransformResult } from './BaseTransformer.js';
import { Subchannel } from '../../old_src/types/Subchannel.js';
import { createHash } from 'crypto';

export interface HTLCParams {
  readonly htlcId: string;
  readonly tokenId: number;
  readonly amount: bigint;
  readonly hashLock: string; // SHA256 hash of preimage
  readonly timelock: number; // Unix timestamp
  readonly sender: 'left' | 'right';
  readonly receiver: 'left' | 'right';
  readonly nextHop?: string; // For multi-hop routing
}

export interface HTLCState {
  readonly htlcId: string;
  readonly status: 'pending' | 'completed' | 'expired' | 'cancelled';
  readonly preimage?: string;
  readonly claimedAt?: number;
  readonly expiredAt?: number;
  readonly refundedAmount?: bigint;
}

export class HTLCTransformer extends BaseTransformer {
  // Active HTLCs per channel
  private static htlcs: Map<string, Map<string, HTLCParams & HTLCState>> = new Map();

  /**
   * Create an HTLC
   */
  static create({
    context,
    params
  }: {
    context: TransformContext;
    params: HTLCParams;
  }): TransformResult<HTLCState> {
    // Validate basic requirements
    if (params.timelock <= context.timestamp) {
      return { success: false, error: 'Timelock must be in future' };
    }

    if (params.sender === params.receiver) {
      return { success: false, error: 'Sender and receiver must differ' };
    }

    const subchannel = context.subchannels.get(params.tokenId);
    if (!subchannel) {
      return { success: false, error: 'Token not found' };
    }

    // Check sender capacity
    const senderCapacity = this.calculateCapacity(subchannel, params.sender);
    if (params.amount > senderCapacity.outCapacity) {
      return {
        success: false,
        error: `Insufficient capacity: ${params.amount} > ${senderCapacity.outCapacity}`
      };
    }

    // Get channel HTLCs
    if (!this.htlcs.has(context.channelKey)) {
      this.htlcs.set(context.channelKey, new Map());
    }
    const channelHTLCs = this.htlcs.get(context.channelKey)!;

    if (channelHTLCs.has(params.htlcId)) {
      return { success: false, error: 'HTLC ID already exists' };
    }

    // Begin atomic transaction
    const txId = this.beginTransaction();

    try {
      const beforeState = this.hashChannelState([subchannel]);

      // Lock funds
      const lockResult = this.lock(subchannel, params.amount, params.sender);
      if (!lockResult.success) {
        this.rollbackTransaction(txId);
        return lockResult;
      }

      // Create HTLC state
      const htlcState: HTLCParams & HTLCState = {
        ...params,
        status: 'pending'
      };

      // Store HTLC
      channelHTLCs.set(params.htlcId, htlcState);

      // Commit transaction
      this.commitTransaction(txId);

      const afterState = this.hashChannelState([subchannel]);
      const proof = this.createProof('htlc_create', beforeState, afterState, {
        htlcId: params.htlcId,
        amount: params.amount.toString(),
        hashLock: params.hashLock,
        timelock: params.timelock
      });

      return {
        success: true,
        data: {
          htlcId: params.htlcId,
          status: 'pending'
        },
        proof
      };

    } catch (error) {
      this.rollbackTransaction(txId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'HTLC creation failed'
      };
    }
  }

  /**
   * Claim HTLC by revealing preimage
   */
  static claim({
    context,
    htlcId,
    preimage
  }: {
    context: TransformContext;
    htlcId: string;
    preimage: string;
  }): TransformResult<HTLCState> {
    const channelHTLCs = this.htlcs.get(context.channelKey);
    if (!channelHTLCs) {
      return { success: false, error: 'No HTLCs in channel' };
    }

    const htlc = channelHTLCs.get(htlcId);
    if (!htlc) {
      return { success: false, error: 'HTLC not found' };
    }

    if (htlc.status !== 'pending') {
      return { success: false, error: `HTLC is ${htlc.status}` };
    }

    // Check timelock
    if (context.timestamp >= htlc.timelock) {
      return { success: false, error: 'HTLC expired' };
    }

    // Verify preimage
    const hash = '0x' + createHash('sha256')
      .update(Buffer.from(preimage, 'hex'))
      .digest('hex');

    if (hash !== htlc.hashLock) {
      return { success: false, error: 'Invalid preimage' };
    }

    const subchannel = context.subchannels.get(htlc.tokenId);
    if (!subchannel) {
      return { success: false, error: 'Subchannel not found' };
    }

    const txId = this.beginTransaction();

    try {
      const beforeState = this.hashChannelState([subchannel]);

      // Unlock funds
      const unlockResult = this.unlock(subchannel, htlc.amount, htlc.sender);
      if (!unlockResult.success) {
        this.rollbackTransaction(txId);
        return unlockResult;
      }

      // Transfer to receiver
      const transferResult = this.transfer(
        subchannel,
        htlc.amount,
        htlc.sender === 'left' ? 'leftToRight' : 'rightToLeft'
      );

      if (!transferResult.success) {
        this.rollbackTransaction(txId);
        return transferResult;
      }

      // Update HTLC state
      htlc.status = 'completed';
      htlc.preimage = preimage;
      htlc.claimedAt = context.timestamp;

      this.commitTransaction(txId);

      const afterState = this.hashChannelState([subchannel]);
      const proof = this.createProof('htlc_claim', beforeState, afterState, {
        htlcId,
        preimage,
        amount: htlc.amount.toString()
      });

      return {
        success: true,
        data: {
          htlcId,
          status: 'completed',
          preimage,
          claimedAt: context.timestamp
        },
        proof
      };

    } catch (error) {
      this.rollbackTransaction(txId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'HTLC claim failed'
      };
    }
  }

  /**
   * Expire HTLC after timelock
   */
  static expire({
    context,
    htlcId
  }: {
    context: TransformContext;
    htlcId: string;
  }): TransformResult<HTLCState> {
    const channelHTLCs = this.htlcs.get(context.channelKey);
    if (!channelHTLCs) {
      return { success: false, error: 'No HTLCs in channel' };
    }

    const htlc = channelHTLCs.get(htlcId);
    if (!htlc) {
      return { success: false, error: 'HTLC not found' };
    }

    if (htlc.status !== 'pending') {
      return { success: false, error: `HTLC is ${htlc.status}` };
    }

    if (context.timestamp < htlc.timelock) {
      return { success: false, error: 'HTLC not expired yet' };
    }

    const subchannel = context.subchannels.get(htlc.tokenId);
    if (!subchannel) {
      return { success: false, error: 'Subchannel not found' };
    }

    const txId = this.beginTransaction();

    try {
      const beforeState = this.hashChannelState([subchannel]);

      // Unlock funds back to sender
      const unlockResult = this.unlock(subchannel, htlc.amount, htlc.sender);
      if (!unlockResult.success) {
        this.rollbackTransaction(txId);
        return unlockResult;
      }

      // Update HTLC state
      htlc.status = 'expired';
      htlc.expiredAt = context.timestamp;
      htlc.refundedAmount = htlc.amount;

      this.commitTransaction(txId);

      const afterState = this.hashChannelState([subchannel]);
      const proof = this.createProof('htlc_expire', beforeState, afterState, {
        htlcId,
        refunded: htlc.amount.toString()
      });

      return {
        success: true,
        data: {
          htlcId,
          status: 'expired',
          expiredAt: context.timestamp,
          refundedAmount: htlc.amount
        },
        proof
      };

    } catch (error) {
      this.rollbackTransaction(txId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'HTLC expiry failed'
      };
    }
  }

  /**
   * Get pending HTLCs for a channel
   */
  static getPending(channelKey: string): (HTLCParams & HTLCState)[] {
    const channelHTLCs = this.htlcs.get(channelKey);
    if (!channelHTLCs) return [];

    return Array.from(channelHTLCs.values())
      .filter(h => h.status === 'pending');
  }

  /**
   * Get expired HTLCs that can be reclaimed
   */
  static getExpired(channelKey: string, currentTime: number): (HTLCParams & HTLCState)[] {
    return this.getPending(channelKey)
      .filter(h => currentTime >= h.timelock);
  }

  /**
   * Required abstract method
   */
  async transform(
    context: TransformContext,
    params: any
  ): Promise<TransformResult> {
    switch (params.operation) {
      case 'create':
        return HTLCTransformer.create({ context, params });
      case 'claim':
        return HTLCTransformer.claim({
          context,
          htlcId: params.htlcId,
          preimage: params.preimage
        });
      case 'expire':
        return HTLCTransformer.expire({ context, htlcId: params.htlcId });
      default:
        return { success: false, error: 'Invalid operation' };
    }
  }
}

/**
 * Lightning Network style multi-hop routing
 */
export class LightningRouter extends HTLCTransformer {
  /**
   * Route payment through multiple channels
   */
  static async route({
    context,
    route,
    amount,
    paymentHash,
    finalRecipient
  }: {
    context: TransformContext;
    route: {
      channelKey: string;
      isLeft: boolean;
    }[];
    amount: bigint;
    paymentHash: string;
    finalRecipient: string;
  }): Promise<TransformResult<HTLCState[]>> {
    const htlcs: HTLCState[] = [];
    const baseTimelock = context.timestamp + 3600000; // 1 hour base
    const timelockDecrement = 600000; // 10 min per hop

    const txId = this.beginTransaction();

    try {
      // Create HTLCs backward from recipient
      for (let i = route.length - 1; i >= 0; i--) {
        const hop = route[i];
        const timelock = baseTimelock - (i * timelockDecrement);

        const htlcResult = this.create({
          context: {
            ...context,
            channelKey: hop.channelKey
          },
          params: {
            htlcId: `payment-${paymentHash}-hop-${i}`,
            tokenId: 0, // Native token
            amount,
            hashLock: paymentHash,
            timelock,
            sender: hop.isLeft ? 'left' : 'right',
            receiver: hop.isLeft ? 'right' : 'left',
            nextHop: i < route.length - 1 ? route[i + 1].channelKey : undefined
          }
        });

        if (!htlcResult.success) {
          this.rollbackTransaction(txId);
          return {
            success: false,
            error: `Hop ${i} failed: ${htlcResult.error}`,
            data: htlcs
          };
        }

        htlcs.push(htlcResult.data!);
      }

      this.commitTransaction(txId);

      return {
        success: true,
        data: htlcs,
        proof: this.createProof('lightning_route', '', '', {
          hops: route.length,
          amount: amount.toString(),
          paymentHash
        })
      };

    } catch (error) {
      this.rollbackTransaction(txId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Routing failed'
      };
    }
  }

  /**
   * Claim payment by revealing preimage (propagates backward)
   */
  static async claimRoute({
    context,
    route,
    paymentHash,
    preimage
  }: {
    context: TransformContext;
    route: {
      channelKey: string;
    }[];
    paymentHash: string;
    preimage: string;
  }): Promise<TransformResult<HTLCState[]>> {
    const claimed: HTLCState[] = [];

    // Claim HTLCs forward from recipient to sender
    for (let i = route.length - 1; i >= 0; i--) {
      const hop = route[i];
      const htlcId = `payment-${paymentHash}-hop-${i}`;

      const claimResult = this.claim({
        context: {
          ...context,
          channelKey: hop.channelKey
        },
        htlcId,
        preimage
      });

      if (claimResult.success) {
        claimed.push(claimResult.data!);
      }
    }

    return {
      success: claimed.length === route.length,
      data: claimed
    };
  }

  /**
   * Find optimal route using Dijkstra's algorithm
   */
  static findRoute({
    source,
    target,
    amount,
    channels
  }: {
    source: string;
    target: string;
    amount: bigint;
    channels: Map<string, {
      from: string;
      to: string;
      capacity: bigint;
      fee: bigint;
    }>;
  }): string[] {
    // Simplified pathfinding
    const visited = new Set<string>();
    const distances = new Map<string, bigint>();
    const previous = new Map<string, string>();

    distances.set(source, 0n);

    while (visited.size < channels.size) {
      // Find unvisited node with minimum distance
      let current: string | undefined;
      let minDistance = BigInt(Number.MAX_SAFE_INTEGER);

      for (const [node, distance] of distances) {
        if (!visited.has(node) && distance < minDistance) {
          current = node;
          minDistance = distance;
        }
      }

      if (!current || current === target) break;

      visited.add(current);

      // Update distances to neighbors
      for (const [channelKey, channel] of channels) {
        if (channel.from === current && channel.capacity >= amount) {
          const neighbor = channel.to;
          const alt = distances.get(current)! + channel.fee;

          if (!distances.has(neighbor) || alt < distances.get(neighbor)!) {
            distances.set(neighbor, alt);
            previous.set(neighbor, channelKey);
          }
        }
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current = target;

    while (previous.has(current)) {
      const channelKey = previous.get(current)!;
      path.unshift(channelKey);
      const channel = channels.get(channelKey)!;
      current = channel.from;
    }

    return current === source ? path : [];
  }
}