import { describe, it, expect } from 'bun:test';
import { createRegistry, registerEntity } from '../src/core/server';
import { toSignerIdx } from '../src/types';

describe('registerEntity validation', () => {
  it('should reject empty quorum', () => {
    const registry = createRegistry();
    
    expect(() => {
      registerEntity(registry, 'test-entity', []);
    }).toThrow('Quorum must have at least one signer');
  });

  it('should reject quorum exceeding maximum size', () => {
    const registry = createRegistry();
    const MAX_QUORUM_SIZE = 1_000_000;
    
    // Create an array with more than MAX_QUORUM_SIZE signers
    const tooManySigners = Array.from({ length: MAX_QUORUM_SIZE + 1 }, (_, i) => toSignerIdx(i));
    
    expect(() => {
      registerEntity(registry, 'test-entity', tooManySigners);
    }).toThrow(`Quorum size ${MAX_QUORUM_SIZE + 1} exceeds maximum allowed size of ${MAX_QUORUM_SIZE}`);
  });

  it('should accept valid quorum sizes', () => {
    const registry = createRegistry();
    
    // Single signer
    expect(() => {
      registerEntity(registry, 'single-signer', [toSignerIdx(0)]);
    }).not.toThrow();
    
    // Multiple signers
    expect(() => {
      registerEntity(registry, 'multi-signer', [toSignerIdx(0), toSignerIdx(1), toSignerIdx(2)]);
    }).not.toThrow();
    
    // Large but valid quorum
    const largeQuorum = Array.from({ length: 1000 }, (_, i) => toSignerIdx(i));
    expect(() => {
      registerEntity(registry, 'large-quorum', largeQuorum);
    }).not.toThrow();
  });
});