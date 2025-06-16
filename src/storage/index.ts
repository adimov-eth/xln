import type { ArchiveStorage, BlockHeight, BlockStorage, KV, Registry, ServerState, ServerTx, StateStorage, Storage, WalStorage } from '../types';
import { toBlockHeight, toEntityId, toSignerIdx } from '../types';

// Storage interfaces using the KV abstraction



// Key helpers
const pad = (n: number | BlockHeight) => n.toString().padStart(10, '0');

export const keys = {
  state: (signer: number, entityId: string) => `state:${signer}:${entityId}`,
  registry: () => 'state:registry',
  meta: () => 'state:meta',
  wal: (height: BlockHeight, signer: number, entityId: string) => 
    `wal:${pad(height)}:${signer}:${entityId}`,
  walRegistry: (height: BlockHeight, id: string) => 
    `wal:reg:${pad(height)}:${id}`,
  block: (height: BlockHeight) => `block:${pad(height)}`,
  archive: (hash: string) => `archive:${hash}`,
};



// State storage implementation
export class StateStorageImpl implements StateStorage {
  constructor(private kv: KV) {}
  
  async save(state: ServerState): Promise<void> {
    const batch: { type: 'put' | 'del'; key: string; value?: string }[] = [];
    
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
          key: keys.state(Number(signerIdx), entityId),
          value: JSON.stringify({
            ...entity,
            ...(entity.tag !== 'Faulted' && entity.state && {
              state: { ...entity.state, balance: entity.state?.balance?.toString() }
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
    
    await this.kv.batch(batch);
  }
  
  async load(): Promise<ServerState | null> {
    try {
      const heightStr = await this.kv.get(keys.meta());
      if (!heightStr) return null;
      
      const height = toBlockHeight(parseInt(heightStr));
      
      // Load registry
      const registryData = await this.kv.get(keys.registry());
      const registry: Registry = new Map(JSON.parse(registryData || '[]').map(([id, meta]: [string, any]) => [
        toEntityId(id),
        { ...meta, id: toEntityId(id), quorum: meta.quorum.map(toSignerIdx), proposer: toSignerIdx(meta.proposer) }
      ]));
      
      // Load entities
      const signers = new Map();
      
      for await (const [key, value] of this.kv.iterator({ gte: 'state:', lt: 'state:\\xff' })) {
        if (key === keys.registry() || key === keys.meta()) continue;
        
        const parts = key.split(':');
        if (parts.length !== 3) continue;
        
        const signerIdx = toSignerIdx(parseInt(parts[1]!));
        const entityId = toEntityId(parts[2]!);
        
        if (!signers.has(signerIdx)) {
          signers.set(signerIdx, new Map());
        }
        
        const entityData = JSON.parse(value);
        const entity = {
          ...entityData,
          state: entityData.state ? {
            ...entityData.state,
            balance: entityData.state.balance ? BigInt(entityData.state.balance) : 0n
          } : undefined
        };
        
        signers.get(signerIdx)!.set(entityId, entity);
      }
      
      return { height, registry, signers, mempool: [] };
    } catch (err) {
      return null;
    }
  }
}

// WAL storage implementation
export class WalStorageImpl implements WalStorage {
  constructor(private kv: KV) {}
  
  async append(height: BlockHeight, txs: ServerTx[]): Promise<void> {
    const batch: { type: 'put'; key: string; value: string }[] = [];
    
    for (const tx of txs) {
      batch.push({
        type: 'put',
        key: keys.wal(height, Number(tx.signer), tx.entityId),
        value: JSON.stringify(tx)
      });
    }
    
    await this.kv.batch(batch);
  }
  
  async getFromHeight(height: BlockHeight): Promise<ServerTx[]> {
    const txs: ServerTx[] = [];
    const pad = (n: number) => n.toString().padStart(10, '0');
    
    for await (const [key, value] of this.kv.iterator({
      gte: `wal:${pad(Number(height))}:`,
      lt: 'wal:\\xff'
    })) {
      try {
        const tx = JSON.parse(value);
        txs.push({
          signer: toSignerIdx(tx.signer),
          entityId: toEntityId(tx.entityId),
          input: tx.input
        });
      } catch (err) {
        console.debug(`Failed to parse WAL entry ${key}:`, err);
      }
    }
    
    return txs;
  }
  
  async truncateBefore(height: BlockHeight): Promise<void> {
    const batch: { type: 'del'; key: string }[] = [];
    const pad = (n: number) => n.toString().padStart(10, '0');
    
    for await (const [key] of this.kv.iterator({
      gte: 'wal:',
      lt: `wal:${pad(Number(height))}:`
    })) {
      batch.push({ type: 'del', key });
    }
    
    await this.kv.batch(batch);
  }
}

// Block storage implementation
export class BlockStorageImpl implements BlockStorage {
  constructor(private kv: KV) {}
  
  async save(height: BlockHeight, data: any): Promise<void> {
    await this.kv.put(keys.block(height), JSON.stringify(data));
  }
  
  async get(height: BlockHeight): Promise<any> {
    const data = await this.kv.get(keys.block(height));
    return data ? JSON.parse(data) : null;
  }
}

// Archive storage implementation
export class ArchiveStorageImpl implements ArchiveStorage {
  constructor(private kv: KV) {}
  
  async save(hash: string, snapshot: any): Promise<void> {
    await this.kv.put(keys.archive(hash), JSON.stringify(snapshot));
  }
  
  async get(hash: string): Promise<any> {
    const data = await this.kv.get(keys.archive(hash));
    return data ? JSON.parse(data) : null;
  }
}

// Create storage instance
export function createStorage(kv: KV): Storage {
  return {
    state: new StateStorageImpl(kv),
    wal: new WalStorageImpl(kv),
    blocks: new BlockStorageImpl(kv),
    archive: new ArchiveStorageImpl(kv),
    refs: kv
  };
}


// In-memory key-value store for testing

  
  export class MemoryKV implements KV {
    private store: Map<string, string> = new Map();
    
    async get(key: string): Promise<string | undefined> {
      return this.store.get(key);
    }
    
    async put(key: string, val: string): Promise<void> {
      this.store.set(key, val);
    }
    
    async del(key: string): Promise<void> {
      this.store.delete(key);
    }
    
    async batch(ops: { type: 'put' | 'del'; key: string; value?: string }[]): Promise<void> {
      for (const op of ops) {
        if (op.type === 'put' && op.value !== undefined) {
          this.store.set(op.key, op.value);
        } else if (op.type === 'del') {
          this.store.delete(op.key);
        }
      }
    }
    
    async *iterator(options?: { gte?: string; lt?: string }): AsyncIterable<[string, string]> {
      const entries = Array.from(this.store.entries())
        .sort(([a], [b]) => a.localeCompare(b));
      
      for (const [key, value] of entries) {
        if (options?.gte && key < options.gte) continue;
        if (options?.lt && key >= options.lt) break;
        yield [key, value];
      }
    }
    
    // Helper methods for testing
    clear(): void {
      this.store.clear();
    }
    
    size(): number {
      return this.store.size;
    }
    
    entries(): [string, string][] {
      return Array.from(this.store.entries());
    }
  }