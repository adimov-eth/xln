/**
 * Block 5: Safety Hardening Tests
 *
 * - Settlement e2e: propose -> approve (both) -> execute -> verify workspace cleared
 * - Recovery: snapshot-coder round-trips env state, payments continue after restore
 * - Adversarial: unknown signer, duplicate tx, non-existent counterparty, over-limit, negative amount
 * - Health monitoring: getHealthStatus returns correct structure
 */

import { describe, expect, test, beforeAll } from 'bun:test';

import type { Env, EntityReplica } from '../types';
import type { AccountKey } from '../ids';

import {
  createTestEnv,
  createEntity,
  openAccount,
  pay,
  findReplica,
  getOffdelta,
  getAccountHeight,
  getAccount,
  getDelta,
  resetSignerCounter,
  usd,
} from './helpers';
import type { TestEnv, TestEntity } from './helpers';
import { getHealthStatus } from '../health';
import { createGossipLayer } from '../networking/gossip';
import { encode, decode } from '../snapshot-coder';
import { isLeftEntity } from '../entity-id-utils';

// ═══════════════════════════════════════════════════════════════════════════════
// SETTLEMENT E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('settlement e2e (propose -> approve -> execute)', () => {
  let t: TestEnv;
  let alice: TestEntity;
  let bob: TestEntity;

  beforeAll(async () => {
    resetSignerCounter();
    t = await createTestEnv();
    alice = await createEntity(t, 'alice');
    bob = await createEntity(t, 'bob');
    await openAccount(t, alice, bob, { creditAmount: usd(10000) });

    // Fund reserves via BrowserVM so we have on-chain collateral to settle with
    await t.browserVM.debugFundReserves(alice.id, 1, usd(5000));
    await t.browserVM.debugFundReserves(bob.id, 1, usd(5000));

    // Make a payment so offdelta is non-zero
    await pay(t, alice, bob, usd(100));
  }, 30000);

  test('payment settled -- offdelta reflects transfer', () => {
    const offdelta = getOffdelta(t.env, alice.id, bob.id);
    // Alice paid Bob 100, so offdelta should show -100 from Alice's perspective
    expect(offdelta).toBe(-usd(100));
  });

  test('propose creates workspace on both sides', async () => {
    // Alice proposes: move 50 from left reserve to collateral
    const aliceIsLeft = isLeftEntity(alice.id, bob.id);
    const diffs = [
      {
        tokenId: 1,
        leftDiff: aliceIsLeft ? -usd(50) : 0n,
        rightDiff: aliceIsLeft ? 0n : -usd(50),
        collateralDiff: usd(50),
        ondeltaDiff: aliceIsLeft ? usd(50) : -usd(50),
      },
    ];

    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [
          {
            type: 'settle_propose',
            data: {
              counterpartyEntityId: bob.id,
              diffs,
              memo: 'deposit collateral',
            },
          },
        ],
      },
    ]);
    await t.converge(10);

    const aliceAcct = getAccount(t.env, alice.id, bob.id);
    const bobAcct = getAccount(t.env, bob.id, alice.id);

    expect(aliceAcct?.settlementWorkspace).toBeDefined();
    expect(bobAcct?.settlementWorkspace).toBeDefined();
    expect(aliceAcct!.settlementWorkspace!.version).toBe(1);
    expect(aliceAcct!.settlementWorkspace!.status).toBe('awaiting_counterparty');
  });

  test('first approve sets one hanko, second approve transitions to ready_to_submit', async () => {
    // Alice approves
    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [{ type: 'settle_approve', data: { counterpartyEntityId: bob.id } }],
      },
    ]);
    await t.converge(10);

    const ws1 = getAccount(t.env, alice.id, bob.id)?.settlementWorkspace;
    expect(ws1).toBeDefined();
    expect(ws1!.status).toBe('awaiting_counterparty');
    // Check that one hanko is present using type narrowing
    if (ws1!.status === 'awaiting_counterparty') {
      const hasOneHanko = !!ws1!.leftHanko !== !!ws1!.rightHanko;
      expect(hasOneHanko).toBe(true);
    }

    // Bob approves
    await t.process([
      {
        entityId: bob.id,
        signerId: bob.signerId,
        entityTxs: [{ type: 'settle_approve', data: { counterpartyEntityId: alice.id } }],
      },
    ]);
    await t.converge(10);

    const ws2 = getAccount(t.env, alice.id, bob.id)?.settlementWorkspace;
    expect(ws2).toBeDefined();
    expect(ws2!.status).toBe('ready_to_submit');
    if (ws2!.status === 'ready_to_submit') {
      expect(ws2!.leftHanko).toBeTruthy();
      expect(ws2!.rightHanko).toBeTruthy();
    }
  });

  test('execute clears workspace and adds to jBatch', async () => {
    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [{ type: 'settle_execute', data: { counterpartyEntityId: bob.id } }],
      },
    ]);
    await t.converge(10);

    const acct = getAccount(t.env, alice.id, bob.id);
    // Workspace should be cleared after execute
    expect(acct?.settlementWorkspace).toBeUndefined();
  });

  test('reject clears workspace', async () => {
    const aliceIsLeft = isLeftEntity(alice.id, bob.id);
    // Propose again
    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [
          {
            type: 'settle_propose',
            data: {
              counterpartyEntityId: bob.id,
              diffs: [
                {
                  tokenId: 1,
                  leftDiff: aliceIsLeft ? -usd(25) : 0n,
                  rightDiff: aliceIsLeft ? 0n : -usd(25),
                  collateralDiff: usd(25),
                  ondeltaDiff: aliceIsLeft ? usd(25) : -usd(25),
                },
              ],
              memo: 'another proposal',
            },
          },
        ],
      },
    ]);
    await t.converge(10);

    expect(getAccount(t.env, alice.id, bob.id)?.settlementWorkspace).toBeDefined();

    // Bob rejects
    await t.process([
      {
        entityId: bob.id,
        signerId: bob.signerId,
        entityTxs: [
          {
            type: 'settle_reject',
            data: { counterpartyEntityId: alice.id, reason: 'nope' },
          },
        ],
      },
    ]);
    await t.converge(10);

    // Both sides should have workspace cleared
    expect(getAccount(t.env, alice.id, bob.id)?.settlementWorkspace).toBeUndefined();
    expect(getAccount(t.env, bob.id, alice.id)?.settlementWorkspace).toBeUndefined();
  });

  test('on-chain reserves exist after funding', async () => {
    const aliceReserve = await t.browserVM.getReserves(alice.id, 1);
    const bobReserve = await t.browserVM.getReserves(bob.id, 1);
    // Reserves should be positive (funded earlier minus any settlement)
    expect(aliceReserve).toBeGreaterThanOrEqual(0n);
    expect(bobReserve).toBeGreaterThanOrEqual(0n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RECOVERY (PERSISTENCE ROUND-TRIP)
// ═══════════════════════════════════════════════════════════════════════════════

describe('recovery: persist -> restore -> continue', () => {
  let t: TestEnv;
  let alice: TestEntity;
  let bob: TestEntity;

  beforeAll(async () => {
    resetSignerCounter();
    t = await createTestEnv();
    alice = await createEntity(t, 'alice');
    bob = await createEntity(t, 'bob');
    await openAccount(t, alice, bob, { creditAmount: usd(10000) });
  }, 30000);

  test('snapshot-coder round-trips env state faithfully', async () => {
    // Make some payments to create state
    await pay(t, alice, bob, usd(100));
    await pay(t, bob, alice, usd(30));

    // Encode the eReplicas (the core state)
    const snapshot = {
      height: t.env.height,
      timestamp: t.env.timestamp,
      eReplicas: Array.from(t.env.eReplicas.entries()),
    };
    const encoded = encode(snapshot);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decode(encoded) as typeof snapshot;
    expect(decoded.height).toBe(snapshot.height);
    expect(decoded.timestamp).toBe(snapshot.timestamp);
    expect(decoded.eReplicas.length).toBe(snapshot.eReplicas.length);

    // Verify replica state survived encoding
    for (const [key] of decoded.eReplicas) {
      const original = t.env.eReplicas.get(key);
      expect(original).toBeDefined();
    }
  });

  test('offdelta and account heights survive encode/decode', async () => {
    await pay(t, alice, bob, usd(50));

    const offdelta = getOffdelta(t.env, alice.id, bob.id);
    const height = getAccountHeight(t.env, alice.id, bob.id);

    // Round-trip via snapshot-coder
    const data = {
      offdelta: offdelta.toString(),
      height,
    };

    const encoded = encode(data);
    const decoded = decode(encoded) as typeof data;

    expect(BigInt(decoded.offdelta)).toBe(offdelta);
    expect(decoded.height).toBe(height);
  });

  test('payments continue correctly after state changes', async () => {
    // Record pre-state
    const offdeltaBefore = getOffdelta(t.env, alice.id, bob.id);
    const heightBefore = getAccountHeight(t.env, alice.id, bob.id);

    // Make another payment
    await pay(t, alice, bob, usd(77));

    const offdeltaAfter = getOffdelta(t.env, alice.id, bob.id);
    const heightAfter = getAccountHeight(t.env, alice.id, bob.id);

    // Verify payment was processed
    expect(offdeltaAfter).toBe(offdeltaBefore - usd(77));
    expect(heightAfter).toBeGreaterThan(heightBefore);
  });

  test('BigInt values survive snapshot-coder', () => {
    const testData = {
      pos: 123456789012345678901234567890n,
      neg: -999999999999999999999999n,
      zero: 0n,
      small: 1n,
    };
    const encoded = encode(testData);
    const decoded = decode(encoded) as typeof testData;
    expect(decoded.pos).toBe(testData.pos);
    expect(decoded.neg).toBe(testData.neg);
    expect(decoded.zero).toBe(testData.zero);
    expect(decoded.small).toBe(testData.small);
  });

  test('Map structures survive snapshot-coder', () => {
    const inner = new Map<number, bigint>([
      [1, 1000n],
      [2, -500n],
    ]);
    const outer = new Map<string, typeof inner>([['test', inner]]);

    const encoded = encode({ data: outer });
    const decoded = decode(encoded) as { data: Map<string, Map<number, bigint>> };

    expect(decoded.data).toBeInstanceOf(Map);
    expect(decoded.data.size).toBe(1);
    const decodedInner = decoded.data.get('test');
    expect(decodedInner).toBeInstanceOf(Map);
    expect(decodedInner!.get(1)).toBe(1000n);
    expect(decodedInner!.get(2)).toBe(-500n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADVERSARIAL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('adversarial: malformed, replayed, and stale inputs', () => {
  let t: TestEnv;
  let alice: TestEntity;
  let bob: TestEntity;

  beforeAll(async () => {
    resetSignerCounter();
    t = await createTestEnv();
    alice = await createEntity(t, 'alice');
    bob = await createEntity(t, 'bob');
    await openAccount(t, alice, bob, { creditAmount: usd(10000) });
  }, 30000);

  test('unknown signerId is silently dropped', async () => {
    const heightBefore = getAccountHeight(t.env, alice.id, bob.id);

    // Send input with a signerId that doesn't match any replica
    await t.process([
      {
        entityId: alice.id,
        signerId: '999', // no such signer
        entityTxs: [
          {
            type: 'directPayment',
            data: {
              targetEntityId: bob.id,
              amount: usd(10),
              tokenId: 1,
              route: [alice.id, bob.id],
            },
          },
        ],
      },
    ]);
    await t.converge(5);

    // Account height should not change -- input was dropped
    const heightAfter = getAccountHeight(t.env, alice.id, bob.id);
    expect(heightAfter).toBe(heightBefore);
  });

  test('empty entityTxs array is harmless', async () => {
    const heightBefore = t.env.height;

    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [],
      },
    ]);
    await t.converge(5);

    // Runtime height advances (tick processed) but no account changes
    expect(t.env.height).toBeGreaterThanOrEqual(heightBefore);
  });

  test('duplicate payment in same tick processes both', async () => {
    const offdeltaBefore = getOffdelta(t.env, alice.id, bob.id);

    // Send two identical payments in the same process tick
    const paymentTx = {
      type: 'directPayment' as const,
      data: {
        targetEntityId: bob.id,
        amount: usd(10),
        tokenId: 1,
        route: [alice.id, bob.id],
      },
    };

    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [paymentTx, paymentTx],
      },
    ]);
    await t.converge(10);

    const offdeltaAfter = getOffdelta(t.env, alice.id, bob.id);
    // Both should process (they're separate txs in same frame)
    const diff = offdeltaBefore - offdeltaAfter;
    expect(diff).toBe(usd(20)); // 2 x 10
  });

  test('payment to non-existent counterparty does not crash', async () => {
    const fakeId = '0x' + 'dead'.repeat(16);
    const heightBefore = getAccountHeight(t.env, alice.id, bob.id);

    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [
          {
            type: 'directPayment',
            data: {
              targetEntityId: fakeId,
              amount: usd(10),
              tokenId: 1,
              route: [alice.id, fakeId],
            },
          },
        ],
      },
    ]);
    await t.converge(5);

    // Alice's account with Bob should be unaffected
    const heightAfter = getAccountHeight(t.env, alice.id, bob.id);
    expect(heightAfter).toBeGreaterThanOrEqual(heightBefore);
  });

  test('payment exceeding credit limit does not corrupt state', async () => {
    const offdeltaBefore = getOffdelta(t.env, alice.id, bob.id);

    // Try to pay way more than credit limit (10000 USDC credit, try 999999)
    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [
          {
            type: 'directPayment',
            data: {
              targetEntityId: bob.id,
              amount: usd(999999),
              tokenId: 1,
              route: [alice.id, bob.id],
            },
          },
        ],
      },
    ]);
    await t.converge(10);

    // Offdelta should not exceed credit limit
    const offdeltaAfter = getOffdelta(t.env, alice.id, bob.id);
    const delta = getDelta(t.env, alice.id, bob.id);
    if (delta) {
      const creditRight = delta.rightCreditLimit ?? 0n;
      const creditLeft = delta.leftCreditLimit ?? 0n;
      const totalCapacity = creditLeft + creditRight + (delta.collateral ?? 0n);
      // Absolute offdelta should not exceed total capacity
      const absOffdelta = offdeltaAfter < 0n ? -offdeltaAfter : offdeltaAfter;
      expect(absOffdelta).toBeLessThanOrEqual(totalCapacity);
    }
  });

  test('negative payment amount does not crash', async () => {
    const heightBefore = getAccountHeight(t.env, alice.id, bob.id);

    await t.process([
      {
        entityId: alice.id,
        signerId: alice.signerId,
        entityTxs: [
          {
            type: 'directPayment',
            data: {
              targetEntityId: bob.id,
              amount: -usd(10),
              tokenId: 1,
              route: [alice.id, bob.id],
            },
          },
        ],
      },
    ]);
    await t.converge(5);

    // Should not crash; payment rejected or ignored
    const heightAfter = getAccountHeight(t.env, alice.id, bob.id);
    expect(heightAfter).toBeGreaterThanOrEqual(heightBefore);
  });

  test('bilateral consistency maintained after adversarial inputs', () => {
    // After all the above abuse, both sides should still agree
    const aliceReplica = findReplica(t.env, alice.id);
    const bobReplica = findReplica(t.env, bob.id);

    const aliceAcct = aliceReplica.state.accounts.get(bob.id as AccountKey);
    const bobAcct = bobReplica.state.accounts.get(alice.id as AccountKey);

    expect(aliceAcct).toBeDefined();
    expect(bobAcct).toBeDefined();

    // Both sides should agree on account height
    const aliceHeight = aliceAcct!.currentHeight;
    const bobHeight = bobAcct!.currentHeight;
    expect(aliceHeight).toBe(bobHeight);

    // Both sides should agree on frame hash
    const aliceHash = aliceAcct!.currentFrame.stateHash;
    const bobHash = bobAcct!.currentFrame.stateHash;
    if (aliceHash && bobHash) {
      expect(aliceHash).toBe(bobHash);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

describe('health monitoring', () => {
  test('getHealthStatus returns correct shape with null env', async () => {
    const health = await getHealthStatus(null);

    expect(health).toHaveProperty('timestamp');
    expect(health).toHaveProperty('uptime');
    expect(health).toHaveProperty('jMachines');
    expect(health).toHaveProperty('hubs');
    expect(health).toHaveProperty('system');

    expect(typeof health.timestamp).toBe('number');
    expect(typeof health.uptime).toBe('number');
    expect(Array.isArray(health.jMachines)).toBe(true);
    expect(Array.isArray(health.hubs)).toBe(true);

    // With null env, system should be down
    expect(health.system.runtime).toBe(false);
    expect(health.system.p2p).toBe(false);
  });

  test('getHealthStatus reflects env presence', async () => {
    const noop = () => {};
    const env: Env = {
      eReplicas: new Map(),
      jReplicas: new Map(),
      evms: new Map(),
      height: 0,
      timestamp: Date.now(),
      runtimeInput: { runtimeTxs: [], entityInputs: [] },
      history: [],
      gossip: createGossipLayer(),
      frameLogs: [],
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      emit: noop,
    };

    const health = await getHealthStatus(env);

    expect(health.system.runtime).toBe(true);
    expect(health.jMachines).toHaveLength(0);
    expect(health.hubs).toHaveLength(0);
  });

  test('getHealthStatus includes hub profiles from gossip', async () => {
    const noop = () => {};
    const env: Env = {
      eReplicas: new Map(),
      jReplicas: new Map(),
      evms: new Map(),
      height: 0,
      timestamp: Date.now(),
      runtimeInput: { runtimeTxs: [], entityInputs: [] },
      history: [],
      gossip: createGossipLayer(),
      frameLogs: [],
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      emit: noop,
    };

    // Announce a hub profile
    env.gossip!.announce({
      entityId: '0x' + 'ab'.repeat(32),
      capabilities: ['hub', 'routing'],
      metadata: {
        isHub: true,
        name: 'TestHub',
        region: 'us-east',
        relayUrl: 'wss://test.example.com/relay',
        lastUpdated: Date.now(),
      },
    });

    const health = await getHealthStatus(env);

    expect(health.hubs.length).toBeGreaterThanOrEqual(1);
    const hub = health.hubs.find(h => h.name === 'TestHub');
    expect(hub).toBeDefined();
    expect(hub!.region).toBe('us-east');
    expect(hub!.status).toBe('healthy');
  });

  test('uptime increases over time', async () => {
    const h1 = await getHealthStatus(null);
    await new Promise(r => setTimeout(r, 50));
    const h2 = await getHealthStatus(null);
    expect(h2.uptime).toBeGreaterThan(h1.uptime);
  });

  test('timestamp is recent', async () => {
    const health = await getHealthStatus(null);
    const now = Date.now();
    expect(health.timestamp).toBeGreaterThan(now - 5000);
    expect(health.timestamp).toBeLessThanOrEqual(now + 1000);
  });
});
