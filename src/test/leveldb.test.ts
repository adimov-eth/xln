import { test, expect, beforeAll, afterAll } from 'bun:test';
import { LevelDBStorage } from '../storage/leveldb.js';
import { createServer, importEntity, registerEntity } from '../engine/server.js';
import type { ServerState } from '../types/state.js';
import { signer, height, id } from '../types/primitives.js';
import * as fs from 'fs/promises';

const DB_PATH = './test-db';

let storage: LevelDBStorage;

const createTestServerState = (h: number): ServerState => {
  let server = createServer();
  server = registerEntity(server, 'wallet-1', { quorum: [1], protocol: 'wallet' });
  server = importEntity(server, signer(1), 'wallet-1', { balance: 1000n, nonce: 0 });
  return { ...server, height: height(h) };
};

beforeAll(async () => {
  await fs.rm(DB_PATH, { recursive: true, force: true });
  storage = new LevelDBStorage(DB_PATH);
});

afterAll(async () => {
  try {
    await storage.close();
  } catch (e) {
    // May already be closed
  }
  await fs.rm(DB_PATH, { recursive: true, force: true });
});

test('leveldb persistence for snapshots', async () => {
  const state = createTestServerState(100);
  
  const saveResult = await storage.snapshots.save(state);
  expect(saveResult.ok).toBe(true);
  
  // Close the original storage first
  await storage.close();
  
  // Create a new instance to ensure it reads from disk
  const newStorage = new LevelDBStorage(DB_PATH);
  // Give it a moment to open
  await new Promise(resolve => setTimeout(resolve, 100));
  const loadResult = await newStorage.snapshots.loadLatest();
  
  if (!loadResult.ok) {
    console.error('Load failed:', loadResult.error);
  }
  expect(loadResult.ok).toBe(true);
  if (loadResult.ok) {
    expect(loadResult.value).not.toBeNull();
  }
  
  // Deep equality check
  if (loadResult.ok && loadResult.value) {
    const originalJSON = JSON.stringify(state, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    const loadedJSON = JSON.stringify(loadResult.value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    expect(loadedJSON).toEqual(originalJSON);
  }
  
  await newStorage.close();
});

test('leveldb loadLatest finds the correct snapshot', async () => {
  // Recreate storage since previous test closed it
  storage = new LevelDBStorage(DB_PATH);
  await storage.clear();
  
  const state10 = createTestServerState(10);
  const state20 = createTestServerState(20);
  
  await storage.snapshots.save(state10);
  await storage.snapshots.save(state20);
  
  const loaded = await storage.snapshots.loadLatest();
  expect(loaded.ok).toBe(true);
  if (loaded.ok && loaded.value) {
    expect(loaded.value.height).toBe(height(20));
  }
});

test('leveldb WAL operations work correctly', async () => {
  // Ensure storage is open
  try {
    await storage.clear();
  } catch (e) {
    // Recreate if closed
    storage = new LevelDBStorage(DB_PATH);
    await storage.clear();
  }
  
  const txs1 = [{ signer: signer(1), entityId: id('e1'), command: { type: 'proposeBlock' as const } }];
  const txs2 = [{ signer: signer(2), entityId: id('e2'), command: { type: 'proposeBlock' as const } }];
  
  await storage.wal.append(height(1), txs1);
  await storage.wal.append(height(2), txs2);
  
  const read1 = await storage.wal.readFromHeight(height(1));
  expect(read1.ok).toBe(true);
  if (read1.ok) {
    expect(read1.value).toHaveLength(2);
  }
  
  const read2 = await storage.wal.readFromHeight(height(2));
  expect(read2.ok).toBe(true);
  if (read2.ok) {
    expect(read2.value).toHaveLength(1);
  }
  
  await storage.wal.truncateBefore(height(2));
  const read3 = await storage.wal.readFromHeight(height(1));
  expect(read3.ok).toBe(true);
  if (read3.ok) {
    expect(read3.value).toHaveLength(1); // Should only have height 2's entry
    expect(read3.value[0]?.signer).toBe(signer(2));
  }
});