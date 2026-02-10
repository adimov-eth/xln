/**
 * E2E Multi-Entity Consensus Tests
 * Tests multi-hop HTLC, conservation law, simultaneous proposal tiebreaker,
 * and multi-entity payment routing through real BrowserVM.
 *
 * PERFORMANCE: BrowserVM inits consolidated — Alice+Bob tests share one env,
 * Alice+Hub+Bob tests share another.
 */

import { describe, expect, test, beforeAll } from 'bun:test';

import type { AccountKey, TokenId } from '../ids';
import { isLeftEntity } from '../entity-id-utils';
import {
  createTestEnv,
  createEntity,
  openAccount,
  pay,
  resetSignerCounter,
  findReplica,
  getOffdelta,
  getAccountHeight,
  getAccount,
  getDelta,
  getLocks,
  usd,
} from './helpers';
import type { TestEnv, TestEntity } from './helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// ALICE + BOB tests (shared BrowserVM)
// ═══════════════════════════════════════════════════════════════════════════════

describe('bilateral consensus (Alice + Bob)', () => {
  let t: TestEnv;
  let alice: TestEntity;
  let bob: TestEntity;
  let leftEntity: TestEntity;
  let rightEntity: TestEntity;

  beforeAll(async () => {
    resetSignerCounter();
    t = await createTestEnv();
    alice = await createEntity(t, 'Alice');
    bob = await createEntity(t, 'Bob');
    await openAccount(t, alice, bob, { creditAmount: usd(10000) });

    // Determine LEFT/RIGHT for tiebreaker tests
    if (isLeftEntity(alice.id, bob.id)) {
      leftEntity = alice;
      rightEntity = bob;
    } else {
      leftEntity = bob;
      rightEntity = alice;
    }
  }, 30000);

  // ─── Conservation Law ────────────────────────────────────────────────────

  describe('conservation law', () => {
    test('payment preserves zero-sum: alice offdelta + bob offdelta = 0', async () => {
      await pay(t, alice, bob, usd(100));

      const deltaA = getDelta(t.env, alice.id, bob.id);
      const deltaB = getDelta(t.env, bob.id, alice.id);
      expect(deltaA).toBeDefined();
      expect(deltaB).toBeDefined();

      // Both sides see the same offdelta value (stored identically)
      expect(deltaA!.offdelta).toBe(deltaB!.offdelta);
    });

    test('bidirectional payments net correctly', async () => {
      const baseline = getOffdelta(t.env, alice.id, bob.id);

      await pay(t, alice, bob, usd(200));
      await pay(t, bob, alice, usd(80));

      const after = getOffdelta(t.env, alice.id, bob.id);
      const netChange = after - baseline;
      const magnitude = netChange < 0n ? -netChange : netChange;
      expect(magnitude).toBe(usd(120)); // 200 - 80 = 120 net
    });

    test('credit limits are symmetric after mutual openAccount', () => {
      const deltaA = getDelta(t.env, alice.id, bob.id);
      const deltaB = getDelta(t.env, bob.id, alice.id);
      expect(deltaA).toBeDefined();
      expect(deltaB).toBeDefined();
      expect(deltaA!.leftCreditLimit).toBe(deltaB!.leftCreditLimit);
      expect(deltaA!.rightCreditLimit).toBe(deltaB!.rightCreditLimit);
    });
  });

  // ─── Bilateral Tiebreaker ────────────────────────────────────────────────

  describe('bilateral tiebreaker', () => {
    test('isLeftEntity is deterministic', () => {
      expect(isLeftEntity(alice.id, bob.id)).toBe(!isLeftEntity(bob.id, alice.id));
    });

    test('simultaneous payments both succeed after convergence', async () => {
      const offdeltaBefore = getOffdelta(t.env, alice.id, bob.id);

      // Send payments from BOTH sides simultaneously (same process tick)
      await t.process([
        {
          entityId: leftEntity.id,
          signerId: leftEntity.signerId,
          entityTxs: [
            {
              type: 'directPayment',
              data: {
                targetEntityId: rightEntity.id,
                tokenId: 1,
                amount: usd(30),
                route: [leftEntity.id, rightEntity.id],
              },
            },
          ],
        },
        {
          entityId: rightEntity.id,
          signerId: rightEntity.signerId,
          entityTxs: [
            {
              type: 'directPayment',
              data: {
                targetEntityId: leftEntity.id,
                tokenId: 1,
                amount: usd(20),
                route: [rightEntity.id, leftEntity.id],
              },
            },
          ],
        },
      ]);

      // Converge until both payments settle
      await t.converge(30);

      const offdeltaAfter = getOffdelta(t.env, alice.id, bob.id);

      // Net effect: left→right 30, right→left 20, net = 10 towards right
      const diff = offdeltaAfter - offdeltaBefore;
      const magnitude = diff < 0n ? -diff : diff;
      expect(magnitude).toBe(usd(10));
    });

    test('account heights agree after simultaneous resolution', () => {
      const heightA = getAccountHeight(t.env, alice.id, bob.id);
      const heightB = getAccountHeight(t.env, bob.id, alice.id);
      expect(heightA).toBe(heightB);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THREE-ENTITY TESTS (shared BrowserVM for routing, HTLC, isolation)
// ═══════════════════════════════════════════════════════════════════════════════

describe('three-entity consensus (Alice + Hub + Bob)', () => {
  let t: TestEnv;
  let alice: TestEntity;
  let hub: TestEntity;
  let bob: TestEntity;

  beforeAll(async () => {
    resetSignerCounter();
    t = await createTestEnv();
    alice = await createEntity(t, 'Alice');
    hub = await createEntity(t, 'Hub');
    bob = await createEntity(t, 'Bob');

    // Alice ↔ Hub
    await openAccount(t, alice, hub, { creditAmount: usd(10000) });
    // Hub ↔ Bob
    await openAccount(t, hub, bob, { creditAmount: usd(10000) });
  }, 30000);

  // ─── Three-Entity Routing ────────────────────────────────────────────────

  describe('three-entity routing', () => {
    test('three entities created with correct accounts', () => {
      expect(getAccount(t.env, alice.id, hub.id)).toBeDefined();
      expect(getAccount(t.env, hub.id, alice.id)).toBeDefined();
      expect(getAccount(t.env, hub.id, bob.id)).toBeDefined();
      expect(getAccount(t.env, bob.id, hub.id)).toBeDefined();
      // Alice and Bob do NOT have a direct account
      expect(getAccount(t.env, alice.id, bob.id)).toBeUndefined();
    });

    test('Alice→Hub direct payment changes offdelta', async () => {
      const before = getOffdelta(t.env, alice.id, hub.id);
      await pay(t, alice, hub, usd(50));
      const after = getOffdelta(t.env, alice.id, hub.id);
      const diff = after - before;
      const magnitude = diff < 0n ? -diff : diff;
      expect(magnitude).toBe(usd(50));
    });

    test('Hub→Bob direct payment changes offdelta', async () => {
      const before = getOffdelta(t.env, hub.id, bob.id);
      await pay(t, hub, bob, usd(30));
      const after = getOffdelta(t.env, hub.id, bob.id);
      const diff = after - before;
      const magnitude = diff < 0n ? -diff : diff;
      expect(magnitude).toBe(usd(30));
    });

    test('bilateral sync maintained across three entities', async () => {
      await pay(t, alice, hub, usd(10));
      await pay(t, hub, bob, usd(10));

      const ahHeightA = getAccountHeight(t.env, alice.id, hub.id);
      const ahHeightH = getAccountHeight(t.env, hub.id, alice.id);
      expect(ahHeightA).toBe(ahHeightH);

      const hbHeightH = getAccountHeight(t.env, hub.id, bob.id);
      const hbHeightB = getAccountHeight(t.env, bob.id, hub.id);
      expect(hbHeightH).toBe(hbHeightB);
    });

    test('each bilateral account tracks independently', async () => {
      const ahBefore = getOffdelta(t.env, alice.id, hub.id);
      const hbBefore = getOffdelta(t.env, hub.id, bob.id);

      await pay(t, alice, hub, usd(25));

      const ahAfter = getOffdelta(t.env, alice.id, hub.id);
      const hbAfter = getOffdelta(t.env, hub.id, bob.id);

      expect(ahAfter).not.toBe(ahBefore);
      expect(hbAfter).toBe(hbBefore);
    });
  });

  // ─── HTLC Multi-Hop ─────────────────────────────────────────────────────

  describe('HTLC multi-hop', () => {
    test('htlc payment resolves through multi-hop', async () => {
      const { ethers } = await import('ethers');
      const { hashHtlcSecret } = await import('../htlc-utils');

      const secret = ethers.zeroPadValue('0xdeadbeef', 32);
      const hashlock = hashHtlcSecret(secret);

      const ahOffdeltaBefore = getOffdelta(t.env, alice.id, hub.id);
      const hbOffdeltaBefore = getOffdelta(t.env, hub.id, bob.id);

      await t.process([
        {
          entityId: alice.id,
          signerId: alice.signerId,
          entityTxs: [
            {
              type: 'htlcPayment',
              data: {
                targetEntityId: bob.id,
                tokenId: 1,
                amount: usd(100),
                route: [alice.id, hub.id, bob.id],
                secret,
                hashlock,
              },
            },
          ],
        },
      ]);

      await t.converge(40);

      const ahOffdeltaAfter = getOffdelta(t.env, alice.id, hub.id);
      const ahDiff = ahOffdeltaAfter - ahOffdeltaBefore;
      const ahMagnitude = ahDiff < 0n ? -ahDiff : ahDiff;
      expect(ahMagnitude).toBeGreaterThanOrEqual(usd(99));

      const hbOffdeltaAfter = getOffdelta(t.env, hub.id, bob.id);
      const hbDiff = hbOffdeltaAfter - hbOffdeltaBefore;
      const hbMagnitude = hbDiff < 0n ? -hbDiff : hbDiff;
      expect(hbMagnitude).toBeGreaterThanOrEqual(usd(99));

      expect(getAccountHeight(t.env, alice.id, hub.id)).toBeGreaterThan(0);
      expect(getAccountHeight(t.env, hub.id, bob.id)).toBeGreaterThan(0);

      const aliceLocks = getLocks(t.env, alice.id, hub.id);
      const hubBobLocks = getLocks(t.env, hub.id, bob.id);
      expect(aliceLocks?.size ?? 0).toBe(0);
      expect(hubBobLocks?.size ?? 0).toBe(0);
    });

    test('hub earns fees on forwarded HTLC', () => {
      const hubRep = findReplica(t.env, hub.id);
      expect(hubRep.state.htlcFeesEarned).toBeGreaterThan(0n);
    });
  });

  // ─── Entity Isolation ────────────────────────────────────────────────────

  describe('entity isolation', () => {
    test('payment between A-B does not affect B-C account', async () => {
      const bcOffdeltaBefore = getOffdelta(t.env, hub.id, bob.id);
      const bcHeightBefore = getAccountHeight(t.env, hub.id, bob.id);

      await pay(t, alice, hub, usd(100));

      const bcOffdeltaAfter = getOffdelta(t.env, hub.id, bob.id);
      const bcHeightAfter = getAccountHeight(t.env, hub.id, bob.id);

      expect(bcOffdeltaAfter).toBe(bcOffdeltaBefore);
      expect(bcHeightAfter).toBe(bcHeightBefore);
    });

    test('entity replicas are independent', () => {
      const aliceRep = findReplica(t.env, alice.id);
      const hubRep = findReplica(t.env, hub.id);
      const bobRep = findReplica(t.env, bob.id);

      expect(aliceRep.entityId).not.toBe(hubRep.entityId);
      expect(hubRep.entityId).not.toBe(bobRep.entityId);

      // Alice has 1 account (with Hub)
      expect(aliceRep.state.accounts.size).toBe(1);
      // Hub has 2 accounts (with Alice and Bob)
      expect(hubRep.state.accounts.size).toBe(2);
      // Bob has 1 account (with Hub)
      expect(bobRep.state.accounts.size).toBe(1);
    });

    test('entity heights are independent', async () => {
      const aliceH = findReplica(t.env, alice.id).state.height;
      const bobH = findReplica(t.env, bob.id).state.height;

      await pay(t, alice, hub, usd(5));

      const aliceH2 = findReplica(t.env, alice.id).state.height;
      const bobH2 = findReplica(t.env, bob.id).state.height;

      expect(aliceH2).toBeGreaterThan(aliceH);
      expect(bobH2).toBe(bobH); // Bob untouched
    });
  });
});
