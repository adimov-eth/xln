import { test, expect } from 'bun:test';
import { scenario } from './fluent-api.js';
import { transaction } from '../entity/transactions.js';
import { WalletProtocol } from '../protocols/wallet.js';
import { DaoProtocol } from '../protocols/dao.js';

const registry = new Map([
  ['wallet', WalletProtocol],
  ['dao', DaoProtocol]
]);

test('debug: multi-signer dao', async () => {
  const s = scenario('debug multisig')
    .withProtocols(registry)
    .withDao('dao', [0, 1, 2], { balance: 1000n, voteThreshold: 66 });
  
  console.log('Initial setup:');
  console.log('  DAO balance:', s.getBalance('dao'));
  console.log('  DAO at signer 0:', s.findEntity('dao', 0).stage);
  console.log('  DAO at signer 1:', s.findEntity('dao', 1).stage);
  console.log('  DAO at signer 2:', s.findEntity('dao', 2).stage);
  
  // Create initiative from signer 0
  s.sendTransaction(0, 'dao', transaction.createInitiative({
    title: 'Test initiative',
    description: 'Testing multi-sig',
    author: 0,
    actions: []
  }));
  
  console.log('\nAfter sending create initiative:');
  console.log('  Server mempool:', s.server.mempool.map(tx => ({
    signer: tx.signer,
    entity: tx.entityId,
    command: tx.command.type
  })));
  
  // Check who should propose
  const height = s.findEntity('dao', 0).height;
  console.log('  Current height:', height);
  console.log('  Expected proposer:', height % 3); // With 3 signers
  
  // Let the expected proposer propose
  s.proposeBlock(0, 'dao');
  
  console.log('\nAfter propose:');
  console.log('  Server mempool:', s.server.mempool.length);
  
  await s.tick();
  console.log('\nAfter tick 1:');
  console.log('  DAO at 0:', s.findEntity('dao', 0).stage);
  console.log('  DAO at 1:', s.findEntity('dao', 1).stage);
  console.log('  DAO at 2:', s.findEntity('dao', 2).stage);
  console.log('  Server mempool:', s.server.mempool.map(tx => ({
    signer: tx.signer,
    entity: tx.entityId,
    command: tx.command.type
  })));
  
  await s.processUntilIdle();
  console.log('\nAfter processing until idle:');
  console.log('  DAO at 0 initiatives:', Array.from(s.findEntityState('dao', 0).initiatives?.keys() ?? []));
  console.log('  DAO at 1 initiatives:', Array.from(s.findEntityState('dao', 1).initiatives?.keys() ?? []));
  console.log('  DAO at 2 initiatives:', Array.from(s.findEntityState('dao', 2).initiatives?.keys() ?? []));
});