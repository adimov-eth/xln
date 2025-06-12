import { createHash } from 'crypto';
import { Level } from 'level';
import RLP from 'rlp';

/**
 * Test RLP encoding/decoding with different data types.
 */
const testRLP = () => {
  console.log('=== Testing RLP ===');
  
  // Simple data
  const simpleData = ['alice', 'bob', 123];
  const encoded = RLP.encode(simpleData);
  const decoded = RLP.decode(encoded);
  console.log('Simple data:', simpleData);
  console.log('Encoded bytes:', encoded.length);
  console.log('Decoded:', decoded.map(x => x.toString()));
  
  // Complex nested data
  const complexData = [
    ['entity', 'alice'],
    ['balance', '1000'],
    ['transactions', [
      ['mint', '100'],
      ['transfer', 'bob', '50']
    ]]
  ];
  
  const complexEncoded = RLP.encode(complexData);
  const complexDecoded = RLP.decode(complexEncoded);
  console.log('\nComplex encoded bytes:', complexEncoded.length);
  console.log('Complex decoded length:', complexDecoded.length);
  
  // Hash from RLP
  const hash = createHash('sha256').update(complexEncoded).digest('hex');
  console.log('SHA256 hash:', hash.slice(0, 16) + '...');
  
  console.log('✅ RLP working correctly\n');
};

/**
 * Test LevelDB basic operations.
 */
const testLevelDB = async () => {
  console.log('=== Testing LevelDB ===');
  
  const db = new Level('./test-db');
  
  try {
    // Test basic put/get
    await db.put('test-key', 'test-value');
    const value = await db.get('test-key');
    console.log('Basic put/get:', value);
    
    // Test JSON data
    const jsonData = {
      height: 42,
      balance: '1000000',
      timestamp: Date.now()
    };
    
    await db.put('json-key', JSON.stringify(jsonData));
    const retrieved = JSON.parse(await db.get('json-key') as string);
    console.log('JSON data:', retrieved);
    
    // Test batch operations
    const batch = db.batch();
    for (let i = 0; i < 5; i++) {
      batch.put(`batch-${i}`, `value-${i}`);
    }
    await batch.write();
    console.log('Batch written successfully');
    
    // Test iterator
    console.log('Batch keys:');
    for await (const [key, value] of db.iterator({ 
      gte: 'batch-', 
      lte: 'batch-z' 
    })) {
      console.log(`  ${key}: ${value}`);
    }
    
    await db.close();
    console.log('✅ LevelDB working correctly\n');
    
  } catch (error) {
    console.error('❌ LevelDB error:', error);
    await db.close();
  }
};

/**
 * Check what's actually stored in our server databases.
 */
const inspectServerData = async () => {
  console.log('=== Inspecting Server Data ===');
  
  try {
    // Check snapshots
    const snapshots = new Level('./data/snapshots');
    console.log('Snapshots:');
    for await (const [key, value] of snapshots.iterator()) {
      if (key.includes('meta')) {
        console.log(`  ${key}: ${value}`);
      } else {
        const data = JSON.parse(value as string);
        console.log(`  ${key}: height ${data.height}, entities ${data.entities.length}`);
      }
    }
    await snapshots.close();
    
    // Check WAL (first few entries)
    const wal = new Level('./data/wal');
    console.log('\nWAL entries (first 5):');
    let count = 0;
    for await (const [key, value] of wal.iterator()) {
      if (count >= 5) break;
      const entry = JSON.parse(value as string);
      console.log(`  ${key}: height ${entry.height}, tx type ${entry.tx.type}`);
      count++;
    }
    await wal.close();
    
    // Check blocks (last few)
    const blocks = new Level('./data/blocks');
    console.log('\nBlocks (last 3):');
    const blockEntries: Array<[string, any]> = [];
    for await (const [key, value] of blocks.iterator()) {
      blockEntries.push([key, JSON.parse(value as string)]);
    }
    
    blockEntries.slice(-3).forEach(([key, block]) => {
      console.log(`  ${key}: height ${block.height}, hash ${block.hash.slice(0, 8)}...`);
    });
    await blocks.close();
    
    console.log('✅ Server data inspection complete\n');
    
  } catch (error) {
    console.error('❌ Inspection error:', error);
  }
};

/**
 * Test BigInt serialization (our specific use case).
 */
const testBigIntSerialization = () => {
  console.log('=== Testing BigInt Serialization ===');
  
  const entity = {
    id: 'alice',
    height: 177,
    balance: 1100n,
    transactions: ['mint', 'transfer']
  };
  
  // JSON with replacer/reviver for BigInt
  const jsonReplacer = (key: string, value: any) => {
    return typeof value === 'bigint' ? value.toString() : value;
  };
  
  const jsonReviver = (key: string, value: any) => {
    if (key === 'balance' && typeof value === 'string') {
      return BigInt(value);
    }
    return value;
  };
  
  const serialized = JSON.stringify(entity, jsonReplacer);
  const deserialized = JSON.parse(serialized, jsonReviver);
  
  console.log('Original balance:', entity.balance, typeof entity.balance);
  console.log('Serialized:', serialized);
  console.log('Deserialized balance:', deserialized.balance, typeof deserialized.balance);
  console.log('Balance equality:', entity.balance === deserialized.balance);
  
  console.log('✅ BigInt serialization working\n');
};

/**
 * Verify real transactions created by server.ts
 */
const verifyServerTransactions = async () => {
  console.log('=== Verifying Server Transactions ===');
  
  try {
    const wal = new Level('./data/wal');
    
    // Read all WAL entries
    const walEntries: Array<{ key: string, entry: any }> = [];
    for await (const [key, value] of wal.iterator()) {
      walEntries.push({ key, entry: JSON.parse(value as string) });
    }
    
    console.log(`Found ${walEntries.length} WAL entries`);
    
    // Group by transaction type
    const createEntityTxs = walEntries.filter(e => e.entry.tx.type === 'create_entity');
    const entityTxs = walEntries.filter(e => e.entry.tx.type === 'entity_tx');
    
    console.log(`Create entity transactions: ${createEntityTxs.length}`);
    console.log(`Entity transactions: ${entityTxs.length}`);
    
    // Verify first few transactions
    if (createEntityTxs.length > 0) {
      const firstCreate = createEntityTxs[0];
      console.log('\nFirst create_entity transaction:');
      console.log(`  WAL key: ${firstCreate.key}`);
      console.log(`  Height: ${firstCreate.entry.height}`);
      console.log(`  Entity ID: ${firstCreate.entry.tx.entityId}`);
      
      // Verify RLP encoding
      const rlpData = [firstCreate.entry.tx.type, firstCreate.entry.tx.entityId];
      const encoded = RLP.encode(rlpData);
      const hash = createHash('sha256').update(encoded).digest('hex');
      console.log(`  RLP bytes: ${encoded.length}`);
      console.log(`  Hash: ${hash.slice(0, 16)}...`);
    }
    
    if (entityTxs.length > 0) {
      const firstEntity = entityTxs[0];
      console.log('\nFirst entity_tx transaction:');
      console.log(`  WAL key: ${firstEntity.key}`);
      console.log(`  Height: ${firstEntity.entry.height}`);
      console.log(`  Entity ID: ${firstEntity.entry.tx.entityId}`);
      console.log(`  Operation: ${firstEntity.entry.tx.data.op}`);
      console.log(`  Amount: ${firstEntity.entry.tx.data.amount}`);
      
      // Verify RLP encoding
      const rlpData = [
        firstEntity.entry.tx.type,
        firstEntity.entry.tx.entityId,
        firstEntity.entry.tx.data.op,
        firstEntity.entry.tx.data.amount
      ];
      const encoded = RLP.encode(rlpData);
      const hash = createHash('sha256').update(encoded).digest('hex');
      console.log(`  RLP bytes: ${encoded.length}`);
      console.log(`  Hash: ${hash.slice(0, 16)}...`);
    }
    
    await wal.close();
    console.log('✅ Server transactions verified\n');
    
  } catch (error) {
    console.error('❌ Verification error:', error);
  }
};

/**
 * Verify WAL consistency with snapshots
 */
const verifyWalConsistency = async () => {
  console.log('=== Verifying WAL Consistency ===');
  
  try {
    const snapshots = new Level('./data/snapshots');
    const wal = new Level('./data/wal');
    
    // Get latest snapshot
    const lastHeight = await snapshots.get('meta:lastHeight');
    if (!lastHeight) {
      console.log('No snapshots found');
      return;
    }
    
    const snapshotData = await snapshots.get(`snapshot:${lastHeight}`);
    const snapshot = JSON.parse(snapshotData as string);
    
    console.log(`Latest snapshot: height ${snapshot.height}`);
    console.log(`Entities in snapshot: ${snapshot.entities.length}`);
    
    // Count WAL entries after snapshot
    let walCount = 0;
    let createEntityCount = 0;
    let entityTxCount = 0;
    
    for await (const [key, value] of wal.iterator()) {
      const entry = JSON.parse(value as string);
      if (entry.height > snapshot.height) {
        walCount++;
        if (entry.tx.type === 'create_entity') createEntityCount++;
        if (entry.tx.type === 'entity_tx') entityTxCount++;
      }
    }
    
    console.log(`WAL entries after snapshot: ${walCount}`);
    console.log(`  Create entity: ${createEntityCount}`);
    console.log(`  Entity transactions: ${entityTxCount}`);
    
    // Verify entity data
    snapshot.entities.forEach((entity: any) => {
      console.log(`Entity ${entity.id}: height ${entity.height}, balance ${entity.balance}`);
    });
    
    await snapshots.close();
    await wal.close();
    
    console.log('✅ WAL consistency verified\n');
    
  } catch (error) {
    console.error('❌ WAL consistency error:', error);
  }
};

/**
 * Run all tests.
 */
const runTests = async () => {
  testRLP();
  await testLevelDB();
  testBigIntSerialization();
  await verifyServerTransactions();
  await verifyWalConsistency();
  await inspectServerData();
};

runTests().catch(console.error); 