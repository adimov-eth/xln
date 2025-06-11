import { createHash } from 'crypto';
import type {
    EntityInput,
    EntityState,
    EntityTx,
    OutboxMsg,
    ServerState,
    ServerTx,
} from './types.ts';

/**
 * Pure utility: compute SHA-256 over UTF-8 string.
 */
const sha256 = (data: string): string =>
  createHash('sha256').update(data, 'utf8').digest('hex');

/**
 * Custom JSON replacer that handles BigInt serialization.
 */
const jsonReplacer = (key: string, value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return `__bigint__${value.toString()}`;
  }
  return value;
};

/**
 * Compute deterministic block hash from ordered tx list.
 */
export const hashBlock = (txs: readonly EntityTx[]): string =>
  sha256(JSON.stringify(txs, jsonReplacer));

/**
 * Apply business-logic transactions to opaque application state (default wallet).
 * Replace with app-specific reducer as needed.
 */
export const applyTxs = <TState extends Record<string, unknown>>(
  state: TState,
  txs: readonly EntityTx[],
): TState => {
  return txs.reduce<TState>((acc, tx) => {
    switch (tx.op) {
      case 'mint': {
        const rawPrev = (acc as Record<string, unknown>).balance as
          | bigint
          | undefined;
        const prev = rawPrev ?? 0n;
        const amount = BigInt((tx as any).data.amount);
        return { ...acc, balance: prev + amount } as TState;
      }
      case 'transfer':
        // domain-specific; noop in generic core
        return acc;
      default:
        return acc;
    }
  }, { ...state });
};

/**
 * Create new empty server with given signer slots.
 */
export const initServer = (signerCount: number): ServerState => {
  const signers = new Map<number, Map<string, EntityState>>();
  for (let i = 0; i < signerCount; i++) signers.set(i, new Map());
  return {
    height: 0,
    signers,
    mempool: [],
  };
};

/**
 * Import (or create) entity under signer.
 */
export const importEntity = <TState extends Record<string, unknown>>({
  server,
  signerIdx,
  entityId,
  initialState,
  height = 0,
  quorum,
}: {
  server: ServerState;
  signerIdx: number;
  entityId: string;
  initialState: TState;
  height?: number;
  quorum?: readonly number[];
}): ServerState => {
  const entities = server.signers.get(signerIdx);
  if (!entities) return server; // invalid signer

  const newEntity: EntityState<TState> = {
    height,
    state: initialState,
    mempool: [],
    quorum: quorum?.length ? [...quorum] : [signerIdx],
    status: 'idle',
  };

  const newEntities = new Map(entities).set(entityId, newEntity);
  const newSigners = new Map(server.signers).set(signerIdx, newEntities);
  return { ...server, signers: newSigners };
};

/**
 * Apply an EntityInput, producing new entity state & optional outbox.
 */
export const applyEntityInput = <TState extends Record<string, unknown>>(
  entity: EntityState<TState>,
  input: EntityInput,
  entityId: string,
  outbox: OutboxMsg[],
): EntityState<TState> => {
  switch (input.type) {
    case 'add_tx':
      return entity.status === 'idle'
        ? { ...entity, mempool: [...entity.mempool, input.tx] }
        : entity;

    case 'propose_block':
      if (entity.status !== 'idle' || entity.mempool.length === 0) return entity;
      return {
        ...entity,
        proposed: {
          txs: [...entity.mempool],
          hash: hashBlock(entity.mempool),
          status: 'pending',
        },
        status: 'proposed',
      };

    case 'commit_block':
      if (entity.status !== 'proposed' || entity.proposed?.hash !== input.blockHash)
        return entity;
      const newState = applyTxs(entity.state, entity.proposed.txs);
      // sample cross-entity notification
      const bal = (newState as any).balance as bigint | undefined;
      if (bal !== undefined && bal > 1000n) {
        outbox.push({
          from: entityId,
          toEntity: 'hub',
          toSigner: entity.quorum[0] ?? 0,
          input: { type: 'add_tx', tx: { op: 'notify', data: { balance: (newState as any).balance } } },
        });
      }
      return {
        ...entity,
        height: entity.height + 1,
        state: newState,
        mempool: [],
        proposed: undefined,
        status: 'idle',
      };
    default:
      return entity;
  }
};

/**
 * Process current mempool into next block; pure & synchronous.
 */
export const applyServerBlock = (server: ServerState): ServerState => {
  const outbox: OutboxMsg[] = [];
  const newSigners = new Map<number, Map<string, EntityState>>();

  // iterate signers for structural cloning
  for (const [idx, entities] of server.signers) newSigners.set(idx, new Map(entities));

  server.mempool.forEach((tx) => {
    const entities = newSigners.get(tx.signer);
    if (!entities) return;
    const entity = entities.get(tx.entityId);
    if (!entity || !entity.quorum.includes(tx.signer)) return;
    const updated = applyEntityInput(entity, tx.input, tx.entityId, outbox);
    entities.set(tx.entityId, updated);
  });

  const newMempool: ServerTx[] = outbox.map((msg) => ({
    signer: msg.toSigner,
    entityId: msg.toEntity,
    input: msg.input,
  }));

  return {
    height: server.height + 1,
    signers: newSigners,
    mempool: newMempool,
  };
};

/**
 * Deterministically hash server topology (signer→entity heights).
 */
export const computeServerHash = (server: ServerState): string => {
  const snapshot: string[][] = [];
  for (const [idx, entities] of server.signers) {
    const arr: string[] = [];
    for (const [id, st] of entities) arr.push(`${id}:${st.height}`);
    snapshot[idx] = arr;
  }
  return sha256(JSON.stringify(snapshot, jsonReplacer));
}; 