// ============================================================================
// test/dao.test.ts - DAO protocol tests
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { importEntity, registerEntity, submitTransaction } from '../core/server.js';
import { SilentLogger } from '../infra/deps.js';
import { createBlockRunner } from '../infra/runner.js';
import { createDaoState, type Initiative } from '../protocols/dao.js';
import { defaultRegistry } from '../protocols/registry.js';
import { MemoryStorage } from '../storage/memory.js';
import { id, signer, type SignerIdx } from '../types/primitives.js';
import { createInitialState } from '../utils/serialization.js';
import { getEntityFromSigner } from '../utils/state-helpers.js';

describe('DAO Protocol', () => {
  test('single signer DAO - basic initiative flow', async () => {
    let server = createInitialState();
    const storage = new MemoryStorage();
    const runner = createBlockRunner({ storage, protocols: defaultRegistry, logger: SilentLogger });
    
    server = registerEntity(server, 'dao', [0], undefined, 'dao');
    server = importEntity(server, signer(0), 'dao', createDaoState(1000n, 1, 50));

    server = submitTransaction(server, 0, 'dao', {
      type: 'addTx',
      tx: {
        op: 'createInitiative',
        data: {
          title: 'Fund Development',
          description: 'Transfer 100 tokens to dev team',
          author: 0,
          actions: [{ op: 'transfer', data: { amount: '100', to: 'dev-wallet' }, nonce: 2 }]
        },
        nonce: 1
      }
    });

    for (let i = 0; i < 3; i++) {
      const res = await runner.processBlock(server);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      server = res.value;
    }

    const entity1 = getEntityFromSigner(server, signer(0), id('dao'))!;
    expect(entity1.data.initiatives.size).toBe(1);
    const [initiativeId, initiative] = Array.from((entity1.data.initiatives as Map<string, Initiative>).entries())[0]!;
    
    server = submitTransaction(server, 0, 'dao', {
      type: 'addTx',
      tx: { op: 'voteInitiative', data: { initiativeId, support: true, voter: 0 }, nonce: 2 }
    });

    for (let i = 0; i < 3; i++) {
      const res = await runner.processBlock(server);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      server = res.value;
    }

    const entity2 = getEntityFromSigner(server, signer(0), id('dao'))!;
    const initiative2 = entity2.data.initiatives.get(initiativeId)!;
    expect(initiative2.status).toBe('passed');
  });
});