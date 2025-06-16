import { BlockHeight, Registry, ServerState, ServerTx, toBlockHeight, toEntityId, toSignerIdx } from '../core/types/primitives';
import { ArchiveStorage, BlockStorage, StateStorage, Storage, WalStorage, keys } from './interfaces';
import { KV } from './kvMemory';

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
        
        const signerIdx = toSignerIdx(parseInt(parts[1]));
        const entityId = toEntityId(parts[2]);
        
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