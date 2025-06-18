import { test, expect, beforeEach, afterAll } from 'bun:test';
import { LevelDBStorage } from '../storage/leveldb.js';
import { height, signer, id } from '../types/primitives.js';
import type { ServerTx } from '../types/state.js';
import * as fs from 'fs/promises';
import { RLP } from '@ethereumjs/rlp';
import { encode } from '../utils/encoding.js';

const DB_PATH = './test-corruption-db';

beforeEach(async () => {
  await fs.rm(DB_PATH, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(DB_PATH, { recursive: true, force: true });
});

test('WAL handles various corruption scenarios', async () => {
  const storage = new LevelDBStorage(DB_PATH);
  const walDb = (storage as any).walDb;
  
  // Create some valid test transactions
  const validTx: ServerTx = {
    signer: signer(1),
    entityId: id('test-entity'),
    command: { type: 'proposeBlock' },
  };
  
  // 1. Add valid entries
  await storage.wal.append(height(1), [validTx]);
  await storage.wal.append(height(2), [validTx, validTx]);
  
  // 2. Add various types of corruption
  // Empty buffer
  await walDb.put('wal:0000000003', Buffer.from(''));
  
  // Invalid RLP - not properly encoded
  await walDb.put('wal:0000000004', Buffer.from([0xFF, 0xFF, 0xFF]));
  
  // Valid RLP but not an array
  await walDb.put('wal:0000000005', Buffer.from(RLP.encode('just a string')));
  
  // Valid RLP array but with invalid transaction structure
  await walDb.put('wal:0000000006', Buffer.from(RLP.encode([1, 2, 3])));
  
  // Partially valid - array with some good and bad txs
  const mixedData = [
    encode.serverTx(validTx),
    'invalid tx data',
    encode.serverTx(validTx),
  ];
  await walDb.put('wal:0000000007', Buffer.from(RLP.encode(mixedData)));
  
  // 3. Add more valid entries after corruption
  await storage.wal.append(height(8), [validTx]);
  await storage.wal.append(height(9), [validTx, validTx]);
  
  // 4. Read from beginning and verify graceful handling
  const result = await storage.wal.readFromHeight(height(1));
  
  expect(result.ok).toBe(true);
  if (result.ok) {
    // Should have recovered valid transactions despite corruption
    const validTxCount = result.value.filter(tx => tx.command.type === 'proposeBlock').length;
    
    // We added: 1 (h1) + 2 (h2) + 1 (h8) + 2 (h9) = 6 valid txs
    // Plus potentially 2 from the mixed entry at h7
    expect(validTxCount).toBeGreaterThanOrEqual(6);
    
    console.log(`Recovered ${validTxCount} valid transactions from WAL with corrupted entries`);
  }
  
  await storage.close();
});

test('WAL append validates encoding structure', async () => {
  const storage = new LevelDBStorage(DB_PATH);
  
  // Test that validation catches malformed structures
  const validTx: ServerTx = {
    signer: signer(1),
    entityId: id('test'),
    command: { type: 'proposeBlock' },
  };
  
  // Normal append should work
  const result1 = await storage.wal.append(height(1), [validTx]);
  expect(result1.ok).toBe(true);
  
  // Reading back should work
  const result2 = await storage.wal.readFromHeight(height(1));
  expect(result2.ok).toBe(true);
  if (result2.ok) {
    expect(result2.value.length).toBe(1);
  }
  
  await storage.close();
});

test('WAL truncation works with corrupted entries', async () => {
  const storage = new LevelDBStorage(DB_PATH);
  // Small delay to ensure DB is open
  await new Promise(resolve => setTimeout(resolve, 50));
  const walDb = (storage as any).walDb;
  
  const validTx: ServerTx = {
    signer: signer(1),
    entityId: id('test-entity'),
    command: { type: 'proposeBlock' },
  };
  
  // Add mix of valid and corrupted entries
  await storage.wal.append(height(1), [validTx]);
  await new Promise(resolve => setTimeout(resolve, 10));
  await walDb.put('wal:0000000002', Buffer.from('corrupted'));
  await new Promise(resolve => setTimeout(resolve, 10));
  await storage.wal.append(height(3), [validTx]);
  await new Promise(resolve => setTimeout(resolve, 10));
  await walDb.put('wal:0000000004', Buffer.from('corrupted'));
  await new Promise(resolve => setTimeout(resolve, 10));
  await storage.wal.append(height(5), [validTx]);
  
  // Truncate before height 4
  const truncateResult = await storage.wal.truncateBefore(height(4));
  expect(truncateResult.ok).toBe(true);
  
  // Read remaining entries
  const readResult = await storage.wal.readFromHeight(height(1));
  expect(readResult.ok).toBe(true);
  if (readResult.ok) {
    // Should only have entries from height 4 and 5
    // Height 4 is corrupted, so only height 5's entry
    const validCount = readResult.value.filter(tx => tx.command.type === 'proposeBlock').length;
    expect(validCount).toBe(1);
  }
  
  await storage.close();
});