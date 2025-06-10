import { Buffer } from 'buffer';
import { Level } from 'level';
import * as enc from './encoding';
import * as t from './types';

export interface StorageConfig {
  stateDbPath: string;
  serverBlocksPath: string;
  entityBlocksPath: string;
  snapshotInterval: number; 
}

const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  stateDbPath: './db/state',
  serverBlocksPath: './db/server_blocks',
  entityBlocksPath: './db/entity_blocks',
  snapshotInterval: 100
};


export class StorageManager {
  private stateDb: Level<string, Buffer>;
  private serverBlocksDb: Level<string, Buffer>;
  private entityBlocksDb: Level<string, Buffer>;
  private config: StorageConfig;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    
    this.stateDb = new Level(this.config.stateDbPath, {
      keyEncoding: 'utf8',
      valueEncoding: 'binary'
    });
    
    this.serverBlocksDb = new Level(this.config.serverBlocksPath, {
      keyEncoding: 'utf8',
      valueEncoding: 'binary'
    });
    
    this.entityBlocksDb = new Level(this.config.entityBlocksPath, {
      keyEncoding: 'utf8',
      valueEncoding: 'binary'
    });
  }

  async open(): Promise<void> {
    await Promise.all([
      this.stateDb.open(),
      this.serverBlocksDb.open(),
      this.entityBlocksDb.open()
    ]);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.stateDb.close(),
      this.serverBlocksDb.close(),
      this.entityBlocksDb.close()
    ]);
  }

  async saveServerState(state: t.ServerState): Promise<void> {
    const batch = this.stateDb.batch();
    
    // Save server root
    const serverRoot = {
      height: state.height,
      stateRoot: enc.hashServerState(state),
      timestamp: Date.now()
    };
    batch.put('root', Buffer.from(enc.encode([
      serverRoot.height,
      Buffer.from(serverRoot.stateRoot, 'hex'),
      serverRoot.timestamp
    ])));
    
    // Save each entity state
    for (const [signerId, entities] of state.entities) {
      for (const [entityId, entityState] of entities) {
        const key = `${signerId}/${entityId}`;
        batch.put(key, encodeEntityState(entityState));
      }
    }
    
    await batch.write();
  }

  async loadServerState(): Promise<t.Result<t.ServerState>> {
    try {
      let height = 0;
      
      // Load server root
      try {
        const rootData = await this.stateDb.get('root');
        const decoded = enc.decode(rootData) as any[];
        const heightData = decoded[0];
        height = typeof heightData === 'number' 
            ? heightData 
            : parseInt(Buffer.from(heightData).toString('hex') || '0', 16);
      } catch (error: any) {
        if (error.code !== 'LEVEL_NOT_FOUND') throw error;
        // No root means fresh state
      }
      
      const entities = new Map<t.SignerId, Map<t.EntityId, t.EntityState>>();
      
      // Load all entity states
      for await (const [key, value] of this.stateDb.iterator()) {
        if (key === 'root') continue; // Skip root
        
        const [signerId, entityId] = key.split('/');
        if (!signerId || !entityId) continue;
        
        const entityResult = decodeEntityState(value);
        if (!entityResult.ok) {
          return { ok: false, error: entityResult.error };
        }
        
        // Get or create signer map
        let signerEntities = entities.get(signerId);
        if (!signerEntities) {
          signerEntities = new Map();
          entities.set(signerId, signerEntities);
        }
        
        signerEntities.set(entityId, entityResult.value);
      }
      
      return { 
        ok: true, 
        value: {
          height,
          mempool: new Map(),
          entities
        } 
      };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }


  async saveServerBlock(block: t.ServerBlock): Promise<void> {
    const key = padBlockNumber(block.height);
    const value = enc.encodeServerBlock(block);
    await this.serverBlocksDb.put(key, value);
  }

  async loadServerBlock(height: number): Promise<t.Result<t.ServerBlock>> {
    try {
      const key = padBlockNumber(height);
      const data = await this.serverBlocksDb.get(key);
      return decodeServerBlock(data);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return { ok: false, error: new Error(`Block ${height} not found`) };
      }
      return { ok: false, error };
    }
  }

  async *iterateServerBlocks(fromHeight: number = 0): AsyncGenerator<t.ServerBlock> {
    const startKey = padBlockNumber(fromHeight);
    
    for await (const [key, value] of this.serverBlocksDb.iterator({ gte: startKey })) {
      const result = decodeServerBlock(value);
      if (result.ok) {
        yield result.value;
      }
    }
  }


  async saveEntityBlock(
    signerId: t.SignerId,
    entityId: t.EntityId,
    block: t.EntityBlock
  ): Promise<void> {
    const key = `${signerId}/${entityId}/${padBlockNumber(block.height)}`;
    const value = enc.encodeEntityBlock(block);
    await this.entityBlocksDb.put(key, value);
  }

  async loadEntityBlock(
    signerId: t.SignerId,
    entityId: t.EntityId,
    height: number
  ): Promise<t.Result<t.EntityBlock>> {
    try {
      const key = `${signerId}/${entityId}/${padBlockNumber(height)}`;
      const data = await this.entityBlocksDb.get(key);
      return decodeEntityBlock(data);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return { ok: false, error: new Error(`Entity block ${height} not found`) };
      }
      return { ok: false, error };
    }
  }

  async *iterateEntityBlocks(
    signerId: t.SignerId,
    entityId: t.EntityId,
    fromHeight: number = 0
  ): AsyncGenerator<t.EntityBlock> {
    const prefix = `${signerId}/${entityId}/`;
    const startKey = `${prefix}${padBlockNumber(fromHeight)}`;
    
    for await (const [key, value] of this.entityBlocksDb.iterator({ 
      gte: startKey,
      lte: `${prefix}\xff`
    })) {
      const result = decodeEntityBlock(value);
      if (result.ok) {
        yield result.value;
      }
    }
  }

  async getLatestServerBlock(): Promise<t.Result<t.ServerBlock | null>> {
    try {
      let latestBlock: t.ServerBlock | null = null;
      
      // Iterate in reverse to find the latest block
      for await (const [key, value] of this.serverBlocksDb.iterator({ reverse: true, limit: 1 })) {
        const result = decodeServerBlock(value);
        if (result.ok) {
          latestBlock = result.value;
        }
      }
      
      return { ok: true, value: latestBlock };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      this.stateDb.clear(),
      this.serverBlocksDb.clear(),
      this.entityBlocksDb.clear()
    ]);
  }
}


function padBlockNumber(height: number): string {
  return height.toString().padStart(12, '0');
}

function encodeEntityState(state: t.EntityState): Buffer {
  return Buffer.from(enc.encode([
    state.status,
    enc.encodeEntityStorage(state.storage),
    state.mempool.map(tx => enc.encodeEntityTx(tx)),
    state.lastBlock ? enc.encodeEntityBlock(state.lastBlock) : Buffer.from([]),
    state.proposedBlock ? enc.encodeEntityBlock(state.proposedBlock) : Buffer.from([]),
    state.height
  ]));
}

function decodeEntityState(data: Buffer): t.Result<t.EntityState> {
  try {
    const decoded = enc.decode(data) as any[];
    const [status, storageData, mempoolData, lastBlockData, proposedBlockData, heightData] = decoded;
    
    // Decode storage
    const storageResult = enc.decodeEntityStorage(storageData);
    if (!storageResult.ok) return storageResult;
    
    // Decode mempool
    const mempool: t.EntityTx[] = [];
    for (const txData of mempoolData) {
      const txResult = enc.decodeEntityTx(txData);
      if (!txResult.ok) return txResult;
      mempool.push(txResult.value);
    }
    
    // Decode blocks if present
    let lastBlock: t.EntityBlock | undefined;
    if (lastBlockData && Buffer.isBuffer(lastBlockData) && lastBlockData.length > 0) {
      const blockResult = decodeEntityBlock(lastBlockData);
      if (!blockResult.ok) return blockResult;
      lastBlock = blockResult.value;
    }
    
    let proposedBlock: t.EntityBlock | undefined;
    if (proposedBlockData && Buffer.isBuffer(proposedBlockData) && proposedBlockData.length > 0) {
      const blockResult = decodeEntityBlock(proposedBlockData);
      if (!blockResult.ok) return blockResult;
      proposedBlock = blockResult.value;
    }
    
    const height = typeof heightData === 'number'
        ? heightData
        : parseInt(Buffer.from(heightData).toString('hex') || '0', 16);
    
    return {
      ok: true,
      value: {
        status: status.toString() as t.EntityStatus,
        storage: storageResult.value,
        mempool,
        lastBlock,
        proposedBlock,
        height
      }
    };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

function decodeEntityBlock(data: Buffer): t.Result<t.EntityBlock> {
  try {
    const decoded = enc.decode(data) as any[];
    const [heightData, timestampData, txsData, stateRoot, storageData] = decoded;
    
    const height = typeof heightData === 'number'
      ? heightData
      : parseInt(Buffer.from(heightData).toString('hex') || '0', 16);
    const timestamp = typeof timestampData === 'number'
      ? timestampData
      : parseInt(Buffer.from(timestampData).toString('hex') || '0', 16);
    
    // Decode transactions
    const txs: t.EntityTx[] = [];
    for (const txData of txsData) {
      const txResult = enc.decodeEntityTx(txData);
      if (!txResult.ok) return txResult;
      txs.push(txResult.value);
    }
    
    // Decode storage
    const storageResult = enc.decodeEntityStorage(storageData);
    if (!storageResult.ok) return storageResult;
    
    return {
      ok: true,
      value: {
        height,
        timestamp,
        txs,
        stateRoot: stateRoot.toString('hex'),
        storage: storageResult.value
      }
    };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

function decodeServerBlock(data: Buffer): t.Result<t.ServerBlock> {
  try {
    const decoded = enc.decode(data) as any[];
    const [heightData, timestampData, inputsData, stateRoot] = decoded;
    
    const height = typeof heightData === 'number'
      ? heightData
      : parseInt(Buffer.from(heightData).toString('hex') || '0', 16);
    const timestamp = typeof timestampData === 'number'
      ? timestampData
      : parseInt(Buffer.from(timestampData).toString('hex') || '0', 16);

    // Decode inputs
    const inputs: t.ServerTx[] = [];
    for (const inputData of inputsData) {
      const txResult = decodeServerTx(inputData);
      if (!txResult.ok) return txResult;
      inputs.push(txResult.value);
    }
    
    return {
      ok: true,
      value: {
        height,
        timestamp,
        inputs,
        stateRoot: stateRoot.toString('hex')
      }
    };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

function decodeServerTx(data: Buffer): t.Result<t.ServerTx> {
  try {
    const decoded = enc.decode(data) as any[];
    const [signerId, entityId, inputData, timestampData] = decoded;
    
    const timestamp = typeof timestampData === 'number'
      ? timestampData
      : parseInt(Buffer.from(timestampData).toString('hex') || '0', 16);

    // Decode input
    const inputResult = decodeEntityInput(inputData);
    if (!inputResult.ok) return inputResult;
    
    return {
      ok: true,
      value: {
        signerId: signerId.toString('hex'),
        entityId: entityId.toString('hex'),
        input: inputResult.value,
        timestamp
      }
    };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

function decodeEntityInput(data: Buffer): t.Result<t.EntityInput> {
  try {
    const decoded = enc.decode(data) as any[];
    const [type, ...args] = decoded;
    const typeStr = type.toString();
    
    switch (typeStr) {
      case 'AddTx': {
        const txResult = enc.decodeEntityTx(args[0]);
        if (!txResult.ok) return txResult;
        return { ok: true, value: { type: 'AddTx', tx: txResult.value } };
      }
      case 'ProposeBlock':
        return { ok: true, value: { type: 'ProposeBlock' } };
      case 'CommitBlock':
        return { ok: true, value: { type: 'CommitBlock', blockHash: args[0].toString('hex') } };
      case 'Flush':
        return { ok: true, value: { type: 'Flush' } };
      default:
        return { ok: false, error: new Error(`Unknown input type: ${typeStr}`) };
    }
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}