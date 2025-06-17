// ============================================================================
// test/dao-multisig-debug.test.ts - Debug multi-sig DAO voting
// ============================================================================

import { describe, test } from 'bun:test';
import { scenario } from '../test/fluent-api.js';
import { transaction } from '../entity/transactions.js';
import { defaultRegistry } from '../protocols/registry.js';

describe('DAO Multi-sig Debug', () => {
  test('debug multi-signer voting', async () => {
    console.log('\n=== Starting multi-sig DAO test ===\n');
    
    const s = scenario('multi-sig DAO debug')
      .withProtocols(defaultRegistry)
      .withDao('dao', [0, 1, 2], { balance: 1000n });
    
    // Create initiative
    console.log('1. Creating initiative from signer 0');
    s.sendTransaction(0, 'dao', transaction.createInitiative({
      title: 'Test proposal',
      description: 'Testing multi-sig voting',
      author: 0,
      actions: [transaction.burn('100', 1)]
    }));
    
    // Process enough blocks for all signers to see it
    console.log('2. Processing blocks to create initiative');
    await s.processBlocks(5);
    
    // Check initiative exists
    s.expectInitiativeCount('dao', 1);
    const initiativeId = s.getInitiativeId('dao', 0);
    console.log('3. Initiative created with ID:', initiativeId);
    
    // First vote
    console.log('\n4. Sending first vote from signer 0');
    s.sendTransaction(0, 'dao', transaction.vote(initiativeId, true, 0));
    await s.processBlocks(5);
    
    // Check state after first vote
    console.log('5. Checking initiative after first vote');
    s.expectInitiativeStatus('dao', 0, 'active');
    
    // Second vote
    console.log('\n6. Sending second vote from signer 1');
    s.sendTransaction(1, 'dao', transaction.vote(initiativeId, true, 1));
    await s.processBlocks(5);
    
    // Check if passed
    console.log('7. Checking if initiative passed');
    s.expectInitiativeStatus('dao', 0, 'passed');
  });
});