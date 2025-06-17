// ============================================================================
// test/dao-fluent.test.ts - DAO tests using fluent API
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { scenario, patterns } from '../test/fluent-api.js';
import { transaction } from '../entity/transactions.js';
import { defaultRegistry } from '../protocols/registry.js';

describe('DAO Protocol with Fluent API', () => {
  test('single signer DAO creates and executes initiative', async () => {
    const s = scenario('single signer DAO')
      .withProtocols(defaultRegistry)
      .withDao('dao', [0], { balance: 1000n })
      
      // Create an initiative
      .sendTransaction(0, 'dao', transaction.createInitiative({
        title: 'Burn tokens',
        description: 'Burn 100 tokens for testing',
        author: 0,
        actions: [transaction.burn('100', 1)]
      }))
      
      // Process to create the initiative
      
    await s.processBlocks(3);
    s.expectInitiativeCount('dao', 1);
    
    // Get the initiative ID
    const initiativeId = s.getInitiativeId('dao', 0);
    
    // Vote on the initiative
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    await s.processBlocks(3);
    s.expectInitiativeStatus('dao', 0, 'passed');
      
    // Execute the initiative
    s.sendTransaction(0, 'dao', transaction.executeInitiative({
      initiativeId,
      actions: [{ op: 'burn', data: { amount: '100' } }]  // No nonce in initiative
    }));
    await s.processBlocks(3);
    s.expectInitiativeStatus('dao', 0, 'executed');
      
    // Process the burn action from the initiative
    await s.processUntilIdle();
    s.expectBalance('dao', 900n);
  });
  
  test('multi-signer DAO requires quorum', async () => {
    const s = patterns.multiSigDao(defaultRegistry)
      
      // Create an initiative
      .sendTransaction(0, 'dao', transaction.createInitiative({
        title: 'Fund operations',
        description: 'Transfer 500 tokens',
        author: 0,
        actions: [transaction.burn('500', 1)]
      }))
      
      // Proposer creates block
      .proposeBlock(0, 'dao');
      
    await s.processUntilIdle();
    s.expectInitiativeCount('dao', 1);
    
    // Get the initiative ID
    const initiativeId = s.getInitiativeId('dao', 0);
    
    // First vote (not enough)
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0))
      .proposeBlock(0, 'dao');
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'active');
      
    // Second vote (reaches 2/3 threshold)
    s.sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, true, 1))
      .proposeBlock(1, 'dao');
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'passed');
  });
  
  test('DAO with treasury transfers', async () => {
    const s = patterns.daoWithTreasury(defaultRegistry)
      .expectBalance('dao', 1000n)
      .expectBalance('treasury', 0n)
      
      // Create initiative to fund treasury
      .sendTransaction(0, 'dao', transaction.createInitiative({
        title: 'Fund treasury',
        description: 'Transfer 200 to treasury',
        author: 0,
        actions: [transaction.transfer('treasury', '200', 1)]
      }))
      
      // Process and get initiative ID
      
    await s.processBlocks(3);
    
    const initiativeId = s.getInitiativeId('dao', 0);
    
    // Vote to pass
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0))
      .sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, true, 1));
    await s.processBlocks(6);
      
    // Execute the initiative
    s.sendTransaction(0, 'dao', transaction.executeInitiative(initiativeId, [
      transaction.transfer('treasury', '200', 2)
    ]));
    await s.processUntilIdle();
      
    // Check final balances
    s.expectBalance('dao', 800n)
      .expectBalance('treasury', 200n);
  });
  
  test('failed votes keep initiative active', async () => {
    const s = scenario('DAO voting')
      .withProtocols(defaultRegistry)
      .withDao('dao', [0, 1, 2])
      
      // Create initiative
      .sendTransaction(0, 'dao', transaction.createInitiative({
        title: 'Controversial proposal',
        description: 'This will be voted down',
        author: 0,
        actions: [transaction.burn('999', 1)]
      }))
      
    await s.processBlocks(3);
    
    const initiativeId = s.getInitiativeId('dao', 0);
    
    // Mixed votes - 1 for, 2 against (not passing 66% threshold)
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0))
      .sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, false, 1))
      .sendTransaction(2, 'dao', transaction.voteOnInitiative(initiativeId, false, 2));
    await s.processUntilIdle();
      
    // Initiative should still be active (not passed)
    s.expectInitiativeStatus('dao', 0, 'active')
      .expectBalance('dao', 1000n); // No burn happened
  });
});