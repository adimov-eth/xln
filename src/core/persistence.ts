// Persistence layer using LevelDB for WAL and snapshots
import { Level } from 'level';
import type { ServerState, ServerBlock, EntityState, EntityBlock } from '../types';

// Database instances
const serverBlocksDb = new Level<string, ServerBlock>('./data/history/server_blocks', { valueEncoding: 'json' });
const entityBlocksDb = new Level<string, EntityBlock>('./data/history/entity_blocks', { valueEncoding: 'json' });
const serverStateDb = new Level<string, any>('./data/state/server', { valueEncoding: 'json' });
const entityStateDb = new Level<string, EntityState>('./data/state/entities', { valueEncoding: 'json' });

// Save a server block to history (WAL)
export async function saveServerBlock(block: ServerBlock): Promise<void> {
  await serverBlocksDb.put(block.height.toString().padStart(10, '0'), block);
}

// Load server blocks in range
export async function loadServerBlocks(fromHeight: number, toHeight: number): Promise<ServerBlock[]> {
  const blocks: ServerBlock[] = [];
  const fromKey = fromHeight.toString().padStart(10, '0');
  const toKey = toHeight.toString().padStart(10, '0');
  
  for await (const [key, block] of serverBlocksDb.iterator({ gte: fromKey, lte: toKey })) {
    blocks.push(block);
  }
  
  return blocks;
}

// Save entity block to history
export async function saveEntityBlock(entityId: string, block: EntityBlock): Promise<void> {
  const key = `${entityId}/${block.height.toString().padStart(10, '0')}`;
  await entityBlocksDb.put(key, block);
}

// Load entity blocks for sync
export async function loadEntityBlocks(entityId: string, fromHeight: number): Promise<EntityBlock[]> {
  const blocks: EntityBlock[] = [];
  const prefix = `${entityId}/`;
  const fromKey = `${prefix}${fromHeight.toString().padStart(10, '0')}`;
  
  for await (const [key, block] of entityBlocksDb.iterator({ gte: fromKey })) {
    if (!key.startsWith(prefix)) break;
    blocks.push(block);
  }
  
  return blocks;
}

// Save server state snapshot
export async function saveServerSnapshot(state: ServerState): Promise<void> {
  // Convert Maps to serializable format
  const signersData: Record<number, Record<string, EntityState>> = {};
  
  for (const [signerIndex, entities] of state.signers) {
    signersData[signerIndex] = {};
    for (const [entityId, entityState] of entities) {
      signersData[signerIndex][entityId] = entityState;
    }
  }
  
  await serverStateDb.put('latest', {
    height: state.height,
    signers: signersData,
    mempool: state.mempool
  });
  
  // Also save individual entity states for faster access
  for (const [signerIndex, entities] of state.signers) {
    for (const [entityId, entityState] of entities) {
      await entityStateDb.put(`${signerIndex}:${entityId}`, entityState);
    }
  }
}

// Load server state from snapshot
export async function loadServerSnapshot(): Promise<ServerState | null> {
  try {
    const data = await serverStateDb.get('latest');
    
    // Validate data exists
    if (!data || !data.signers) {
      return null;
    }
    
    // Reconstruct Maps from serialized data
    const signers = new Map<number, Map<string, EntityState>>();
    
    for (const [signerIndex, entities] of Object.entries(data.signers)) {
      const entityMap = new Map<string, EntityState>();
      for (const [entityId, entityState] of Object.entries(entities as Record<string, EntityState>)) {
        entityMap.set(entityId, entityState);
      }
      signers.set(parseInt(signerIndex), entityMap);
    }
    
    return {
      height: data.height,
      signers,
      mempool: data.mempool
    };
  } catch (error: any) {
    if (error.code === 'LEVEL_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

// Load specific entity state
export async function loadEntityState(signerIndex: number, entityId: string): Promise<EntityState | null> {
  try {
    return await entityStateDb.get(`${signerIndex}:${entityId}`);
  } catch (error: any) {
    if (error.code === 'LEVEL_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

// Close all databases gracefully
export async function closeDatabases(): Promise<void> {
  await Promise.all([
    serverBlocksDb.close(),
    entityBlocksDb.close(),
    serverStateDb.close(),
    entityStateDb.close()
  ]);
}