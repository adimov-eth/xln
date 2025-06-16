import type {
  ArchiveStorage,
  BlockStorage,
  KV,
  Registry,
  ServerState,
  ServerTx,
  StateStorage,
  Storage as StorageInterface,
  WalStorage,
  EntityId
} from '../types';
import { toBlockHeight, toEntityId, toSignerIdx } from '../types';
import { keys, keyPrefixes } from './keys';

// Helper to serialize BigInt values as strings
function serializeBigInts(obj: any): any {
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInts);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}

// Helper to deserialize string values back to BigInt
function deserializeBigInts(obj: any, schema: any): any {
  if (schema && typeof schema.balance === 'bigint' && typeof obj.balance === 'string') {
    return { ...obj, balance: BigInt(obj.balance) };
  }
  return obj;
}

/**
 * Factory for state storage
 */
export function createStateStorage(kv: KV): StateStorage {
  return {
    async save(state: ServerState) {
      const batch: Array<{ type: 'put' | 'del'; key: string; value?: string }> = [];
      
      // Save registry
      batch.push({
        type: 'put',
        key: keys.registry(),
        value: JSON.stringify([...state.registry])
      });
      
      // Save entities
      for (const [entityId, entity] of state.entities) {
        // Convert BigInt values to strings for serialization
        const serializable = {
          ...entity,
          ...(entity.tag !== 'Faulted' && entity.state && {
            state: serializeBigInts(entity.state)
          })
        };
        
        batch.push({
          type: 'put',
          key: keys.entity(entityId),
          value: JSON.stringify(serializable)
        });
      }
      
      // Save metadata
      batch.push({
        type: 'put',
        key: keys.meta(),
        value: state.height.toString()
      });
      
      await kv.batch(batch);
    },

    async load() {
      const heightStr = await kv.get(keys.meta());
      if (!heightStr) return null;
      
      const height = toBlockHeight(parseInt(heightStr, 10));
      
      // Load registry
      const registryData = await kv.get(keys.registry()) || '[]';
      const registry: Registry = new Map(
        JSON.parse(registryData).map(([id, meta]: [string, any]) => [
          toEntityId(id),
          { 
            id: toEntityId(id), 
            quorum: meta.quorum.map(toSignerIdx), 
            timeoutMs: meta.timeoutMs 
          }
        ])
      );
      
      // Load entities
      const entities = new Map<EntityId, any>();
      
      for await (const [key, value] of kv.iterator({ 
        gte: 'entity:', 
        lt: 'entity:\xff' 
      })) {
        const [, entityId] = key.split(':');
        if (!entityId) continue;
        
        const data = JSON.parse(value);
        const entity = {
          ...data,
          state: data.state && data.state.balance !== undefined
            ? deserializeBigInts(data.state, { balance: 0n })
            : data.state
        };
        
        entities.set(toEntityId(entityId), entity);
      }
      
      return { height, registry, entities, mempool: [] };
    }
  };
}

/**
 * Factory for WAL storage
 */
export function createWalStorage(kv: KV): WalStorage {
  return {
    async append(height, txs) {
      const batch: Array<{ type: 'put'; key: string; value: string }> = [];
      
      for (const tx of txs) {
        batch.push({
          type: 'put',
          key: keys.wal(height, tx.signer, tx.entityId),
          value: JSON.stringify(tx)
        });
      }
      
      await kv.batch(batch);
    },

    async getFromHeight(height) {
      const txs: ServerTx[] = [];
      const startKey = keys.wal(height, toSignerIdx(0), toEntityId(''));
      const prefix = startKey.substring(0, startKey.lastIndexOf(':') + 1);
      
      for await (const [, val] of kv.iterator({ 
        gte: prefix, 
        lt: keyPrefixes.wal + '\xff' 
      })) {
        const tx = JSON.parse(val);
        txs.push({
          signer: toSignerIdx(tx.signer),
          entityId: toEntityId(tx.entityId),
          input: tx.input
        });
      }
      
      return txs;
    },

    async truncateBefore(height) {
      const batch: Array<{ type: 'del'; key: string }> = [];
      const endKey = keys.wal(height, toSignerIdx(0), toEntityId(''));
      const prefix = endKey.substring(0, endKey.lastIndexOf(':') + 1);
      
      for await (const [key] of kv.iterator({ 
        gte: keyPrefixes.wal, 
        lt: prefix 
      })) {
        batch.push({ type: 'del', key });
      }
      
      await kv.batch(batch);
    }
  };
}

/**
 * Factory for block storage
 */
export function createBlockStorage(kv: KV): BlockStorage {
  return {
    async save(height, data) {
      // Serialize BigInts in the data before saving
      const serializable = serializeBigInts(data);
      await kv.put(keys.block(height), JSON.stringify(serializable));
    },
    
    async get(height) {
      const raw = await kv.get(keys.block(height));
      return raw ? JSON.parse(raw) : null;
    }
  };
}

/**
 * Factory for archive storage
 */
export function createArchiveStorage(kv: KV): ArchiveStorage {
  return {
    async save(hash, snapshot) {
      await kv.put(keys.archive(hash), JSON.stringify(snapshot));
    },
    
    async get(hash) {
      const raw = await kv.get(keys.archive(hash));
      return raw ? JSON.parse(raw) : null;
    }
  };
}

/**
 * Factory for reference storage (simple KV wrapper with ref: prefix)
 */
export function createRefStorage(kv: KV): KV {
  return {
    async get(name) {
      return kv.get(keys.ref(name));
    },
    
    async put(name, value) {
      await kv.put(keys.ref(name), value);
    },
    
    async del(name) {
      await kv.del(keys.ref(name));
    },
    
    async batch(ops) {
      const prefixedOps = ops.map(op => ({
        ...op,
        key: keys.ref(op.key)
      }));
      await kv.batch(prefixedOps);
    },
    
    async *iterator(options) {
      const prefixedOptions = options ? {
        gte: options.gte ? keys.ref(options.gte) : keyPrefixes.ref,
        lt: options.lt ? keys.ref(options.lt) : keyPrefixes.ref + '\xff'
      } : {
        gte: keyPrefixes.ref,
        lt: keyPrefixes.ref + '\xff'
      };
      
      for await (const [key, value] of kv.iterator(prefixedOptions)) {
        // Strip ref: prefix
        yield [key.substring(4), value];
      }
    }
  };
}

/**
 * Assemble the full Storage interface
 */
export function createStorage(kv: KV): StorageInterface {
  return {
    state: createStateStorage(kv),
    wal: createWalStorage(kv),
    blocks: createBlockStorage(kv),
    archive: createArchiveStorage(kv),
    refs: createRefStorage(kv)
  };
}

// Export the MemoryKV implementation separately
export { MemoryKV } from './memory';

// Re-export keys for convenience
export { keys, keyPrefixes } from './keys';

// Re-export Storage type
export type { Storage } from '../types';