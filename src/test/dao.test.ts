// ============================================================================
// test/dao.test.ts - DAO protocol tests
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { importEntity, registerEntity, submitCommand } from '../engine/server.js';
import { SilentLogger } from '../infra/deps.js';
import { createBlockRunner } from '../infra/runner.js';
import { createDaoState, type Initiative } from '../protocols/dao.js';
import { defaultRegistry } from '../protocols/registry.js';
import { MemoryStorage } from '../storage/memory.js';
import { id, signer, type SignerIdx } from '../types/primitives.js';
import { createInitialState } from '../utils/serialization.js';
import { getEntityFromSigner } from '../utils/state-helpers.js';

describe('DAO Protocol', () => {
  test('wallet entity works with manual propose', async () => {
    // Test with wallet protocol first
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({
      storage,
      protocols: defaultRegistry,
      logger: SilentLogger
    });
    
    server = registerEntity(server, 'wallet', {
      quorum: [0],
      protocol: 'wallet'
    });
    server = importEntity(server, signer(0), 'wallet', { balance: 1000n, nonce: 0 });
    
    // Add a burn transaction
    server = submitCommand(server, 0, 'wallet', {
      type: 'addTx',
      tx: { op: 'burn', data: { amount: '100' }, nonce: 1 }
    });
    
    // Process to route and auto-propose
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process auto-proposed block (moves to committing)
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process commit to finalize
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Check balance
    const entity = getEntityFromSigner(server, signer(0), id('wallet'))!;
    expect(entity.data.balance).toBe(900n);
  });

  test('single signer DAO - basic initiative flow', async () => {
    // Setup single-signer DAO
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({
      storage,
      protocols: defaultRegistry,
      logger: SilentLogger
    });
    
    server = registerEntity(server, 'dao', {
      quorum: [0],
      protocol: 'dao'
    });
    server = importEntity(server, signer(0), 'dao', createDaoState(1000n, 1, 50));

    // Create an initiative
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Fund Development',
          description: 'Transfer 100 tokens to dev team',
          author: 0,
          actions: [{
            op: 'transfer',
            data: { amount: '100', to: 'dev-wallet' },
            nonce: 1
          }]
        },
        nonce: 1
      }
    });

    // Process to route and auto-propose
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process auto-proposed block (moves to committing)
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process commit to finalize
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Check initiative was created
    const entity1 = getEntityFromSigner(server, signer(0), id('dao'))!;
    expect(entity1.data.initiatives.size).toBe(1);
    const entries = Array.from((entity1.data.initiatives as Map<string, Initiative>).entries());
    const [initiativeId, initiative] = entries[0]!;
    expect(initiative.title).toBe('Fund Development');
    expect(initiative.status).toBe('active');

    // Vote on the initiative (as single signer, should pass immediately)
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'voteInitiative',
        data: {
          initiativeId,
          support: true,
          voter: 0
        }
      }
    });

    // Process vote - need three blocks for single signer
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Check initiative passed (50% threshold, 1/1 = 100%)
    const entity2 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const initiative2 = entity2.data.initiatives.get(initiativeId)!;
    expect(initiative2.status).toBe('passed');
    expect(initiative2.votes.get(signer(0))).toBe(true);

    // Execute the initiative
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'executeInitiative',
        data: {
          initiativeId,
          actions: initiative.actions
        }
      }
    });

    // Process execution - need three blocks for single signer
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Check initiative was executed
    const entity3 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const initiative3 = entity3.data.initiatives.get(initiativeId)!;
    expect(initiative3.status).toBe('executed');
    expect(initiative3.executedAt).toBeDefined();

    // The transfer has been executed, so check the action completed
    const entity4 = getEntityFromSigner(server, signer(0), id('dao'))!;
    // After execution, the mempool should be empty and the transfer would have been routed
    expect(entity4.stage).toBe('idle');
    expect(entity4.mempool.length).toBe(0);
  });

  test('multi-signer DAO - initiative creation only', async () => {
    // Setup 3-signer DAO
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({
      storage,
      protocols: defaultRegistry,
      logger: SilentLogger
    });
    
    server = registerEntity(server, 'dao', {
      quorum: [0, 1, 2],
      protocol: 'dao'
    });
    
    // Import only to signer 0 for simplicity
    const daoState = createDaoState(1000n, 3, 66);
    server = importEntity(server, signer(0), 'dao', daoState);

    // Signer 0 creates an initiative
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Test Initiative',
          description: 'Testing multi-sig DAO',
          author: 0,
          actions: [{
            op: 'burn',
            data: { amount: '100' },
            nonce: 2
          }]
        },
        nonce: 1
      }
    });

    // Process to route transaction
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Let signer 0 propose the block
    server = submitCommand(server, 0, 'dao', {
      type: 'proposeBlock'
    });

    // Process to create proposal
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // For now, just verify the proposal was created
    const entity = getEntityFromSigner(server, signer(0), id('dao'))!;
    expect(entity.stage).toBe('proposed');
    expect(entity.proposal).toBeDefined();
    expect(entity.proposal!.txs.length).toBe(1);
    expect(entity.proposal!.txs[0]!.op).toBe('createInitiative');
  });

  test.skip('multi-signer DAO - 2/3 majority voting', async () => {
    // Setup 3-signer DAO with 66% threshold
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({
      storage,
      protocols: defaultRegistry,
      logger: SilentLogger
    });
    
    server = registerEntity(server, 'dao', {
      quorum: [0, 1, 2],
      protocol: 'dao'
    });
    
    // Import to all signers
    const daoState = createDaoState(1000n, 3, 66);
    server = importEntity(server, signer(0), 'dao', daoState);
    server = importEntity(server, signer(1), 'dao', daoState);
    server = importEntity(server, signer(2), 'dao', daoState);

    // Signer 0 creates an initiative
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Increase Budget',
          description: 'Allocate 500 tokens for operations',
          author: 0,
          actions: [{
            op: 'burn',
            data: { amount: '500' },
            nonce: 4 // Will be used when executed
          }]
        },
        nonce: 1
      }
    });

    // Process to route transaction
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Let proposer create the block
    server = submitCommand(server, 0, 'dao', {
      type: 'proposeBlock'
    });

    // Process to create proposal
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Check that we're in proposed state
    const checkEntity = getEntityFromSigner(server, signer(0), id('dao'))!;
    expect(checkEntity.stage).toBe('proposed');
    expect(checkEntity.proposal).toBeDefined();
    
    // Process blocks until all signers have the initiative in idle state
    let allSynced = false;
    for (let iter = 0; iter < 10 && !allSynced; iter++) {
      console.log(`\nConsensus iteration ${iter + 1}, mempool size: ${server.mempool.length}`);
      
      // Check current state of all signers
      console.log('Entity states:');
      let syncedCount = 0;
      for (let i = 0; i < 3; i++) {
        const entity = getEntityFromSigner(server, signer(i), id('dao'))!;
        console.log(`  Signer ${i}: stage=${entity.stage}, initiatives=${entity.data.initiatives.size}`);
        if (entity.stage === 'idle' && entity.data.initiatives.size === 1) {
          syncedCount++;
        }
      }
      
      allSynced = syncedCount === 3;
      if (allSynced) break;
      
      // Show mempool contents
      if (server.mempool.length > 0) {
        console.log('Mempool:');
        for (const tx of server.mempool) {
          console.log(`  - Signer ${tx.signer}, entity ${tx.entityId}, command: ${tx.command.type}`);
        }
      }
      
      result = await runner.processBlock(server);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      server = result.value;
    }
    
    // Verify all signers are synced
    expect(allSynced).toBe(true);
    
    // Get initiative ID for voting
    const entity1 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const [initiativeId] = Array.from((entity1.data.initiatives as Map<string, Initiative>).keys());
    
    // Make sure mempool is empty before adding votes
    while (server.mempool.length > 0) {
      console.log('Clearing remaining mempool messages:', server.mempool.length);
      result = await runner.processBlock(server);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      server = result.value;
    }

    // Submit both votes to signer 1 who will be the proposer
    // Signer 0 votes yes
    server = submitCommand(server, 1, 'dao', {
      type: 'addTx',
      tx: {
        op: 'voteInitiative',
        data: {
          initiativeId,
          support: true,
          voter: 0
        },
        nonce: 2  // First vote after initiative
      }
    });

    // Signer 1 votes no
    server = submitCommand(server, 1, 'dao', {
      type: 'addTx',
      tx: {
        op: 'voteInitiative',
        data: {
          initiativeId,
          support: false,
          voter: 1
        },
        nonce: 3  // Second vote
      }
    });

    // Process votes - route to entities
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Check entity mempools before propose
    console.log('\nBefore proposeBlock:');
    for (let i = 0; i < 3; i++) {
      const e = getEntityFromSigner(server, signer(i), id('dao'))!;
      console.log(`  Signer ${i}: mempool=${e.mempool.length}, stage=${e.stage}`);
      if (e.mempool.length > 0) {
        for (const tx of e.mempool) {
          console.log(`    - ${tx.op}, nonce=${tx.nonce}`);
        }
      }
    }
    
    // Create and approve block for votes
    server = submitCommand(server, 1, 'dao', {
      type: 'proposeBlock'
    });
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // First check what's in the proposed block
    console.log('\nAfter proposeBlock:');
    const proposedEntity = getEntityFromSigner(server, signer(1), id('dao'))!;
    console.log('Signer 1 entity stage:', proposedEntity.stage);
    if (proposedEntity.proposal) {
      console.log('Proposed txs:', proposedEntity.proposal.txs.length);
      for (const tx of proposedEntity.proposal.txs) {
        console.log(`  - op: ${tx.op}, nonce: ${tx.nonce}`);
        if (tx.op === 'voteInitiative') {
          console.log(`    voter: ${tx.data.voter}, support: ${tx.data.support}`);
        }
      }
    }
    
    // Process the block proposal through consensus
    // Use a loop to process until all signers are synced with the votes
    let votesSynced = false;
    for (let iter = 0; iter < 10 && !votesSynced; iter++) {
      console.log(`\nVote consensus iteration ${iter + 1}, mempool size: ${server.mempool.length}`);
      
      // Check if votes are synced
      const entity = getEntityFromSigner(server, signer(0), id('dao'))!;
      const initiative = entity.data.initiatives.get(initiativeId)!;
      console.log(`  Initiative votes: ${initiative.votes.size}`);
      if (initiative.votes.size > 0) {
        const voteEntries = Array.from(initiative.votes.entries()) as Array<[SignerIdx, boolean]>
        console.log('  Votes:', voteEntries.map(([s, v]) => `${s}=${v}`).join(', '));
      }
      
      if (initiative.votes.size >= 2 && entity.stage === 'idle') {
        votesSynced = true;
        break;
      }
      
      result = await runner.processBlock(server);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      server = result.value;
    }

    // Check initiative is still active (1/3 yes, 1/3 no)
    const entity2 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const initiative2 = entity2.data.initiatives.get(initiativeId)!;
    expect(initiative2.status).toBe('active');
    expect(initiative2.votes.size).toBe(2); // 2 votes so far

    // For this test, let's just verify the voting mechanism works
    // In a real scenario, you'd need to coordinate vote submission to the same proposer
    // or implement a vote collection mechanism
  });

  test.skip('DAO validation rules', async () => {
    // Setup DAO
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({
      storage,
      protocols: defaultRegistry,
      logger: SilentLogger
    });
    
    server = registerEntity(server, 'dao', {
      quorum: [0],
      protocol: 'dao'
    });
    server = importEntity(server, signer(0), 'dao', createDaoState(1000n, 1, 50));

    // Test: Initiative without title
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          description: 'Missing title',
          author: 0,
          actions: [{ op: 'burn', data: { amount: '100' } }]
        },
        nonce: 1
      }
    });

    // Process blocks - should succeed but initiative shouldn't be created
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Check no initiative was created
    const entity = getEntityFromSigner(server, signer(0), id('dao'))!;
    expect(entity.data.initiatives.size).toBe(0);

    // Reset server
    server = createInitialState();
    server = registerEntity(server, 'dao', {
      quorum: [0],
      protocol: 'dao'
    });
    server = importEntity(server, signer(0), 'dao', createDaoState(1000n, 1, 50));

    // Test: Initiative without actions
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'No actions',
          description: 'Initiative with no actions',
          author: 0,
          actions: []
        },
        nonce: 1
      }
    });

    // Process blocks - should succeed but initiative shouldn't be created
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Check no initiative was created
    const entityNoActions = getEntityFromSigner(server, signer(0), id('dao'))!;
    expect(entityNoActions.data.initiatives.size).toBe(0);

    // Reset and create valid initiative
    server = createInitialState();
    server = registerEntity(server, 'dao', {
      quorum: [0],
      protocol: 'dao'
    });
    server = importEntity(server, signer(0), 'dao', createDaoState(1000n, 1, 50));
    
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Test',
          description: 'Test initiative',
          author: 0,
          actions: [{ op: 'burn', data: { amount: '50' }, nonce: 1 }]
        },
        nonce: 1
      }
    });

    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process auto-propose and commit for single-signer
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    const entityTest = getEntityFromSigner(server, signer(0), id('dao'))!;
    console.log('After initiative creation: nonce=', entityTest.data.nonce, 'stage=', entityTest.stage);
    const [initiativeId] = Array.from((entityTest.data.initiatives as Map<string, Initiative>).keys());

    // Test: Double voting
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'voteInitiative',
        data: { initiativeId, support: true, voter: 0 },
        nonce: 2  // Initiative creation was nonce 1
      }
    });

    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process the vote through consensus (single-signer auto-propose)
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Try to vote again
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'voteInitiative',
        data: { initiativeId, support: false, voter: 0 },
        nonce: 3  // After first vote
      }
    });

    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process the second vote through consensus
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Check that the second vote was rejected - still only 1 vote
    const entityAfterDoubleVote = getEntityFromSigner(server, signer(0), id('dao'))!;
    const initiativeAfterDoubleVote = entityAfterDoubleVote.data.initiatives.get(initiativeId)!;
    expect(initiativeAfterDoubleVote.votes.size).toBe(1); // Still only 1 vote
    expect(initiativeAfterDoubleVote.votes.get(signer(0))).toBe(true); // Original vote unchanged

    // Test: Execute non-passed initiative
    server = createInitialState();
    server = registerEntity(server, 'dao', {
      quorum: [0],
      protocol: 'dao'
    }); // 2 members, 51% threshold
    server = importEntity(server, signer(0), 'dao', createDaoState(1000n, 2, 51));
    
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Test',
          description: 'Test',
          author: 0,
          actions: [{ op: 'burn', data: { amount: '50' }, nonce: 1 }]
        },
        nonce: 1
      }
    });

    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Now create a valid initiative to test execution
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Test Execute',
          description: 'Test executing non-passed initiative',
          author: 0,
          actions: [{ op: 'burn', data: { amount: '50' }, nonce: 2 }]
        },
        nonce: 1
      }
    });
    
    // Process the initiative creation
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    const entity2 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const entries2 = Array.from((entity2.data.initiatives as Map<string, Initiative>).entries());
    const [initiativeId2, initiative2] = entries2[0]!;

    // Try to execute without passing
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'executeInitiative',
        data: { initiativeId: initiativeId2, actions: initiative2.actions },
        nonce: 2  // Initiative creation was nonce 1
      }
    });

    result = await runner.processBlock(server);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Initiative has not passed');
  });

  test.skip('DAO with wallet operations', async () => {
    // Setup DAO that can also do wallet operations
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({
      storage,
      protocols: defaultRegistry,
      logger: SilentLogger
    });
    
    server = registerEntity(server, 'dao', {
      quorum: [0],
      protocol: 'dao'
    });
    server = registerEntity(server, 'treasury', {
      quorum: [1],
      protocol: 'wallet'
    });
    
    server = importEntity(server, signer(0), 'dao', createDaoState(1000n, 1, 50));
    server = importEntity(server, signer(1), 'treasury', { balance: 0n, nonce: 0 });

    // Create initiative to transfer funds
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Fund Treasury',
          description: 'Transfer 200 to treasury',
          author: 0,
          actions: [{
            op: 'transfer',
            data: { amount: '200', to: 'treasury' },
            nonce: 2 // Future nonce for when executed
          }]
        },
        nonce: 1
      }
    });

    // Process, vote, and execute
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process auto-propose and commit for single-signer
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    const entity1 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const [initiativeId] = Array.from((entity1.data.initiatives as Map<string, Initiative>).keys());

    // Vote to pass
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'voteInitiative',
        data: { initiativeId, support: true, voter: 0 },
        nonce: 2  // Initiative creation was nonce 1
      }
    });

    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process vote through consensus (single-signer auto-propose)
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Execute initiative
    const entity2 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const initiative = entity2.data.initiatives.get(initiativeId)!;
    expect(initiative.status).toBe('passed');  // Should be passed after vote
    
    server = submitCommand(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'executeInitiative',
        data: { initiativeId, actions: initiative.actions },
        nonce: 3  // After vote
      }
    });

    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process execute through consensus (single-signer auto-propose)
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process the routed actions from executeInitiative
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;

    // Check transfer is in mempool
    const entity3 = getEntityFromSigner(server, signer(0), id('dao'))!;
    expect(entity3.mempool.length).toBe(1);
    expect(entity3.mempool[0]!.op).toBe('transfer');

    // Process the transfer - route to entities
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process through consensus for the transfer
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // The transfer generates a credit message to treasury, process it
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process treasury's auto-propose and commit
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    server = result.value;
    
    // Process any remaining messages (limit to prevent infinite loop)
    for (let i = 0; i < 5 && server.mempool.length > 0; i++) {
      console.log('Processing remaining mempool:', server.mempool.length, 'messages');
      result = await runner.processBlock(server);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      server = result.value;
    }

    // Debug: Check server mempool for any pending messages
    console.log('Final server mempool:', server.mempool.length);
    if (server.mempool.length > 0) {
      console.log('Pending messages:', server.mempool.map(tx => ({
        signer: tx.signer,
        entity: tx.entityId,
        command: tx.command.type
      })));
    }
    
    // Verify balances
    const daoEntity = getEntityFromSigner(server, signer(0), id('dao'))!;
    const treasuryEntity = getEntityFromSigner(server, signer(1), id('treasury'))!;
    
    console.log('DAO balance:', daoEntity.data.balance);
    console.log('Treasury balance:', treasuryEntity.data.balance);
    
    expect(daoEntity.data.balance).toBe(800n); // 1000 - 200
    expect(treasuryEntity.data.balance).toBe(200n); // 0 + 200
  });
});