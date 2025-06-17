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
    const runner = createBlockRunner({ storage, protocols: defaultRegistry, logger: SilentLogger });
    
    server = registerEntity(server, 'dao', [0, 1, 2], { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(0), 'dao', { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(1), 'dao', { balance: 1000n, nonce: 0 });
    server = importEntity(server, signer(2), 'dao', { balance: 1000n, nonce: 0 });
    
    server = submitTransaction(server, 0, 'dao', {
      type: 'addTx',
      tx: { op: 'burn', data: { amount: '100' }, nonce: 1 }
    });
    
    let result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
    
    const dao0 = getEntityFromSigner(server, signer(0), id('dao'));
    expect(dao0?.mempool.length).toBe(1);
    
    server = submitTransaction(server, 0, 'dao', { type: 'proposeBlock' });
    
    result = await runner.processBlock(server);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    server = result.value;
    
    const dao0Proposed = getEntityFromSigner(server, signer(0), id('dao'));
    expect(dao0Proposed?.stage).toBe('proposed');
    
    for (let i = 0; i < 5; i++) {
      result = await runner.processBlock(server);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      server = result.value;
      
      const daoCheck = getEntityFromSigner(server, signer(0), id('dao'));
      if (daoCheck?.stage === 'idle' && daoCheck.data.balance === 900n) break;
    }
    
    const daoFinal = getEntityFromSigner(server, signer(0), id('dao'));
    expect(daoFinal?.data.balance).toBe(900n);
    expect(daoFinal?.data.nonce).toBe(1);
  });
});