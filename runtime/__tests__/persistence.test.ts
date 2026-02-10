/**
 * Persistence tests — verify LevelDB save/restore round-trip.
 * Tests that BigInts, Maps, entity replicas, and financial state survive serialization.
 */

import { describe, expect, test, afterEach } from 'bun:test';
import { Level } from 'level';
import { createEmptyEnv } from '../runtime';
import { saveEnvToDB, loadEnvFromDB, getRuntimeDb, clearDB, tryOpenDb } from '../runtime';
import { createGossipLayer } from '../networking/gossip';
import { encode, decode } from '../snapshot-coder';
import type { Env } from '../types';

function createPersistableEnv(seed: string): Env {
  const env = createEmptyEnv(seed);
  // Don't override dbNamespace — let it derive from seed so load can find it
  env.scenarioMode = false; // Must be false for persistence to run
  env.gossip = createGossipLayer();
  return env;
}

// Clean up test DBs after each test
const cleanupEnvs: Env[] = [];
afterEach(async () => {
  for (const env of cleanupEnvs) {
    try {
      await clearDB(env);
      const db = getRuntimeDb(env);
      await db.close();
    } catch {
      // Ignore cleanup errors
    }
  }
  cleanupEnvs.length = 0;
});

describe('snapshot-coder round-trip', () => {
  test('BigInt survives encode/decode', () => {
    const data = { amount: 10000000000000000000n, balance: -5000000000000000000n, zero: 0n };
    const buffer = encode(data);
    const decoded = decode(buffer);
    expect(decoded.amount).toBe(10000000000000000000n);
    expect(decoded.balance).toBe(-5000000000000000000n);
    expect(decoded.zero).toBe(0n);
  });

  test('Map survives encode/decode', () => {
    const data = {
      reserves: new Map([
        ['token1', 500n],
        ['token2', 1000n],
      ]),
    };
    const buffer = encode(data);
    const decoded = decode(buffer);
    expect(decoded.reserves).toBeInstanceOf(Map);
    expect(decoded.reserves.get('token1')).toBe(500n);
    expect(decoded.reserves.get('token2')).toBe(1000n);
  });

  test('nested Map<string, Map<number, bigint>> survives', () => {
    const inner = new Map<number, bigint>([
      [1, 100n],
      [2, 200n],
    ]);
    const outer = new Map<string, Map<number, bigint>>([['entity1', inner]]);
    const data = { collaterals: outer };
    const buffer = encode(data);
    const decoded = decode(buffer);
    expect(decoded.collaterals).toBeInstanceOf(Map);
    const decodedInner = decoded.collaterals.get('entity1');
    expect(decodedInner).toBeInstanceOf(Map);
    expect(decodedInner.get(1)).toBe(100n);
    expect(decodedInner.get(2)).toBe(200n);
  });

  test('Uint8Array survives as array (stateRoot pattern)', () => {
    const stateRoot = new Uint8Array(32);
    stateRoot[0] = 0xde;
    stateRoot[31] = 0xad;
    const data = { stateRoot };
    const buffer = encode(data);
    const decoded = decode(buffer);
    // snapshot-coder doesn't tag Uint8Arrays — they become plain arrays
    // loadEnvFromDB handles reconversion via new Uint8Array(jr.stateRoot)
    expect(decoded.stateRoot[0]).toBe(0xde);
    expect(decoded.stateRoot[31]).toBe(0xad);
  });

  test('entity replica with accounts and deltas', () => {
    const replica = {
      state: {
        reserves: new Map([['1', 1000000n]]),
        accounts: new Map([
          [
            'counterparty-id',
            {
              deltas: new Map([
                [
                  1,
                  {
                    collateral: 500n,
                    ondelta: 100n,
                    offdelta: -200n,
                    leftCreditLimit: 10000n,
                    rightCreditLimit: 10000n,
                  },
                ],
              ]),
            },
          ],
        ]),
      },
    };
    const buffer = encode(replica);
    const decoded = decode(buffer);

    const reserves = decoded.state.reserves;
    expect(reserves).toBeInstanceOf(Map);
    expect(reserves.get('1')).toBe(1000000n);

    const accounts = decoded.state.accounts;
    expect(accounts).toBeInstanceOf(Map);
    const account = accounts.get('counterparty-id');
    expect(account).toBeDefined();
    const delta = account.deltas.get(1);
    expect(delta.collateral).toBe(500n);
    expect(delta.ondelta).toBe(100n);
    expect(delta.offdelta).toBe(-200n);
    expect(delta.leftCreditLimit).toBe(10000n);
    expect(delta.rightCreditLimit).toBe(10000n);
  });
});

describe('LevelDB persistence', () => {
  test('saveEnvToDB + loadEnvFromDB round-trip', async () => {
    const seed = `persist-roundtrip-${Date.now()}`;
    const env = createPersistableEnv(seed);
    cleanupEnvs.push(env);
    env.height = 5;
    env.timestamp = 1700000000000;

    // Add a mock eReplica with reserves
    env.eReplicas.set('entity1:signer1', {
      entityId: 'entity1',
      signerId: 'signer1',
      isProposer: true,
      state: {
        height: 3,
        lastFinalizedJHeight: 0,
        reserves: new Map([['1', 1000000000000000000n]]),
        accounts: new Map(),
        messages: [],
        locks: new Map(),
        swapOffers: new Map(),
        mempoolOps: new Map(),
      },
    } as any);

    // Save
    await saveEnvToDB(env);

    // Close DB
    const db = getRuntimeDb(env);
    await db.close();

    // Load from fresh context
    const restored = await loadEnvFromDB(null, seed);
    expect(restored).not.toBeNull();
    if (!restored) throw new Error('Failed to restore');
    cleanupEnvs.push(restored);

    expect(restored.height).toBe(5);
    expect(restored.timestamp).toBe(1700000000000);
    expect(restored.eReplicas.size).toBe(1);

    const replica = restored.eReplicas.get('entity1:signer1');
    expect(replica).toBeDefined();
    expect(replica!.state.reserves).toBeInstanceOf(Map);
    expect(replica!.state.reserves.get('1')).toBe(1000000000000000000n);
  });

  test('multiple saves at increasing heights', async () => {
    const seed = `persist-heights-${Date.now()}`;
    const env = createPersistableEnv(seed);
    cleanupEnvs.push(env);

    // Save at height 0
    env.height = 0;
    env.timestamp = 1000;
    await saveEnvToDB(env);

    // Save at height 1
    env.height = 1;
    env.timestamp = 2000;
    await saveEnvToDB(env);

    // Save at height 2
    env.height = 2;
    env.timestamp = 3000;
    await saveEnvToDB(env);

    const db = getRuntimeDb(env);
    await db.close();

    // Load should get latest (height 2)
    const restored = await loadEnvFromDB(null, seed);
    expect(restored).not.toBeNull();
    expect(restored!.height).toBe(2);
    expect(restored!.timestamp).toBe(3000);
    if (restored) cleanupEnvs.push(restored);
  });

  test('scenarioMode skips persistence', async () => {
    const seed = `persist-scenario-${Date.now()}`;
    const env = createPersistableEnv(seed);
    cleanupEnvs.push(env);
    env.scenarioMode = true;
    env.height = 10;
    await saveEnvToDB(env);

    // Force open the DB so we can close it properly
    await tryOpenDb(env);
    const db = getRuntimeDb(env);
    await db.close();

    // Should find nothing since save was skipped
    const restored = await loadEnvFromDB(null, seed);
    expect(restored).toBeNull();
  });

  test('jReplica metadata persists', async () => {
    const seed = `persist-jreplica-${Date.now()}`;
    const env = createPersistableEnv(seed);
    cleanupEnvs.push(env);
    env.height = 1;
    env.timestamp = 5000;
    env.activeJurisdiction = 'arrakis';

    env.jReplicas.set('arrakis', {
      name: 'arrakis',
      blockNumber: 42n,
      stateRoot: new Uint8Array(32),
      mempool: [],
      blockDelayMs: 300,
      lastBlockTimestamp: 4000,
      position: { x: 0, y: 0, z: 0 },
      // No rpcs — avoids loadEnvFromDB trying to connect to real RPC
      chainId: 11155111,
      depositoryAddress: '0x1234567890abcdef1234567890abcdef12345678',
      entityProviderAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
    } as any);

    await saveEnvToDB(env);

    const db = getRuntimeDb(env);
    await db.close();

    const restored = await loadEnvFromDB(null, seed);
    expect(restored).not.toBeNull();
    if (restored) cleanupEnvs.push(restored);
    expect(restored!.activeJurisdiction).toBe('arrakis');
    expect(restored!.jReplicas.size).toBe(1);

    const jr = restored!.jReplicas.get('arrakis');
    expect(jr).toBeDefined();
    expect(jr!.name).toBe('arrakis');
    expect(jr!.chainId).toBe(11155111);
    expect(jr!.depositoryAddress).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });
});
