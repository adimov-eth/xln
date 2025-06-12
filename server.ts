import { createHash } from 'crypto';
import { ethers } from 'ethers';
import { Level } from 'level';
import RLP from 'rlp';

// Add signature to transaction type
type SignedTx = {
  signer: number;
  entityId: string;
  input: any;
  nonce: number;
  signature: string;
};

type Entity = {
  id: string;
  height: number;
  balance: bigint;
  mempool: any[];
  signers: number[];
};

type Signer = {
  index: number;
  address: string; // Add ethereum address
  entities: Map<string, Entity>;
};

type Server = {
  height: number;
  signers: Map<number, Signer>;
  mempool: SignedTx[]; // Now signed
  wallets: Map<number, ethers.Wallet>; // For simulation only
};

type Storage = {
  snapshots: Level;
  wal: Level;
  blocks: Level;
};

const createStorage = (basePath = './data'): Storage => ({
  snapshots: new Level(`${basePath}/snapshots`),
  wal: new Level(`${basePath}/wal`),
  blocks: new Level(`${basePath}/blocks`)
});

const keys = {
  snapshot: (height: number) => `snapshot:${height}`,
  wal: (height: number, index: number) => `wal:${height}:${index}`,
  block: (height: number) => `block:${height}`,
  lastHeight: () => 'meta:lastHeight'
};

const computeHash = (data: any): string => {
  const encoded = RLP.encode(data);
  return createHash('sha256').update(encoded).digest('hex');
};

// Deterministic wallet factory (returns standard Wallet instance)
const createWallet = (index: number): ethers.Wallet => {
  const mnemonic = 'test test test test test test test test test test test junk';
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic).deriveChild(index);
  return new ethers.Wallet(hdNode.privateKey);
};

const createServer = (): Server => ({
  height: 0,
  signers: new Map(),
  mempool: [],
  wallets: new Map() // For simulation
});

const createSigner = (index: number, address: string): Signer => ({
  index,
  address,
  entities: new Map()
});

const createEntity = (id: string, signers: number[]): Entity => ({
  id,
  height: 0,
  balance: 0n,
  mempool: [],
  signers
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// Deterministic hash of the core tx fields (used for signing & verification)
const hashTx = (tx: Pick<SignedTx, 'signer' | 'entityId' | 'input' | 'nonce'>): string =>
  ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify({
      signer: tx.signer,
      entityId: tx.entityId,
      input: tx.input,
      nonce: tx.nonce
    }))
  );

// Sign a transaction
const signTransaction = async (
  wallet: ethers.Wallet,
  tx: Omit<SignedTx, 'signature'>
): Promise<SignedTx> => {
  const message = hashTx(tx);
  const signature = await wallet.signMessage(ethers.getBytes(message));
  return { ...tx, signature };
};

// Verify transaction signature
const verifySignature = (tx: SignedTx, expectedAddress: string): boolean => {
  try {
    const message = hashTx(tx);
    const recoveredAddress = ethers.verifyMessage(ethers.getBytes(message), tx.signature);
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
};

const updateEntityInSigner = (signer: Signer, entityId: string, entity: Entity): Signer => ({
  ...signer,
  entities: new Map(signer.entities).set(entityId, entity)
});

const updateSignerInServer = (server: Server, signerIndex: number, signer: Signer): Server => ({
  ...server,
  signers: new Map(server.signers).set(signerIndex, signer)
});

const addEntityToSigner = (server: Server, signerIndex: number, entity: Entity): Server => {
  const signer = server.signers.get(signerIndex);
  if (!signer) return server;
  
  const updatedSigner = updateEntityInSigner(signer, entity.id, entity);
  return updateSignerInServer(server, signerIndex, updatedSigner);
};

const addTxToEntity = (entity: Entity, tx: any): Entity => ({
  ...entity,
  mempool: [...entity.mempool, tx]
});

const mapValues = <K, V, R>(source: Map<K, V>, fn: (value: V, key: K) => R): Map<K, R> =>
  new Map(Array.from(source, ([k, v]) => [k, fn(v, k)] as [K, R]));

const applyTransaction = (server: Server, tx: SignedTx): Server => {
  const signerIndex = tx.signer;
  const signer = server.signers.get(signerIndex);
  
  // Verify signature
  if (!signer || !verifySignature(tx, signer.address)) {
    console.log(`Invalid signature for tx from signer ${signerIndex}`);
    return server;
  }

  switch (tx.input.type) {
    case 'create_entity': {
      // Check if entity already exists
      const existingEntity = signer.entities.get(tx.entityId);
      if (existingEntity) {
        console.log(`Entity ${tx.entityId} already exists for signer ${signerIndex}`);
        return server;
      }
      
      const entity = createEntity(tx.entityId, [signerIndex]);
      return addEntityToSigner(server, signerIndex, entity);
    }

    case 'add_tx': {
      const entity = signer.entities.get(tx.entityId);
      if (!entity || !entity.signers.includes(signerIndex)) return server;

      const updatedEntity = addTxToEntity(entity, tx.input.data);
      const updatedSigner = updateEntityInSigner(signer, tx.entityId, updatedEntity);
      return updateSignerInServer(server, signerIndex, updatedSigner);
    }

    default:
      return server;
  }
};

const processEntityMempool = (entity: Entity): Entity => {
  if (entity.mempool.length === 0) return entity;
  
  return {
    ...entity,
    height: entity.height + 1,
    balance: entity.balance + BigInt(entity.mempool.length * 100),
    mempool: []
  };
};

const processSignerEntities = (signer: Signer): Signer => ({
  ...signer,
  entities: mapValues(signer.entities, processEntityMempool)
});

const applyMempool = (server: Server): Server => {
  const afterTx = server.mempool.reduce((srv, tx) => applyTransaction(srv, tx), server);
  return { ...afterTx, mempool: [] };
};

const processAllEntities = (server: Server): Server => ({
  ...server,
  signers: mapValues(server.signers, processSignerEntities)
});

const processBlockPure = (server: Server): Server => {
  const serverAfterMempool = applyMempool(server);
  const serverAfterEntities = processAllEntities(serverAfterMempool);
  
  return {
    ...serverAfterEntities,
    height: server.height + 1
  };
};

const processBlock = async (server: Server, storage: Storage): Promise<Server> => {
  for (let i = 0; i < server.mempool.length; i++) {
    const tx = server.mempool[i];
    const walKey = keys.wal(server.height + 1, i);
    await storage.wal.put(walKey, JSON.stringify({ height: server.height + 1, tx }));
  }
  
  const newServer = processBlockPure(server);
  
  if (newServer.height % 10 === 0) {
    await saveSnapshot(newServer, storage);
  }
  
  const blockData = {
    height: newServer.height,
    hash: computeHash([newServer.height, Array.from(newServer.signers.keys())]),
    timestamp: Date.now()
  };
  await storage.blocks.put(keys.block(newServer.height), JSON.stringify(blockData));
  
  return newServer;
};

const serializeServer = (server: Server) => ({
  height: server.height,
  signers: Array.from(server.signers.entries()).map(([index, signer]) => ({
    index,
    address: signer.address,
    entities: Array.from(signer.entities.entries()).map(([id, entity]) => ({
      id,
      height: entity.height,
      balance: entity.balance.toString(),
      signers: entity.signers
    }))
  })),
  timestamp: Date.now()
});

const deserializeServer = (data: any): Server => {
  const server = createServer();
  const signers = new Map<number, Signer>();
  
  for (const signerData of data.signers) {
    const signer = createSigner(signerData.index, signerData.address);
    const entities = new Map<string, Entity>();
    
    for (const entityData of signerData.entities) {
      entities.set(entityData.id, {
        id: entityData.id,
        height: entityData.height,
        balance: BigInt(entityData.balance),
        mempool: [],
        signers: entityData.signers
      });
    }
    
    signers.set(signerData.index, { ...signer, entities });
  }
  
  return {
    height: data.height,
    signers,
    mempool: [],
    wallets: new Map() // Recreate in simulation
  };
};

const saveSnapshot = async (server: Server, storage: Storage): Promise<void> => {
  const snapshot = serializeServer(server);
  await storage.snapshots.put(keys.snapshot(server.height), JSON.stringify(snapshot));
  await storage.snapshots.put(keys.lastHeight(), server.height.toString());
};

const loadSnapshot = async (storage: Storage): Promise<Server | null> => {
  try {
    const lastHeight = await storage.snapshots.get(keys.lastHeight());
    if (!lastHeight) return null;
    
    const snapshotData = await storage.snapshots.get(keys.snapshot(parseInt(lastHeight as string)));
    if (!snapshotData) return null;
    
    return deserializeServer(JSON.parse(snapshotData as string));
  } catch {
    return null;
  }
};

const replayWalEntries = async (server: Server, storage: Storage): Promise<Server> => {
  let currentServer = server;
  
  try {
    const iterator = storage.wal.iterator();
    
    for await (const [key, value] of iterator) {
      const entry = JSON.parse(value as string);
      if (entry.height > currentServer.height) {
        currentServer = applyTransaction(currentServer, entry.tx);
      }
    }
  } catch {}
  
  return currentServer;
};

const startServer = async (storage: Storage): Promise<Server> => {
  const savedServer = await loadSnapshot(storage);
  const initialServer = savedServer || createServer();
  
  // Recreate wallets for simulation
  const withWallets = { ...initialServer };
  for (const [index, signer] of withWallets.signers) {
    withWallets.wallets.set(index, createWallet(index));
  }
  
  return replayWalEntries(withWallets, storage);
};

const addToMempool = (server: Server, tx: SignedTx): Server => ({
  ...server,
  mempool: [...server.mempool, tx]
});

let nonceCounter = 0;

const simulate = async (): Promise<void> => {
  const storage = createStorage();
  let server = await startServer(storage);
  
  console.log(`started at height ${server.height}`);
  
  // Initialize signers with wallets
  const wallet0 = createWallet(0);
  const wallet1 = createWallet(1);
  
  server.wallets.set(0, wallet0);
  server.wallets.set(1, wallet1);
  
  if (!server.signers.has(0)) {
    server = updateSignerInServer(server, 0, createSigner(0, wallet0.address));
  }
  if (!server.signers.has(1)) {
    server = updateSignerInServer(server, 1, createSigner(1, wallet1.address));
  }
  
  // Sign and add transactions
  // Only create entities if they don't exist
  if (!server.signers.get(0)?.entities.has('alice')) {
    const createAliceTx = await signTransaction(wallet0, {
      signer: 0,
      entityId: 'alice',
      input: { type: 'create_entity' },
      nonce: nonceCounter++
    });
    server = addToMempool(server, createAliceTx);
    console.log('Creating alice entity');
  } else {
    console.log('Alice entity already exists from previous run');
  }
  
  if (!server.signers.get(1)?.entities.has('bob')) {
    const createBobTx = await signTransaction(wallet1, {
      signer: 1,
      entityId: 'bob',
      input: { type: 'create_entity' },
      nonce: nonceCounter++
    });
    server = addToMempool(server, createBobTx);
    console.log('Creating bob entity');
  } else {
    console.log('Bob entity already exists from previous run');
  }
  
  const blockCount = 30 + Math.floor(Math.random() * 21);
  console.log(`processing ${blockCount} blocks`);
  
  for (let i = 0; i < blockCount; i++) {
    if (i % 3 === 0 && server.signers.get(0)?.entities.has('alice')) {
      const mintTx = await signTransaction(wallet0, {
        signer: 0,
        entityId: 'alice',
        input: { type: 'add_tx', data: { op: 'mint', amount: 100 } },
        nonce: nonceCounter++
      });
      server = addToMempool(server, mintTx);
    }
    
    if (i % 4 === 0 && server.signers.get(1)?.entities.has('bob')) {
      const mintTx = await signTransaction(wallet1, {
        signer: 1,
        entityId: 'bob',
        input: { type: 'add_tx', data: { op: 'mint', amount: 50 } },
        nonce: nonceCounter++
      });
      server = addToMempool(server, mintTx);
    }
    
    // Try adding invalid transaction (wrong signer)
    if (i === 15) {
      const invalidTx = await signTransaction(wallet0, {
        signer: 1, // Wrong! wallet0 is for signer 0
        entityId: 'bob',
        input: { type: 'add_tx', data: { op: 'mint', amount: 1000 } },
        nonce: nonceCounter++
      });
      server = addToMempool(server, invalidTx);
      console.log('Added invalid tx at block 15 (should be rejected)');
    }
    
    server = await processBlock(server, storage);
    console.log(`block ${server.height} signers ${server.signers.size}`);
    
    if (i % 10 === 0) {
      for (const [signerIndex, signer] of server.signers) {
        console.log(`  signer ${signerIndex}: ${signer.address.slice(0, 10)}...`);
        for (const [id, entity] of signer.entities) {
          console.log(`    ${id}: balance ${entity.balance}`);
        }
      }
    }
  }
  
  await saveSnapshot(server, storage);
  console.log(`stopped at height ${server.height}`);
  
  console.log('\nFinal state - All entities:');
  for (const [signerIndex, signer] of server.signers) {
    console.log(`  signer ${signerIndex}: ${signer.address}`);
    for (const [id, entity] of signer.entities) {
      console.log(`    ${id}: height ${entity.height}, balance ${entity.balance}`);
    }
  }
  
  await storage.snapshots.close();
  await storage.wal.close();
  await storage.blocks.close();
};

simulate().catch(console.error);