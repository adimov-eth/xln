import { createHash } from 'crypto';
import { Level } from 'level';
import { encode } from 'rlp';
import { Entity, encodeBlock } from './entity.js';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();
const merkleRoot = (leaves: Buffer[]) => {
  if (leaves.length === 0) return Buffer.alloc(32);
  let level = leaves.map(sha256);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!, b = level[i + 1] ?? level[i]!;
      next.push(sha256(Buffer.concat([a, b])));
    }
    level = next;
  }
  return level[0]!;
};

type EntityId   = string;
type Entities  = Map<EntityId, ReturnType<typeof Entity.init>>;

type ServerState = Readonly<{
  height : number;
  entities   : Entities;
}>;

const logDb   = new Level<string, Buffer>('./db/log',   { valueEncoding: 'buffer' });
const stateDb = new Level<string, Buffer>('./db/state', { valueEncoding: 'buffer' });

const makeServer = (): ServerState => ({ height: 0, entities: new Map() });

const withEntity = (s: ServerState, id: EntityId, f: (e: ReturnType<typeof Entity.init>) =>
                      ReturnType<typeof Entity.init>): ServerState => {
  const next = new Map(s.entities);
  next.set(id, f(next.get(id) ?? Entity.init()));
  return { ...s, entities: next };
};

export const Server = {
  addTx(state: ServerState, id: EntityId, tx: Parameters<typeof Entity.addTx>[1]): ServerState {
    return withEntity(state, id, e => Entity.addTx(e, tx));
  },

  async tick(state: ServerState): Promise<ServerState> {
    const nextEntities = new Map<EntityId, ReturnType<typeof Entity.init>>();
    const blockLeaves: Buffer[] = [];

    for (const [id, ent] of state.entities) {
      const committed = ent.mempool.size ? Entity.commit(ent) : ent;
      nextEntities.set(id, committed);

      if (committed.lastBlock) {
        const key = `${id}:${committed.lastBlock.height}`;
        await logDb.put(key, encodeBlock(committed.lastBlock));

        const leaf = Buffer.from(encode([id, committed.lastBlock.height,
          committed.lastBlock.storage.value]));
        blockLeaves.push(leaf);
      }
    }

    const newHeight  = state.height + 1;
    const rootHash   = merkleRoot(blockLeaves);
    await stateDb.put(
      newHeight.toString().padStart(10, '0'),
      Buffer.concat([rootHash, Buffer.from(Uint32Array.of(Date.now()).buffer)])
    );

    return { height: newHeight, entities: nextEntities };
  }
};

if (import.meta.main) {
  (async () => {
    let s = makeServer();

    s = Server.addTx(s, 'counter', { type: 'create' });
    for (let i = 0; i < 3; i++)
      s = Server.addTx(s, 'counter', { type: 'increment', n: 1 });

    s = await Server.tick(s);
    console.log('block #1 committed');

    s = Server.addTx(s, 'counter', { type: 'increment', n: 5 });
    s = await Server.tick(s);
    console.log('block #2 committed');
  })();
}
