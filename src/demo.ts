#!/usr/bin/env bun

import {
    addTransaction,
    hashBlock,
    importEntity,
    initServer,
    runServer
} from './index.ts';

/**
 * Demo: Simple wallet with mint/transfer operations
 */
const demo = async () => {
  // Initialize server with 2 signers
  let server = initServer(2);
  
  // Create entities under each signer
  server = importEntity({
    server,
    signerIdx: 0,
    entityId: 'alice-wallet',
    initialState: { balance: 0n, owner: 'alice' },
  });
  
  server = importEntity({
    server,
    signerIdx: 1, 
    entityId: 'bob-wallet',
    initialState: { balance: 0n, owner: 'bob' },
  });
  
  // Create hub entity for notifications
  server = importEntity({
    server,
    signerIdx: 0,
    entityId: 'hub',
    initialState: { notifications: [] },
  });

  // Transaction 1: Alice mints tokens
  server = addTransaction(server, {
    signer: 0,
    entityId: 'alice-wallet',
    input: {
      type: 'add_tx',
      tx: { op: 'mint', data: { amount: 1500n } }
    }
  });

  // Transaction 2: Alice proposes block
  server = addTransaction(server, {
    signer: 0,
    entityId: 'alice-wallet', 
    input: { type: 'propose_block' }
  });

  // Transaction 3: Alice commits block (with proper hash)
  // Note: In real usage, this hash would be computed from the proposed block
  const mockTxs = [{ op: 'mint', data: { amount: 1500n } }];
  const blockHash = hashBlock(mockTxs);
  
  server = addTransaction(server, {
    signer: 0,
    entityId: 'alice-wallet',
    input: { 
      type: 'commit_block', 
      blockHash
    }
  });

  // Transaction 4: Bob mints tokens
  server = addTransaction(server, {
    signer: 1,
    entityId: 'bob-wallet',
    input: {
      type: 'add_tx',
      tx: { op: 'mint', data: { amount: 500n } }
    }
  });

  // Transaction 5: Bob proposes and commits
  server = addTransaction(server, {
    signer: 1,
    entityId: 'bob-wallet',
    input: { type: 'propose_block' }
  });

  const bobTxs = [{ op: 'mint', data: { amount: 500n } }];
  server = addTransaction(server, {
    signer: 1,
    entityId: 'bob-wallet',
    input: { 
      type: 'commit_block', 
      blockHash: hashBlock(bobTxs)
    }
  });

  console.log('=== XLN Demo Started ===');
  console.log('Alice wallet: mint 1500 tokens');
  console.log('Bob wallet: mint 500 tokens');
  console.log('Hub: receives notifications when balance > 1000');
  console.log('Transactions queued, starting server...');
  console.log('Press Ctrl+C to stop.\n');
  
  // Start server loop
  await runServer(server);
};

// Run demo if this file is executed directly
if (import.meta.main) {
  await demo();
} 