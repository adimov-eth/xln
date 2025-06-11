import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { Level } from 'level';
import * as RLP from 'rlp';
import type { EntityState, ServerState, ServerTx } from './types.ts';

// BigInt-aware JSON (prefix __bigint__)
const jsonReplacer = (_: string, value: unknown) =>
  typeof value === 'bigint' ? `__bigint__${value.toString()}` : value;
const jsonReviver = (_: string, value: unknown) =>
  typeof value === 'string' && value.startsWith('__bigint__')
    ? BigInt(value.slice(10))
    : value;

const bigJsonEncoding = {
  encode: (val: unknown) =>
    Buffer.from(JSON.stringify(val, jsonReplacer), 'utf8'),
  decode: (buf: Buffer) => JSON.parse(buf.toString('utf8'), jsonReviver),
  buffer: true as const,
  type: 'bigjson' as const,
};

// Database instances - will be initialized on first use
let stateDB: Level<string, any> | null = null;
let walDB: Level<string, any> | null = null;
let blockDB: Level<string, Uint8Array> | null = null;

/** Snapshot every N blocks */
export const SNAPSHOT_INTERVAL = 100;

/**
 * Initialize all databases - call before any persistence operations.
 */
export const initDatabases = async (): Promise<void> => {
  if (!stateDB) {
    stateDB = new Level<string, any>('./state', { valueEncoding: bigJsonEncoding });
    await stateDB.open();
  }
  
  if (!walDB) {
    walDB = new Level<string, any>('./wal', { valueEncoding: bigJsonEncoding });
    await walDB.open();
  }
  
  if (!blockDB) {
    blockDB = new Level('./blocks', { valueEncoding: 'binary' });
    await blockDB.open();
  }
};

/**
 * Close all databases gracefully.
 */
export const closeDatabases = async (): Promise<void> => {
  await Promise.all([
    stateDB?.close(),
    walDB?.close(), 
    blockDB?.close()
  ]);
  stateDB = null;
  walDB = null;
  blockDB = null;
};

/**
 * Ensure databases are initialized.
 */
const ensureInit = async (): Promise<void> => {
  if (!stateDB || !walDB || !blockDB) {
    await initDatabases();
  }
};

/**
 * Append transaction to WAL keyed by height:signer:entity.
 */
export const appendWAL = async (
  height: number,
  tx: ServerTx,
): Promise<void> => {
  await ensureInit();
  const key = `${height}:${tx.signer}:${tx.entityId}`;
  await walDB!.put(key, tx);
};

/**
 * Store binary-encoded block.
 */
export const storeBlock = async (
  height: number,
  blockData: readonly ServerTx[],
): Promise<void> => {
  await ensureInit();
  const payload = RLP.encode([
    height,
    Date.now(),
    blockData.map((tx) => [
      tx.signer,
      tx.entityId,
      JSON.stringify(tx.input, jsonReplacer),
    ]),
  ]);
  await blockDB!.put(height.toString(), payload);
};

/**
 * Save full snapshot of ServerState into stateDB with root hash for quick integrity check.
 */
export const saveSnapshot = async (server: ServerState): Promise<void> => {
  await ensureInit();
  // Root hash accumulator
  const root = createHash('sha256');

  for (const [signerIdx, entities] of server.signers) {
    for (const [entityId, state] of entities) {
      await stateDB!.put(`${signerIdx}:${entityId}`, state);
      root.update(`${signerIdx}:${entityId}:${state.height}`);
    }
  }

  await stateDB!.put('root', {
    height: server.height,
    hash: root.digest('hex'),
  });
};

/**
 * Restore state from the most recent snapshot and WAL replay.
 */
export const restoreServer = async (): Promise<ServerState> => {
  await ensureInit();
  
  const rootMeta = (await stateDB!.get('root').catch(() => null)) as
    | { height: number; hash: string }
    | null;

  const signers = new Map<number, Map<string, EntityState>>();
  let height = rootMeta?.height ?? 0;

  // Load snapshot entities
  if (rootMeta) {
    for await (const [key, value] of stateDB!.iterator()) {
      if (key === 'root') continue;
      const parts = (key as string).split(':');
      const signerStr = parts[0];
      const entityId = parts[1];
      if (!signerStr || !entityId) continue;
      
      const signerIdx = parseInt(signerStr, 10);
      if (!signers.has(signerIdx)) signers.set(signerIdx, new Map());
      signers.get(signerIdx)!.set(entityId, value as EntityState);
    }
  }

  // Replay WAL after snapshot
  const mempool: ServerTx[] = [];
  for await (const [key, tx] of walDB!.iterator()) {
    const parts = (key as string).split(':');
    const hStr = parts[0];
    if (!hStr) continue;
    
    const h = parseInt(hStr, 10);
    if (h >= height) mempool.push(tx as ServerTx);
  }

  return {
    height,
    signers,
    mempool,
  };
}; 