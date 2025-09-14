/**
 * Database Adapter Layer for XLN
 * 
 * Provides abstraction over storage backends:
 * - Development: LevelDB (simple, fast, local)
 * - Production: PostgreSQL with JSONB (scalable, queryable)
 * - Alternative: MongoDB (document-oriented)
 * - Future: FalkorDB (graph-optimized)
 * 
 * Key requirements:
 * 1. Sub-millisecond reads for channel states
 * 2. Atomic batch writes for consensus
 * 3. Efficient range queries for block history
 * 4. Snapshot/restore for recovery
 */

import { Level } from 'level';
import { Pool } from 'pg';
import { encode, decode } from 'rlp';
import { createHash } from 'crypto';
import { ChannelState } from '../../old_src/channel.js';
import { EntityState, EntityReplica } from '../types.js';
import { log } from '../utils.js';

export interface DatabaseConfig {
  type: 'leveldb' | 'postgresql' | 'mongodb';
  connectionString?: string;
  dataDir?: string;
  poolSize?: number;
  enableCompression?: boolean;
}

export interface StorageKey {
  namespace: 'entity' | 'channel' | 'block' | 'snapshot';
  id: string;
  subkey?: string;
}

export interface BatchOperation {
  type: 'put' | 'del';
  key: StorageKey;
  value?: Buffer;
}

export abstract class DatabaseAdapter {
  protected config: DatabaseConfig;
  
  constructor(config: DatabaseConfig) {
    this.config = config;
  }
  
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  
  // Core operations
  abstract get(key: StorageKey): Promise<Buffer | null>;
  abstract put(key: StorageKey, value: Buffer): Promise<void>;
  abstract del(key: StorageKey): Promise<void>;
  abstract batch(operations: BatchOperation[]): Promise<void>;
  
  // Range queries
  abstract range(
    namespace: string,
    start?: string,
    end?: string,
    limit?: number
  ): Promise<Array<{ key: string; value: Buffer }>>;
  
  // Snapshot operations
  abstract createSnapshot(snapshotId: string): Promise<void>;
  abstract restoreSnapshot(snapshotId: string): Promise<void>;
  abstract listSnapshots(): Promise<string[]>;
  
  // Helper methods
  protected encodeKey(key: StorageKey): string {
    return `${key.namespace}:${key.id}${key.subkey ? ':' + key.subkey : ''}`;
  }
  
  protected decodeKey(encoded: string): StorageKey {
    const parts = encoded.split(':');
    return {
      namespace: parts[0] as any,
      id: parts[1],
      subkey: parts[2]
    };
  }
}

/**
 * LevelDB Adapter - Development and testing
 */
export class LevelDBAdapter extends DatabaseAdapter {
  private db?: Level<string, Buffer>;
  
  async connect(): Promise<void> {
    const dataDir = this.config.dataDir || './data/leveldb';
    this.db = new Level(dataDir, {
      valueEncoding: 'buffer',
      compression: this.config.enableCompression !== false
    });
    await this.db.open();
    log.info(`📁 LevelDB connected at ${dataDir}`);
  }
  
  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close();
      log.info('📁 LevelDB disconnected');
    }
  }
  
  async get(key: StorageKey): Promise<Buffer | null> {
    if (!this.db) throw new Error('Database not connected');
    
    try {
      return await this.db.get(this.encodeKey(key));
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') return null;
      throw error;
    }
  }
  
  async put(key: StorageKey, value: Buffer): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    await this.db.put(this.encodeKey(key), value);
  }
  
  async del(key: StorageKey): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    await this.db.del(this.encodeKey(key));
  }
  
  async batch(operations: BatchOperation[]): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    const batch = this.db.batch();
    for (const op of operations) {
      const key = this.encodeKey(op.key);
      if (op.type === 'put' && op.value) {
        batch.put(key, op.value);
      } else if (op.type === 'del') {
        batch.del(key);
      }
    }
    await batch.write();
  }
  
  async range(
    namespace: string,
    start?: string,
    end?: string,
    limit?: number
  ): Promise<Array<{ key: string; value: Buffer }>> {
    if (!this.db) throw new Error('Database not connected');
    
    const results: Array<{ key: string; value: Buffer }> = [];
    const startKey = start ? `${namespace}:${start}` : `${namespace}:`;
    const endKey = end ? `${namespace}:${end}` : `${namespace}:~`;
    
    for await (const [key, value] of this.db.iterator({
      gte: startKey,
      lte: endKey,
      limit
    })) {
      results.push({ key, value });
    }
    
    return results;
  }
  
  async createSnapshot(snapshotId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    // Copy all data to snapshot namespace
    const snapshot: BatchOperation[] = [];
    
    for await (const [key, value] of this.db.iterator()) {
      snapshot.push({
        type: 'put',
        key: {
          namespace: 'snapshot',
          id: snapshotId,
          subkey: key
        },
        value
      });
    }
    
    await this.batch(snapshot);
    log.info(`📸 Created snapshot: ${snapshotId}`);
  }
  
  async restoreSnapshot(snapshotId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    // Clear current data
    const clearOps: BatchOperation[] = [];
    for await (const [key] of this.db.iterator()) {
      if (!key.startsWith('snapshot:')) {
        clearOps.push({
          type: 'del',
          key: this.decodeKey(key)
        });
      }
    }
    await this.batch(clearOps);
    
    // Restore from snapshot
    const restoreOps: BatchOperation[] = [];
    const snapshotPrefix = `snapshot:${snapshotId}:`;
    
    for await (const [key, value] of this.db.iterator({
      gte: snapshotPrefix,
      lte: snapshotPrefix + '~'
    })) {
      const originalKey = key.slice(snapshotPrefix.length);
      restoreOps.push({
        type: 'put',
        key: this.decodeKey(originalKey),
        value
      });
    }
    
    await this.batch(restoreOps);
    log.info(`📸 Restored snapshot: ${snapshotId}`);
  }
  
  async listSnapshots(): Promise<string[]> {
    if (!this.db) throw new Error('Database not connected');
    
    const snapshots = new Set<string>();
    for await (const [key] of this.db.iterator({
      gte: 'snapshot:',
      lte: 'snapshot:~'
    })) {
      const parts = key.split(':');
      if (parts[1]) snapshots.add(parts[1]);
    }
    
    return Array.from(snapshots);
  }
}

/**
 * PostgreSQL Adapter - Production
 */
export class PostgreSQLAdapter extends DatabaseAdapter {
  private pool?: Pool;
  
  async connect(): Promise<void> {
    this.pool = new Pool({
      connectionString: this.config.connectionString,
      max: this.config.poolSize || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });
    
    // Create tables if not exist
    await this.createTables();
    log.info('🐘 PostgreSQL connected');
  }
  
  private async createTables(): Promise<void> {
    if (!this.pool) throw new Error('Pool not initialized');
    
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xln_storage (
        namespace VARCHAR(50) NOT NULL,
        id VARCHAR(255) NOT NULL,
        subkey VARCHAR(255),
        value BYTEA NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (namespace, id, subkey)
      );
      
      CREATE INDEX IF NOT EXISTS idx_namespace ON xln_storage(namespace);
      CREATE INDEX IF NOT EXISTS idx_id ON xln_storage(id);
      CREATE INDEX IF NOT EXISTS idx_updated ON xln_storage(updated_at);
      
      CREATE TABLE IF NOT EXISTS xln_snapshots (
        snapshot_id VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      log.info('🐘 PostgreSQL disconnected');
    }
  }
  
  async get(key: StorageKey): Promise<Buffer | null> {
    if (!this.pool) throw new Error('Database not connected');
    
    const result = await this.pool.query(
      'SELECT value FROM xln_storage WHERE namespace = $1 AND id = $2 AND subkey = $3',
      [key.namespace, key.id, key.subkey || '']
    );
    
    return result.rows[0]?.value || null;
  }
  
  async put(key: StorageKey, value: Buffer): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');
    
    await this.pool.query(
      `INSERT INTO xln_storage (namespace, id, subkey, value, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (namespace, id, subkey)
       DO UPDATE SET value = $4, updated_at = CURRENT_TIMESTAMP`,
      [key.namespace, key.id, key.subkey || '', value]
    );
  }
  
  async del(key: StorageKey): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');
    
    await this.pool.query(
      'DELETE FROM xln_storage WHERE namespace = $1 AND id = $2 AND subkey = $3',
      [key.namespace, key.id, key.subkey || '']
    );
  }
  
  async batch(operations: BatchOperation[]): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const op of operations) {
        if (op.type === 'put' && op.value) {
          await client.query(
            `INSERT INTO xln_storage (namespace, id, subkey, value, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (namespace, id, subkey)
             DO UPDATE SET value = $4, updated_at = CURRENT_TIMESTAMP`,
            [op.key.namespace, op.key.id, op.key.subkey || '', op.value]
          );
        } else if (op.type === 'del') {
          await client.query(
            'DELETE FROM xln_storage WHERE namespace = $1 AND id = $2 AND subkey = $3',
            [op.key.namespace, op.key.id, op.key.subkey || '']
          );
        }
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  async range(
    namespace: string,
    start?: string,
    end?: string,
    limit?: number
  ): Promise<Array<{ key: string; value: Buffer }>> {
    if (!this.pool) throw new Error('Database not connected');
    
    let query = 'SELECT id, subkey, value FROM xln_storage WHERE namespace = $1';
    const params: any[] = [namespace];
    
    if (start) {
      query += ' AND id >= $2';
      params.push(start);
    }
    
    if (end) {
      query += ` AND id <= $${params.length + 1}`;
      params.push(end);
    }
    
    query += ' ORDER BY id, subkey';
    
    if (limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }
    
    const result = await this.pool.query(query, params);
    
    return result.rows.map(row => ({
      key: `${namespace}:${row.id}${row.subkey ? ':' + row.subkey : ''}`,
      value: row.value
    }));
  }
  
  async createSnapshot(snapshotId: string): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');
    
    // Export all data as JSONB
    const result = await this.pool.query('SELECT * FROM xln_storage');
    
    await this.pool.query(
      'INSERT INTO xln_snapshots (snapshot_id, data) VALUES ($1, $2)',
      [snapshotId, JSON.stringify(result.rows)]
    );
    
    log.info(`📸 Created PostgreSQL snapshot: ${snapshotId}`);
  }
  
  async restoreSnapshot(snapshotId: string): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get snapshot
      const result = await client.query(
        'SELECT data FROM xln_snapshots WHERE snapshot_id = $1',
        [snapshotId]
      );
      
      if (!result.rows[0]) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }
      
      // Clear current data
      await client.query('TRUNCATE xln_storage');
      
      // Restore from snapshot
      const data = result.rows[0].data;
      for (const row of data) {
        await client.query(
          `INSERT INTO xln_storage (namespace, id, subkey, value, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.namespace, row.id, row.subkey, Buffer.from(row.value), row.created_at, row.updated_at]
        );
      }
      
      await client.query('COMMIT');
      log.info(`📸 Restored PostgreSQL snapshot: ${snapshotId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  async listSnapshots(): Promise<string[]> {
    if (!this.pool) throw new Error('Database not connected');
    
    const result = await this.pool.query(
      'SELECT snapshot_id FROM xln_snapshots ORDER BY created_at DESC'
    );
    
    return result.rows.map(row => row.snapshot_id);
  }
}

/**
 * Factory function to create appropriate adapter
 */
export function createDatabaseAdapter(config: DatabaseConfig): DatabaseAdapter {
  switch (config.type) {
    case 'leveldb':
      return new LevelDBAdapter(config);
    
    case 'postgresql':
      if (!config.connectionString) {
        throw new Error('PostgreSQL requires connectionString');
      }
      return new PostgreSQLAdapter(config);
    
    // MongoDB adapter would go here
    
    default:
      throw new Error(`Unsupported database type: ${config.type}`);
  }
}

/**
 * High-level storage interface for XLN components
 */
export class XLNStorage {
  private adapter: DatabaseAdapter;
  
  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
  }
  
  // Entity operations
  async saveEntityState(entityId: string, state: EntityState): Promise<void> {
    const key: StorageKey = {
      namespace: 'entity',
      id: entityId,
      subkey: `height:${state.height}`
    };
    
    const value = encode([
      state.height,
      state.timestamp,
      Array.from(state.nonces.entries()),
      state.messages,
      Array.from(state.proposals.entries()),
      state.config
    ]);
    
    await this.adapter.put(key, Buffer.from(value));
  }
  
  async loadEntityState(entityId: string, height?: number): Promise<EntityState | null> {
    const key: StorageKey = {
      namespace: 'entity',
      id: entityId,
      subkey: height ? `height:${height}` : undefined
    };
    
    const value = await this.adapter.get(key);
    if (!value) return null;
    
    const decoded = decode(value) as any;
    return {
      height: decoded[0],
      timestamp: decoded[1],
      nonces: new Map(decoded[2]),
      messages: decoded[3],
      proposals: new Map(decoded[4]),
      config: decoded[5]
    };
  }
  
  // Channel operations
  async saveChannelState(channelKey: string, state: ChannelState): Promise<void> {
    const key: StorageKey = {
      namespace: 'channel',
      id: channelKey,
      subkey: `block:${state.blockId}`
    };
    
    const value = encode([
      state.left,
      state.right,
      state.channelKey,
      state.previousBlockHash,
      state.previousStateHash,
      state.blockId,
      state.timestamp,
      state.transitionId,
      state.subchannels,
      state.subcontracts
    ]);
    
    await this.adapter.put(key, Buffer.from(value));
  }
  
  async loadChannelState(channelKey: string, blockId?: number): Promise<ChannelState | null> {
    const key: StorageKey = {
      namespace: 'channel',
      id: channelKey,
      subkey: blockId ? `block:${blockId}` : undefined
    };
    
    const value = await this.adapter.get(key);
    if (!value) return null;
    
    const decoded = decode(value) as any;
    return {
      left: decoded[0],
      right: decoded[1],
      channelKey: decoded[2],
      previousBlockHash: decoded[3],
      previousStateHash: decoded[4],
      blockId: decoded[5],
      timestamp: decoded[6],
      transitionId: decoded[7],
      subchannels: decoded[8],
      subcontracts: decoded[9]
    };
  }
  
  // Block operations
  async saveBlock(blockHash: string, blockData: Buffer): Promise<void> {
    const key: StorageKey = {
      namespace: 'block',
      id: blockHash
    };
    
    await this.adapter.put(key, blockData);
  }
  
  async loadBlock(blockHash: string): Promise<Buffer | null> {
    const key: StorageKey = {
      namespace: 'block',
      id: blockHash
    };
    
    return await this.adapter.get(key);
  }
  
  // Batch operations for consensus
  async commitBatch(operations: Array<{
    type: 'entity' | 'channel' | 'block';
    id: string;
    data: any;
  }>): Promise<void> {
    const batchOps: BatchOperation[] = [];
    
    for (const op of operations) {
      let value: Buffer;
      let key: StorageKey;
      
      switch (op.type) {
        case 'entity':
          key = {
            namespace: 'entity',
            id: op.id,
            subkey: `height:${op.data.height}`
          };
          value = Buffer.from(encode(op.data));
          break;
        
        case 'channel':
          key = {
            namespace: 'channel',
            id: op.id,
            subkey: `block:${op.data.blockId}`
          };
          value = Buffer.from(encode(op.data));
          break;
        
        case 'block':
          key = {
            namespace: 'block',
            id: op.id
          };
          value = op.data;
          break;
        
        default:
          continue;
      }
      
      batchOps.push({
        type: 'put',
        key,
        value
      });
    }
    
    await this.adapter.batch(batchOps);
  }
  
  // Query operations
  async getEntityHistory(entityId: string, limit = 100): Promise<EntityState[]> {
    const results = await this.adapter.range(
      'entity',
      entityId,
      entityId + ':~',
      limit
    );
    
    return results
      .filter(r => r.key.includes(':height:'))
      .map(r => {
        const decoded = decode(r.value) as any;
        return {
          height: decoded[0],
          timestamp: decoded[1],
          nonces: new Map(decoded[2]),
          messages: decoded[3],
          proposals: new Map(decoded[4]),
          config: decoded[5]
        };
      });
  }
  
  async getChannelHistory(channelKey: string, limit = 100): Promise<ChannelState[]> {
    const results = await this.adapter.range(
      'channel',
      channelKey,
      channelKey + ':~',
      limit
    );
    
    return results
      .filter(r => r.key.includes(':block:'))
      .map(r => {
        const decoded = decode(r.value) as any;
        return {
          left: decoded[0],
          right: decoded[1],
          channelKey: decoded[2],
          previousBlockHash: decoded[3],
          previousStateHash: decoded[4],
          blockId: decoded[5],
          timestamp: decoded[6],
          transitionId: decoded[7],
          subchannels: decoded[8],
          subcontracts: decoded[9]
        };
      });
  }
}