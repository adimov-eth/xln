import { Server } from './server';
import { Database } from './store';
import { type EntityTx, type ServerTx } from './types';

async function main() {
  // Initialize database
  const db = new Database('./data');
  await db.open();

  // Create server
  const server = new Server(db);
  await server.initialize();

  // Start processing loop
  server.start();

  // Create a simple entity
  const createTx: ServerTx = {
    signerIndex: 0,
    entityId: 'entity1',
    input: { type: 'import', state: {
      height: 0,
      nonce: 0,
      data: { counter: 0 },
      mempool: [],
      status: 'idle'
    }, height: 0 }
  };
  await server.submitTx(createTx);

  // Submit some transactions
  for (let i = 0; i < 10; i++) {
    const tx: EntityTx = {
      nonce: i + 1,
      op: 'increment',
      data: {}
    };
    
    await server.submitTx({
      signerIndex: 0,
      entityId: 'entity1',
      input: { type: 'add_tx', tx }
    });
  }

  // Trigger block creation
  await server.submitTx({
    signerIndex: 0,
    entityId: 'entity1',
    input: { type: 'propose_block' }
  });

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Print final state
  server.printTree();

  // Cleanup
  server.stop();
  await db.close();
}

// Run if main module
if (require.main === module) {
  main().catch(console.error);
}