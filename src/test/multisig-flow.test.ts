// ============================================================================
// test/multisig-flow.test.ts - Tests for multi-sig consensus flow
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { importEntity, registerEntity, submitTransaction } from '../core/server.js';
import { createBlockRunner } from '../infra/runner.js';
import { defaultRegistry } from '../protocols/registry.js';
import { MemoryStorage } from '../storage/memory.js';
import { id, signer } from '../types/primitives.js';
import { createInitialState } from '../utils/serialization.js';
import { getEntityFromSigner } from '../utils/state-helpers.js';
import { SilentLogger } from '../infra/deps.js';

describe('Multi-sig Flow', () => {
  test('multi-sig entity should process through consensus', async () => {
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({
      storage,
      protocols: defaultRegistry,
      logger: SilentLogger
    });
    
    // Register and import multi-sig entity
    server = registerEntity(server, 'dao', [0, 1, 2], { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(0), 'dao', { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(1), 'dao', { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(2), 'dao', { balance: 1000n, nonce: 0 });
    
    // Add transaction from signer 0
    server = submitTransaction(server, 0, 'dao', {
      type: 'addTx',
      tx: { op: 'burn', data: { amount: '100' }, nonce: 1 }
    });
    
    // Process block - should route to entity
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
    
    // Check that transaction was added to dao mempool at signer 0
    const dao0 = getEntityFromSigner(server, signer(0), id('dao'));
    console.log('After first block:', {
      daoMempool: dao0?.mempool.length,
      serverMempool: server.mempool.length,
      daoStage: dao0?.stage,
      proposer: getEntityFromSigner(server, signer(0), id('dao'))?.height
    });
    expect(dao0?.mempool.length).toBe(1);
    expect(dao0?.stage).toBe('idle');
    
    // For multi-sig, we need to manually trigger proposal
    // In real system, this would be done by the proposer signer
    server = submitTransaction(server, 0, 'dao', {
      type: 'proposeBlock'
    });
    
    // Process the proposal
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
    
    // Check that dao is now in proposed stage
    const dao0Proposed = getEntityFromSigner(server, signer(0), id('dao'));
    console.log('After proposal block:', {
      dao0Stage: dao0Proposed?.stage,
      dao0Mempool: dao0Proposed?.mempool.length,
      serverMempool: server.mempool.length,
      proposal: dao0Proposed?.proposal ? {
        hash: dao0Proposed.proposal.hash,
        approvals: dao0Proposed.proposal.approvals.size,
        proposer: dao0Proposed.proposal.proposer
      } : null
    });
    expect(dao0Proposed?.stage).toBe('proposed');
    expect(dao0Proposed?.proposal).toBeDefined();
    expect(dao0Proposed?.proposal?.approvals.size).toBe(1); // Proposer auto-approves
    
    // Other signers should have received approval requests
    expect(server.mempool.length).toBeGreaterThan(0);
    
    // Debug mempool contents
    console.log('Mempool contents:', server.mempool.map(tx => ({
      signer: tx.signer,
      entity: tx.entityId,
      command: tx.command
    })));
    
    // Process approvals
    for (let i = 0; i < 5; i++) {
      console.log(`\nProcessing block ${i + 1}, mempool size: ${server.mempool.length}`);
      
      // Debug: Show mempool
      if (server.mempool.length > 0) {
        console.log('Mempool:', server.mempool.map(tx => ({
          signer: tx.signer,
          entity: tx.entityId,
          command: tx.command.type
        })));
      }
      
      // Debug: Check state at each signer before processing
      console.log('Entity states before block:');
      for (let j = 0; j < 3; j++) {
        const entity = getEntityFromSigner(server, signer(j), id('dao'));
        console.log(`  Signer ${j}: stage=${entity?.stage}, height=${entity?.height}, proposal=${entity?.proposal ? 'yes' : 'no'}`);
      }
      
      result = await runner.processBlock(server);
      if (!result.ok) {
        console.error(`Block processing failed: ${result.error}`);
      }
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      server = result.value;
      
      const daoCheck = getEntityFromSigner(server, signer(0), id('dao'));
      console.log(`Block ${server.height}: dao stage = ${daoCheck?.stage}, approvals = ${daoCheck?.proposal?.approvals.size}`);
      
      if (daoCheck?.stage === 'idle' && daoCheck.data.balance === 900n) {
        // Transaction was committed!
        break;
      }
    }
    
    // Verify final state
    const daoFinal = getEntityFromSigner(server, signer(0), id('dao'));
    expect(daoFinal?.data.balance).toBe(900n);
    expect(daoFinal?.data.nonce).toBe(1);
  });
});