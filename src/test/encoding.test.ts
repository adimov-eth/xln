import { test, expect } from 'bun:test';
import { createServer, importEntity, registerEntity, submitCommand } from '../engine/server.js';
import { height, id, signer } from '../types/primitives.js';
import type { ServerState } from '../types/state.js';
import { decode, encode } from '../utils/encoding.js';

const createTestServerState = (): ServerState => {
  let server = createServer();
  server = registerEntity(server, 'wallet-1', { quorum: [1], protocol: 'wallet' });
  server = importEntity(server, signer(1), 'wallet-1', { balance: 1000n, nonce: 0 });
  server = submitCommand(server, signer(1), 'wallet-1', {
    type: 'addTx',
    tx: { op: 'transfer', data: { to: 'wallet-2', amount: '50' }, nonce: 1 },
  });
  return { ...server, height: height(10) };
};

test('RLP encoding round trip for ServerState', () => {
  const original = createTestServerState();
  const encoded = encode.serverState(original);
  const decoded = decode.serverState(encoded);
  
  // Check that the key structures are preserved
  expect(decoded.height).toEqual(original.height);
  expect(decoded.signers.size).toEqual(original.signers.size);
  expect(decoded.registry.size).toEqual(original.registry.size);
  expect(decoded.mempool.length).toEqual(original.mempool.length);
  
  // Check entity details
  const originalEntity = original.signers.get(signer(1))!.get(id('wallet-1'))!;
  const decodedSigner = decoded.signers.get(signer(1));
  expect(decodedSigner).toBeDefined();
  
  // Debug: check what keys are in the decoded signer map
  const decodedKeys = Array.from(decodedSigner!.keys());
  expect(decodedKeys.length).toBe(1);
  expect(decodedKeys[0]).toBe(id('wallet-1'));
  
  const decodedEntity = decodedSigner!.get(id('wallet-1'))!;
  expect(decodedEntity.id).toEqual(originalEntity.id);
  expect(decodedEntity.height).toEqual(originalEntity.height);
  expect(decodedEntity.stage).toEqual(originalEntity.stage);
  expect(decodedEntity.data.balance).toEqual(originalEntity.data.balance);
  expect(decodedEntity.data.nonce).toEqual(originalEntity.data.nonce);
  
  // Check mempool transaction
  const originalTx = original.mempool[0];
  const decodedTx = decoded.mempool[0];
  if (originalTx && decodedTx) {
    expect(decodedTx.signer).toEqual(originalTx.signer);
    expect(decodedTx.entityId).toEqual(originalTx.entityId);
    expect(decodedTx.command.type).toEqual(originalTx.command.type);
  }
});

test('deterministic RLP encoding', () => {
  const state1 = createTestServerState();
  const state2 = createTestServerState(); // Create an identical state
  
  const encoded1 = encode.serverState(state1);
  const encoded2 = encode.serverState(state2);
  
  expect(encoded1).toEqual(encoded2);
});

test('RLP encoding handles null and undefined fields', () => {
  let server = createServer();
  server = registerEntity(server, 'wallet-1', { quorum: [1], protocol: 'wallet' });
  server = importEntity(server, signer(1), 'wallet-1', { balance: 1000n, nonce: 0 });
  server = { ...server, height: height(10), mempool: [] };

  const encoded = encode.serverState(server);
  const decoded = decode.serverState(encoded);

  const decodedEntity = decoded.signers.get(signer(1))!.get(id('wallet-1'))!;
  expect(decodedEntity.proposal).toBeUndefined();
  expect(decodedEntity.lastBlockHash).toBeUndefined();
});