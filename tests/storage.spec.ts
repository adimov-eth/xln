import { 
  createStorage, 
  createStateStorage,
  createWalStorage,
  createBlockStorage,
  createArchiveStorage,
  keys,
  keyPrefixes
} from '../src/storage';
import { MemoryKV } from '../src/storage/memory';
import { MockKV } from '../src/storage/mock';
import { 
  createServerState, 
  createRegistry, 
  registerEntity,
  createEntity,
  addEntityToServer
} from '../src/core/server';
import { 
  toBlockHeight, 
  toEntityId, 
  toSignerIdx 
} from '../src/types/primitives';
import type { ServerTx } from '../src/types';

describe('Storage Layer', () => {
  let kv: MemoryKV;
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    kv = new MemoryKV();
    storage = createStorage(kv);
  });

  describe('MemoryKV', () => {
    it('should perform basic operations', async () => {
      await kv.put('test', 'value');
      expect(await kv.get('test')).toBe('value');
      
      await kv.del('test');
      expect(await kv.get('test')).toBeUndefined();
    });

    it('should handle batch operations', async () => {
      await kv.batch([
        { type: 'put', key: 'a', value: '1' },
        { type: 'put', key: 'b', value: '2' },
        { type: 'del', key: 'c' }
      ]);
      
      expect(await kv.get('a')).toBe('1');
      expect(await kv.get('b')).toBe('2');
      expect(await kv.get('c')).toBeUndefined();
    });

    it('should iterate in lexicographic order', async () => {
      await kv.batch([
        { type: 'put', key: 'b', value: '2' },
        { type: 'put', key: 'a', value: '1' },
        { type: 'put', key: 'c', value: '3' }
      ]);
      
      const entries: [string, string][] = [];
      for await (const entry of kv.iterator()) {
        entries.push(entry);
      }
      
      expect(entries).toEqual([
        ['a', '1'],
        ['b', '2'],
        ['c', '3']
      ]);
    });

    it('should respect iterator bounds', async () => {
      await kv.batch([
        { type: 'put', key: 'a', value: '1' },
        { type: 'put', key: 'b', value: '2' },
        { type: 'put', key: 'c', value: '3' },
        { type: 'put', key: 'd', value: '4' }
      ]);
      
      const entries: [string, string][] = [];
      for await (const entry of kv.iterator({ gte: 'b', lt: 'd' })) {
        entries.push(entry);
      }
      
      expect(entries).toEqual([
        ['b', '2'],
        ['c', '3']
      ]);
    });
  });

  describe('Key naming', () => {
    it('should generate consistent keys', () => {
      const signer = toSignerIdx(1);
      const entity = toEntityId('test');
      const height = toBlockHeight(42);
      
      expect(keys.state(signer, entity)).toBe('state:1:test');
      expect(keys.registry()).toBe('state:registry');
      expect(keys.meta()).toBe('state:meta');
      expect(keys.wal(height, signer, entity)).toBe('wal:0000000042:1:test');
      expect(keys.block(height)).toBe('block:0000000042');
      expect(keys.archive('hash123')).toBe('archive:hash123');
      expect(keys.ref('HEAD')).toBe('ref:HEAD');
    });
  });

  describe('StateStorage', () => {
    let stateStorage: ReturnType<typeof createStateStorage>;

    beforeEach(() => {
      stateStorage = createStateStorage(kv);
    });

    it('should save and load server state', async () => {
      // Create a server state
      const registry = registerEntity(
        createRegistry(), 
        'alice', 
        [toSignerIdx(0), toSignerIdx(1)]
      );
      
      let server = createServerState(toBlockHeight(10), registry);
      
      const aliceEntity = createEntity<{ balance: bigint }>(
        toBlockHeight(10), 
        { balance: 1000n }
      );
      
      server = addEntityToServer(
        server,
        toEntityId('alice'),
        registry.get(toEntityId('alice'))!,
        aliceEntity
      );
      
      // Save state
      await stateStorage.save(server);
      
      // Load state
      const loaded = await stateStorage.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.height).toEqual(toBlockHeight(10));
      expect(loaded!.registry.size).toBe(1);
      
      const loadedEntity = loaded!.signers.get(toSignerIdx(0))?.get(toEntityId('alice'));
      expect(loadedEntity).toBeDefined();
      expect(loadedEntity.state.balance).toBe(1000n);
    });

    it('should return null for empty storage', async () => {
      const loaded = await stateStorage.load();
      expect(loaded).toBeNull();
    });
  });

  describe('WalStorage', () => {
    let walStorage: ReturnType<typeof createWalStorage>;

    beforeEach(() => {
      walStorage = createWalStorage(kv);
    });

    it('should append and retrieve transactions', async () => {
      const txs: ServerTx[] = [
        {
          signer: toSignerIdx(0),
          entityId: toEntityId('alice'),
          input: { type: 'add_tx', tx: { op: 'mint', data: { amount: '100' } } }
        },
        {
          signer: toSignerIdx(1),
          entityId: toEntityId('alice'),
          input: { type: 'add_tx', tx: { op: 'burn', data: { amount: '50' } } }
        }
      ];
      
      await walStorage.append(toBlockHeight(5), txs);
      
      const retrieved = await walStorage.getFromHeight(toBlockHeight(5));
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0]).toEqual(txs[0]);
      expect(retrieved[1]).toEqual(txs[1]);
    });

    it('should retrieve transactions from specific height', async () => {
      // Add transactions at different heights
      await walStorage.append(toBlockHeight(1), [{
        signer: toSignerIdx(0),
        entityId: toEntityId('alice'),
        input: { type: 'add_tx', tx: { op: 'mint', data: { amount: '100' } } }
      }]);
      
      await walStorage.append(toBlockHeight(2), [{
        signer: toSignerIdx(1),
        entityId: toEntityId('alice'),
        input: { type: 'add_tx', tx: { op: 'burn', data: { amount: '50' } } }
      }]);
      
      const fromHeight2 = await walStorage.getFromHeight(toBlockHeight(2));
      expect(fromHeight2).toHaveLength(1);
      expect(fromHeight2[0]!.input.tx.op).toBe('burn');
    });

    it('should truncate entries before height', async () => {
      // Add transactions at multiple heights
      for (let h = 1; h <= 5; h++) {
        await walStorage.append(toBlockHeight(h), [{
          signer: toSignerIdx(0),
          entityId: toEntityId('test'),
          input: { type: 'add_tx', tx: { op: 'mint', data: { amount: String(h) } } }
        }]);
      }
      
      // Truncate before height 3
      await walStorage.truncateBefore(toBlockHeight(3));
      
      // Check what remains
      const all = await walStorage.getFromHeight(toBlockHeight(1));
      expect(all).toHaveLength(3); // Heights 3, 4, 5
      expect(all[0]!.input.tx.data.amount).toBe('3');
    });
  });

  describe('BlockStorage', () => {
    let blockStorage: ReturnType<typeof createBlockStorage>;

    beforeEach(() => {
      blockStorage = createBlockStorage(kv);
    });

    it('should save and retrieve blocks', async () => {
      const blockData = {
        height: toBlockHeight(10),
        timestamp: Date.now(),
        transactions: [],
        stateHash: 'hash123',
        messages: []
      };
      
      await blockStorage.save(toBlockHeight(10), blockData);
      
      const retrieved = await blockStorage.get(toBlockHeight(10));
      expect(retrieved).toEqual(blockData);
    });

    it('should return null for non-existent blocks', async () => {
      const retrieved = await blockStorage.get(toBlockHeight(999));
      expect(retrieved).toBeNull();
    });
  });

  describe('ArchiveStorage', () => {
    let archiveStorage: ReturnType<typeof createArchiveStorage>;

    beforeEach(() => {
      archiveStorage = createArchiveStorage(kv);
    });

    it('should save and retrieve snapshots', async () => {
      const snapshot = {
        height: toBlockHeight(100),
        timestamp: Date.now(),
        stateRoot: 'root123',
        parentHash: 'parent456',
        signers: []
      };
      
      await archiveStorage.save('hash789', snapshot);
      
      const retrieved = await archiveStorage.get('hash789');
      expect(retrieved).toEqual(snapshot);
    });
  });

  describe('RefStorage', () => {
    it('should store references with prefix', async () => {
      await storage.refs.put('HEAD', 'hash123');
      expect(await storage.refs.get('HEAD')).toBe('hash123');
      
      // Check actual key in underlying store
      expect(await kv.get('ref:HEAD')).toBe('hash123');
    });

    it('should iterate only ref entries', async () => {
      // Mix different key types
      await kv.put('state:test', 'value1');
      await storage.refs.put('HEAD', 'hash1');
      await storage.refs.put('TAIL', 'hash2');
      await kv.put('block:123', 'value2');
      
      const refs: [string, string][] = [];
      for await (const entry of storage.refs.iterator()) {
        refs.push(entry);
      }
      
      expect(refs).toEqual([
        ['HEAD', 'hash1'],
        ['TAIL', 'hash2']
      ]);
    });
  });

  describe('Full storage integration', () => {
    it('should handle complete save/load cycle', async () => {
      // Create complex server state
      let registry = createRegistry();
      registry = registerEntity(registry, 'vault', [toSignerIdx(0), toSignerIdx(1)]);
      registry = registerEntity(registry, 'pool', [toSignerIdx(2)]);
      
      let server = createServerState(toBlockHeight(50), registry);
      
      // Add entities
      server = addEntityToServer(
        server,
        toEntityId('vault'),
        registry.get(toEntityId('vault'))!,
        createEntity(toBlockHeight(50), { balance: 5000n })
      );
      
      server = addEntityToServer(
        server,
        toEntityId('pool'),
        registry.get(toEntityId('pool'))!,
        createEntity(toBlockHeight(50), { balance: 10000n })
      );
      
      // Save everything
      await storage.state.save(server);
      
      // Add some WAL entries
      await storage.wal.append(toBlockHeight(51), [
        {
          signer: toSignerIdx(0),
          entityId: toEntityId('vault'),
          input: { type: 'add_tx', tx: { op: 'mint', data: { amount: '100' } } }
        }
      ]);
      
      // Save a block
      await storage.blocks.save(toBlockHeight(50), {
        height: toBlockHeight(50),
        transactions: [],
        stateHash: 'hash50'
      });
      
      // Clear and reload
      const newKv = new MemoryKV();
      // Copy all data
      for (const [k, v] of kv.entries()) {
        await newKv.put(k, v);
      }
      
      const newStorage = createStorage(newKv);
      const loaded = await newStorage.state.load();
      
      expect(loaded).not.toBeNull();
      expect(loaded!.height).toEqual(toBlockHeight(50));
      expect(loaded!.registry.size).toBe(2);
      
      const walTxs = await newStorage.wal.getFromHeight(toBlockHeight(51));
      expect(walTxs).toHaveLength(1);
      
      const block = await newStorage.blocks.get(toBlockHeight(50));
      expect(block).not.toBeNull();
      expect(block.stateHash).toBe('hash50');
    });
  });

  describe('MockKV error handling', () => {
    let mockKv: MockKV;
    let errorStorage: ReturnType<typeof createStorage>;

    beforeEach(() => {
      mockKv = new MockKV();
      errorStorage = createStorage(mockKv);
    });

    it('should simulate operation failures', async () => {
      const error = new Error('Disk full');
      mockKv.failOn('put', error);
      
      await expect(errorStorage.refs.put('test', 'value'))
        .rejects.toThrow('Disk full');
    });

    it('should simulate key-specific failures', async () => {
      const error = new Error('Corrupted sector');
      mockKv.failOnKey('state:', error);
      
      // This should work
      await errorStorage.refs.put('HEAD', 'hash');
      
      // This should fail
      const server = createServerState(toBlockHeight(1), new Map());
      await expect(errorStorage.state.save(server))
        .rejects.toThrow('Corrupted sector');
    });

    it('should handle WAL write failures gracefully', async () => {
      const error = new Error('Write failed');
      mockKv.failOnKey(/^wal:/, error);
      
      const txs: ServerTx[] = [{
        signer: toSignerIdx(0),
        entityId: toEntityId('test'),
        input: { type: 'add_tx', tx: { op: 'mint', data: { amount: '100' } } }
      }];
      
      await expect(errorStorage.wal.append(toBlockHeight(1), txs))
        .rejects.toThrow('Write failed');
    });
  });
});