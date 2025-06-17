import { createHash } from 'crypto';
import type { BlockHash, BlockHeight, EntityId } from '../types/primitives.js';
import { hash } from '../types/primitives.js';
import type { EntityTx, ServerState } from '../types/state.js';
import { encode } from './encoding.js';
import { MerkleTree } from './merkle.js';
import { RLP } from '@ethereumjs/rlp';
import { serializeWithBigInt } from './serialization.js';

const sha256 = (data: Buffer): Buffer => {
  return createHash('sha256').update(data).digest();
};

export const deterministicHash = (data: any): string => {
  // This function is now legacy, but kept for non-RLP hashing needs.
  // RLP should be preferred for any data that needs a deterministic hash.
  const serialized = JSON.stringify(data);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
};

export const computeBlockHash = (
  entityId: EntityId,
  blockHeight: BlockHeight,
  state: any,
  txs: readonly EntityTx[],
): BlockHash => {
  const encoded = RLP.encode([
    entityId,
    Number(blockHeight),
    serializeWithBigInt(state),
    txs.map(encode.entityTx),
  ]);
  return hash(sha256(Buffer.from(encoded)).toString('hex'));
};

export const computeStateHash = (server: ServerState): string => {
  const tree = new MerkleTree(sha256);

  for (const [signerId, entities] of server.signers) {
    for (const [entityId, entity] of entities) {
      const key = encode.merkleKey(signerId, entityId);
      const value = Buffer.from(RLP.encode(encode.entityState(entity)));
      tree.insert(key, value);
    }
  }

  // To make the hash sensitive to height and registry changes,
  // we hash the Merkle root with that data.
  const rootHash = tree.getRootHash();
  const finalHash = sha256(
    Buffer.concat([
      Buffer.from(rootHash, 'hex'),
      Buffer.from(RLP.encode(Number(server.height))),
      Buffer.from(RLP.encode(encode.registry(server.registry))),
    ]),
  );

  return finalHash.toString('hex');
};