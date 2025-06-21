// /Users/adimov/Developer/xln/v6/src/server.ts

import { createHash } from 'crypto';
import { Level } from 'level';
import { decode, encode } from 'rlp';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();

type EntityId = string;
type SignerId = string;

type EntityTx = 
  | { type: 'create' }
  | { type: 'increment'; n: number };

type EntityState = {
  storage: { value: number };
  mempool: Map<string, Buffer>;
  height: number;
};

type ServerState = {
  height: number;
  signers: Map<SignerId, Map<EntityId, EntityState>>;
  quorums: Map<EntityId, SignerId[]>;
  mempool: Map<SignerId, Map<EntityId, EntityTx[]>>;
};

const serverBlocks = new Level<string, Buffer>('./db/blocks', { valueEncoding: 'buffer' });
const state = new Level<string, Buffer>('./db/state', { valueEncoding: 'buffer' });

let server: ServerState = {
  height: 0,
  signers: new Map(),
  quorums: new Map(),
  mempool: new Map()
};

const encodeTx = (tx: EntityTx): Buffer => Buffer.from(encode([
  tx.type === 'increment' ? 1 : 0,
  tx.type === 'increment' ? tx.n : 0
]));

const decodeTx = (raw: Buffer): EntityTx => {
  const [tag, n] = decode(raw) as unknown as [number, number];
  return tag === 1 ? { type: 'increment', n } : { type: 'create' };
};

const txHash = (raw: Buffer) => sha256(raw).toString('hex');

export const Server = {
  registerEntity(entityId: EntityId, quorum: SignerId[]) {
    server.quorums.set(entityId, quorum);
    for (const signerId of quorum) {
      if (!server.signers.has(signerId)) {
        server.signers.set(signerId, new Map());
      }
    }
  },

  importEntity(signerId: SignerId, entityId: EntityId, initialState: { value: number }) {
    const signerEntities = server.signers.get(signerId);
    if (!signerEntities) throw new Error('Signer not found');
    
    signerEntities.set(entityId, {
      storage: initialState,
      mempool: new Map(),
      height: 0
    });
  },

  addTx(signerId: SignerId, entityId: EntityId, tx: EntityTx) {
    const quorum = server.quorums.get(entityId);
    if (!quorum) throw new Error('Entity not registered');
    
    // Add to all signers in quorum
    for (const targetSignerId of quorum) {
      let signerPool = server.mempool.get(targetSignerId);
      if (!signerPool) {
        signerPool = new Map();
        server.mempool.set(targetSignerId, signerPool);
      }
      
      let entityTxs = signerPool.get(entityId);
      if (!entityTxs) {
        entityTxs = [];
        signerPool.set(entityId, entityTxs);
      }
      
      entityTxs.push(tx);
    }
  },

  async tick() {
    if (server.mempool.size === 0) return;

    // Process each signer's mempool
    for (const [signerId, signerPool] of server.mempool) {
      const signerEntities = server.signers.get(signerId);
      if (!signerEntities) continue;

      for (const [entityId, txs] of signerPool) {
        const entity = signerEntities.get(entityId);
        if (!entity) continue;

        // Add txs to entity mempool
        for (const tx of txs) {
          const raw = encodeTx(tx);
          entity.mempool.set(txHash(raw), raw);
        }

        // Commit entity block if has txs
        if (entity.mempool.size > 0) {
          for (const [hash, raw] of entity.mempool) {
            const tx = decodeTx(raw);
            entity.storage = applyTx(entity.storage, tx);
          }
          entity.height++;
          entity.mempool.clear();
        }
      }
    }

    // Save server block
    const blockData = Buffer.from(encode(
      Array.from(server.mempool.entries()).map(([signerId, entityMap]) => [
        signerId,
        Array.from(entityMap.entries()).map(([entityId, txs]) => [
          entityId,
          txs.map(tx => encodeTx(tx))
        ])
      ])
    ));
    const blockKey = server.height.toString().padStart(10, '0');
    await serverBlocks.put(blockKey, blockData);

    // Save current state
    const stateData = Buffer.from(encode([
      server.height + 1,
      Array.from(server.signers.entries()).map(([signerId, entities]) => [
        signerId,
        Array.from(entities.entries()).map(([entityId, entity]) => [
          entityId,
          entity.storage.value,
          entity.height
        ])
      ])
    ]));
    await state.put('current', stateData);

    server.height++;
    server.mempool.clear();
    
    console.log(`Block ${server.height} committed`);
  },

  getEntity(signerId: SignerId, entityId: EntityId) {
    return server.signers.get(signerId)?.get(entityId);
  }
};

function applyTx(storage: { value: number }, tx: EntityTx): { value: number } {
  if (tx.type === 'create') return { value: 0 };
  return { value: storage.value + tx.n };
}

if (import.meta.main) {
  (async () => {
    // Register multi-sig entity
    Server.registerEntity('dao', ['alice', 'bob', 'charlie']);
    Server.importEntity('alice', 'dao', { value: 1000 });
    Server.importEntity('bob', 'dao', { value: 1000 });
    Server.importEntity('charlie', 'dao', { value: 1000 });

    // Register single-sig entity
    Server.registerEntity('counter', ['alice']);
    Server.importEntity('alice', 'counter', { value: 0 });

    // Add transactions
    Server.addTx('alice', 'dao', { type: 'increment', n: 5 });
    Server.addTx('alice', 'counter', { type: 'increment', n: 1 });
    
    await Server.tick();

    console.log('DAO at alice:', Server.getEntity('alice', 'dao'));
    console.log('DAO at bob:', Server.getEntity('bob', 'dao'));
    console.log('Counter:', Server.getEntity('alice', 'counter'));
  })();
}   