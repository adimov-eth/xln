// encoding.ts - Safe RLP encoding/decoding
import { Buffer } from 'buffer';
import { decode, encode } from 'rlp';
import * as t from './types';

type RLPInput = string | number | Buffer | RLPInput[];
type RLPDecoded = Buffer | RLPDecoded[];

export function encodeEntityTx(tx: t.EntityTx): Buffer {
  const args: RLPInput[] = tx.args.map(arg => 
    typeof arg === 'number' ? arg : Buffer.from(String(arg))
  );
  return Buffer.from(encode([Buffer.from(tx.op), ...args, tx.nonce ?? 0]));
}

export function encodeEntityInput(input: t.EntityInput): Buffer {
  switch (input.type) {
    case 'AddTx':
      return Buffer.from(encode([Buffer.from('AddTx'), encodeEntityTx(input.tx)]));
    case 'ProposeBlock':
      return Buffer.from(encode([Buffer.from('ProposeBlock')]));
    case 'CommitBlock':
      return Buffer.from(encode([Buffer.from('CommitBlock'), Buffer.from(input.blockHash)]));
    case 'Flush':
      return Buffer.from(encode([Buffer.from('Flush')]));
  }
}

export function encodeServerTx(tx: t.ServerTx): Buffer {
  return Buffer.from(encode([
    Buffer.from(tx.signerId, 'hex'),
    Buffer.from(tx.entityId, 'hex'),
    encodeEntityInput(tx.input),
    tx.timestamp
  ]));
}

export function encodeEntityBlock(block: t.EntityBlock): Buffer {
  return Buffer.from(encode([
    block.height,
    block.timestamp,
    block.txs.map(tx => encodeEntityTx(tx)),
    Buffer.from(block.stateRoot),
    encodeEntityStorage(block.storage)
  ]));
}

export function encodeEntityStorage(storage: t.EntityStorage): Buffer {
  // Convert storage to RLP-compatible format
  const entries = Object.entries(storage).sort(([a], [b]) => a.localeCompare(b));
  const rlpEntries: RLPInput[] = entries.map(([key, value]) => {
    let encodedValue: RLPInput;
    if (typeof value === 'boolean') {
      encodedValue = value ? 1 : 0;
    } else if (typeof value === 'number') {
      encodedValue = value;
    } else {
      encodedValue = Buffer.from(String(value));
    }
    return [Buffer.from(key), encodedValue];
  });
  return Buffer.from(encode(rlpEntries));
}

export function encodeServerBlock(block: t.ServerBlock): Buffer {
  return Buffer.from(encode([
    block.height,
    block.timestamp,
    block.inputs.map(tx => encodeServerTx(tx)),
    Buffer.from(block.stateRoot)
  ]));
}

function decodeBuffer(value: RLPDecoded): Buffer {
  if (Buffer.isBuffer(value)) return value;
  throw new Error('Expected Buffer');
}

function decodeNumber(value: RLPDecoded): number {
  if (Buffer.isBuffer(value)) {
    if (value.length === 0) return 0;
    return parseInt(value.toString('hex'), 16);
  }
  if (typeof value === 'number') return value;
  throw new Error('Expected number');
}

function decodeString(value: RLPDecoded): string {
  if (Buffer.isBuffer(value)) return value.toString();
  throw new Error('Expected string');
}

export function decodeEntityTx(data: Buffer): t.Result<t.EntityTx> {
  try {
    const decoded = decode(data);
    if (!Array.isArray(decoded) || decoded.length < 2) {
      return { ok: false, error: new Error('Invalid EntityTx format') };
    }
    
    const op = decodeString(decoded[0] as RLPDecoded);
    const argsAndNonce = decoded.slice(1);
    
    if (argsAndNonce.length === 0) {
      return { ok: false, error: new Error('Missing arguments and nonce') };
    }
    
    const nonce = decodeNumber(argsAndNonce[argsAndNonce.length - 1] as RLPDecoded);
    const args = argsAndNonce.slice(0, -1).map(arg => {
      try {
        return decodeNumber(arg as RLPDecoded);
      } catch {
        return decodeString(arg as RLPDecoded);
      }
    });
    
    const tx: t.EntityTx = {
      op,
      args,
      nonce: nonce > 0 ? nonce : undefined
    };
    
    return { ok: true, value: tx };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

export function decodeEntityStorage(data: Buffer): t.Result<t.EntityStorage> {
  try {
    const decoded = decode(data);
    if (!Array.isArray(decoded)) {
      return { ok: false, error: new Error('Invalid storage format') };
    }
    
    const storage: Record<string, string | number | boolean> = {};
    
    for (const entry of decoded) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        return { ok: false, error: new Error('Invalid storage entry') };
      }
      
      const key = decodeString(entry[0] as RLPDecoded);
      const value = entry[1];
      
      if (Buffer.isBuffer(value)) {
        // Try to decode as number first
        if (value.length <= 4) {
          const num = decodeNumber(value);
          // Check if it's a boolean (0 or 1)
          if (num === 0 || num === 1) {
            storage[key] = num === 1;
          } else {
            storage[key] = num;
          }
        } else {
          storage[key] = value.toString();
        }
      } else if (typeof value === 'number') {
        storage[key] = value;
      } else {
        storage[key] = String(value);
      }
    }
    
    return { ok: true, value: storage };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

import { createHash } from 'crypto';

export function hash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashEntityState(state: t.EntityState): string {
  const data = Buffer.concat([
    Buffer.from(state.status),
    encodeEntityStorage(state.storage),
    Buffer.from(state.height.toString())
  ]);
  return hash(data);
}

export function hashServerState(state: t.ServerState): string {
  const entityHashes: string[] = [];
  
  for (const [signerId, entities] of state.entities) {
    for (const [entityId, entity] of entities) {
      entityHashes.push(`${signerId}:${entityId}:${hashEntityState(entity)}`);
    }
  }
  
  entityHashes.sort();
  return hash(Buffer.from(entityHashes.join(',')));
}


export { decode, encode } from 'rlp';
