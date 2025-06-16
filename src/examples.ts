// ============================================================================
// examples.ts - Usage examples
// ============================================================================

import { registerEntity, submitTransaction } from './core/server.js';
import { ConsoleLogger } from './infra/deps.js';
import { createBlockRunner } from './infra/runner.js';
import { defaultRegistry } from './protocols/registry.js';
import { MemoryStorage } from './storage/memory.js';
import { id } from './types/primitives.js';
import { createInitialState } from './utils/serialization.js';

export async function runExample() {
  console.log('=== XLN v2.1 Example ===\n');
  
  // Create infrastructure
  const storage = new MemoryStorage();
  const protocols = defaultRegistry;
  const runner = createBlockRunner({ 
    storage, 
    protocols,
    logger: ConsoleLogger,
    snapshotInterval: 5  // Take snapshots every 5 blocks for testing
  });
  
  // Initialize server
  let server = createInitialState();
  
  // Register entities
  server = registerEntity(server, 'alice', [0], { balance: 1000n, nonce: 0 });
  server = registerEntity(server, 'bob', [1], { balance: 500n, nonce: 0 });
  server = registerEntity(server, 'dao', [0, 1, 2], { balance: 10000n, nonce: 0 });
  
  console.log('Registered entities:');
  console.log('- alice: single signer (0), balance 1000');
  console.log('- bob: single signer (1), balance 500');
  console.log('- dao: multi-sig (0,1,2), balance 10000\n');
  
  // Example 1: Simple transfer
  console.log('=== Example 1: Simple Transfer ===');
  
  server = submitTransaction(server, 0, 'alice', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'bob', amount: '100' }, nonce: 1 }
  });
  
  let result = await runner.processBlock(server);
  if (!result.ok) throw new Error(result.error);
  server = result.value;
  
  console.log(`After block ${server.height}:`);
  console.log(`- Mempool size: ${server.mempool.length}`);
  console.log(`- Alice mempool: ${server.entities.get(id('alice'))?.mempool.length}`);
  
  // Process auto-propose and commit
  for (let i = 0; i < 3; i++) {
    result = await runner.processBlock(server);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
  }
  
  console.log(`\nFinal state after transfer:`);
  console.log(`- Alice balance: ${server.entities.get(id('alice'))?.data.balance}`);
  console.log(`- Alice nonce: ${server.entities.get(id('alice'))?.data.nonce}`);
  console.log(`- Bob balance: ${server.entities.get(id('bob'))?.data.balance}`);
  console.log(`- Bob nonce: ${server.entities.get(id('bob'))?.data.nonce} (incremented by credit)`);
  console.log(`- Bob mempool: ${server.entities.get(id('bob'))?.mempool.length} pending\n`);
  
  // Example 2: Multi-sig transaction
  console.log('=== Example 2: Multi-Sig Transaction ===');
  
  server = submitTransaction(server, 0, 'dao', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'alice', amount: '1000' }, nonce: 1 }
  });
  
  result = await runner.processBlock(server);
  if (!result.ok) throw new Error(result.error);
  server = result.value;
  
  console.log('DAO transaction added, processing...');
  
  // Process through multi-sig flow
  for (let i = 0; i < 5; i++) {
    result = await runner.processBlock(server);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
    
    const dao = server.entities.get(id('dao'));
    const meta = server.registry.get(id('dao'))!;
    console.log(`Block ${server.height}: DAO stage = ${dao?.stage}`);
    
    if (dao?.stage === 'proposed' && dao.proposal) {
      console.log(`  Approvals: ${dao.proposal.approvals.size}/${meta.quorum.length}`);
    }
  }
  
  console.log(`\nFinal DAO balance: ${server.entities.get(id('dao'))?.data.balance}`);
  
  // Example 3: Recovery
  console.log('\n=== Example 3: Recovery Test ===');
  
  const beforeCrash = server.height;
  console.log(`Height before "crash": ${beforeCrash}`);
  
  // Simulate crash and recovery
  const recoveryResult = await runner.recover();
  if (!recoveryResult.ok) throw new Error(recoveryResult.error);
  
  const recovered = recoveryResult.value;
  console.log(`Height after recovery: ${recovered.height}`);
  console.log(`Entities recovered: ${recovered.entities.size}`);
  console.log(`Alice balance after recovery: ${recovered.entities.get(id('alice'))?.data.balance}`);
  
  // Example 4: Replay protection test
  console.log('\n=== Example 4: Replay Protection ===');
  
  // Try to replay an old transaction with same nonce
  server = submitTransaction(recovered, 0, 'alice', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'bob', amount: '50' }, nonce: 1 } // Old nonce!
  });
  
  result = await runner.processBlock(server);
  if (!result.ok) throw new Error(result.error);
  server = result.value;
  
  // Process through the pipeline
  for (let i = 0; i < 3; i++) {
    result = await runner.processBlock(server);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
  }
  
  console.log(`After replay attempt:`);
  console.log(`- Alice balance: ${server.entities.get(id('alice'))?.data.balance} (should be unchanged)`);
  console.log(`- Alice nonce: ${server.entities.get(id('alice'))?.data.nonce}`);
  console.log(`- Transaction was rejected due to invalid nonce`);
} 