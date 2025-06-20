import { RLP } from '@ethereumjs/rlp';
import { Level } from 'level';
import type { EntityState, EntityTx } from './entity.js';
import { createInitialState, decodeState, decodeTx, encodeState, encodeTx, executeBlock } from './entity.js';

export type EntityId = string;

export type ServerState = {
  blockNumber: number;
  mempool: Map<EntityId, EntityTx[]>;
};


type BlockData = Map<EntityId, EntityTx[]>;

class Storage {
  private logDb: Level<Buffer, Buffer>;
  private stateDb: Level<Buffer, Buffer>;

  constructor(basePath: string) {
    const options = { keyEncoding: 'binary' as const, valueEncoding: 'binary' as const };
    this.logDb = new Level<Buffer, Buffer>(`${basePath}/log`, options);
    this.stateDb = new Level<Buffer, Buffer>(`${basePath}/state`, options);
  }



  async loadEntity(id: EntityId): Promise<EntityState> {
    try {
      const data = await this.stateDb.get(Buffer.from(id));
      return decodeState(data);
    } catch (e: any) {
      if (e.code === 'LEVEL_NOT_FOUND') {
        return createInitialState();
      }
      throw e;
    }
  }

  async saveEntity(id: EntityId, state: EntityState): Promise<void> {
    await this.stateDb.put(Buffer.from(id), encodeState(state));
  }



  private encodeBlock(data: BlockData): Buffer {
    const encodedEntries = Array.from(data.entries()).map(([entityId, txs]) => {
      return [Buffer.from(entityId), txs.map(encodeTx)];
    });
    return Buffer.from(RLP.encode(encodedEntries));
  }

  private decodeBlock(data: Buffer): BlockData {
    const decodedEntries = RLP.decode(data) as unknown as [Buffer, Buffer[]][];
    const map = new Map<EntityId, EntityTx[]>();
    for (const [entityIdBuf, txsBuf] of decodedEntries) {
      const entityId = entityIdBuf.toString();
      const txs = txsBuf.map(decodeTx);
      map.set(entityId, txs);
    }
    return map;
  }

  async appendLog(blockNumber: number, data: BlockData): Promise<void> {
    const key = Buffer.alloc(4);
    key.writeUInt32BE(blockNumber);
    const value = this.encodeBlock(data);
    await this.logDb.put(key, value);
  }

  async *readLog(fromBlock: number): AsyncGenerator<{ blockNumber: number, data: BlockData }> {
    const startKey = Buffer.alloc(4);
    startKey.writeUInt32BE(fromBlock);

    for await (const [key, value] of this.logDb.iterator({ gte: startKey })) {
      const blockNumber = key.readUInt32BE(0);
      const data = this.decodeBlock(value);
      yield { blockNumber, data };
    }
  }
  
  async getLatestBlockNumber(): Promise<number> {
    let latest = 0;
    try {
      const keys = await this.logDb.keys({ reverse: true, limit: 1 }).all();
      if (keys.length > 0 && keys[0]) {
        latest = keys[0].readUInt32BE(0);
      }
    } catch (e) {
    
    }
    return latest;
  }

  async clear(): Promise<void> {
    await this.logDb.clear();
    await this.stateDb.clear();
  }
}



export function createServerState(): ServerState {
  return {
    blockNumber: 0,
    mempool: new Map(),
  };
}

export function receive(state: ServerState, entityId: EntityId, tx: EntityTx): ServerState {
  const newMempool = new Map(state.mempool);
  const entityTxs = newMempool.get(entityId) ?? [];
  entityTxs.push(tx);
  newMempool.set(entityId, entityTxs);

  return {
    ...state,
    mempool: newMempool,
  };
}


export async function processTick(state: ServerState, storage: Storage): Promise<ServerState> {
  if (state.mempool.size === 0) {
    return state;
  }

  const newBlockNumber = state.blockNumber + 1;
  const blockTxs = state.mempool;



  await storage.appendLog(newBlockNumber, blockTxs);


  for (const [entityId, txs] of blockTxs.entries()) {
    const currentState = await storage.loadEntity(entityId);
    const newState = executeBlock(currentState, txs);
    await storage.saveEntity(entityId, newState);
  }


  console.log(`Processed block ${newBlockNumber} with ${blockTxs.size} entities affected.`);
  return {
    blockNumber: newBlockNumber,
    mempool: new Map(),
  };
}


export async function recover(storage: Storage): Promise<void> {
  console.log('Starting recovery...');


  for await (const { blockNumber, data } of storage.readLog(0)) {
    console.log(`Replaying block ${blockNumber}...`);
    for (const [entityId, txs] of data.entries()) {
      const currentState = await storage.loadEntity(entityId);
      const newState = executeBlock(currentState, txs);
      await storage.saveEntity(entityId, newState);
    }
  }
  console.log('Recovery complete.');
}


async function main() {
  const storage = new Storage('./db');
  
  await recover(storage);
  
  const latestBlock = await storage.getLatestBlockNumber();
  let state = createServerState();
  state.blockNumber = latestBlock;

  console.log(`Server started. Current block: ${state.blockNumber}`);

  state = receive(state, 'wallet-alice', { op: 'create' });
  state = receive(state, 'wallet-alice', { op: 'increment', amount: 100 });
  state = receive(state, 'wallet-bob', { op: 'create' });
  state = receive(state, 'wallet-bob', { op: 'increment', amount: 50 });
  state = receive(state, 'wallet-alice', { op: 'increment', amount: -20 });


  state = await processTick(state, storage);


  const aliceState = await storage.loadEntity('wallet-alice');
  const bobState = await storage.loadEntity('wallet-bob');
  console.log("Alice's final state:", aliceState);
  console.log("Bob's final state:", bobState);    


  state = receive(state, 'wallet-bob', { op: 'increment', amount: 10 });
  state = await processTick(state, storage);
  const bobState2 = await storage.loadEntity('wallet-bob');
  console.log("Bob's state after 2nd tick:", bobState2);
}

if (import.meta.url.startsWith('file:') && process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(console.error);
}