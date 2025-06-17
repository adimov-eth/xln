// ============================================================================
// examples.ts - Usage examples
// ============================================================================

import { importEntity, registerEntity, submitTransaction } from './core/server.js';
import { ConsoleLogger } from './infra/deps.js';
import { createBlockRunner } from './infra/runner.js';
import { defaultRegistry } from './protocols/registry.js';
import { MemoryStorage } from './storage/memory.js';
import { id, signer } from './types/primitives.js';
import { createInitialState } from './utils/serialization.js';
import { getCanonicalEntity } from './utils/state-helpers.js';

export async function runExample() {
  console.log('=== XLN v2.2 Example ===\n');
  
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
  
  // Import entities to their signers
  server = importEntity(server, signer(0), 'alice', { balance: 1000n, nonce: 0 });
  server = importEntity(server, signer(1), 'bob', { balance: 500n, nonce: 0 });
  // For multi-sig, import to all signers
  server = importEntity(server, signer(0), 'dao', { balance: 10000n, nonce: 0 });
  server = importEntity(server, signer(1), 'dao', { balance: 10000n, nonce: 0 });
  server = importEntity(server, signer(2), 'dao', { balance: 10000n, nonce: 0 });
  
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
  
  let result = await runner.processBlock(server, false);
  if (!result.ok) throw new Error(result.error);
  server = result.value;
  
  console.log(`After block ${server.height}:`);
  console.log(`- Mempool size: ${server.mempool.length}`);
  const alice = getCanonicalEntity(server, id('alice'));
  console.log(`- Alice mempool: ${alice?.mempool.length}`);
  
  // Process auto-propose and commit
  for (let i = 0; i < 3; i++) {
    result = await runner.processBlock(server, false);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
  }
  
  console.log(`\nFinal state after transfer:`);
  const finalAlice = getCanonicalEntity(server, id('alice'));
  const finalBob = getCanonicalEntity(server, id('bob'));
  console.log(`- Alice balance: ${finalAlice?.data.balance}`);
  console.log(`- Alice nonce: ${finalAlice?.data.nonce}`);
  console.log(`- Bob balance: ${finalBob?.data.balance}`);
  console.log(`- Bob nonce: ${finalBob?.data.nonce} (incremented by credit)`);
  console.log(`- Bob mempool: ${finalBob?.mempool.length} pending\n`);
  
  // Example 2: Multi-sig transaction
  console.log('=== Example 2: Multi-Sig Transaction ===');
  
  server = submitTransaction(server, 0, 'dao', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'alice', amount: '1000' }, nonce: 1 }
  });
  
  result = await runner.processBlock(server, false);
  if (!result.ok) throw new Error(result.error);
  server = result.value;
  
  console.log('DAO transaction added, processing...');
  
  // Process through multi-sig flow
  for (let i = 0; i < 5; i++) {
    result = await runner.processBlock(server, false);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
    
    const dao = getCanonicalEntity(server, id('dao'));
    const meta = server.registry.get(id('dao'))!;
    console.log(`Block ${server.height}: DAO stage = ${dao?.stage}`);
    
    if (dao?.stage === 'proposed' && dao.proposal) {
      console.log(`  Approvals: ${dao.proposal.approvals.size}/${meta.quorum.length}`);
    }
  }
  
  const finalDao = getCanonicalEntity(server, id('dao'));
  console.log(`\nFinal DAO balance: ${finalDao?.data.balance}`);
  
  // Example 3: Recovery
  console.log('\n=== Example 3: Recovery Test ===');
  
  const beforeCrash = server.height;
  console.log(`Height before "crash": ${beforeCrash}`);
  
  // Simulate crash and recovery
  const recoveryResult = await runner.recover();
  if (!recoveryResult.ok) throw new Error(recoveryResult.error);
  
  const recovered = recoveryResult.value;
  console.log(`Height after recovery: ${recovered.height}`);
  console.log(`Signers recovered: ${recovered.signers.size}`);
  const recoveredAlice = getCanonicalEntity(recovered, id('alice'));
  console.log(`Alice balance after recovery: ${recoveredAlice?.data.balance}`);
  
  // Example 4: Replay protection test
  console.log('\n=== Example 4: Replay Protection ===');
  
  // Try to replay an old transaction with same nonce
  server = submitTransaction(recovered, 0, 'alice', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'bob', amount: '50' }, nonce: 1 } // Old nonce!
  });
  
  result = await runner.processBlock(server, false);
  if (!result.ok) throw new Error(result.error);
  server = result.value;
  
  // Process through the pipeline
  for (let i = 0; i < 3; i++) {
    result = await runner.processBlock(server, false);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
  }
  
  console.log(`After replay attempt:`);
  const replayAlice = getCanonicalEntity(server, id('alice'));
  console.log(`- Alice balance: ${replayAlice?.data.balance} (should be unchanged)`);
  console.log(`- Alice nonce: ${replayAlice?.data.nonce}`);
  console.log(`- Transaction was rejected due to invalid nonce`);
} 
