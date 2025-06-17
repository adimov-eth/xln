// ============================================================================
// test/dao-fluent.test.ts - DAO tests using fluent API
// ============================================================================

import { describe, test } from 'bun:test';
import { transaction } from '../entity/transactions.js';
import { defaultRegistry } from '../protocols/registry.js';
import { id } from '../types/primitives.js';
import { patterns, scenario } from './fluent-api.js';

describe('DAO Protocol with Fluent API', () => {
  test('single signer DAO creates and executes initiative', async () => {
    const s = scenario('single signer DAO')
      .withProtocols(defaultRegistry)
      .withDao('dao', [0], { balance: 1000n, voteThreshold: 100 });
      
    const burnAction = transaction.burn('100', 2);
    
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Burn tokens',
      description: 'Burn 100 tokens for testing',
      author: 0,
      actions: [burnAction]
    }));
    
    await s.processUntilIdle();
    s.expectInitiativeCount('dao', 1);
    
    const initiativeId = s.getInitiativeId('dao', 0);
    
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'passed');
      
    s.sendTransaction(0, 'dao', transaction.executeInitiative(initiativeId, [burnAction]));
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'executed');
      
    await s.processUntilIdle();
    s.expectBalance('dao', 900n);
    s.expectNonce('dao', 3); // create, execute, burn
  });
  
  test('multi-signer DAO requires quorum', async () => {
    const s = patterns.multiSigDao(defaultRegistry);
      
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Fund operations',
      description: 'Transfer 500 tokens',
      author: 0,
      actions: [transaction.burn('500', 2)]
    }));
    
    await s.processUntilIdle();
    s.expectInitiativeCount('dao', 1);
    
    const initiativeId = s.getInitiativeId('dao', 0);
    
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'active');
      
    s.sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, true, 1));
    await s.processUntilIdle();
    s.expectInitiativeStatus('dao', 0, 'passed');
  });
  
  test('DAO with treasury transfers', async () => {
    const s = patterns.daoWithTreasury(defaultRegistry)
      .expectBalance('dao', 1000n)
      .expectBalance('treasury', 0n);
      
    const transferAction = transaction.transfer(id('treasury'), '200', 2);
    
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Fund treasury',
      description: 'Transfer 200 to treasury',
      author: 0,
      actions: [transferAction]
    }));
      
    await s.processUntilIdle();
    const initiativeId = s.getInitiativeId('dao', 0);
    
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    s.sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, true, 1));
    await s.processUntilIdle();
      
    s.sendTransaction(0, 'dao', transaction.executeInitiative(initiativeId, [transferAction]));
    await s.processUntilIdle();
      
    s.expectBalance('dao', 800n)
      .expectBalance('treasury', 200n);
  });
  
  test('failed votes keep initiative active', async () => {
    const s = scenario('DAO voting')
      .withProtocols(defaultRegistry)
      .withDao('dao', [0, 1, 2]);
      
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Controversial proposal',
      description: 'This will be voted down',
      author: 0,
      actions: [transaction.burn('999', 2)]
    }));
      
    await s.processUntilIdle();
    const initiativeId = s.getInitiativeId('dao', 0);
    
    s.sendTransaction(0, 'dao', transaction.voteOnInitiative(initiativeId, true, 0));
    s.sendTransaction(1, 'dao', transaction.voteOnInitiative(initiativeId, false, 1));
    s.sendTransaction(2, 'dao', transaction.voteOnInitiative(initiativeId, false, 2));
    await s.processUntilIdle();
      
    s.expectInitiativeStatus('dao', 0, 'active')
      .expectBalance('dao', 1000n);
  });
});