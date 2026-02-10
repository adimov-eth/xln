/**
 * Account Consensus Tests
 * Tests bilateral frame exchange through process().
 * Uses real BrowserVM — no mocks.
 */

import { describe, expect, test, beforeAll } from 'bun:test';

import type { AccountKey, TokenId } from '../ids';
import {
  createTestEnv,
  createEntity,
  openAccount,
  pay,
  resetSignerCounter,
  findReplica,
  getOffdelta,
  getAccountHeight,
  getEntityHeight,
  getAccountFrameHash,
  hasPendingProposal,
  getAccount,
  getDelta,
  usd,
} from './helpers';
import type { TestEnv, TestEntity } from './helpers';

// ─── Shared state ────────────────────────────────────────────────────────────

let t: TestEnv;
let alice: TestEntity;
let bob: TestEntity;

beforeAll(async () => {
  resetSignerCounter();
  t = await createTestEnv();
  alice = await createEntity(t, 'Alice');
  bob = await createEntity(t, 'Bob');
  await openAccount(t, alice, bob, { creditAmount: usd(10000) });
}, 30000);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('account consensus', () => {
  test('entities are created with replicas', () => {
    const aliceRep = findReplica(t.env, alice.id);
    const bobRep = findReplica(t.env, bob.id);
    expect(aliceRep).toBeDefined();
    expect(bobRep).toBeDefined();
  });

  test('account opened between alice and bob', () => {
    const account = getAccount(t.env, alice.id, bob.id);
    expect(account).toBeDefined();
    const bobAccount = getAccount(t.env, bob.id, alice.id);
    expect(bobAccount).toBeDefined();
  });

  test('entity heights increment during setup', () => {
    const aliceH = getEntityHeight(t.env, alice.id);
    const bobH = getEntityHeight(t.env, bob.id);
    // Both entities should have processed at least 1 frame during setup
    expect(aliceH).toBeGreaterThan(0);
    expect(bobH).toBeGreaterThan(0);
  });

  test('account height > 0 after openAccount', () => {
    const h = getAccountHeight(t.env, alice.id, bob.id);
    expect(h).toBeGreaterThanOrEqual(1);
  });
});

describe('single payment', () => {
  test('alice pays bob — offdelta changes and accounts are in sync', async () => {
    const heightBefore = getAccountHeight(t.env, alice.id, bob.id);
    const hashBefore = getAccountFrameHash(t.env, alice.id, bob.id);

    await pay(t, alice, bob, usd(100));

    // Account height should increment
    const heightAfter = getAccountHeight(t.env, alice.id, bob.id);
    expect(heightAfter).toBeGreaterThan(heightBefore);

    // Frame hash should change
    const hashAfter = getAccountFrameHash(t.env, alice.id, bob.id);
    expect(hashAfter).not.toBe(hashBefore);

    // No pending proposals after convergence
    expect(hasPendingProposal(t.env, alice.id, bob.id)).toBe(false);
    expect(hasPendingProposal(t.env, bob.id, alice.id)).toBe(false);

    // Both sides should agree on offdelta
    const offdeltaA = getOffdelta(t.env, alice.id, bob.id);
    const offdeltaB = getOffdelta(t.env, bob.id, alice.id);
    expect(offdeltaA).toBe(offdeltaB);

    // The offdelta magnitude should be usd(100)
    const magnitude = offdeltaA < 0n ? -offdeltaA : offdeltaA;
    expect(magnitude).toBe(usd(100));
  });

  test('entity height increments after payment', async () => {
    const heightBefore = getEntityHeight(t.env, alice.id);
    await pay(t, alice, bob, usd(50));
    const heightAfter = getEntityHeight(t.env, alice.id);
    expect(heightAfter).toBeGreaterThan(heightBefore);
  });

  test('multiple payments accumulate', async () => {
    const before = getOffdelta(t.env, alice.id, bob.id);
    await pay(t, alice, bob, usd(30));
    await pay(t, alice, bob, usd(20));
    const after = getOffdelta(t.env, alice.id, bob.id);

    // Should have moved by usd(50) total in the same direction
    const diff = after - before;
    const magnitude = diff < 0n ? -diff : diff;
    expect(magnitude).toBe(usd(50));
  });
});

describe('bilateral sync', () => {
  test('both sides agree on account height after payment', async () => {
    await pay(t, alice, bob, usd(10));
    const heightA = getAccountHeight(t.env, alice.id, bob.id);
    const heightB = getAccountHeight(t.env, bob.id, alice.id);
    expect(heightA).toBe(heightB);
  });

  test('both sides agree on frame hash after payment', async () => {
    await pay(t, alice, bob, usd(10));
    const hashA = getAccountFrameHash(t.env, alice.id, bob.id);
    const hashB = getAccountFrameHash(t.env, bob.id, alice.id);
    expect(hashA).toBe(hashB);
  });

  test('full delta sync — all fields match', async () => {
    await pay(t, alice, bob, usd(15));
    const deltaA = getDelta(t.env, alice.id, bob.id);
    const deltaB = getDelta(t.env, bob.id, alice.id);

    expect(deltaA).toBeDefined();
    expect(deltaB).toBeDefined();
    if (deltaA && deltaB) {
      expect(deltaA.offdelta).toBe(deltaB.offdelta);
      expect(deltaA.ondelta).toBe(deltaB.ondelta);
      expect(deltaA.collateral).toBe(deltaB.collateral);
      expect(deltaA.leftCreditLimit).toBe(deltaB.leftCreditLimit);
      expect(deltaA.rightCreditLimit).toBe(deltaB.rightCreditLimit);
    }
  });
});

describe('bidirectional payments', () => {
  test('bob pays alice — opposite direction', async () => {
    const before = getOffdelta(t.env, alice.id, bob.id);
    await pay(t, bob, alice, usd(50));
    const after = getOffdelta(t.env, alice.id, bob.id);

    // Bob→Alice should move offdelta in opposite direction from Alice→Bob
    const diff = after - before;
    const magnitude = diff < 0n ? -diff : diff;
    expect(magnitude).toBe(usd(50));
  });

  test('equal payments cancel out', async () => {
    const baseline = getOffdelta(t.env, alice.id, bob.id);

    await pay(t, alice, bob, usd(100));
    await pay(t, bob, alice, usd(100));

    const after = getOffdelta(t.env, alice.id, bob.id);
    expect(after).toBe(baseline);
  });
});

describe('frame chain integrity', () => {
  test('account frames form a hash chain', async () => {
    const account = getAccount(t.env, alice.id, bob.id);
    expect(account).toBeDefined();

    const history = account!.frameHistory;
    if (history.length >= 2) {
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        if (prev && curr && prev.stateHash && curr.prevFrameHash) {
          expect(curr.prevFrameHash).toBe(prev.stateHash);
        }
      }
    }
  });

  test('frame heights are monotonically increasing', async () => {
    const account = getAccount(t.env, alice.id, bob.id);
    expect(account).toBeDefined();

    const history = account!.frameHistory;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      if (prev && curr) {
        expect(curr.height).toBeGreaterThan(prev.height);
      }
    }
  });
});
