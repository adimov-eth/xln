// XLN v1 Core - Server runner with fault tolerance
import type { ServerState, ServerTx, EntityInput } from './types';
import { createServerState, processServerBlock, addToMempool, initializeSigner, importEntity } from './core/server';
import { createGenesisEntity } from './core/entity';
import { saveServerBlock, saveServerSnapshot, loadServerSnapshot, loadServerBlocks, closeDatabases } from './core/persistence';

// Server tick interval in milliseconds
const TICK_INTERVAL = 100; // 100ms blocks as per spec
const SNAPSHOT_INTERVAL = 100; // Snapshot every 100 blocks

let serverState: ServerState;
let isRunning = true;

// Initialize or recover server state
async function initialize(): Promise<void> {
  console.log('🚀 Starting XLN v1 Core...');
  
  // Try to load from snapshot
  const snapshot = await loadServerSnapshot();
  
  if (snapshot) {
    console.log(`📸 Recovered from snapshot at height ${snapshot.height}`);
    serverState = snapshot;
    
    // Apply any WAL entries after snapshot
    const currentHeight = serverState.height;
    const latestBlocks = await loadServerBlocks(currentHeight, currentHeight + 1000);
    
    if (latestBlocks.length > 0) {
      console.log(`📜 Applying ${latestBlocks.length} blocks from WAL...`);
      // In production, we'd replay these blocks
      // For now, we'll just update the height
      serverState = { ...serverState, height: currentHeight + latestBlocks.length };
    }
  } else {
    console.log('🌱 Starting fresh server state');
    serverState = createServerState();
    
    // Demo: Initialize signers and create test entities
    await setupDemo();
  }
}

// Demo setup with test entities
async function setupDemo(): Promise<void> {
  // Initialize 3 signers
  serverState = initializeSigner(serverState, 0);
  serverState = initializeSigner(serverState, 1);
  serverState = initializeSigner(serverState, 2);
  
  // Create a test entity with 3-signer quorum
  const testEntityId = 'entity_test_001';
  const testEntity = createGenesisEntity(testEntityId, [0, 1, 2], 0);
  
  // Import entity into all signers
  serverState = importEntity(serverState, 0, testEntityId, testEntity);
  serverState = importEntity(serverState, 1, testEntityId, testEntity);
  serverState = importEntity(serverState, 2, testEntityId, testEntity);
  
  console.log('🏗️  Demo setup complete: 3 signers, 1 test entity');
  
  // Add initial test transaction
  const mintTx: ServerTx = {
    signerIndex: 0,
    entityId: testEntityId,
    input: {
      kind: 'addTx',
      tx: { op: 'MINT', data: { amount: 1000 } }
    }
  };
  
  serverState = addToMempool(serverState, mintTx);
}

// Main server tick loop
async function serverTick(): Promise<void> {
  if (serverState.mempool.length === 0) return;
  
  const startTime = Date.now();
  const previousHeight = serverState.height;
  const processedTxs = serverState.mempool; // Save the transactions we're about to process
  
  // Process the block
  serverState = processServerBlock(serverState);
  
  // Save to WAL
  const block = {
    height: previousHeight,
    txs: processedTxs, // Save the transactions that were actually processed
    timestamp: Date.now()
  };
  await saveServerBlock(block);
  
  // Periodic snapshots
  if (serverState.height % SNAPSHOT_INTERVAL === 0) {
    await saveServerSnapshot(serverState);
    console.log(`💾 Snapshot saved at height ${serverState.height}`);
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`⚡ Block ${serverState.height} processed in ${elapsed}ms (${serverState.mempool.length} new txs in mempool)`);
}

// Graceful shutdown handler
async function shutdown(): Promise<void> {
  console.log('\n🛑 Shutting down gracefully...');
  isRunning = false;
  
  // Save final snapshot
  await saveServerSnapshot(serverState);
  console.log(`💾 Final snapshot saved at height ${serverState.height}`);
  
  // Close databases
  await closeDatabases();
  console.log('👋 Goodbye!');
  process.exit(0);
}

// Handle process termination
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Simulate external transactions
function simulateTransactions(): void {
  if (Math.random() < 0.3) { // 30% chance per tick
    const testEntityId = 'entity_test_001';
    const signerIndex = Math.floor(Math.random() * 3);
    
    const txTypes = ['MINT', 'SET', 'proposeBlock'] as const;
    const txType = txTypes[Math.floor(Math.random() * txTypes.length)]!;
    
    let input: EntityInput;
    
    if (txType === 'proposeBlock') {
      input = { kind: 'proposeBlock' };
    } else {
      input = {
        kind: 'addTx',
        tx: {
          op: txType,
          data: txType === 'MINT' 
            ? { amount: Math.floor(Math.random() * 100) }
            : { key: `key_${Date.now()}`, value: Math.random() }
        }
      };
    }
    
    const tx: ServerTx = { signerIndex, entityId: testEntityId, input };
    serverState = addToMempool(serverState, tx);
  }
}

// Main entry point
async function main(): Promise<void> {
  await initialize();
  
  // Start the server tick loop
  console.log('🔄 Starting server tick loop...\n');
  
  while (isRunning) {
    simulateTransactions();
    await serverTick();
    await new Promise(resolve => setTimeout(resolve, TICK_INTERVAL));
  }
}

// Run the server
main().catch(console.error);