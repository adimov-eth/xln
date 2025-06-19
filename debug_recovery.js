import { createServer, importEntity, registerEntity, submitCommand } from './src/engine/server.js';
import { transaction } from './src/entity/transactions.js';
import { createBlockRunner } from './src/infra/runner.js';
import { defaultRegistry } from './src/protocols/registry.js';
import { LevelDBStorage } from './src/storage/leveldb.js';
import { height, id, signer } from './src/types/primitives.js';

const createTestState = () => {
  let server = createServer();
  server = registerEntity(server, 'alice', { quorum: [0], protocol: 'wallet' });
  server = importEntity(server, signer(0), 'alice', { balance: 1000n, nonce: 0 });
  server = registerEntity(server, 'bob', { quorum: [1], protocol: 'wallet' });
  server = importEntity(server, signer(1), 'bob', { balance: 500n, nonce: 0 });
  return server;
};

async function test() {
  const storage = new LevelDBStorage('./debug-db3');
  const runner = createBlockRunner({
    storage,
    protocols: defaultRegistry,
    logger: { info: () => {}, error: () => {}, warn: () => {} }
  });
  
  // Simulate crash test conditions
  let server = createTestState();
  server = submitCommand(server, signer(0), 'alice', {
    type: 'addTx',
    tx: transaction.transfer(id('bob'), '100', 1),
  });
  
  console.log('Initial server height:', server.height);
  
  // Process first block successfully
  const result1 = await runner.processBlock(server);
  if (result1.ok) {
    server = result1.value;
    console.log('After first block, server height:', server.height);
  }
  
  // Add another transaction for second block
  server = submitCommand(server, signer(0), 'alice', {
    type: 'addTx',
    tx: transaction.transfer(id('bob'), '50', 2),
  });
  
  console.log('Before second block, server height:', server.height);
  console.log('Server mempool length:', server.mempool.length);
  
  // Check WAL entries at different heights
  for (let h = 0; h <= 3; h++) {
    const walResult = await storage.wal.readFromHeight(height(h));
    if (walResult.ok && walResult.value.length > 0) {
      console.log(`WAL at height ${h}: ${walResult.value.length} entries`);
    }
  }
  
  await storage.close();
  
  // Now test recovery
  const newStorage = new LevelDBStorage('./debug-db3');
  const newRunner = createBlockRunner({
    storage: newStorage,
    protocols: defaultRegistry,
    logger: { info: () => {}, error: () => {}, warn: () => {} }
  });
  
  console.log('\n=== Recovery ===');
  
  // Check what blocks exist
  console.log('Blocks found:');
  for await (const [key] of newStorage.blocks.iterator({ reverse: true })) {
    console.log('  ', key);
  }
  
  // Manual recovery simulation
  let anchorHeight = 0;
  for await (const [key] of newStorage.blocks.iterator({ reverse: true, limit: 1 })) {
    anchorHeight = Number(key.slice(6));
    console.log('Anchor height from iterator:', anchorHeight);
    break;
  }
  
  // Check WAL from anchor + 1
  console.log(`Reading WAL from height ${anchorHeight + 1}:`);
  const walResult = await newStorage.wal.readFromHeight(height(anchorHeight + 1));
  if (walResult.ok) {
    console.log(`WAL entries: ${walResult.value.length}`);
  }
  
  await newStorage.close();
}

test().catch(console.error);