#!/usr/bin/env bun

import { ServerTx, createStorage, initializeServer, processBlock } from './server';
import { parseEntityId, parseSignerIdx } from './typeHelpers';

// Test critical error handling
const testCriticalError = async () => {
  console.log('🚨 Testing Critical Error Handling\n');
  
  const storage = createStorage('./data-test-critical');
  let server = initializeServer();
  
  // Remove an entity from a signer's view to trigger a critical error
  const signer0Map = server.signers.get(parseSignerIdx(0))!;
  signer0Map.delete(parseEntityId('alice')); // Remove alice from signer 0's view
  
  console.log('Test: Transaction to entity that exists in registry but not in signer view');
  const criticalTx: ServerTx = {
    signer: parseSignerIdx(0),
    entityId: parseEntityId('alice'),
    input: { type: 'add_tx', tx: { op: 'mint', data: { amount: 1000 } } }
  };
  
  server.mempool.push(criticalTx);
  
  try {
    server = await processBlock(server, storage);
  } catch (error) {
    console.log('✅ Caught expected error:', error instanceof Error ? error.message : String(error));
  }
  
  console.log(`\nFinal server height: ${server.height} (should be 0 - block failed)`);
  
  // Clean up
  await storage.state.close();
  await storage.wal.close();
  await storage.blocks.close();
  await storage.archive.close();
  await storage.refs.close();
};

testCriticalError().catch(console.error);