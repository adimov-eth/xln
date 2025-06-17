import { test, expect } from 'bun:test';
import { scenario } from './fluent-api.js';
import { transaction } from '../entity/transactions.js';
import { WalletProtocol } from '../protocols/wallet.js';
import { DaoProtocol } from '../protocols/dao.js';

const registry = new Map([
  ['wallet', WalletProtocol],
  ['dao', DaoProtocol]
]);

test('debug: simple dao burn', async () => {
  const s = scenario('debug dao')
    .withProtocols(registry)
    .withDao('dao', [0], { balance: 1000n });
  
  console.log('Initial state:', s.getBalance('dao'));
  
  // Send burn transaction
  s.sendTransaction(0, 'dao', transaction.burn('100', 1));
  
  console.log('After adding tx, server mempool:', s.server.mempool);
  
  // Process blocks
  await s.tick();
  console.log('After tick 1, balance:', s.getBalance('dao'));
  console.log('Server mempool after tick 1:', s.server.mempool);
  
  await s.tick();
  console.log('After tick 2, balance:', s.getBalance('dao'));
  
  await s.tick();
  console.log('After tick 3, balance:', s.getBalance('dao'));
  
  // Should have burned 100
  expect(s.getBalance('dao')).toBe(900n);
});