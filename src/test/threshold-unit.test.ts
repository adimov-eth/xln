import { expect, test } from 'bun:test';
import { createServer, registerEntity } from '../engine/server.js';
import { calcRequiredApprovals } from '../entity/commands.js';
import { id } from '../types/primitives.js';
import { decode, encode } from '../utils/encoding.js';

test('calcRequiredApprovals math is correct', () => {
  // Test default 66% threshold
  expect(calcRequiredApprovals(1)).toBe(1);
  expect(calcRequiredApprovals(2)).toBe(2);
  expect(calcRequiredApprovals(3)).toBe(2);
  expect(calcRequiredApprovals(5)).toBe(4);
  expect(calcRequiredApprovals(10)).toBe(7);
  
  // Test custom thresholds
  expect(calcRequiredApprovals(5, 80)).toBe(4);
  expect(calcRequiredApprovals(5, 50)).toBe(3);
  expect(calcRequiredApprovals(10, 90)).toBe(9);
  expect(calcRequiredApprovals(100, 51)).toBe(51);
});

test('EntityMeta threshold encoding/decoding', () => {
  const meta = {
    id: id('test'),
    quorum: [],
    timeoutMs: 5000,
    protocol: 'wallet',
    thresholdPercent: 75,
  };
  
  const encoded = encode.entityMeta(meta);
  const decoded = decode.entityMeta(encoded as any);
  
  expect(decoded.thresholdPercent).toBe(75);
  
  // Test without threshold
  const meta2 = {
    id: id('test2'),
    quorum: [],
    timeoutMs: 5000,
    protocol: 'wallet',
  };
  
  const encoded2 = encode.entityMeta(meta2);
  const decoded2 = decode.entityMeta(encoded2 as any);
  
  expect(decoded2.thresholdPercent).toBeUndefined();
});

test('registerEntity validates threshold', () => {
  const server = createServer();
  
  // Valid thresholds
  expect(() => registerEntity(server, 'test1', {
    quorum: [0],
    protocol: 'wallet',
    thresholdPercent: 1,
  })).not.toThrow();
  
  expect(() => registerEntity(server, 'test2', {
    quorum: [0],
    protocol: 'wallet',
    thresholdPercent: 100,
  })).not.toThrow();
  
  // Invalid thresholds
  expect(() => registerEntity(server, 'test3', {
    quorum: [0],
    protocol: 'wallet',
    thresholdPercent: 0,
  })).toThrow('Threshold percent must be between 1 and 100');
  
  expect(() => registerEntity(server, 'test4', {
    quorum: [0],
    protocol: 'wallet',
    thresholdPercent: 101,
  })).toThrow('Threshold percent must be between 1 and 100');
});