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
    
    // Should be in registry
    expect(server.registry.has(id('test'))).toBe(true);
    
    // Should NOT have any entity replicas yet
    expect(server.signers.size).toBe(0);
  });
  
  test('importEntity creates replicas at signers', () => {
    let server = createInitialState();
    
    // First register
    server = registerEntity(server, 'test', [0, 1], { balance: 100n, nonce: 0 });
    
    // Then import to signer 0
    server = importEntity(server, signer(0), 'test');
    
    // Should have signer 0 with the entity
    expect(server.signers.has(signer(0))).toBe(true);
    expect(getEntityFromSigner(server, signer(0), id('test'))).toBeDefined();
    
    // Should NOT have signer 1 yet
    expect(server.signers.has(signer(1))).toBe(false);
    
    // Import to signer 1
    server = importEntity(server, signer(1), 'test');
    
    // Now should have both signers
    expect(server.signers.size).toBe(2);
    expect(getEntityFromSigner(server, signer(1), id('test'))).toBeDefined();
  });
  
  test('getEntityAcrossSigners returns all replicas', () => {
    let server = createInitialState();
    
    // Register and import to multiple signers
    server = registerEntity(server, 'test', [0, 1, 2], { balance: 100n, nonce: 0 });
    server = importEntity(server, signer(0), 'test');
    server = importEntity(server, signer(1), 'test');
    server = importEntity(server, signer(2), 'test');
    
    const replicas = getEntityAcrossSigners(server, id('test'));
    
    expect(replicas.size).toBe(3);
    expect(replicas.has(signer(0))).toBe(true);
    expect(replicas.has(signer(1))).toBe(true);
    expect(replicas.has(signer(2))).toBe(true);
  });
  
  test('import fails if signer not in quorum', () => {
    let server = createInitialState();
    
    server = registerEntity(server, 'test', [0, 1], { balance: 100n, nonce: 0 });
    
    // Try to import to signer 2 (not in quorum)
    expect(() => {
      importEntity(server, signer(2), 'test');
    }).toThrow('Signer 2 not in quorum');
  });
  
  test('import is idempotent', () => {
    let server = createInitialState();
    
    server = registerEntity(server, 'test', [0], { balance: 100n, nonce: 0 });
    server = importEntity(server, signer(0), 'test');
    
    const firstImport = server;
    
    // Import again - should be no-op
    server = importEntity(server, signer(0), 'test');
    
    expect(server).toBe(firstImport); // Same reference, no changes
  });
});