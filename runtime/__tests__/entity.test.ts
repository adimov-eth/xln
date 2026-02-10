/**
 * Entity Consensus Tests
 * Tests entity-level BFT consensus: single-signer fast path, multi-signer
 * propose/precommit/commit, frame hash determinism, height monotonicity,
 * mempool management, and state cloning correctness.
 * Uses real BrowserVM — no mocks.
 *
 * PERFORMANCE: BrowserVM inits consolidated — single-signer blocks share one env,
 * multi-signer gets its own, pure tests use no env.
 */

import { describe, expect, test, beforeAll } from 'bun:test';

import type { AccountKey } from '../ids';
import {
  createTestEnv,
  createEntity,
  createMultiSignerEntity,
  openAccount,
  pay,
  resetSignerCounter,
  findReplica,
  findAllReplicas,
  getOffdelta,
  getEntityHeight,
  getAccountHeight,
  getAccountFrameHash,
  getAccount,
  getDelta,
  usd,
} from './helpers';
import type { TestEnv, TestEntity } from './helpers';
import { createEntityFrameHash } from '../entity-consensus';

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE-SIGNER TESTS (shared BrowserVM for all single-signer describe blocks)
// ═══════════════════════════════════════════════════════════════════════════════

describe('single-signer entity tests', () => {
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

  // ─── Single-Signer Fast Path ─────────────────────────────────────────────

  describe('single-signer fast path', () => {
    test('single-signer entity has exactly one replica', () => {
      const replicas = findAllReplicas(t.env, alice.id);
      expect(replicas.length).toBe(1);
      expect(replicas[0]!.replica.isProposer).toBe(true);
    });

    test('single-signer entity has threshold=1', () => {
      const replica = findReplica(t.env, alice.id);
      expect(replica.state.config.threshold).toBe(1n);
      expect(replica.state.config.validators.length).toBe(1);
    });

    test('direct execution — no proposal lingers after processing', async () => {
      await pay(t, alice, bob, usd(10));
      const replica = findReplica(t.env, alice.id);
      expect(replica.proposal).toBeUndefined();
      expect(replica.lockedFrame).toBeUndefined();
    });

    test('mempool empty after single-signer commit', async () => {
      await pay(t, alice, bob, usd(10));
      const replica = findReplica(t.env, alice.id);
      expect(replica.mempool.length).toBe(0);
    });

    test('entity height increments after payment', async () => {
      const hBefore = getEntityHeight(t.env, alice.id);
      await pay(t, alice, bob, usd(10));
      const hAfter = getEntityHeight(t.env, alice.id);
      expect(hAfter).toBeGreaterThan(hBefore);
    });

    test('prevFrameHash chains across frames', async () => {
      const rep1 = findReplica(t.env, alice.id);
      const hash1 = rep1.state.prevFrameHash;
      expect(hash1).toBeDefined();
      expect(hash1).not.toBe('genesis');

      await pay(t, alice, bob, usd(5));

      const rep2 = findReplica(t.env, alice.id);
      const hash2 = rep2.state.prevFrameHash;
      expect(hash2).toBeDefined();
      expect(hash2).not.toBe(hash1);
    });

    test('empty process tick does not increment entity height', async () => {
      const hBefore = getEntityHeight(t.env, alice.id);
      await t.tick();
      const hAfter = getEntityHeight(t.env, alice.id);
      expect(hAfter).toBe(hBefore);
    });
  });

  // ─── Height Monotonicity ─────────────────────────────────────────────────

  describe('entity height monotonicity', () => {
    test('sequential payments produce strictly increasing entity heights', async () => {
      const heights: number[] = [];
      heights.push(getEntityHeight(t.env, alice.id));

      for (let i = 0; i < 5; i++) {
        await pay(t, alice, bob, usd(1));
        heights.push(getEntityHeight(t.env, alice.id));
      }

      for (let i = 1; i < heights.length; i++) {
        expect(heights[i]).toBeGreaterThan(heights[i - 1]!);
      }
    });

    test('entity height never decreases', async () => {
      const baseline = getEntityHeight(t.env, alice.id);

      await t.tick();
      await t.tick();
      await t.tick();

      expect(getEntityHeight(t.env, alice.id)).toBeGreaterThanOrEqual(baseline);
    });
  });

  // ─── Mempool Management ──────────────────────────────────────────────────

  describe('mempool management', () => {
    test('committed txs are cleared from mempool', async () => {
      const rep0 = findReplica(t.env, alice.id);
      expect(rep0.mempool.length).toBe(0);

      await pay(t, alice, bob, usd(10));

      const rep1 = findReplica(t.env, alice.id);
      expect(rep1.mempool.length).toBe(0);
    });

    test('entity processes chat message without account interaction', async () => {
      const hBefore = getEntityHeight(t.env, alice.id);

      await t.process([
        {
          entityId: alice.id,
          signerId: alice.signerId,
          entityTxs: [{ type: 'chat', data: { from: alice.signerId, message: 'test message' } }],
        },
      ]);
      await t.converge();

      const hAfter = getEntityHeight(t.env, alice.id);
      expect(hAfter).toBe(hBefore + 1);

      const rep = findReplica(t.env, alice.id);
      expect(rep.mempool.length).toBe(0);
      const hasTestMessage = rep.state.messages.some(m => m.includes('test message'));
      expect(hasTestMessage).toBe(true);
    });
  });

  // ─── State Cloning ───────────────────────────────────────────────────────

  describe('state cloning', () => {
    test('entity state mutation does not leak across frames', async () => {
      const heightBefore = getEntityHeight(t.env, alice.id);
      const offdeltaBefore = getOffdelta(t.env, alice.id, bob.id);

      await pay(t, alice, bob, usd(100));

      const heightAfter = getEntityHeight(t.env, alice.id);
      const offdeltaAfter = getOffdelta(t.env, alice.id, bob.id);

      expect(heightAfter).toBeGreaterThan(heightBefore);
      expect(offdeltaAfter).not.toBe(offdeltaBefore);

      const diff = offdeltaAfter - offdeltaBefore;
      const magnitude = diff < 0n ? -diff : diff;
      expect(magnitude).toBe(usd(100));
    });

    test('reserves map is properly cloned between frames', async () => {
      const rep1 = findReplica(t.env, alice.id);
      const reserves1 = new Map(rep1.state.reserves);

      await pay(t, alice, bob, usd(10));

      const rep2 = findReplica(t.env, alice.id);

      for (const [key, val] of reserves1) {
        expect(rep2.state.reserves.get(key)).toBe(val);
      }
    });

    test('accounts map is properly cloned', async () => {
      const rep = findReplica(t.env, alice.id);
      const accountsBefore = rep.state.accounts.size;

      await pay(t, alice, bob, usd(5));

      const repAfter = findReplica(t.env, alice.id);
      expect(repAfter.state.accounts.size).toBe(accountsBefore);
    });
  });

  // ─── Crontab Initialization ──────────────────────────────────────────────

  describe('crontab initialization', () => {
    test('crontab is initialized after entity input', async () => {
      const rep = findReplica(t.env, alice.id);
      // After payments, crontab should already be initialized
      expect(rep.state.crontabState).toBeDefined();
      expect(rep.state.crontabState.tasks).toBeDefined();
    });

    test('crontab has expected task names', () => {
      const rep = findReplica(t.env, alice.id);
      const taskNames = Array.from(rep.state.crontabState.tasks.keys());
      expect(taskNames).toContain('checkAccountTimeouts');
      expect(taskNames).toContain('broadcastBatch');
      expect(taskNames).toContain('checkHtlcTimeouts');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-SIGNER CONSENSUS (2-of-3) — needs its own BrowserVM
// ═══════════════════════════════════════════════════════════════════════════════

describe('multi-signer consensus', () => {
  let t: TestEnv;
  let msEntity: { id: string; proposerId: string; validators: string[]; threshold: bigint };
  let bob: TestEntity;

  beforeAll(async () => {
    resetSignerCounter();
    t = await createTestEnv();
    msEntity = await createMultiSignerEntity(t, 'MultiSig', 3, 2n);
    bob = await createEntity(t, 'Bob');

    const msAsEntity: TestEntity = { id: msEntity.id, signerId: msEntity.proposerId };
    await openAccount(t, msAsEntity, bob, { creditAmount: usd(10000) });
  }, 30000);

  test('multi-signer entity has 3 replicas', () => {
    const replicas = findAllReplicas(t.env, msEntity.id);
    expect(replicas.length).toBe(3);
  });

  test('exactly one proposer among replicas', () => {
    const replicas = findAllReplicas(t.env, msEntity.id);
    const proposers = replicas.filter(r => r.replica.isProposer);
    expect(proposers.length).toBe(1);
    expect(proposers[0]!.signerId).toBe(msEntity.proposerId);
  });

  test('all validators share same config', () => {
    const replicas = findAllReplicas(t.env, msEntity.id);
    const configs = replicas.map(r => r.replica.state.config);
    for (const config of configs) {
      expect(config.threshold).toBe(2n);
      expect(config.validators).toEqual(msEntity.validators);
      expect(config.mode).toBe('proposer-based');
    }
  });

  test('payment converges — all validators reach same height', async () => {
    const msAsEntity: TestEntity = { id: msEntity.id, signerId: msEntity.proposerId };
    await pay(t, msAsEntity, bob, usd(50));

    const replicas = findAllReplicas(t.env, msEntity.id);
    const heights = replicas.map(r => r.replica.state.height);

    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBeGreaterThan(0);
  });

  test('all validators agree on prevFrameHash after commit', async () => {
    const msAsEntity: TestEntity = { id: msEntity.id, signerId: msEntity.proposerId };
    await pay(t, msAsEntity, bob, usd(25));

    const replicas = findAllReplicas(t.env, msEntity.id);
    const hashes = replicas.map(r => r.replica.state.prevFrameHash);

    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toBeDefined();
  });

  test('proposer height exceeds non-proposer height or equals it', () => {
    const replicas = findAllReplicas(t.env, msEntity.id);
    const proposer = replicas.find(r => r.replica.isProposer)!;
    const validators = replicas.filter(r => !r.replica.isProposer);

    for (const v of validators) {
      expect(proposer.replica.state.height).toBeGreaterThanOrEqual(v.replica.state.height);
    }
  });

  test('bilateral account state consistent across validators', async () => {
    const msAsEntity: TestEntity = { id: msEntity.id, signerId: msEntity.proposerId };
    await pay(t, msAsEntity, bob, usd(30));

    const replicas = findAllReplicas(t.env, msEntity.id);
    const accountKeys = Array.from(replicas[0]!.replica.state.accounts.keys());

    for (const key of accountKeys) {
      const heights = replicas.map(r => r.replica.state.accounts.get(key)?.currentHeight);
      const hashes = replicas.map(r => r.replica.state.accounts.get(key)?.currentFrame?.stateHash);

      expect(new Set(heights).size).toBe(1);
      expect(new Set(hashes).size).toBe(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY FRAME HASH DETERMINISM (pure — no BrowserVM)
// ═══════════════════════════════════════════════════════════════════════════════

describe('entity frame hash determinism', () => {
  test('same inputs produce identical hash', async () => {
    const mockState = {
      entityId: '0x' + '0a'.repeat(32),
      reserves: new Map([
        ['1', 100n],
        ['2', 200n],
      ]),
      lastFinalizedJHeight: 5,
      accounts: new Map(),
      htlcRoutes: new Map(),
      htlcFeesEarned: 0n,
      lockBook: new Map(),
      swapBook: new Map(),
      orderbookExt: undefined,
    };

    const txs = [{ type: 'chat' as const, data: { from: 'alice', message: 'hello' } }];

    const hash1 = await createEntityFrameHash('genesis', 1, 1700000000000, txs, mockState as any);
    const hash2 = await createEntityFrameHash('genesis', 1, 1700000000000, txs, mockState as any);
    expect(hash1).toBe(hash2);
  });

  test('different heights produce different hashes', async () => {
    const mockState = {
      entityId: '0x' + '0a'.repeat(32),
      reserves: new Map(),
      lastFinalizedJHeight: 0,
      accounts: new Map(),
      htlcRoutes: new Map(),
      htlcFeesEarned: 0n,
      lockBook: new Map(),
      swapBook: new Map(),
      orderbookExt: undefined,
    };

    const hash1 = await createEntityFrameHash('genesis', 1, 1700000000000, [], mockState as any);
    const hash2 = await createEntityFrameHash('genesis', 2, 1700000000000, [], mockState as any);
    expect(hash1).not.toBe(hash2);
  });

  test('different prevFrameHash produces different hash', async () => {
    const mockState = {
      entityId: '0x' + '0a'.repeat(32),
      reserves: new Map(),
      lastFinalizedJHeight: 0,
      accounts: new Map(),
      htlcRoutes: new Map(),
      htlcFeesEarned: 0n,
      lockBook: new Map(),
      swapBook: new Map(),
      orderbookExt: undefined,
    };

    const hash1 = await createEntityFrameHash('genesis', 1, 1700000000000, [], mockState as any);
    const hash2 = await createEntityFrameHash('0xabc123', 1, 1700000000000, [], mockState as any);
    expect(hash1).not.toBe(hash2);
  });

  test('reserve insertion order does not affect hash', async () => {
    const state1 = {
      entityId: '0x' + '0a'.repeat(32),
      reserves: new Map([
        ['1', 100n],
        ['2', 200n],
      ]),
      lastFinalizedJHeight: 0,
      accounts: new Map(),
      htlcRoutes: new Map(),
      htlcFeesEarned: 0n,
      lockBook: new Map(),
      swapBook: new Map(),
      orderbookExt: undefined,
    };

    const state2 = {
      ...state1,
      reserves: new Map([
        ['2', 200n],
        ['1', 100n],
      ]),
    };

    const hash1 = await createEntityFrameHash('genesis', 1, 1700000000000, [], state1 as any);
    const hash2 = await createEntityFrameHash('genesis', 1, 1700000000000, [], state2 as any);
    expect(hash1).toBe(hash2);
  });

  test('hash is keccak256 format (0x-prefixed, 66 chars)', async () => {
    const mockState = {
      entityId: '0x' + '0a'.repeat(32),
      reserves: new Map(),
      lastFinalizedJHeight: 0,
      accounts: new Map(),
      htlcRoutes: new Map(),
      htlcFeesEarned: 0n,
      lockBook: new Map(),
      swapBook: new Map(),
      orderbookExt: undefined,
    };

    const hash = await createEntityFrameHash('genesis', 1, 1700000000000, [], mockState as any);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUORUM POWER CALCULATION (pure — no BrowserVM)
// ═══════════════════════════════════════════════════════════════════════════════

describe('quorum power', () => {
  test('calculateQuorumPower sums validator shares', async () => {
    const { calculateQuorumPower } = await import('../entity-consensus');

    const config = {
      mode: 'proposer-based' as const,
      threshold: 2n,
      validators: ['a', 'b', 'c'],
      shares: { a: 1n, b: 1n, c: 1n },
    };

    expect(calculateQuorumPower(config, ['a'])).toBe(1n);
    expect(calculateQuorumPower(config, ['a', 'b'])).toBe(2n);
    expect(calculateQuorumPower(config, ['a', 'b', 'c'])).toBe(3n);
  });

  test('calculateQuorumPower skips unknown signers', async () => {
    const { calculateQuorumPower } = await import('../entity-consensus');

    const config = {
      mode: 'proposer-based' as const,
      threshold: 2n,
      validators: ['a', 'b'],
      shares: { a: 1n, b: 1n },
    };

    expect(calculateQuorumPower(config, ['a', 'unknown'])).toBe(1n);
  });

  test('calculateQuorumPower handles weighted shares', async () => {
    const { calculateQuorumPower } = await import('../entity-consensus');

    const config = {
      mode: 'proposer-based' as const,
      threshold: 5n,
      validators: ['a', 'b', 'c'],
      shares: { a: 3n, b: 1n, c: 2n },
    };

    expect(calculateQuorumPower(config, ['a'])).toBe(3n);
    expect(calculateQuorumPower(config, ['b', 'c'])).toBe(3n);
    expect(calculateQuorumPower(config, ['a', 'c'])).toBe(5n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT MERGING (pure — no BrowserVM)
// ═══════════════════════════════════════════════════════════════════════════════

describe('entity input merging', () => {
  test('mergeEntityInputs combines duplicate entity:signer keys', async () => {
    const { mergeEntityInputs } = await import('../entity-consensus');

    const inputs = [
      {
        entityId: '0x01',
        signerId: 'a',
        entityTxs: [{ type: 'chat' as const, data: { from: 'a', message: '1' } }],
      },
      {
        entityId: '0x01',
        signerId: 'a',
        entityTxs: [{ type: 'chat' as const, data: { from: 'a', message: '2' } }],
      },
    ];

    const merged = mergeEntityInputs(inputs);
    expect(merged.length).toBe(1);
    expect(merged[0]!.entityTxs!.length).toBe(2);
  });

  test('mergeEntityInputs preserves distinct entity:signer pairs', async () => {
    const { mergeEntityInputs } = await import('../entity-consensus');

    const inputs = [
      {
        entityId: '0x01',
        signerId: 'a',
        entityTxs: [{ type: 'chat' as const, data: { from: 'a', message: '1' } }],
      },
      {
        entityId: '0x01',
        signerId: 'b',
        entityTxs: [{ type: 'chat' as const, data: { from: 'b', message: '2' } }],
      },
    ];

    const merged = mergeEntityInputs(inputs);
    expect(merged.length).toBe(2);
  });

  test('mergeEntityInputs merges hashPrecommits', async () => {
    const { mergeEntityInputs } = await import('../entity-consensus');

    const inputs = [
      {
        entityId: '0x01',
        signerId: 'proposer',
        hashPrecommits: new Map([['validator1', ['sig1']]]),
      },
      {
        entityId: '0x01',
        signerId: 'proposer',
        hashPrecommits: new Map([['validator2', ['sig2']]]),
      },
    ];

    const merged = mergeEntityInputs(inputs);
    expect(merged.length).toBe(1);
    expect(merged[0]!.hashPrecommits!.size).toBe(2);
    expect(merged[0]!.hashPrecommits!.has('validator1')).toBe(true);
    expect(merged[0]!.hashPrecommits!.has('validator2')).toBe(true);
  });
});
