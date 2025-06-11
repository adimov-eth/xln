import { Server } from './server';
import { Database } from './store';
import { type EntityTx, type ServerTx, type EntityInput } from './types';

async function main() {
  // Initialize database
  const db = new Database('./data');
  await db.open();

  // Create server
  const server = new Server(db);
  await server.initialize();

  // Start processing loop
  server.start();

  // Create multiple entities with different roles
  const entities = [
    { id: 'bank', role: 'financial', initialBalance: 1000000 },
    { id: 'merchant', role: 'commerce', inventory: 100 },
    { id: 'user1', role: 'consumer', balance: 1000 },
    { id: 'user2', role: 'consumer', balance: 500 }
  ];

  // Initialize all entities
  for (const entity of entities) {
    const createTx: ServerTx = {
      signerIndex: 0,
      entityId: entity.id,
      input: { 
        type: 'import', 
        state: {
          height: 0,
          nonce: 0,
          data: { 
            role: entity.role,
            balance: entity.initialBalance || entity.balance || 0,
            inventory: entity.inventory || 0,
            transactions: [],
            connections: []
          },
          mempool: [],
          status: 'idle',
          proposedBlock: undefined,
          consensusBlock: undefined
        }, 
        height: 0 
      }
    };
    
    const createResult = await server.submitTx(createTx);
    if (!createResult.ok) {
      console.error(`Failed to create entity ${entity.id}:`, createResult.error);
      return;
    }
    console.log(`✓ Created entity: ${entity.id} (${entity.role})`);
  }

  // Simulate different transaction types
  console.log('\n--- Starting transaction simulation ---\n');

  // 1. User1 requests loan from bank
  const loanRequest: EntityTx = {
    nonce: 1,
    op: 'loan_request',
    data: {
      from: 'user1',
      to: 'bank',
      amount: 5000,
      purpose: 'business expansion'
    }
  };
  
  await server.submitTx({
    signerIndex: 0,
    entityId: 'user1',
    input: { type: 'add_tx', tx: loanRequest }
  });

  // 2. Bank processes loan (via outbox message)
  const loanApproval: EntityTx = {
    nonce: 1,
    op: 'loan_approval',
    data: {
      borrower: 'user1',
      amount: 5000,
      interestRate: 0.05,
      term: 12
    }
  };
  
  await server.submitTx({
    signerIndex: 0,
    entityId: 'bank',
    input: { type: 'add_tx', tx: loanApproval }
  });

  // 3. User1 purchases from merchant
  const purchase: EntityTx = {
    nonce: 2,
    op: 'purchase',
    data: {
      from: 'user1',
      to: 'merchant',
      item: 'product_a',
      quantity: 5,
      price: 100
    }
  };
  
  await server.submitTx({
    signerIndex: 0,
    entityId: 'user1',
    input: { type: 'add_tx', tx: purchase }
  });

  // 4. User2 transfers to User1
  const transfer: EntityTx = {
    nonce: 1,
    op: 'transfer',
    data: {
      from: 'user2',
      to: 'user1',
      amount: 200,
      memo: 'payment for services'
    }
  };
  
  await server.submitTx({
    signerIndex: 0,
    entityId: 'user2',
    input: { type: 'add_tx', tx: transfer }
  });

  // 5. Merchant restocks inventory
  const restock: EntityTx = {
    nonce: 1,
    op: 'restock',
    data: {
      item: 'product_a',
      quantity: 50,
      cost: 2500
    }
  };
  
  await server.submitTx({
    signerIndex: 0,
    entityId: 'merchant',
    input: { type: 'add_tx', tx: restock }
  });

  // Process blocks for all entities
  console.log('\n--- Processing blocks ---\n');
  
  for (const entity of entities) {
    // Propose block
    await server.submitTx({
      signerIndex: 0,
      entityId: entity.id,
      input: { type: 'propose_block' }
    });
    
    // Simulate consensus voting (multiple signers)
    for (let signerIndex = 1; signerIndex < 3; signerIndex++) {
      await server.submitTx({
        signerIndex,
        entityId: entity.id,
        input: { 
          type: 'vote', 
          blockHeight: 1,
          blockHash: 'simulated_hash' // In real system, this would be calculated
        }
      });
    }
    
    console.log(`✓ Processed block for ${entity.id}`);
  }

  // Simulate inter-entity communication
  console.log('\n--- Inter-entity communication ---\n');

  // Bank sends credit line update to user1
  const creditLineUpdate: EntityInput = {
    type: 'inbox',
    from: 'bank',
    message: {
      type: 'credit_line_update',
      recipient: 'user1',
      newLimit: 10000,
      utilizationRate: 0.5
    }
  };
  
  await server.submitTx({
    signerIndex: 0,
    entityId: 'user1',
    input: creditLineUpdate
  });

  // Merchant sends invoice to user1
  const invoice: EntityInput = {
    type: 'inbox',
    from: 'merchant',
    message: {
      type: 'invoice',
      recipient: 'user1',
      items: [{ name: 'product_a', quantity: 5, price: 100 }],
      total: 500,
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  };
  
  await server.submitTx({
    signerIndex: 0,
    entityId: 'user1',
    input: invoice
  });

  // Simulate error scenarios
  console.log('\n--- Testing error scenarios ---\n');

  // Invalid transaction (insufficient balance)
  const invalidTx: EntityTx = {
    nonce: 2,
    op: 'transfer',
    data: {
      from: 'user2',
      to: 'user1',
      amount: 10000, // More than user2's balance
      memo: 'invalid transfer'
    }
  };
  
  const invalidResult = await server.submitTx({
    signerIndex: 0,
    entityId: 'user2',
    input: { type: 'add_tx', tx: invalidTx }
  });
  
  if (!invalidResult.ok) {
    console.log('✓ Correctly rejected invalid transaction:', invalidResult.error);
  }

  // Non-existent entity
  const ghostTx = await server.submitTx({
    signerIndex: 0,
    entityId: 'ghost_entity',
    input: { type: 'add_tx', tx: { nonce: 1, op: 'test', data: {} } }
  });
  
  if (!ghostTx.ok) {
    console.log('✓ Correctly rejected transaction to non-existent entity:', ghostTx.error);
  }

  // Wait for all processing to complete
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Print final state
  console.log('\n--- Final system state ---\n');
  server.printTree();

  // Query specific entity states
  console.log('\n--- Entity summaries ---\n');
  for (const entity of entities) {
    const state = await server.getEntityState(entity.id);
    if (state) {
      console.log(`${entity.id}: Height=${state.height}, Nonce=${state.nonce}, Status=${state.status}`);
      console.log(`  Data:`, JSON.stringify(state.data, null, 2));
    }
  }

  // Cleanup
  server.stop();
  await db.close();
}

// Run main function
main().catch(console.error);