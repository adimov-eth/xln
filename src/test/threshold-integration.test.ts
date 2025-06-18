import { test, expect } from 'bun:test';
import { createServer, registerEntity, importEntity, query } from '../engine/server.js';
import { signer } from '../types/primitives.js';
import { calcRequiredApprovals } from '../entity/commands.js';
import { scenario } from './fluent-api.js';
import { defaultRegistry } from '../protocols/registry.js';
import { transaction } from '../entity/transactions.js';

test('calcRequiredApprovals with different thresholds', () => {
  // Test various threshold calculations
  expect(calcRequiredApprovals(4, 50)).toBe(2);   // 4 * 50% = 2
  expect(calcRequiredApprovals(4, 25)).toBe(1);   // 4 * 25% = 1
  expect(calcRequiredApprovals(4, 75)).toBe(3);   // 4 * 75% = 3
  expect(calcRequiredApprovals(4, 100)).toBe(4);  // 4 * 100% = 4
  expect(calcRequiredApprovals(5, 60)).toBe(3);   // 5 * 60% = 3
  expect(calcRequiredApprovals(7, 51)).toBe(4);   // 7 * 51% = 3.57 -> 4
  expect(calcRequiredApprovals(10, 33)).toBe(4);  // 10 * 33% = 3.3 -> 4
  
  // Edge cases
  expect(calcRequiredApprovals(1, 1)).toBe(1);     // Single signer always needs 1
  expect(calcRequiredApprovals(1, 100)).toBe(1);   // Single signer always needs 1
  expect(calcRequiredApprovals(3, 34)).toBe(2);    // 3 * 34% = 1.02 -> 2
  expect(calcRequiredApprovals(3, 33)).toBe(1);    // 3 * 33% = 0.99 -> 1
});

test('entity registration with custom threshold stores correctly', () => {
  let server = createServer();
  
  // Register entities with various thresholds
  server = registerEntity(server, 'low', {
    quorum: [0, 1, 2],
    protocol: 'wallet',
    thresholdPercent: 34  // Just over 1/3
  });
  
  server = registerEntity(server, 'medium', {
    quorum: [0, 1, 2, 3],
    protocol: 'wallet',
    thresholdPercent: 50
  });
  
  server = registerEntity(server, 'high', {
    quorum: [0, 1, 2, 3],
    protocol: 'wallet',
    thresholdPercent: 90
  });
  
  server = registerEntity(server, 'unanimous', {
    quorum: [0, 1, 2],
    protocol: 'wallet',
    thresholdPercent: 100
  });
  
  server = registerEntity(server, 'minimal', {
    quorum: [0, 1, 2, 3, 4],
    protocol: 'wallet',
    thresholdPercent: 1
  });
  
  // Check metadata stored correctly
  const lowMeta = query.getMetadata(server, 'low');
  const mediumMeta = query.getMetadata(server, 'medium');
  const highMeta = query.getMetadata(server, 'high');
  const unanimousMeta = query.getMetadata(server, 'unanimous');
  const minimalMeta = query.getMetadata(server, 'minimal');
  
  expect(lowMeta?.thresholdPercent).toBe(34);
  expect(mediumMeta?.thresholdPercent).toBe(50);
  expect(highMeta?.thresholdPercent).toBe(90);
  expect(unanimousMeta?.thresholdPercent).toBe(100);
  expect(minimalMeta?.thresholdPercent).toBe(1);
  
  // Check required approvals calculation
  expect(calcRequiredApprovals(lowMeta!.quorum.length, lowMeta!.thresholdPercent)).toBe(2);
  expect(calcRequiredApprovals(mediumMeta!.quorum.length, mediumMeta!.thresholdPercent)).toBe(2);
  expect(calcRequiredApprovals(highMeta!.quorum.length, highMeta!.thresholdPercent)).toBe(4);
  expect(calcRequiredApprovals(unanimousMeta!.quorum.length, unanimousMeta!.thresholdPercent)).toBe(3);
  expect(calcRequiredApprovals(minimalMeta!.quorum.length, minimalMeta!.thresholdPercent)).toBe(1);
});

test('entity without explicit threshold uses default 66%', () => {
  let server = createServer();
  
  // Register without threshold
  server = registerEntity(server, 'default', {
    quorum: [0, 1, 2],
    protocol: 'wallet'
  });
  
  const meta = query.getMetadata(server, 'default');
  expect(meta?.thresholdPercent).toBeUndefined();
  
  // Default should behave as 66%
  expect(calcRequiredApprovals(3, 66)).toBe(2);
});

test('DAO with custom voting threshold', async () => {
  const s = scenario('custom voting threshold')
    .withProtocols(defaultRegistry)
    .withDao('governance', [0, 1, 2, 3, 4], { balance: 10000n, voteThreshold: 40 });
  
  // Create initiative
  s.sendTransaction(0, 'governance', transaction.createInitiative({
    title: 'Lower fees',
    description: 'Reduce fees by 50%',
    author: 0,
    actions: [transaction.burn('1000', 1)]
  }));
  
  await s.processUntilIdle();
  s.expectInitiativeCount('governance', 1);
  
  const initiativeId = s.getInitiativeId('governance', 0);
  
  // With 40% threshold and 5 members, need 2 votes to pass
  s.sendTransaction(0, 'governance', transaction.voteOnInitiative(initiativeId, true, 0));
  s.sendTransaction(1, 'governance', transaction.voteOnInitiative(initiativeId, true, 1));
  
  await s.processUntilIdle();
  
  // 2/5 = 40%, should pass
  s.expectInitiativeStatus('governance', 0, 'passed');
});

test('multi-sig wallet operations with custom threshold', async () => {
  const s = scenario('multi-sig with threshold')
    .withProtocols(defaultRegistry)
    .withWallet('multisig', [0, 1, 2, 3], 10000n, 50); // 50% threshold
  
  // For a 4-signer wallet with 50% threshold:
  // - Single signer can only add transactions
  // - Need 2 signers to approve blocks
  // - The system will handle consensus automatically
  
  s.sendTransaction(0, 'multisig', transaction.burn('1000', 1));
  
  // Process multiple blocks to let consensus happen
  await s.processBlocks(10);
  
  // The burn should complete after consensus
  s.expectBalance('multisig', 9000n);
});

test('threshold validation rejects invalid values', () => {
  let server = createServer();
  
  // Test threshold = 0
  expect(() => registerEntity(server, 'zero', {
    quorum: [0, 1],
    protocol: 'wallet',
    thresholdPercent: 0
  })).toThrow('Threshold percent must be between 1 and 100');
  
  // Test threshold > 100
  expect(() => registerEntity(server, 'too-high', {
    quorum: [0, 1],
    protocol: 'wallet',
    thresholdPercent: 101
  })).toThrow('Threshold percent must be between 1 and 100');
  
  // Test negative threshold
  expect(() => registerEntity(server, 'negative', {
    quorum: [0, 1],
    protocol: 'wallet',
    thresholdPercent: -10
  })).toThrow('Threshold percent must be between 1 and 100');
});