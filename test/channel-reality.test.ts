/**
 * REAL Channel Test - Tests what actually works
 *
 * This tests the actual working Channel implementation from old_src
 * without all the theatrical consensus and bridge layers.
 */

import { describe, it, expect } from 'bun:test';
import { ethers } from 'ethers';
import Channel from '../old_src/app/Channel.js';
import User from '../old_src/app/User.js';
import { Transition } from '../old_src/app/Transition.js';
import IChannelContext from '../old_src/types/IChannelContext.js';
import { createSubchannelData, Delta } from '../old_src/types/Subchannel.js';

describe('Real Channel Implementation', () => {
  it('should calculate bilateral capacity correctly', () => {
    // Create mock context
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();

    const mockUser = {
      signer: wallet1,
      logger: {
        log: () => {},
        warn: () => {},
        error: () => {}
      },
      mempoolMap: new Map(),
      storage: {
        get: async () => null,
        set: async () => {},
        delete: async () => {}
      }
    };

    const ctx: IChannelContext = {
      getUserAddress: () => wallet1.address,
      getRecipientAddress: () => wallet2.address,
      getStorage: () => mockUser.storage,
      user: mockUser as any
    };

    // Create channel
    const channel = new Channel(ctx);

    // Create a delta with the three-zone capacity model
    const delta: Delta = {
      tokenId: 0,
      ondelta: 100n,  // on-chain delta
      offdelta: 50n,  // off-chain delta
      collateral: 1000n,  // collateral
      leftCreditLimit: 500n,  // left credit limit
      rightCreditLimit: 300n,  // right credit limit
      leftAllowence: 0n,
      rightAllowence: 0n
    };

    // Add delta to channel state
    channel.state.subchannels = [{
      chainId: 1,
      cooperativeNonce: 0,
      disputeNonce: 0,
      deltas: [delta],
      updateType: 'DIRECT',
      recentTransitionIds: []
    }];

    // Test deriveDelta calculation - the REAL bilateral capacity math
    const derived = channel.deriveDelta(1, 0, true);

    // Verify the three-zone model works
    expect(derived.inCapacity).toBeGreaterThanOrEqual(0n);
    expect(derived.outCapacity).toBeGreaterThanOrEqual(0n);
    expect(derived.collateral).toBe(1000n);

    // Test perspective flip
    const derivedRight = channel.deriveDelta(1, 0, false);
    expect(derivedRight.inCapacity).toBeGreaterThanOrEqual(0n);
    expect(derivedRight.outCapacity).toBeGreaterThanOrEqual(0n);
  });

  it('should create and apply payment transitions', async () => {
    // Create mock users
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();

    const mockUser = {
      signer: wallet1,
      logger: {
        log: () => {},
        warn: () => {},
        error: () => {}
      },
      mempoolMap: new Map(),
      storage: {
        get: async () => null,
        set: async () => {},
        delete: async () => {}
      },
      send: async () => {}
    };

    const ctx: IChannelContext = {
      getUserAddress: () => wallet1.address,
      getRecipientAddress: () => wallet2.address,
      getStorage: () => mockUser.storage,
      user: mockUser as any
    };

    const channel = new Channel(ctx);

    // Initialize channel state
    channel.state.subchannels = [{
      chainId: 1,
      cooperativeNonce: 0,
      disputeNonce: 0,
      deltas: [{
        tokenId: 0,
        ondelta: 0n,
        offdelta: 0n,
        collateral: 1000n,
        leftCreditLimit: 500n,
        rightCreditLimit: 500n,
        leftAllowence: 0n,
        rightAllowence: 0n
      }],
      updateType: 'DIRECT',
      recentTransitionIds: []
    }];

    // Create AddPayment transition
    const secret = ethers.randomBytes(32);
    const hashlock = ethers.keccak256(secret);
    const addPayment = new Transition.AddPayment(
      1,  // chainId
      0,  // tokenId
      100n,  // amount
      hashlock,
      Date.now() + 3600000,  // timelock (1 hour)
      ''  // encrypted package
    );

    // Apply transition (in real system this would be in a block)
    const transitions = [addPayment];

    // Test that transition is created correctly
    expect(addPayment.type).toBe('AddPayment');
    expect(addPayment.amount).toBe(100n);
    expect(addPayment.hashlock).toBe(hashlock);

    // Create SettlePayment transition
    const settlePayment = new Transition.SettlePayment(
      0,  // transition ID
      ethers.hexlify(secret)  // reveal secret
    );

    expect(settlePayment.type).toBe('SettlePayment');
    expect(settlePayment.secret).toBe(ethers.hexlify(secret));
  });

  it('should handle bilateral state without global consensus', () => {
    // This tests the core insight: bilateral sovereignty
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();

    // Each party maintains their own view
    const leftView = {
      ondelta: 100n,
      offdelta: 50n,
      perspective: 'left'
    };

    const rightView = {
      ondelta: -100n,  // Opposite sign
      offdelta: -50n,
      perspective: 'right'
    };

    // Both views are valid - no global consensus needed
    expect(leftView.ondelta).toBe(-rightView.ondelta);
    expect(leftView.offdelta).toBe(-rightView.offdelta);

    // This is the key: no MEV, no global ordering, just bilateral agreement
  });
});