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
  BlockHeight,
  EntityId,
  SignerIdx
} from '../types';
import { toBlockHeight, toEntityId, toSignerIdx } from '../types';
import { keys, keyPrefixes } from './keys';

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
      for (const [signerIdx, entities] of state.signers) {
        for (const [entityId, entity] of entities) {
          batch.push({
            type: 'put',
            key: keys.state(signerIdx, entityId),
            value: JSON.stringify({
              ...entity,
              ...(entity.tag !== 'Faulted' && entity.state && {
                state: { ...entity.state, balance: entity.state.balance.toString() }
              })
            })
          });
        }
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
      const signers = new Map<SignerIdx, Map<EntityId, any>>();
      
      for await (const [key, value] of kv.iterator({ 
        gte: keyPrefixes.state, 
        lt: keyPrefixes.state + '\xff' 
      })) {
        if (key === keys.registry() || key === keys.meta()) continue;
        
        const [, signerStr, entityId] = key.split(':');
        if (!signerStr || !entityId) continue;
        
        const signerIdx = toSignerIdx(parseInt(signerStr, 10));
        
        if (!signers.has(signerIdx)) {
          signers.set(signerIdx, new Map());
        }
        
        const data = JSON.parse(value);
        const entity = {
          ...data,
          state: data.state
            ? { ...data.state, balance: BigInt(data.state.balance) }
            : undefined
        };
        
        signers.get(signerIdx)!.set(toEntityId(entityId), entity);
      }
      
      return { height, registry, signers, mempool: [] };
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
      
      for await (const [key, val] of kv.iterator({ 
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
      await kv.put(keys.block(height), JSON.stringify(data));
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