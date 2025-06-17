import { test, expect } from 'bun:test';
import { scenario } from './fluent-api.js';
import { transaction } from '../entity/transactions.js';
import { WalletProtocol } from '../protocols/wallet.js';
import { DaoProtocol } from '../protocols/dao.js';

const registry = new Map([
  ['wallet', WalletProtocol],
  ['dao', DaoProtocol]
]);

test('debug: dao initiative execution', async () => {
  const s = scenario('debug initiative')
    .withProtocols(registry)
    .withDao('dao', [0], { balance: 1000n });
  
  console.log('Initial state:', s.getBalance('dao'));
  
  // Create initiative with burn action
  s.sendTransaction(0, 'dao', transaction.createInitiative({
    title: 'Burn funds',
    description: 'Burn 100 tokens',
    author: 0,
    actions: [transaction.burn('100', 2)]
  }));
  
  await s.tick();
  console.log('After tick 1 (addTx → mempool)');
  console.log('  Entity stage:', s.findEntity('dao').stage);
  console.log('  Entity mempool:', s.findEntity('dao').mempool);
  
  await s.tick();  
  console.log('After tick 2 (propose block)');
  console.log('  Entity stage:', s.findEntity('dao').stage);
  
  await s.tick();
  console.log('After tick 3 (commit block)');
  console.log('  Entity stage:', s.findEntity('dao').stage);
  console.log('  Initiatives:', Array.from(s.findEntityState('dao').initiatives?.keys() ?? []));
  console.log('  Balance:', s.getBalance('dao'));
  
  const initiativeId = s.getInitiativeId('dao', 0);
  console.log('  Initiative ID:', initiativeId);
  console.log('  Initiative status:', s.findEntityState('dao').initiatives?.get(initiativeId)?.status);
  
  // Vote to pass
  s.sendTransaction(0, 'dao', transaction.vote(initiativeId, true, 0));
  await s.tick();
  await s.tick();
  await s.tick();
  console.log('After voting:');
  console.log('  Initiative status:', s.findEntityState('dao').initiatives?.get(initiativeId)?.status);
  
  // Execute initiative  
  s.sendTransaction(0, 'dao', transaction.executeInitiative({
    initiativeId,
    actions: [transaction.burn('100', 2)]
  }));
  
  await s.tick();
  console.log('After execute tick 1:');
  console.log('  Entity mempool:', s.findEntity('dao').mempool);
  console.log('  Server mempool:', s.server.mempool.map(tx => ({ 
    entity: tx.entityId, 
    command: tx.command.type,
    details: tx.command
  })));
  
  await s.tick();
  console.log('After execute tick 2:');
  console.log('  Entity mempool:', s.findEntity('dao').mempool);
  console.log('  Initiative status:', s.findEntityState('dao').initiatives?.get(initiativeId)?.status);
  
  await s.tick();
  console.log('After execute tick 3:');
  console.log('  Balance:', s.getBalance('dao'));
  console.log('  Server mempool:', s.server.mempool.length);
  
  // Process any remaining messages
  await s.processUntilIdle();
  console.log('Final balance:', s.getBalance('dao'));
});