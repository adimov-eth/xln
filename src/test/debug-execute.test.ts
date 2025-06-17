import { test, expect } from 'bun:test';
import { scenario } from './fluent-api.js';
import { transaction } from '../entity/transactions.js';
import { WalletProtocol } from '../protocols/wallet.js';
import { DaoProtocol } from '../protocols/dao.js';

const registry = new Map([
  ['wallet', WalletProtocol],
  ['dao', DaoProtocol]
]);

test('debug: execute initiative messages', async () => {
  const s = scenario('debug execute')
    .withProtocols(registry)
    .withDao('dao', [0], { balance: 1000n });
  
  // Create and pass initiative
  s.sendTransaction(0, 'dao', transaction.createInitiative({
    title: 'Burn funds',
    description: 'Burn 100 tokens',
    author: 0,
    actions: [transaction.burn('100', 99)]  // Using nonce 99 to track it
  }));
  
  await s.processBlocks(3);
  const initiativeId = s.getInitiativeId('dao', 0);
  
  s.sendTransaction(0, 'dao', transaction.vote(initiativeId, true, 0));
  await s.processBlocks(3);
  
  console.log('Before execute:');
  console.log('  Initiative status:', s.findEntityState('dao').initiatives?.get(initiativeId)?.status);
  console.log('  Balance:', s.getBalance('dao'));
  
  // Execute initiative  
  s.sendTransaction(0, 'dao', transaction.executeInitiative({
    initiativeId,
    actions: [transaction.burn('100', 99)]
  }));
  
  console.log('\nAfter adding execute tx:');
  console.log('  Server mempool:', s.server.mempool.length);
  
  await s.tick();
  console.log('\nAfter tick 1 (execute → entity mempool):');
  console.log('  Entity mempool:', JSON.stringify(s.findEntity('dao').mempool, null, 2));
  console.log('  Server mempool:', s.server.mempool.length);
  
  await s.tick();
  console.log('\nAfter tick 2 (propose execute block):');
  console.log('  Entity stage:', s.findEntity('dao').stage);
  console.log('  Server mempool:', s.server.mempool.length);
  
  await s.tick();
  console.log('\nAfter tick 3 (commit execute block):');
  console.log('  Entity stage:', s.findEntity('dao').stage);
  console.log('  Initiative status:', s.findEntityState('dao').initiatives?.get(initiativeId)?.status);
  console.log('  Server mempool messages:', s.server.mempool.map(tx => ({
    entity: tx.entityId,
    command: tx.command
  })));
  console.log('  Balance:', s.getBalance('dao'));
  
  // Process generated messages
  if (s.server.mempool.length > 0) {
    console.log('\nProcessing generated messages...');
    await s.tick();
    console.log('After tick 4:');
    console.log('  Entity mempool:', JSON.stringify(s.findEntity('dao').mempool, null, 2));
    console.log('  Balance:', s.getBalance('dao'));
    
    await s.processUntilIdle();
    console.log('\nFinal state:');
    console.log('  Balance:', s.getBalance('dao'));
  }
});