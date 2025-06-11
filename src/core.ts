import * as RLP from 'rlp';
import { addTxToMempool, commitBlock as commitBlockTransition, proposeBlock as proposeBlockTransition, transitionKey } from './entityTransitions.ts';
import { composeApplyTxs, defaultProtocols } from './protocols.ts';
import type {
  EntityInput,
  EntityState,
  EntityTx,
} from './types/entity.ts';
import type { Message, ServerState } from './types/server.ts';
import { jsonReplacer, sha256, StreamingHash } from './utils.ts';

/**
 * Compute deterministic block hash from ordered tx list.
 */
export const hashBlock = (txs: readonly EntityTx[]): string => {
  // RLP encode [ [op, dataJson] ... ] for canonical binary representation
  const encoded = RLP.encode(
    txs.map((tx) => [tx.op, JSON.stringify(tx.data, jsonReplacer)]),
  );
  return sha256(encoded);
};

/**
 * Apply business-logic transactions to opaque application state (default wallet).
 * Replace with app-specific reducer as needed.
 */
export const applyTxs = <TState extends Record<string, unknown>>(
  state: TState,
  txs: readonly EntityTx[],
): TState => {
  // Use composed protocol handler; fallback to identity for unknown state shape
  const apply = composeApplyTxs<Record<string, unknown>>(defaultProtocols as any);
  return apply(state as Record<string, unknown>, txs) as TState;
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
  outbox: Message[],
): EntityState<TState> => {
  // Transition table mapping
  const stateTransitions: Record<string, (e: EntityState<TState>) => EntityState<TState>> = {
    [transitionKey('idle', 'add_tx')]: () => addTxToMempool(entity, (input as any).tx),
    [transitionKey('idle', 'propose_block')]: () => proposeBlockTransition(entity),
    [transitionKey('proposed', 'commit_block')]: () => commitBlockTransition(entity, (input as any).blockHash, entityId, outbox),
  } as const;

  const fn = stateTransitions[transitionKey(entity.status, input.type)];
  return fn ? fn(entity) : entity;
};

/**
 * Process current mempool into next block; pure & synchronous.
 */
export const applyServerBlock = (server: ServerState): ServerState => {
  const outbox: Message[] = [];
  const newSigners = new Map<number, Map<string, EntityState>>();

  // iterate signers for structural cloning
  for (const [idx, entities] of server.signers) newSigners.set(idx, new Map(entities));

  server.mempool.forEach((msg) => {
    if (msg.scope !== 'direct') return; // only direct messages trigger state
    const entities = newSigners.get(msg.signer);
    if (!entities) return;
    const entity = entities.get(msg.entityId);
    if (!entity) return;
    // quorum membership check
    if (!entity.quorum.includes(msg.signer)) return;
    // proposer validation: only first quorum member may propose block
    if (msg.input.type === 'propose_block' && entity.quorum[0] !== msg.signer) return;
    const updated = applyEntityInput(entity, msg.input, msg.entityId, outbox);
    entities.set(msg.entityId, updated);
  });

  const newMempool: Message[] = outbox.filter((m) => m.scope === 'outbox').map((m) => ({
    scope: 'direct',
    signer: m.toSigner,
    entityId: m.toEntity,
    input: m.input,
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
  const rootHash = StreamingHash.create();
  
  for (const [idx, entities] of server.signers) {
    const signerHash = StreamingHash.create();
    signerHash.update(`signer:${idx}`);
    
    for (const [id, st] of entities) {
      const entityHash = StreamingHash.create()
        .update(`entity:${id}`)
        .update(`height:${st.height}`)
        .update(JSON.stringify(st.state, jsonReplacer));
      signerHash.update(entityHash.digest());
    }
    
    rootHash.update(signerHash.digest());
  }
  
  return rootHash.digest();
}; 