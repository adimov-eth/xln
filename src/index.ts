// example.ts - Demonstration of the system
import * as server from './server';
import * as t from './types';

async function runExample() {
  // Create server
  let serverState = server.createServer();
  
  // Create deterministic random for testing
  const rng = new server.DeterministicRandom(42);
  const signerId = rng.hex(32);
  const entityId = rng.hex(32);
  
  // Send some transactions
  const txs: t.ServerTx[] = [
    {
      signerId,
      entityId,
      input: { type: 'AddTx', tx: { op: 'Create', args: [] } },
      timestamp: Date.now()
    },
    {
      signerId,
      entityId,
      input: { type: 'AddTx', tx: { op: 'Increment', args: [10] } },
      timestamp: Date.now()
    },
    {
      signerId,
      entityId,
      input: { type: 'AddTx', tx: { op: 'Increment', args: [5] } },
      timestamp: Date.now()
    },
    {
      signerId,
      entityId,
      input: { type: 'Flush' },
      timestamp: Date.now()
    }
  ];
  
  // Add to mempool
  for (const tx of txs) {
    const result = server.receive(serverState, tx);
    if (result.ok) {
      serverState = result.value;
    } else {
      console.error('Failed to receive tx:', result.error);
    }
  }
  
  // Process one tick
  const processResult = server.processMempool(serverState);
  if (processResult.ok) {
    const [newState, outbox] = processResult.value;
    console.log('Server height:', newState.height);
    console.log('Entities:', newState.entities);
    console.log('Outbox messages:', outbox.length);
  }
}

// Run the example
runExample().catch(console.error);