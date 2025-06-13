#!/usr/bin/env bun

import { ServerState, ServerTx, createStorage, initializeServer, processBlock } from './server';
import { parseSignerIdx, parseEntityId } from './typeHelpers';

// Test script to demonstrate error handling
const testErrorHandling = async () => {
  console.log('🧪 Testing Error Handling System\n');
  
  const storage = createStorage('./data-test');
  let server = initializeServer();
  
  // Test 1: Invalid entity transaction
  console.log('Test 1: Transaction to non-existent entity');
  const invalidEntityTx: ServerTx = {
    signer: parseSignerIdx(0),
    entityId: parseEntityId('nonexistent'),
    input: { type: 'add_tx', tx: { op: 'mint', data: { amount: 1000 } } }
  };
  
  server.mempool.push(invalidEntityTx);
  server = await processBlock(server, storage);
  
  // Test 2: Unauthorized signer
  console.log('\nTest 2: Unauthorized signer for entity');
  const unauthorizedTx: ServerTx = {
    signer: parseSignerIdx(2), // Carol trying to control Alice
    entityId: parseEntityId('alice'),
    input: { type: 'add_tx', tx: { op: 'mint', data: { amount: 5000 } } }
  };
  
  server.mempool.push(unauthorizedTx);
  server = await processBlock(server, storage);
  
  // Test 3: Invalid block proposal (entity not idle)
  console.log('\nTest 3: Multiple block proposals');
  const proposalTx1: ServerTx = {
    signer: parseSignerIdx(0),
    entityId: parseEntityId('dao'),
    input: { 
      type: 'propose_block', 
      txs: [{ op: 'mint', data: { amount: 10000 } }],
      hash: 'test-hash-1'
    }
  };
  
  const proposalTx2: ServerTx = {
    signer: parseSignerIdx(0),
    entityId: parseEntityId('dao'),
    input: { 
      type: 'propose_block', 
      txs: [{ op: 'mint', data: { amount: 20000 } }],
      hash: 'test-hash-2'
    }
  };
  
  server.mempool.push(proposalTx1, proposalTx2);
  server = await processBlock(server, storage);
  
  // Test 4: Mix of valid and invalid transactions
  console.log('\nTest 4: Mix of valid and invalid transactions');
  const mixedTxs: ServerTx[] = [
    // Valid
    {
      signer: parseSignerIdx(0),
      entityId: parseEntityId('alice'),
      input: { type: 'add_tx', tx: { op: 'mint', data: { amount: 1000 } } }
    },
    // Invalid entity
    {
      signer: parseSignerIdx(1),
      entityId: parseEntityId('invalid'),
      input: { type: 'add_tx', tx: { op: 'mint', data: { amount: 2000 } } }
    },
    // Valid
    {
      signer: parseSignerIdx(1),
      entityId: parseEntityId('bob'),
      input: { type: 'add_tx', tx: { op: 'mint', data: { amount: 3000 } } }
    },
    // Unauthorized
    {
      signer: parseSignerIdx(0),
      entityId: parseEntityId('carol'),
      input: { type: 'add_tx', tx: { op: 'burn', data: { amount: 500 } } }
    }
  ];
  
  server.mempool.push(...mixedTxs);
  server = await processBlock(server, storage);
  
  console.log('\n✅ Error handling tests completed');
  console.log(`Final server height: ${server.height}`);
  
  // Clean up
  await storage.state.close();
  await storage.wal.close();
  await storage.blocks.close();
  await storage.archive.close();
  await storage.refs.close();
};

testErrorHandling().catch(console.error);