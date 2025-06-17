import { test, expect } from 'bun:test';
import { scenario } from './fluent-api.js';
import { transaction } from '../entity/transactions.js';
import { WalletProtocol } from '../protocols/wallet.js';
import { DaoProtocol } from '../protocols/dao.js';

const registry = new Map([
  ['wallet', WalletProtocol],
  ['dao', DaoProtocol]
]);

test('debug: full multi-signer flow', async () => {
  const s = scenario('debug multisig full')
    .withProtocols(registry)
    .withDao('dao', [0, 1, 2], { balance: 1000n, voteThreshold: 66 });
  
  // Step 1: Create initiative
  s.sendTransaction(0, 'dao', transaction.createInitiative({
    title: 'Test initiative',
    description: 'Testing multi-sig',
    author: 0,
    actions: [transaction.burn('1', 1)]
  }));
  
  // Step 2: Signer 0 proposes
  s.proposeBlock(0, 'dao');
  
  console.log('After propose command added:');
  console.log('  Server mempool:', s.server.mempool.length);
  
  // Tick 1: Process addTx and proposeBlock
  await s.tick();
  console.log('\nAfter tick 1 (should share proposal):');
  console.log('  DAO@0 stage:', s.findEntity('dao', 0).stage);
  console.log('  DAO@1 stage:', s.findEntity('dao', 1).stage);
  console.log('  DAO@2 stage:', s.findEntity('dao', 2).stage);
  console.log('  Server mempool commands:', s.server.mempool.map(tx => tx.command.type));
  
  // Tick 2: Process shareProposal messages
  await s.tick();
  console.log('\nAfter tick 2 (signers receive proposal):');
  console.log('  DAO@0 stage:', s.findEntity('dao', 0).stage);
  console.log('  DAO@1 stage:', s.findEntity('dao', 1).stage);
  console.log('  DAO@2 stage:', s.findEntity('dao', 2).stage);
  console.log('  Server mempool commands:', s.server.mempool.map(tx => ({
    to: tx.signer,
    cmd: tx.command.type
  })));
  
  // Tick 3: Process approvals
  await s.tick();
  console.log('\nAfter tick 3 (approvals sent):');
  console.log('  DAO@0 stage:', s.findEntity('dao', 0).stage);
  const proposal = s.findEntity('dao', 0).proposal;
  if (proposal) {
    console.log('  Approvals:', Array.from(proposal.approvals));
  }
  console.log('  Server mempool commands:', s.server.mempool.map(tx => tx.command.type));
  
  // Tick 4: Should move to committing
  await s.tick();
  console.log('\nAfter tick 4 (consensus reached):');
  console.log('  DAO@0 stage:', s.findEntity('dao', 0).stage);
  console.log('  Server mempool commands:', s.server.mempool.map(tx => ({
    to: tx.signer,
    cmd: tx.command.type
  })));
  
  // Tick 5: Commit block
  await s.tick();
  console.log('\nAfter tick 5 (block committed):');
  console.log('  DAO@0 stage:', s.findEntity('dao', 0).stage);
  console.log('  DAO@0 height:', s.findEntity('dao', 0).height);
  console.log('  DAO@0 initiatives:', Array.from(s.findEntityState('dao', 0).initiatives?.keys() ?? []));
  console.log('  Server mempool:', s.server.mempool.length);
  
  // Process remaining commit notifications
  await s.processUntilIdle();
  console.log('\nFinal state:');
  console.log('  DAO@0 initiatives:', Array.from(s.findEntityState('dao', 0).initiatives?.keys() ?? []));
  console.log('  DAO@1 initiatives:', Array.from(s.findEntityState('dao', 1).initiatives?.keys() ?? []));
  console.log('  DAO@2 initiatives:', Array.from(s.findEntityState('dao', 2).initiatives?.keys() ?? []));
  
  // All signers should have the initiative
  expect(s.findEntityState('dao', 0).initiatives?.size).toBe(1);
  expect(s.findEntityState('dao', 1).initiatives?.size).toBe(1);
  expect(s.findEntityState('dao', 2).initiatives?.size).toBe(1);
});