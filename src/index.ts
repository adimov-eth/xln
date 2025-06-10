// example-persistent.ts
import { DeterministicRandom, Server } from './server';

async function runPersistentExample() {
  // Create and initialize server
  const server = new Server({
    storage: {
      stateDbPath: './test-db/state',
      serverBlocksPath: './test-db/server_blocks',
      entityBlocksPath: './test-db/entity_blocks',
      snapshotInterval: 10 // Snapshot every 10 blocks for testing
    }
  });

  await server.initialize();
  await server.start();

  // Create test entities
  const rng = new DeterministicRandom(42);
  const signerId = rng.hex(32);
  const entityId = rng.hex(32);

  // Send transactions
  console.log('Sending transactions...');
  
  // Create entity
  await server.receive({
    signerId,
    entityId,
    input: { type: 'AddTx', tx: { op: 'Create', args: [] } },
    timestamp: Date.now()
  });

  // Send multiple increments
  for (let i = 0; i < 25; i++) {
    await server.receive({
      signerId,
      entityId,
      input: { type: 'AddTx', tx: { op: 'Increment', args: [i + 1] } },
      timestamp: Date.now()
    });
    
    // Flush periodically
    if (i % 5 === 4) {
      await server.receive({
        signerId,
        entityId,
        input: { type: 'Flush' },
        timestamp: Date.now()
      });
      
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 500));

  // Check final state
  const state = server.getState();
  console.log('Final server height:', state.height);
  
  const entityState = state.entities.get(signerId)?.get(entityId);
  if (entityState) {
    console.log('Entity state:', {
      height: entityState.height,
      storage: entityState.storage,
      mempoolSize: entityState.mempool.length
    });
  }

  // Export entity blocks
  const blocks = await server.exportEntityBlocks(signerId, entityId);
  console.log('Entity blocks:', blocks.length);
  
  // Stop server
  await server.stop();

  // Test recovery by creating new server instance
  console.log('\nTesting recovery...');
  const server2 = new Server({
    storage: {
      stateDbPath: './test-db/state',
      serverBlocksPath: './test-db/server_blocks',
      entityBlocksPath: './test-db/entity_blocks'
    }
  });

  await server2.initialize();
  
  const recoveredState = server2.getState();
  console.log('Recovered server height:', recoveredState.height);
  
  const recoveredEntity = recoveredState.entities.get(signerId)?.get(entityId);
  if (recoveredEntity) {
    console.log('Recovered entity state:', {
      height: recoveredEntity.height,
      storage: recoveredEntity.storage
    });
  }

  await server2.stop();
}

// Run the example
runPersistentExample().catch(console.error);