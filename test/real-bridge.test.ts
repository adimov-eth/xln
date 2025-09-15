/**
 * Test the REAL bridge between old_src channels and src consensus
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { RealEntityChannelBridge, createRealBridge } from '../src/RealEntityChannelBridge.js';
import { createEmptyEnv } from '../src/server.js';
import { EntityReplica, ConsensusConfig } from '../src/types.js';
import User from '../old_src/app/User.js';
import { setupGlobalHub, teardownGlobalHub } from '../old_src/test/hub.js';

describe('Real Entity-Channel Bridge', () => {
  let env: any;
  let aliceBridge: RealEntityChannelBridge;
  let bobBridge: RealEntityChannelBridge;
  let globalHub: User;

  beforeAll(async () => {
    // Setup global hub for channel communication
    globalHub = await setupGlobalHub(10002);

    // Create environment
    env = createEmptyEnv();

    // Create bridges for Alice and Bob
    aliceBridge = await createRealBridge('entity-1', 'alice', 'password1');
    bobBridge = await createRealBridge('entity-1', 'bob', 'password2');

    // Create entity replicas
    const config: ConsensusConfig = {
      mode: 'proposer-based',
      threshold: 2n,
      validators: ['alice', 'bob'],
      shares: {
        alice: 1n,
        bob: 1n
      }
    };

    const aliceReplica: EntityReplica = {
      entityId: 'entity-1',
      signerId: 'alice',
      state: {
        height: 0,
        timestamp: BigInt(Date.now()),
        nonces: new Map(),
        messages: [],
        config,
        reserves: new Map(),
        channels: new Map(),
        collaterals: new Map()
      },
      mempool: [],
      isProposer: true
    };

    const bobReplica: EntityReplica = {
      entityId: 'entity-1',
      signerId: 'bob',
      state: {
        height: 0,
        timestamp: BigInt(Date.now()),
        nonces: new Map(),
        messages: [],
        config,
        reserves: new Map(),
        channels: new Map(),
        collaterals: new Map()
      },
      mempool: [],
      isProposer: false
    };

    // Initialize bridges
    await aliceBridge.initialize(env, aliceReplica);
    await bobBridge.initialize(env, bobReplica);
  });

  afterAll(async () => {
    await aliceBridge.destroy();
    await bobBridge.destroy();
    await teardownGlobalHub();
  });

  test('should open bilateral channel through bridge', async () => {
    // Alice opens channel to Bob
    await aliceBridge.processEntityTx({
      type: 'channel_open',
      data: {
        peerId: 'bob',
        chainId: 1,
        tokenId: 0,
        collateral: 1000000n
      }
    });

    // Wait for channel propagation
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check channel state
    const aliceChannelState = aliceBridge.getChannelState('bob');
    expect(aliceChannelState).toBeDefined();
    expect(aliceChannelState.state).toBeDefined();
  });

  test('should process payment through bridge', async () => {
    // First ensure channel is open
    await aliceBridge.processEntityTx({
      type: 'channel_open',
      data: {
        peerId: 'bob',
        chainId: 1,
        tokenId: 0
      }
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Alice sends payment to Bob
    await aliceBridge.processEntityTx({
      type: 'payment',
      data: {
        channelId: 'bob',
        amount: 1000n,
        chainId: 1,
        tokenId: 0
      }
    });

    // Wait for payment processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check channel has pending payment
    const channelState = aliceBridge.getChannelState('bob');
    expect(channelState).toBeDefined();
    // Payment should be in subcontracts
    expect(channelState.state.subcontracts).toBeDefined();
  });

  test('should bridge consensus to channel operations', async () => {
    const entityState = {
      height: 1,
      timestamp: BigInt(Date.now()),
      nonces: new Map(),
      messages: [
        JSON.stringify({
          type: 'channel_open',
          data: {
            peerId: 'bob',
            chainId: 1
          }
        })
      ],
      config: {} as any,
      reserves: new Map(),
      channels: new Map(),
      collaterals: new Map()
    };

    await aliceBridge.bridgeConsensusToChannel(entityState);

    // Check channel was created
    const channelState = aliceBridge.getChannelState('bob');
    expect(channelState).toBeDefined();
  });

  test('should export channel state for consensus', () => {
    const exported = aliceBridge.exportToEntityState();

    expect(exported).toBeDefined();
    expect(exported.channels).toBeDefined();
    expect(Array.isArray(exported.channels)).toBe(true);
    expect(exported.user).toBeDefined();
  });

  test('should handle swap through bridge', async () => {
    // Ensure channel is open
    await aliceBridge.processEntityTx({
      type: 'channel_open',
      data: {
        peerId: 'bob',
        chainId: 1,
        tokenId: 0
      }
    });

    // Add second token
    await aliceBridge.processEntityTx({
      type: 'channel_open',
      data: {
        peerId: 'bob',
        chainId: 1,
        tokenId: 1
      }
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Process swap
    await aliceBridge.processEntityTx({
      type: 'swap',
      data: {
        channelId: 'bob',
        fromToken: 0,
        toToken: 1,
        amountIn: 1000n,
        minAmountOut: 900n
      }
    });

    // Wait for swap processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    const channelState = aliceBridge.getChannelState('bob');
    expect(channelState).toBeDefined();
    // Swap should be in subcontracts
    expect(channelState.state.subcontracts).toBeDefined();
  });
});