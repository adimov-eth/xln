// ============================================================================
// test/signer-layer.test.ts - Tests for signer layer functionality
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { importEntity, registerEntity } from '../core/server.js';
import { id, signer } from '../types/primitives.js';
import { createInitialState } from '../utils/serialization.js';
import { getEntityAcrossSigners, getEntityFromSigner } from '../utils/state-helpers.js';

describe('Signer Layer', () => {
  test('registerEntity only adds to registry', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0, 1], { balance: 100n, nonce: 0 });
    expect(server.registry.has(id('test'))).toBe(true);
    expect(server.signers.size).toBe(0);
  });
  
  test('importEntity creates replicas at signers', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0, 1], { balance: 100n, nonce: 0 });
    server = importEntity(server, signer(0), 'test');
    expect(server.signers.has(signer(0))).toBe(true);
    expect(getEntityFromSigner(server, signer(0), id('test'))).toBeDefined();
    expect(server.signers.has(signer(1))).toBe(false);
    server = importEntity(server, signer(1), 'test');
    expect(server.signers.size).toBe(2);
    expect(getEntityFromSigner(server, signer(1), id('test'))).toBeDefined();
  });
  
  test('getEntityAcrossSigners returns all replicas', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0, 1, 2], { balance: 100n, nonce: 0 });
    server = importEntity(server, signer(0), 'test');
    server = importEntity(server, signer(1), 'test');
    server = importEntity(server, signer(2), 'test');
    const replicas = getEntityAcrossSigners(server, id('test'));
    expect(replicas.size).toBe(3);
    expect(replicas.has(signer(0))).toBe(true);
  });
  
  test('import fails if signer not in quorum', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0, 1], { balance: 100n, nonce: 0 });
    expect(() => importEntity(server, signer(2), 'test')).toThrow('Signer 2 not in quorum');
  });
  
  test('import is idempotent', () => {
    let server = createInitialState();
    server = registerEntity(server, 'test', [0], { balance: 100n, nonce: 0 });
    server = importEntity(server, signer(0), 'test');
    const firstImport = server;
    server = importEntity(server, signer(0), 'test');
    expect(server).toBe(firstImport);
  });
});