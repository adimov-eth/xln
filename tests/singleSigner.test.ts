import { describe, test, expect } from 'bun:test';
import { 
  ServerState, Registry, EntityState, ServerTx,
  toEntityId, toSignerIdx, toBlockHeight, Ok
} from '../core/types/primitives';
import { processBlock } from '../core/server/processBlock';
import { MemoryKV } from '../storage/kvMemory';
import { createStorage } from '../storage/implementations';

// Helper to create initial server state
function createTestServer(): ServerState {
  const registry: Registry = new Map([
    [toEntityId('alice'), {
      id: toEntityId('alice'),
      quorum: [toSignerIdx(0)],
      proposer: toSignerIdx(0)
    }]
  ]);
  
  const aliceEntity: EntityState = {
    tag: 'Idle',
    height: toBlockHeight(0),
    state: { balance: 1000n },
    mempool: [],
    lastBlockHash: undefined
  };
  
  const signers = new Map([
    [toSignerIdx(0), new Map([
      [toEntityId('alice'), aliceEntity]
    ])]
  ]);
  
  return {
    height: toBlockHeight(0),
    registry,
    signers,
    mempool: []
  };
}

describe('Single Signer Happy Path', () => {
  test('should process add_tx and auto-propose for single signer', async () => {
    // Setup
    const kv = new MemoryKV();
    const storage = createStorage(kv);
    let server = createTestServer();
    
    // Add transaction to mempool
    const mintTx: ServerTx = {
      signer: toSignerIdx(0),
      entityId: toEntityId('alice'),
      input: { type: 'add_tx', tx: { op: 'mint', data: { amount: 500 } } }
    };
    
    server.mempool = [mintTx];
    
    // Process block 1 - should apply add_tx
    const result1 = await processBlock(server, storage);
    expect(result1.ok).toBe(true);
    if (!result1.ok) throw new Error('Block 1 failed');
    
    server = result1.value;
    
    // Verify state after block 1
    expect(server.height).toBe(1);
    expect(server.mempool.length).toBe(1); // Auto-propose tx added
    
    const alice1 = server.signers.get(toSignerIdx(0))?.get(toEntityId('alice'));
    expect(alice1?.tag).toBe('Idle');
    expect(alice1?.mempool.length).toBe(1);
    expect(alice1?.mempool[0]).toEqual({ op: 'mint', data: { amount: 500 } });
    
    // Process block 2 - should auto-propose and commit
    const result2 = await processBlock(server, storage);
    expect(result2.ok).toBe(true);
    if (!result2.ok) throw new Error('Block 2 failed');
    
    server = result2.value;
    
    // Verify final state
    expect(server.height).toBe(2);
    expect(server.mempool.length).toBe(0); // Clean after commit
    
    const alice2 = server.signers.get(toSignerIdx(0))?.get(toEntityId('alice'));
    expect(alice2?.tag).toBe('Idle');
    expect(alice2?.height).toBe(1); // Entity height incremented
    expect(alice2?.state.balance).toBe(1500n); // 1000 + 500
    expect(alice2?.mempool.length).toBe(0); // Mempool cleared
    expect(alice2?.lastBlockHash).toBeDefined(); // Block hash set
  });
  
  test('should handle transfer between entities', async () => {
    // Setup with two entities
    const kv = new MemoryKV();
    const storage = createStorage(kv);
    
    const registry: Registry = new Map([
      [toEntityId('alice'), {
        id: toEntityId('alice'),
        quorum: [toSignerIdx(0)],
        proposer: toSignerIdx(0)
      }],
      [toEntityId('bob'), {
        id: toEntityId('bob'),
        quorum: [toSignerIdx(1)],
        proposer: toSignerIdx(1)
      }]
    ]);
    
    const signers = new Map([
      [toSignerIdx(0), new Map([
        [toEntityId('alice'), {
          tag: 'Idle' as const,
          height: toBlockHeight(0),
          state: { balance: 1000n },
          mempool: []
        }]
      ])],
      [toSignerIdx(1), new Map([
        [toEntityId('bob'), {
          tag: 'Idle' as const,
          height: toBlockHeight(0),
          state: { balance: 0n },
          mempool: []
        }]
      ])]
    ]);
    
    let server: ServerState = {
      height: toBlockHeight(0),
      registry,
      signers,
      mempool: []
    };
    
    // Add transfer transaction
    const transferTx: ServerTx = {
      signer: toSignerIdx(0),
      entityId: toEntityId('alice'),
      input: { 
        type: 'add_tx', 
        tx: { op: 'transfer', data: { to: 'bob', amount: 300 } } 
      }
    };
    
    server.mempool = [transferTx];
    
    // Process multiple blocks to complete transfer
    for (let i = 0; i < 4; i++) {
      const result = await processBlock(server, storage);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`Block ${i + 1} failed`);
      server = result.value;
    }
    
    // Verify final balances
    const alice = server.signers.get(toSignerIdx(0))?.get(toEntityId('alice'));
    const bob = server.signers.get(toSignerIdx(1))?.get(toEntityId('bob'));
    
    expect(alice?.state.balance).toBe(700n); // 1000 - 300
    expect(bob?.state.balance).toBe(300n); // 0 + 300
  });
  
  test('should persist and recover state', async () => {
    // Setup
    const kv = new MemoryKV();
    const storage = createStorage(kv);
    let server = createTestServer();
    
    // Add and process transaction
    server.mempool = [{
      signer: toSignerIdx(0),
      entityId: toEntityId('alice'),
      input: { type: 'add_tx', tx: { op: 'mint', data: { amount: 100 } } }
    }];
    
    // Process two blocks
    let result = await processBlock(server, storage);
    if (!result.ok) throw new Error('Block 1 failed');
    server = result.value;
    
    result = await processBlock(server, storage);
    if (!result.ok) throw new Error('Block 2 failed');
    server = result.value;
    
    // Save state
    await storage.state.save(server);
    
    // Load state
    const loaded = await storage.state.load();
    expect(loaded).toBeTruthy();
    
    if (loaded) {
      expect(loaded.height).toBe(2);
      const alice = loaded.signers.get(toSignerIdx(0))?.get(toEntityId('alice'));
      expect(alice?.state.balance).toBe(1100n);
    }
  });
});