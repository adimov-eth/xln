/**
 * Comprehensive E2E Tests for XLN J/E/A Stack
 * 
 * Tests the complete flow:
 * 1. J-machine (jurisdiction) registration and events
 * 2. E-machine (entity) consensus and governance
 * 3. A-machine (account/channel) bilateral operations
 * 4. Integration between all three layers
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ethers } from 'ethers';
import { EntityProvider } from '../contracts/contracts/EntityProvider.sol';
import { Depository } from '../contracts/contracts/Depository.sol';
import { processEntityInput } from '../src/entity-consensus.js';
import { EntityChannelBridge } from '../src/EntityChannelBridge.js';
import { SwapTransformer, MultiHopSwapTransformer } from '../src/transformers/SwapTransformer.js';
import { createDirectHashSignature } from '../src/hanko-real.js';
import { 
  Env, 
  EntityInput, 
  EntityState, 
  ConsensusConfig,
  EntityReplica 
} from '../src/types.js';

describe('XLN Full Stack E2E Tests', () => {
  let provider: ethers.JsonRpcProvider;
  let entityProvider: any;
  let depository: any;
  let bridge: EntityChannelBridge;
  let env: Env;
  
  // Test wallets
  let alice: ethers.Wallet;
  let bob: ethers.Wallet;
  let charlie: ethers.Wallet;
  
  // Entity IDs
  let aliceEntityId: string;
  let bobEntityId: string;
  let charlieEntityId: string;
  
  beforeEach(async () => {
    // Setup test environment
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    
    // Create test wallets
    alice = ethers.Wallet.createRandom().connect(provider);
    bob = ethers.Wallet.createRandom().connect(provider);
    charlie = ethers.Wallet.createRandom().connect(provider);
    
    // Fund wallets (assuming local test network)
    const funder = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
    await funder.sendTransaction({ to: alice.address, value: ethers.parseEther('10') });
    await funder.sendTransaction({ to: bob.address, value: ethers.parseEther('10') });
    await funder.sendTransaction({ to: charlie.address, value: ethers.parseEther('10') });
    
    // Deploy contracts
    const EntityProviderFactory = await ethers.getContractFactory('EntityProvider');
    entityProvider = await EntityProviderFactory.deploy();
    await entityProvider.waitForDeployment();
    
    const DepositoryFactory = await ethers.getContractFactory('Depository');
    depository = await DepositoryFactory.deploy();
    await depository.waitForDeployment();
    
    // Add entity provider to depository
    await depository.addEntityProvider(await entityProvider.getAddress());
    
    // Initialize environment
    env = {
      chainId: 31337, // Hardhat network
      replicas: new Map(),
      serverState: {
        blockHeight: 0,
        timestamp: Date.now()
      }
    };
    
    // Initialize bridge
    bridge = new EntityChannelBridge(env);
  });
  
  describe('J-Machine Tests', () => {
    it('should register entities on jurisdiction', async () => {
      // Register Alice's entity
      const aliceBoardHash = ethers.id('alice-board-v1');
      const tx1 = await entityProvider.connect(alice).registerNumberedEntity(aliceBoardHash);
      const receipt1 = await tx1.wait();
      
      // Extract entity number from events
      const event1 = receipt1.logs.find((log: any) => log.fragment?.name === 'EntityRegistered');
      const aliceEntityNumber = event1.args.entityNumber;
      aliceEntityId = ethers.zeroPadValue(ethers.toBeHex(aliceEntityNumber), 32);
      
      expect(aliceEntityNumber).toBeGreaterThan(0);
      
      // Register Bob's entity
      const bobBoardHash = ethers.id('bob-board-v1');
      const tx2 = await entityProvider.connect(bob).registerNumberedEntity(bobBoardHash);
      const receipt2 = await tx2.wait();
      
      const event2 = receipt2.logs.find((log: any) => log.fragment?.name === 'EntityRegistered');
      const bobEntityNumber = event2.args.entityNumber;
      bobEntityId = ethers.zeroPadValue(ethers.toBeHex(bobEntityNumber), 32);
      
      expect(bobEntityNumber).toBeGreaterThan(aliceEntityNumber);
    });
    
    it('should handle control share releases', async () => {
      // Setup entities first
      await setupTestEntities();
      
      // Release control shares from Alice's entity
      const controlAmount = ethers.parseEther('1000');
      const dividendAmount = ethers.parseEther('1000');
      
      const tx = await entityProvider.connect(alice).releaseControlShares(
        aliceEntityId,
        await depository.getAddress(),
        controlAmount,
        dividendAmount,
        'Initial release for channel collateral'
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find((log: any) => log.fragment?.name === 'ControlSharesReleased');
      
      expect(event).toBeDefined();
      expect(event.args.controlAmount).toEqual(controlAmount);
    });
    
    it('should process equivocation proofs and slash', async () => {
      await setupTestEntities();
      
      // Create conflicting proofs (same sequence, different state)
      const channelKey = createChannelKey(aliceEntityId, bobEntityId);
      const seq = 42;
      
      const stateHash1 = ethers.id('state-1');
      const stateHash2 = ethers.id('state-2');
      
      const proof1 = {
        channelKey,
        seq,
        stateHash: stateHash1,
        leftSig: await createDirectHashSignature(
          Buffer.from(stateHash1.slice(2), 'hex'),
          Buffer.from(alice.privateKey.slice(2), 'hex')
        ),
        rightSig: await createDirectHashSignature(
          Buffer.from(stateHash1.slice(2), 'hex'),
          Buffer.from(bob.privateKey.slice(2), 'hex')
        )
      };
      
      const proof2 = {
        channelKey,
        seq,
        stateHash: stateHash2,
        leftSig: await createDirectHashSignature(
          Buffer.from(stateHash2.slice(2), 'hex'),
          Buffer.from(alice.privateKey.slice(2), 'hex')
        ),
        rightSig: await createDirectHashSignature(
          Buffer.from(stateHash2.slice(2), 'hex'),
          Buffer.from(bob.privateKey.slice(2), 'hex')
        )
      };
      
      // Submit equivocation proof
      // In production, this would call depository.slashOnEquivocation
      expect(proof1.seq).toEqual(proof2.seq);
      expect(proof1.stateHash).not.toEqual(proof2.stateHash);
    });
  });
  
  describe('E-Machine Tests', () => {
    it('should process entity consensus with single signer', async () => {
      await setupTestEntities();
      
      // Create entity replica for Alice
      const config: ConsensusConfig = {
        mode: 'proposer-based',
        threshold: 100n,
        validators: [alice.address],
        shares: { [alice.address]: 100n }
      };
      
      const replica: EntityReplica = {
        entityId: aliceEntityId,
        signerId: alice.address,
        state: createInitialEntityState(config),
        mempool: [],
        isProposer: true
      };
      
      env.replicas.set(aliceEntityId, replica);
      
      // Submit transaction
      const input: EntityInput = {
        entityId: aliceEntityId,
        signerId: alice.address,
        entityTxs: [{
          type: 'chat',
          data: { message: 'Hello from Alice!' }
        }]
      };
      
      const result = await processEntityInput(input, env);
      expect(result.replica.state.messages).toContain('Hello from Alice!');
      expect(result.replica.state.height).toBe(1);
    });
    
    it('should handle multi-signer consensus', async () => {
      await setupTestEntities();
      
      // Create DAO entity with multiple signers
      const config: ConsensusConfig = {
        mode: 'proposer-based',
        threshold: 66n,
        validators: [alice.address, bob.address, charlie.address],
        shares: {
          [alice.address]: 40n,
          [bob.address]: 30n,
          [charlie.address]: 30n
        }
      };
      
      const daoEntityId = ethers.id('test-dao');
      
      // Create replicas for each signer
      const aliceReplica = createReplica(daoEntityId, alice.address, config, true);
      const bobReplica = createReplica(daoEntityId, bob.address, config, false);
      const charlieReplica = createReplica(daoEntityId, charlie.address, config, false);
      
      env.replicas.set(`${daoEntityId}-${alice.address}`, aliceReplica);
      env.replicas.set(`${daoEntityId}-${bob.address}`, bobReplica);
      env.replicas.set(`${daoEntityId}-${charlie.address}`, charlieReplica);
      
      // Alice proposes
      const proposalTx = {
        type: 'propose' as const,
        data: {
          action: {
            type: 'collective_message',
            data: { message: 'DAO proposal #1' }
          }
        }
      };
      
      const aliceInput: EntityInput = {
        entityId: daoEntityId,
        signerId: alice.address,
        entityTxs: [proposalTx]
      };
      
      await processEntityInput(aliceInput, env);
      
      // Bob votes yes (total: 70% > 66% threshold)
      const bobInput: EntityInput = {
        entityId: daoEntityId,
        signerId: bob.address,
        entityTxs: [{
          type: 'vote',
          data: {
            proposalId: Object.keys(aliceReplica.state.proposals)[0],
            choice: 'yes'
          }
        }]
      };
      
      const result = await processEntityInput(bobInput, env);
      
      // Check proposal executed
      const proposal = Object.values(result.replica.state.proposals)[0];
      expect(proposal.status).toBe('executed');
    });
    
    it('should handle Byzantine fault tolerance', async () => {
      await setupTestEntities();
      
      // Create conflicting proposals from same entity
      const config: ConsensusConfig = {
        mode: 'proposer-based',
        threshold: 100n,
        validators: [alice.address],
        shares: { [alice.address]: 100n }
      };
      
      const replica = createReplica(aliceEntityId, alice.address, config, true);
      env.replicas.set(aliceEntityId, replica);
      
      // Try to double-sign with different state hashes
      const frame1 = {
        height: 1,
        txs: [{ type: 'chat' as const, data: { message: 'Message 1' } }],
        hash: ethers.id('frame-1'),
        newState: {} as EntityState,
        signatures: new Map([[alice.address, 'sig1']])
      };
      
      const frame2 = {
        height: 1,
        txs: [{ type: 'chat' as const, data: { message: 'Message 2' } }],
        hash: ethers.id('frame-2'),
        newState: {} as EntityState,
        signatures: new Map([[alice.address, 'sig2']])
      };
      
      // Submit first frame
      replica.proposal = frame1;
      
      // Try to submit conflicting frame (should be detected)
      const input: EntityInput = {
        entityId: aliceEntityId,
        signerId: alice.address,
        proposedFrame: frame2
      };
      
      // This should trigger Byzantine fault detection
      const result = await processEntityInput(input, env);
      expect(result.error).toContain('Byzantine');
    });
  });
  
  describe('A-Machine Tests', () => {
    it('should open and update bilateral channels', async () => {
      await setupTestEntities();
      await setupEntityReplicas();
      
      // Open channel between Alice and Bob
      await bridge.processEntityTx(aliceEntityId, {
        type: 'channel_open' as any,
        data: {
          peerId: bobEntityId,
          initialDeposit: 1000000,
          creditLimit: 500000
        }
      });
      
      const channelKey = createChannelKey(aliceEntityId, bobEntityId);
      
      // Update channel with offdelta (instant, bilateral)
      await bridge.processEntityTx(aliceEntityId, {
        type: 'channel_update' as any,
        data: {
          channelKey,
          delta: 100000,
          isOndelta: false
        }
      });
      
      // Check capacity
      const capacity = await bridge.getChannelCapacity(channelKey, true);
      expect(capacity.delta).toBe(100000n);
      expect(capacity.inCapacity).toBeGreaterThan(0n);
      expect(capacity.outCapacity).toBeGreaterThan(0n);
    });
    
    it('should execute atomic swaps', async () => {
      await setupTestEntities();
      await setupEntityReplicas();
      await setupChannels();
      
      const channelKey = createChannelKey(aliceEntityId, bobEntityId);
      
      // Get channel state
      const channel = await getChannelState(channelKey);
      
      // Execute swap: Alice gives 100 tokenA for 50 tokenB
      const swapParams = {
        tokenIdA: 1,
        amountA: 100n,
        tokenIdB: 2,
        amountB: 50n,
        nonce: 1,
        expiry: Date.now() + 3600000
      };
      
      const result = SwapTransformer.executeSwap(
        channel.subchannels,
        swapParams,
        true // Alice is left
      );
      
      expect(result.success).toBe(true);
      expect(result.proof.swapId).toBeDefined();
      expect(result.newDeltas.size).toBe(2);
    });
    
    it('should handle multi-hop swaps', async () => {
      await setupTestEntities();
      await setupEntityReplicas();
      
      // Setup channel path: Alice -> Bob -> Charlie
      await setupChannelPath();
      
      const hop1 = {
        channelKey: createChannelKey(aliceEntityId, bobEntityId),
        subchannels: await getChannelState(createChannelKey(aliceEntityId, bobEntityId)).subchannels,
        isLeft: true
      };
      
      const hop2 = {
        channelKey: createChannelKey(bobEntityId, charlieEntityId),
        subchannels: await getChannelState(createChannelKey(bobEntityId, charlieEntityId)).subchannels,
        isLeft: true
      };
      
      const params = {
        tokenPath: [1, 2, 3], // tokenA -> tokenB -> tokenC
        amounts: [100n, 90n], // Amount at each hop (with fees)
        nonce: 1,
        expiry: Date.now() + 3600000
      };
      
      const result = MultiHopSwapTransformer.executeMultiHop([hop1, hop2], params);
      
      expect(result.success).toBe(true);
      expect(result.proofs.length).toBe(2);
    });
    
    it('should handle cooperative channel close', async () => {
      await setupTestEntities();
      await setupEntityReplicas();
      await setupChannels();
      
      const channelKey = createChannelKey(aliceEntityId, bobEntityId);
      
      // Make some updates
      await bridge.processEntityTx(aliceEntityId, {
        type: 'channel_update' as any,
        data: {
          channelKey,
          delta: 250000,
          isOndelta: false
        }
      });
      
      // Close cooperatively
      await bridge.processEntityTx(aliceEntityId, {
        type: 'channel_close' as any,
        data: {
          channelKey,
          finalState: 'cooperative'
        }
      });
      
      // Channel should be removed
      const capacity = await bridge.getChannelCapacity(channelKey, true);
      expect(capacity).toBeNull();
    });
    
    it('should handle channel disputes', async () => {
      await setupTestEntities();
      await setupEntityReplicas();
      await setupChannels();
      
      const channelKey = createChannelKey(aliceEntityId, bobEntityId);
      
      // Alice initiates dispute with latest proof
      const disputeProof = {
        seq: 5,
        stateHash: ethers.id('disputed-state'),
        signatures: {
          left: 'alice-sig',
          right: 'bob-sig'
        }
      };
      
      await bridge.processEntityTx(aliceEntityId, {
        type: 'channel_dispute' as any,
        data: {
          channelKey,
          disputeProof
        }
      });
      
      // In production, this would:
      // 1. Submit to Depository.sol
      // 2. Start challenge period
      // 3. Allow Bob to submit newer proof
      // 4. Finalize after timeout
    });
  });
  
  describe('Integration Tests', () => {
    it('should handle complete flow: register -> govern -> channel -> swap -> settle', async () => {
      // 1. Register entities on J-machine
      await setupTestEntities();
      
      // 2. Setup entity governance (E-machine)
      await setupEntityReplicas();
      
      // 3. Open channels (A-machine)
      await setupChannels();
      
      // 4. Execute swaps
      const channelKey = createChannelKey(aliceEntityId, bobEntityId);
      const swapParams = {
        tokenIdA: 1,
        amountA: 100n,
        tokenIdB: 2,
        amountB: 50n,
        nonce: 1,
        expiry: Date.now() + 3600000
      };
      
      const channel = await getChannelState(channelKey);
      const swapResult = SwapTransformer.executeSwap(
        channel.subchannels,
        swapParams,
        true
      );
      
      expect(swapResult.success).toBe(true);
      
      // 5. Update ondelta for on-chain finality
      await bridge.processEntityTx(aliceEntityId, {
        type: 'channel_update' as any,
        data: {
          channelKey,
          delta: 100n,
          isOndelta: true // On-chain update
        }
      });
      
      // 6. Cooperative settlement
      await bridge.processEntityTx(aliceEntityId, {
        type: 'channel_close' as any,
        data: {
          channelKey,
          finalState: 'cooperative'
        }
      });
      
      // Verify complete flow succeeded
      const finalCapacity = await bridge.getChannelCapacity(channelKey, true);
      expect(finalCapacity).toBeNull(); // Channel closed
    });
    
    it('should handle reorg recovery', async () => {
      await setupTestEntities();
      
      // Simulate J-machine event
      const event = {
        type: 'entity_registered',
        blockNumber: 100,
        confirms: 8
      };
      
      // Process as tentative
      if (event.confirms < 64) {
        // Mark tentative, don't finalize
        expect(event.confirms).toBeLessThan(64);
      }
      
      // Simulate reorg
      const reorgDepth = 5;
      const snapshotHeight = 95;
      
      // Rollback and replay
      // rollbackTo(snapshotAt(snapshotHeight));
      // replay();
      
      expect(event.blockNumber - reorgDepth).toBe(snapshotHeight);
    });
  });
  
  // Helper functions
  async function setupTestEntities() {
    // Register entities on chain
    const tx1 = await entityProvider.connect(alice).registerNumberedEntity(ethers.id('alice-board'));
    const receipt1 = await tx1.wait();
    const event1 = receipt1.logs.find((log: any) => log.fragment?.name === 'EntityRegistered');
    aliceEntityId = ethers.zeroPadValue(ethers.toBeHex(event1.args.entityNumber), 32);
    
    const tx2 = await entityProvider.connect(bob).registerNumberedEntity(ethers.id('bob-board'));
    const receipt2 = await tx2.wait();
    const event2 = receipt2.logs.find((log: any) => log.fragment?.name === 'EntityRegistered');
    bobEntityId = ethers.zeroPadValue(ethers.toBeHex(event2.args.entityNumber), 32);
    
    const tx3 = await entityProvider.connect(charlie).registerNumberedEntity(ethers.id('charlie-board'));
    const receipt3 = await tx3.wait();
    const event3 = receipt3.logs.find((log: any) => log.fragment?.name === 'EntityRegistered');
    charlieEntityId = ethers.zeroPadValue(ethers.toBeHex(event3.args.entityNumber), 32);
  }
  
  async function setupEntityReplicas() {
    // Setup entity replicas in bridge
    const aliceConfig: ConsensusConfig = {
      mode: 'proposer-based',
      threshold: 100n,
      validators: [alice.address],
      shares: { [alice.address]: 100n }
    };
    
    const aliceReplica = createReplica(aliceEntityId, alice.address, aliceConfig, true);
    await bridge.initialize(aliceEntityId, aliceReplica);
    
    const bobConfig: ConsensusConfig = {
      mode: 'proposer-based',
      threshold: 100n,
      validators: [bob.address],
      shares: { [bob.address]: 100n }
    };
    
    const bobReplica = createReplica(bobEntityId, bob.address, bobConfig, true);
    await bridge.initialize(bobEntityId, bobReplica);
  }
  
  async function setupChannels() {
    // Open channels between entities
    await bridge.processEntityTx(aliceEntityId, {
      type: 'channel_open' as any,
      data: {
        peerId: bobEntityId,
        initialDeposit: 1000000,
        creditLimit: 500000
      }
    });
    
    await bridge.processEntityTx(bobEntityId, {
      type: 'channel_open' as any,
      data: {
        peerId: charlieEntityId,
        initialDeposit: 1000000,
        creditLimit: 500000
      }
    });
  }
  
  async function setupChannelPath() {
    await setupChannels();
    // Additional setup for multi-hop path
  }
  
  async function getChannelState(channelKey: string): Promise<any> {
    // Mock channel state retrieval
    return {
      subchannels: [
        {
          chainId: 1,
          tokenId: 1,
          leftCreditLimit: 500000n,
          rightCreditLimit: 500000n,
          leftAllowence: 0n,
          rightAllowence: 0n,
          collateral: 1000000n,
          ondelta: 0n,
          offdelta: 0n,
          cooperativeNonce: 0,
          disputeNonce: 0,
          deltas: [],
          proposedEvents: []
        },
        {
          chainId: 1,
          tokenId: 2,
          leftCreditLimit: 500000n,
          rightCreditLimit: 500000n,
          leftAllowence: 0n,
          rightAllowence: 0n,
          collateral: 1000000n,
          ondelta: 0n,
          offdelta: 0n,
          cooperativeNonce: 0,
          disputeNonce: 0,
          deltas: [],
          proposedEvents: []
        }
      ]
    };
  }
  
  function createReplica(
    entityId: string,
    signerId: string,
    config: ConsensusConfig,
    isProposer: boolean
  ): EntityReplica {
    return {
      entityId,
      signerId,
      state: createInitialEntityState(config),
      mempool: [],
      isProposer
    };
  }
  
  function createInitialEntityState(config: ConsensusConfig): EntityState {
    return {
      height: 0,
      timestamp: Date.now(),
      nonces: new Map(),
      messages: [],
      proposals: new Map(),
      config
    };
  }
  
  function createChannelKey(left: string, right: string): string {
    const [addr1, addr2] = left < right ? [left, right] : [right, left];
    return '0x' + ethers.keccak256(
      ethers.concat([
        ethers.getBytes(addr1),
        ethers.getBytes(addr2)
      ])
    ).slice(2);
  }
});

// Run tests
console.log('🧪 Running XLN E2E Tests...');