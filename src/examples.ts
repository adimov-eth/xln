// ============================================================================
// examples.ts - Usage examples
// ============================================================================

import { importEntity, registerEntity, submitCommand } from './engine/server.js';
import { ConsoleLogger } from './infra/deps.js';
import { createBlockRunner } from './infra/runner.js';
import { defaultRegistry } from './protocols/registry.js';
import { MemoryStorage } from './storage/memory.js';
import { id } from './types/primitives.js';
import { createInitialState } from './utils/serialization.js';
import { getCanonicalEntity } from './utils/state-helpers.js';

export async function runExample() {
  console.log('=== XLN v4 Example ===\n');
  
  const storage = new MemoryStorage();
  const runner = createBlockRunner({ storage, protocols: defaultRegistry, logger: ConsoleLogger, snapshotInterval: 5 });
  
  let server = createInitialState();
  
  // Register entities with the new API format
  server = registerEntity(server, 'alice', { quorum: [0], protocol: 'wallet' });
  server = registerEntity(server, 'bob', { quorum: [1], protocol: 'wallet' });
  server = registerEntity(server, 'dao', { quorum: [0, 1, 2], protocol: 'dao' });
  
  // Import entities to signers
  server = importEntity(server, 0, 'alice', { balance: 1000n, nonce: 0 });
  server = importEntity(server, 1, 'bob', { balance: 500n, nonce: 0 });
  server = importEntity(server, 0, 'dao', { balance: 10000n, nonce: 0 });
  server = importEntity(server, 1, 'dao', { balance: 10000n, nonce: 0 });
  server = importEntity(server, 2, 'dao', { balance: 10000n, nonce: 0 });
  
  console.log('Registered entities: alice, bob, dao\n');
  
  console.log('=== Example 1: Simple Transfer ===');
  server = submitCommand(server, 0, 'alice', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'bob', amount: '100' }, nonce: 1 }
  });
  
  // Process blocks
  for (let i = 0; i < 4; i++) {
    const result = await runner.processBlock(server);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
  }
  
  const finalAlice = getCanonicalEntity(server, id('alice'));
  const finalBob = getCanonicalEntity(server, id('bob'));
  console.log(`- Alice balance: ${finalAlice?.data.balance}, Bob balance: ${finalBob?.data.balance}\n`);
  
  console.log('=== Example 2: Multi-Sig Transaction ===');
  server = submitCommand(server, 0, 'dao', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'alice', amount: '1000' }, nonce: 1 }
  });
  
  for (let i = 0; i < 5; i++) {
    const result = await runner.processBlock(server);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
  }
  
  const finalDao = getCanonicalEntity(server, id('dao'));
  console.log(`Final DAO balance: ${finalDao?.data.balance}\n`);
  
  console.log('=== Example 3: Recovery Test ===');
  const recoveryResult = await runner.recover();
  if (!recoveryResult.ok) throw new Error(recoveryResult.error);
  const recovered = recoveryResult.value;
  console.log(`Height after recovery: ${recovered.height}`);
}