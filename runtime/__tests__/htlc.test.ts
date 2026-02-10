/**
 * HTLC Unit Tests
 * Pure tests for htlc-utils, handleHtlcLock, handleHtlcResolve, handleDirectPayment.
 * No Env/BrowserVM needed — constructs AccountMachine inline per test.
 */

import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';

import type { AccountMachine, Delta } from '../types';
import type { EntityId, TokenId, LockId } from '../ids';
import {
  calculateHtlcFee,
  calculateHtlcFeeAmount,
  generateLockId,
  hashHtlcSecret,
  generateHashlock,
  calculateHopTimelock,
  calculateHopRevealHeight,
} from '../htlc-utils';
import { handleHtlcLock } from '../account-tx/handlers/htlc-lock';
import { handleHtlcResolve } from '../account-tx/handlers/htlc-resolve';
import { handleDirectPayment } from '../account-tx/handlers/direct-payment';
import { HTLC, FINANCIAL } from '../constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LEFT = '0x0000000000000000000000000000000000000000000000000000000000000001' as EntityId;
const RIGHT = '0x0000000000000000000000000000000000000000000000000000000000000002' as EntityId;
const TOKEN_1 = 1 as TokenId;
const NOW = 1700000000000;
const HEIGHT = 10;

function makeSecret(): { secret: string; hashlock: string } {
  // Deterministic 32-byte secret for tests
  const secret = ethers.zeroPadValue('0xdeadbeef', 32);
  const hashlock = hashHtlcSecret(secret);
  return { secret, hashlock };
}

function makeDefaultDelta(tokenId: TokenId, overrides?: Partial<Delta>): Delta {
  return {
    tokenId,
    collateral: 0n,
    ondelta: 0n,
    offdelta: 0n,
    leftCreditLimit: 10000n,
    rightCreditLimit: 10000n,
    leftAllowance: 0n,
    rightAllowance: 0n,
    leftHtlcHold: 0n,
    rightHtlcHold: 0n,
    ...overrides,
  };
}

function makeAccountMachine(overrides?: Partial<AccountMachine>): AccountMachine {
  return {
    leftEntity: LEFT,
    rightEntity: RIGHT,
    mempool: [],
    currentFrame: {
      height: 0,
      timestamp: NOW,
      jHeight: 0,
      accountTxs: [],
      prevFrameHash: '',
      stateHash: '',
      tokenIds: [],
      deltas: [],
    },
    deltas: new Map(),
    locks: new Map(),
    swapOffers: new Map(),
    globalCreditLimits: { ownLimit: 0n, peerLimit: 0n },
    currentHeight: HEIGHT,
    rollbackCount: 0,
    leftJObservations: [],
    rightJObservations: [],
    jEventChain: [],
    lastFinalizedJHeight: 0,
    proofHeader: { fromEntity: LEFT, toEntity: RIGHT, cooperativeNonce: 0, disputeNonce: 0 },
    proofBody: { tokenIds: [], deltas: [] },
    disputeConfig: { leftDisputeDelay: 10, rightDisputeDelay: 10 },
    onChainSettlementNonce: 0,
    frameHistory: [],
    pendingWithdrawals: new Map(),
    requestedRebalance: new Map(),
    ...overrides,
  } as AccountMachine;
}

// ─── htlc-utils ──────────────────────────────────────────────────────────────

describe('htlc-utils', () => {
  describe('calculateHtlcFee', () => {
    test('returns amount minus fee', () => {
      const amount = 10_000_000n; // 10M units
      const result = calculateHtlcFee(amount);
      const fee = calculateHtlcFeeAmount(amount);
      expect(result).toBe(amount - fee);
      expect(result).toBeLessThan(amount);
      expect(result).toBeGreaterThan(0n);
    });

    test('fee rate matches HTLC constants', () => {
      const amount = 10_000_000n;
      const expectedFee = HTLC.BASE_FEE_USD + (amount * HTLC.FEE_RATE_UBP) / HTLC.FEE_DENOMINATOR;
      expect(calculateHtlcFeeAmount(amount)).toBe(expectedFee);
    });

    test('throws when fee exceeds amount', () => {
      // With BASE_FEE_USD=0 and FEE_RATE_UBP=100 / DENOMINATOR=10_000_000,
      // fee is always amount * 100 / 10_000_000 = amount/100_000
      // Fee >= amount when amount is very small (0 or negative handled by bigint)
      expect(() => calculateHtlcFee(0n)).toThrow();
    });

    test('small amounts produce proportionally small fees', () => {
      const small = 1_000_000n;
      const large = 100_000_000n;
      const smallFee = calculateHtlcFeeAmount(small);
      const largeFee = calculateHtlcFeeAmount(large);
      // Fees should scale linearly (since BASE_FEE_USD = 0)
      expect(largeFee * small).toBe(smallFee * large);
    });
  });

  describe('hashHtlcSecret', () => {
    test('produces deterministic hash', () => {
      const secret = ethers.zeroPadValue('0x01', 32);
      const h1 = hashHtlcSecret(secret);
      const h2 = hashHtlcSecret(secret);
      expect(h1).toBe(h2);
    });

    test('different secrets produce different hashes', () => {
      const s1 = ethers.zeroPadValue('0x01', 32);
      const s2 = ethers.zeroPadValue('0x02', 32);
      expect(hashHtlcSecret(s1)).not.toBe(hashHtlcSecret(s2));
    });

    test('rejects non-32-byte hex', () => {
      expect(() => hashHtlcSecret('0xdeadbeef')).toThrow('32-byte hex');
      expect(() => hashHtlcSecret('not-hex')).toThrow();
    });

    test('hash matches ethers keccak256(abi.encode(bytes32))', () => {
      const secret = ethers.zeroPadValue('0xabcd', 32);
      const coder = ethers.AbiCoder.defaultAbiCoder();
      const expected = ethers.keccak256(coder.encode(['bytes32'], [secret]));
      expect(hashHtlcSecret(secret)).toBe(expected);
    });
  });

  describe('generateLockId', () => {
    test('produces deterministic ID', () => {
      const hashlock = '0xabc123';
      const id1 = generateLockId(hashlock, 10, 0, NOW);
      const id2 = generateLockId(hashlock, 10, 0, NOW);
      expect(id1).toBe(id2);
    });

    test('different inputs produce different IDs', () => {
      const hashlock = '0xabc123';
      const id1 = generateLockId(hashlock, 10, 0, NOW);
      const id2 = generateLockId(hashlock, 11, 0, NOW);
      const id3 = generateLockId(hashlock, 10, 1, NOW);
      const id4 = generateLockId(hashlock, 10, 0, NOW + 1);
      expect(new Set([id1, id2, id3, id4]).size).toBe(4);
    });

    test('returns keccak256 hash', () => {
      const hashlock = '0xtest';
      const id = generateLockId(hashlock, 5, 3, 1000);
      const expected = ethers.keccak256(ethers.toUtf8Bytes(`${hashlock}:5:3:1000`));
      expect(id).toBe(expected);
    });
  });

  describe('generateHashlock', () => {
    test('always throws (banned in consensus)', () => {
      expect(() => generateHashlock()).toThrow('non-deterministic');
    });
  });

  describe('calculateHopTimelock', () => {
    test('first hop gets full timelock', () => {
      const base = 60000n;
      // 3-hop route: Alice(0), Hub(1), Bob(2)
      const alice = calculateHopTimelock(base, 0, 3);
      expect(alice).toBe(base - BigInt(2 * HTLC.MIN_TIMELOCK_DELTA_MS));
    });

    test('last hop gets minimum timelock', () => {
      const base = 60000n;
      const bob = calculateHopTimelock(base, 2, 3);
      // Last hop: totalHops - hopIndex - 1 = 0 reduction
      expect(bob).toBe(base);
    });

    test('timelocks decrease per hop for griefing protection', () => {
      const base = 100000n;
      const t0 = calculateHopTimelock(base, 0, 3);
      const t1 = calculateHopTimelock(base, 1, 3);
      const t2 = calculateHopTimelock(base, 2, 3);
      // Earlier hops get LESS time (they have higher reduction)
      expect(t0).toBeLessThan(t1);
      expect(t1).toBeLessThan(t2);
    });
  });

  describe('calculateHopRevealHeight', () => {
    test('first hop gets highest reveal height', () => {
      const base = 100;
      const alice = calculateHopRevealHeight(base, 0, 3);
      const bob = calculateHopRevealHeight(base, 2, 3);
      expect(alice).toBeGreaterThan(bob);
    });

    test('each hop gets one less block', () => {
      const base = 100;
      const h0 = calculateHopRevealHeight(base, 0, 3);
      const h1 = calculateHopRevealHeight(base, 1, 3);
      const h2 = calculateHopRevealHeight(base, 2, 3);
      expect(h0 - h1).toBe(1);
      expect(h1 - h2).toBe(1);
    });

    test('returns baseHeight + (totalHops - hopIndex)', () => {
      expect(calculateHopRevealHeight(50, 0, 4)).toBe(54);
      expect(calculateHopRevealHeight(50, 3, 4)).toBe(51);
    });
  });
});

// ─── handleHtlcLock ──────────────────────────────────────────────────────────

describe('handleHtlcLock', () => {
  test('creates lock and updates hold', async () => {
    const { hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    const result = await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW + 30000),
          revealBeforeHeight: HEIGHT + 5,
          amount: 500n,
          tokenId: TOKEN_1,
        },
      },
      true, // byLeft (left is sender)
      NOW,
      HEIGHT,
    );

    expect(result.success).toBe(true);
    expect(am.locks.has(lockId)).toBe(true);
    expect(am.deltas.get(TOKEN_1)!.leftHtlcHold).toBe(500n);
  });

  test('rejects duplicate lockId', async () => {
    const { hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    // First lock succeeds
    await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW + 30000),
          revealBeforeHeight: HEIGHT + 5,
          amount: 500n,
          tokenId: TOKEN_1,
        },
      },
      true,
      NOW,
      HEIGHT,
    );

    // Same lockId fails
    const result = await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW + 30000),
          revealBeforeHeight: HEIGHT + 5,
          amount: 500n,
          tokenId: TOKEN_1,
        },
      },
      true,
      NOW,
      HEIGHT,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  test('rejects expired timelock', async () => {
    const { hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    const result = await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW - 1),
          revealBeforeHeight: HEIGHT + 5,
          amount: 500n,
          tokenId: TOKEN_1,
        },
      },
      true,
      NOW,
      HEIGHT,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
  });

  test('rejects expired revealBeforeHeight', async () => {
    const { hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    const result = await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW + 30000),
          revealBeforeHeight: HEIGHT - 1,
          amount: 500n,
          tokenId: TOKEN_1,
        },
      },
      true,
      NOW,
      HEIGHT,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('revealBeforeHeight');
  });

  test('rejects amount below minimum', async () => {
    const { hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    const result = await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW + 30000),
          revealBeforeHeight: HEIGHT + 5,
          amount: 0n,
          tokenId: TOKEN_1,
        },
      },
      true,
      NOW,
      HEIGHT,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid amount');
  });

  test('rejects when insufficient capacity', async () => {
    const { hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    // Credit limit of 100 but trying to lock 500
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 100n }));

    const result = await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW + 30000),
          revealBeforeHeight: HEIGHT + 5,
          amount: 500n,
          tokenId: TOKEN_1,
        },
      },
      true,
      NOW,
      HEIGHT,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient capacity');
  });

  test('right sender updates rightHtlcHold', async () => {
    const { hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { rightCreditLimit: 10000n }));

    const result = await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW + 30000),
          revealBeforeHeight: HEIGHT + 5,
          amount: 300n,
          tokenId: TOKEN_1,
        },
      },
      false, // right sender
      NOW,
      HEIGHT,
    );

    expect(result.success).toBe(true);
    expect(am.deltas.get(TOKEN_1)!.rightHtlcHold).toBe(300n);
    expect(am.deltas.get(TOKEN_1)!.leftHtlcHold).toBe(0n);
  });

  test('multiple locks accumulate holds', async () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    for (let i = 0; i < 3; i++) {
      const secret = ethers.zeroPadValue(`0x${(i + 1).toString(16).padStart(2, '0')}`, 32);
      const hashlock = hashHtlcSecret(secret);
      const lockId = generateLockId(hashlock, HEIGHT, i, NOW) as LockId;

      const result = await handleHtlcLock(
        am,
        {
          type: 'htlc_lock',
          data: {
            lockId,
            hashlock,
            timelock: BigInt(NOW + 30000),
            revealBeforeHeight: HEIGHT + 5,
            amount: 100n,
            tokenId: TOKEN_1,
          },
        },
        true,
        NOW,
        HEIGHT,
      );
      expect(result.success).toBe(true);
    }

    expect(am.locks.size).toBe(3);
    expect(am.deltas.get(TOKEN_1)!.leftHtlcHold).toBe(300n);
  });

  test('lock stores senderIsLeft correctly', async () => {
    const { hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { rightCreditLimit: 5000n }));

    await handleHtlcLock(
      am,
      {
        type: 'htlc_lock',
        data: {
          lockId,
          hashlock,
          timelock: BigInt(NOW + 30000),
          revealBeforeHeight: HEIGHT + 5,
          amount: 100n,
          tokenId: TOKEN_1,
        },
      },
      false,
      NOW,
      HEIGHT,
    );

    const lock = am.locks.get(lockId)!;
    expect(lock.senderIsLeft).toBe(false);
    expect(lock.amount).toBe(100n);
    expect(lock.hashlock).toBe(hashlock);
  });
});

// ─── handleHtlcResolve ──────────────────────────────────────────────────────

describe('handleHtlcResolve', () => {
  function setupWithLock(senderIsLeft = true) {
    const { secret, hashlock } = makeSecret();
    const lockId = generateLockId(hashlock, HEIGHT, 0, NOW) as LockId;
    const am = makeAccountMachine();
    const delta = makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n, rightCreditLimit: 10000n });

    if (senderIsLeft) {
      delta.leftHtlcHold = 500n;
    } else {
      delta.rightHtlcHold = 500n;
    }
    am.deltas.set(TOKEN_1, delta);

    am.locks.set(lockId, {
      lockId,
      hashlock,
      timelock: BigInt(NOW + 30000),
      revealBeforeHeight: HEIGHT + 5,
      amount: 500n,
      tokenId: TOKEN_1,
      senderIsLeft,
      createdHeight: HEIGHT,
      createdTimestamp: NOW,
    });

    return { am, lockId, secret, hashlock };
  }

  test('resolves with valid secret — applies delta and releases hold', async () => {
    const { am, lockId, secret } = setupWithLock(true);
    const deltaBefore = am.deltas.get(TOKEN_1)!.offdelta;

    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'secret', secret } },
      HEIGHT,
      NOW,
    );

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('secret');
    expect(result.secret).toBe(secret);
    // Lock removed
    expect(am.locks.has(lockId)).toBe(false);
    // Hold released
    expect(am.deltas.get(TOKEN_1)!.leftHtlcHold).toBe(0n);
    // Delta applied: left sender → -amount
    expect(am.deltas.get(TOKEN_1)!.offdelta).toBe(deltaBefore - 500n);
  });

  test('resolves right-sender lock — delta increases', async () => {
    const { am, lockId, secret } = setupWithLock(false);

    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'secret', secret } },
      HEIGHT,
      NOW,
    );

    expect(result.success).toBe(true);
    // Right sender → +amount
    expect(am.deltas.get(TOKEN_1)!.offdelta).toBe(500n);
    expect(am.deltas.get(TOKEN_1)!.rightHtlcHold).toBe(0n);
  });

  test('rejects invalid secret', async () => {
    const { am, lockId } = setupWithLock(true);
    const wrongSecret = ethers.zeroPadValue('0x9999', 32);

    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'secret', secret: wrongSecret } },
      HEIGHT,
      NOW,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('mismatch');
    // Lock NOT removed on failure
    expect(am.locks.has(lockId)).toBe(true);
  });

  test('rejects expired lock (height)', async () => {
    const { am, lockId, secret } = setupWithLock(true);

    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'secret', secret } },
      HEIGHT + 100, // well past revealBeforeHeight
      NOW,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
  });

  test('rejects expired lock (timestamp)', async () => {
    const { am, lockId, secret } = setupWithLock(true);

    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'secret', secret } },
      HEIGHT,
      NOW + 100000, // well past timelock
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
  });

  test('error outcome releases hold without applying delta', async () => {
    const { am, lockId } = setupWithLock(true);
    const offdeltaBefore = am.deltas.get(TOKEN_1)!.offdelta;

    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'error', reason: 'no_capacity' } },
      HEIGHT,
      NOW,
    );

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('error');
    expect(result.reason).toBe('no_capacity');
    // Lock removed
    expect(am.locks.has(lockId)).toBe(false);
    // Hold released but offdelta unchanged
    expect(am.deltas.get(TOKEN_1)!.leftHtlcHold).toBe(0n);
    expect(am.deltas.get(TOKEN_1)!.offdelta).toBe(offdeltaBefore);
  });

  test('timeout error requires lock to be expired', async () => {
    const { am, lockId } = setupWithLock(true);

    // Lock is NOT expired yet
    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'error', reason: 'timeout' } },
      HEIGHT,
      NOW,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not expired');
  });

  test('non-timeout error resolves without expiry check', async () => {
    const { am, lockId } = setupWithLock(true);

    // Lock is NOT expired — but error reason is not 'timeout'
    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'error', reason: 'downstream_failure' } },
      HEIGHT,
      NOW,
    );

    expect(result.success).toBe(true);
    expect(am.locks.has(lockId)).toBe(false);
  });

  test('rejects resolve for nonexistent lock', async () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1));

    const result = await handleHtlcResolve(
      am,
      {
        type: 'htlc_resolve',
        data: { lockId: '0xnonexistent', outcome: 'secret', secret: ethers.zeroPadValue('0x01', 32) },
      },
      HEIGHT,
      NOW,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('secret outcome without secret field fails', async () => {
    const { am, lockId } = setupWithLock(true);

    const result = await handleHtlcResolve(
      am,
      { type: 'htlc_resolve', data: { lockId, outcome: 'secret' } },
      HEIGHT,
      NOW,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Secret required');
  });
});

// ─── handleDirectPayment ─────────────────────────────────────────────────────

describe('handleDirectPayment', () => {
  test('applies offdelta for left→right payment', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    const result = handleDirectPayment(
      am,
      { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 500n, fromEntityId: LEFT, toEntityId: RIGHT } },
      true,
    );

    expect(result.success).toBe(true);
    // Left sends → offdelta decreases
    expect(am.deltas.get(TOKEN_1)!.offdelta).toBe(-500n);
  });

  test('applies offdelta for right→left payment', () => {
    const am = makeAccountMachine({
      proofHeader: { fromEntity: RIGHT, toEntity: LEFT, cooperativeNonce: 0, disputeNonce: 0 },
    });
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { rightCreditLimit: 10000n }));

    const result = handleDirectPayment(
      am,
      { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 300n, fromEntityId: RIGHT, toEntityId: LEFT } },
      false,
    );

    expect(result.success).toBe(true);
    // Right sends → offdelta increases
    expect(am.deltas.get(TOKEN_1)!.offdelta).toBe(300n);
  });

  test('rejects when amount exceeds credit limit', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 100n }));

    const result = handleDirectPayment(
      am,
      { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 500n, fromEntityId: LEFT, toEntityId: RIGHT } },
      true,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('capacity');
  });

  test('rejects missing fromEntityId/toEntityId', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    const result = handleDirectPayment(am, { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 500n } }, true);

    expect(result.success).toBe(false);
    expect(result.error).toContain('FATAL');
  });

  test('rejects amount below minimum', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    const result = handleDirectPayment(
      am,
      { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 0n, fromEntityId: LEFT, toEntityId: RIGHT } },
      true,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid payment amount');
  });

  test('rejects amount above maximum', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: FINANCIAL.MAX_PAYMENT_AMOUNT + 1n }));

    const result = handleDirectPayment(
      am,
      {
        type: 'direct_payment',
        data: { tokenId: TOKEN_1, amount: FINANCIAL.MAX_PAYMENT_AMOUNT + 1n, fromEntityId: LEFT, toEntityId: RIGHT },
      },
      true,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid payment amount');
  });

  test('sets pendingForward for multi-hop routing', () => {
    const HUB = '0x0000000000000000000000000000000000000000000000000000000000000003' as EntityId;
    // AM from HUB's perspective, receiving from LEFT
    const am = makeAccountMachine({
      proofHeader: { fromEntity: HUB, toEntity: LEFT, cooperativeNonce: 0, disputeNonce: 0 },
    });
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n, rightCreditLimit: 10000n }));

    const result = handleDirectPayment(
      am,
      {
        type: 'direct_payment',
        data: {
          tokenId: TOKEN_1,
          amount: 500n,
          fromEntityId: LEFT,
          toEntityId: HUB,
          route: [HUB, RIGHT], // Remaining route after sender was removed
        },
      },
      false,
    );

    expect(result.success).toBe(true);
    expect(am.pendingForward).toBeDefined();
    expect(am.pendingForward!.amount).toBe(500n);
    expect(am.pendingForward!.route).toEqual([HUB, RIGHT]);
  });

  test('no pendingForward for direct (non-routed) payment', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    handleDirectPayment(
      am,
      { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 500n, fromEntityId: LEFT, toEntityId: RIGHT } },
      true,
    );

    expect(am.pendingForward).toBeUndefined();
  });

  test('updates currentFrame tokenIds and deltas', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    handleDirectPayment(
      am,
      { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 500n, fromEntityId: LEFT, toEntityId: RIGHT } },
      true,
    );

    expect(am.currentFrame.tokenIds).toContain(TOKEN_1);
    expect(am.currentFrame.deltas.length).toBe(1);
    // ondelta(0) + offdelta(-500) = -500
    expect(am.currentFrame.deltas[0]).toBe(-500n);
  });

  test('bidirectional payments net correctly', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n, rightCreditLimit: 10000n }));

    // Left sends 500
    handleDirectPayment(
      am,
      { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 500n, fromEntityId: LEFT, toEntityId: RIGHT } },
      true,
    );

    // Right sends 300
    handleDirectPayment(
      am,
      { type: 'direct_payment', data: { tokenId: TOKEN_1, amount: 300n, fromEntityId: RIGHT, toEntityId: LEFT } },
      false,
    );

    // Net: -500 + 300 = -200 (left still owes 200)
    expect(am.deltas.get(TOKEN_1)!.offdelta).toBe(-200n);
  });

  test('rejects route exceeding MAX_ROUTE_HOPS', () => {
    const am = makeAccountMachine();
    am.deltas.set(TOKEN_1, makeDefaultDelta(TOKEN_1, { leftCreditLimit: 10000n }));

    const longRoute = Array.from(
      { length: FINANCIAL.MAX_ROUTE_HOPS + 1 },
      (_, i) => `0x${i.toString(16).padStart(64, '0')}`,
    );

    const result = handleDirectPayment(
      am,
      {
        type: 'direct_payment',
        data: { tokenId: TOKEN_1, amount: 500n, fromEntityId: LEFT, toEntityId: RIGHT, route: longRoute },
      },
      true,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Route too long');
  });
});
