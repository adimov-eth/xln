/**
 * Tests for j-batch.ts — JBatch aggregator pure functions.
 * No BrowserVM needed: all functions operate on plain data structures.
 */

import { describe, expect, test } from 'bun:test';
import {
  createEmptyBatch,
  cloneJBatch,
  initJBatch,
  isBatchEmpty,
  getBatchSize,
  assertBatchNotPending,
  detectPureC2R,
  preflightBatchForE2,
  batchAddSettlement,
  batchAddReserveToCollateral,
  batchAddReserveToReserve,
  batchAddRevealSecret,
  batchAddInsurance,
  shouldBroadcastBatch,
  encodeJBatch,
  decodeJBatch,
  computeBatchHankoHash,
  summarizeBatch,
} from '../j-batch';
import type { JBatch, JBatchState, InsuranceReg } from '../j-batch';

// ─── Test Entity IDs ─────────────────────────────────────────────────────────
// LEFT < RIGHT lexicographically (canonical bilateral ordering)
const LEFT = '0x' + '0'.repeat(63) + '1';
const RIGHT = '0x' + '0'.repeat(63) + '2';
const THIRD = '0x' + '0'.repeat(63) + '3';
const ZERO_ENTITY = '0x' + '0'.repeat(64);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeState(overrides?: Partial<JBatchState>): JBatchState {
  return { ...initJBatch(), ...overrides };
}

function makeDiff(tokenId: number, leftDiff: bigint, rightDiff: bigint, collateralDiff: bigint, ondeltaDiff: bigint) {
  return { tokenId, leftDiff, rightDiff, collateralDiff, ondeltaDiff };
}

// ═══════════════════════════════════════════════════════════════════════════════
// createEmptyBatch / initJBatch
// ═══════════════════════════════════════════════════════════════════════════════

describe('createEmptyBatch', () => {
  test('returns batch with all empty arrays', () => {
    const batch = createEmptyBatch();
    expect(batch.flashloans).toEqual([]);
    expect(batch.reserveToReserve).toEqual([]);
    expect(batch.reserveToCollateral).toEqual([]);
    expect(batch.collateralToReserve).toEqual([]);
    expect(batch.settlements).toEqual([]);
    expect(batch.disputeStarts).toEqual([]);
    expect(batch.disputeFinalizations).toEqual([]);
    expect(batch.externalTokenToReserve).toEqual([]);
    expect(batch.reserveToExternalToken).toEqual([]);
    expect(batch.revealSecrets).toEqual([]);
    expect(batch.hub_id).toBe(0);
  });

  test('returns new instance each call', () => {
    const a = createEmptyBatch();
    const b = createEmptyBatch();
    expect(a).not.toBe(b);
    a.hub_id = 42;
    expect(b.hub_id).toBe(0);
  });
});

describe('initJBatch', () => {
  test('returns initial state with empty batch', () => {
    const state = initJBatch();
    expect(isBatchEmpty(state.batch)).toBe(true);
    expect(state.jurisdiction).toBeNull();
    expect(state.lastBroadcast).toBe(0);
    expect(state.broadcastCount).toBe(0);
    expect(state.failedAttempts).toBe(0);
    expect(state.pendingBroadcast).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isBatchEmpty / getBatchSize
// ═══════════════════════════════════════════════════════════════════════════════

describe('isBatchEmpty', () => {
  test('true for fresh batch', () => {
    expect(isBatchEmpty(createEmptyBatch())).toBe(true);
  });

  const fields: Array<keyof JBatch> = [
    'flashloans',
    'reserveToReserve',
    'reserveToCollateral',
    'collateralToReserve',
    'settlements',
    'disputeStarts',
    'disputeFinalizations',
    'externalTokenToReserve',
    'reserveToExternalToken',
    'revealSecrets',
  ];

  for (const field of fields) {
    test(`false when ${field} has an entry`, () => {
      const batch = createEmptyBatch();
      // Push a dummy element — isBatchEmpty only checks .length
      (batch[field] as unknown[]).push({});
      expect(isBatchEmpty(batch)).toBe(false);
    });
  }
});

describe('getBatchSize', () => {
  test('0 for empty batch', () => {
    expect(getBatchSize(createEmptyBatch())).toBe(0);
  });

  test('sums all array lengths', () => {
    const batch = createEmptyBatch();
    batch.flashloans.push({ tokenId: 1, amount: 100n });
    batch.reserveToReserve.push({ receivingEntity: LEFT, tokenId: 1, amount: 50n });
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [],
      sig: '',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    expect(getBatchSize(batch)).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// assertBatchNotPending
// ═══════════════════════════════════════════════════════════════════════════════

describe('assertBatchNotPending', () => {
  test('does nothing when not pending', () => {
    const state = makeState();
    expect(() => assertBatchNotPending(state, 'test')).not.toThrow();
  });

  test('throws when pending', () => {
    const state = makeState({ pendingBroadcast: true });
    expect(() => assertBatchNotPending(state, 'R2C')).toThrow(/Cannot add R2C/);
    expect(() => assertBatchNotPending(state, 'R2C')).toThrow(/pending broadcast/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// detectPureC2R
// ═══════════════════════════════════════════════════════════════════════════════

describe('detectPureC2R', () => {
  test('rejects multiple diffs', () => {
    const diffs = [makeDiff(1, 100n, 0n, -100n, -100n), makeDiff(2, 50n, 0n, -50n, -50n)];
    expect(detectPureC2R(diffs, [], []).isPureC2R).toBe(false);
  });

  test('rejects empty diffs', () => {
    expect(detectPureC2R([], [], []).isPureC2R).toBe(false);
  });

  test('rejects when forgiveDebtsInTokenIds present', () => {
    const diffs = [makeDiff(1, 100n, 0n, -100n, -100n)];
    expect(detectPureC2R(diffs, [1], []).isPureC2R).toBe(false);
  });

  test('rejects when insuranceRegs present', () => {
    const diffs = [makeDiff(1, 100n, 0n, -100n, -100n)];
    const reg: InsuranceReg = { insured: LEFT, insurer: RIGHT, tokenId: 1, limit: 100n, expiresAt: 9999n };
    expect(detectPureC2R(diffs, [], [reg]).isPureC2R).toBe(false);
  });

  test('rejects non-negative collateralDiff', () => {
    const diffs = [makeDiff(1, 100n, 0n, 0n, -100n)];
    expect(detectPureC2R(diffs, [], []).isPureC2R).toBe(false);
  });

  test('detects left-withdraws pattern', () => {
    // LEFT withdraws 100: leftDiff=+100, rightDiff=0, collateralDiff=-100, ondeltaDiff=-100
    const diffs = [makeDiff(1, 100n, 0n, -100n, -100n)];
    const result = detectPureC2R(diffs, [], []);
    expect(result.isPureC2R).toBe(true);
    if (result.isPureC2R) {
      expect(result.withdrawer).toBe('left');
      expect(result.tokenId).toBe(1);
      expect(result.amount).toBe(100n);
    }
  });

  test('detects right-withdraws pattern', () => {
    // RIGHT withdraws 200: leftDiff=0, rightDiff=+200, collateralDiff=-200, ondeltaDiff=0
    const diffs = [makeDiff(1, 0n, 200n, -200n, 0n)];
    const result = detectPureC2R(diffs, [], []);
    expect(result.isPureC2R).toBe(true);
    if (result.isPureC2R) {
      expect(result.withdrawer).toBe('right');
      expect(result.tokenId).toBe(1);
      expect(result.amount).toBe(200n);
    }
  });

  test('rejects when ondeltaDiff does not match left-withdraws pattern', () => {
    // leftDiff=+100 but ondeltaDiff=0 (should be -100 for left-withdraws)
    const diffs = [makeDiff(1, 100n, 0n, -100n, 0n)];
    expect(detectPureC2R(diffs, [], []).isPureC2R).toBe(false);
  });

  test('rejects when ondeltaDiff does not match right-withdraws pattern', () => {
    // rightDiff=+200 but ondeltaDiff=-200 (should be 0 for right-withdraws)
    const diffs = [makeDiff(1, 0n, 200n, -200n, -200n)];
    expect(detectPureC2R(diffs, [], []).isPureC2R).toBe(false);
  });

  test('rejects when both leftDiff and rightDiff are positive', () => {
    const diffs = [makeDiff(1, 50n, 50n, -100n, -50n)];
    expect(detectPureC2R(diffs, [], []).isPureC2R).toBe(false);
  });

  test('rejects when leftDiff does not equal amount', () => {
    // collateralDiff=-100 => amount=100, but leftDiff=50
    const diffs = [makeDiff(1, 50n, 0n, -100n, -100n)];
    expect(detectPureC2R(diffs, [], []).isPureC2R).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// batchAddReserveToCollateral
// ═══════════════════════════════════════════════════════════════════════════════

describe('batchAddReserveToCollateral', () => {
  test('adds new R2C entry', () => {
    const state = makeState();
    batchAddReserveToCollateral(state, LEFT, RIGHT, 1, 500n);
    expect(state.batch.reserveToCollateral).toHaveLength(1);
    expect(state.batch.reserveToCollateral[0]!.receivingEntity).toBe(LEFT);
    expect(state.batch.reserveToCollateral[0]!.tokenId).toBe(1);
    expect(state.batch.reserveToCollateral[0]!.pairs).toEqual([{ entity: RIGHT, amount: 500n }]);
  });

  test('aggregates amount for same entity+token, new counterparty', () => {
    const state = makeState();
    batchAddReserveToCollateral(state, LEFT, RIGHT, 1, 500n);
    batchAddReserveToCollateral(state, LEFT, THIRD, 1, 300n);
    // Same receivingEntity + tokenId → same entry, two pairs
    expect(state.batch.reserveToCollateral).toHaveLength(1);
    expect(state.batch.reserveToCollateral[0]!.pairs).toHaveLength(2);
    expect(state.batch.reserveToCollateral[0]!.pairs[1]!.entity).toBe(THIRD);
    expect(state.batch.reserveToCollateral[0]!.pairs[1]!.amount).toBe(300n);
  });

  test('aggregates amount for same counterparty pair', () => {
    const state = makeState();
    batchAddReserveToCollateral(state, LEFT, RIGHT, 1, 500n);
    batchAddReserveToCollateral(state, LEFT, RIGHT, 1, 200n);
    expect(state.batch.reserveToCollateral).toHaveLength(1);
    expect(state.batch.reserveToCollateral[0]!.pairs).toHaveLength(1);
    expect(state.batch.reserveToCollateral[0]!.pairs[0]!.amount).toBe(700n);
  });

  test('creates separate entry for different tokenId', () => {
    const state = makeState();
    batchAddReserveToCollateral(state, LEFT, RIGHT, 1, 500n);
    batchAddReserveToCollateral(state, LEFT, RIGHT, 2, 300n);
    expect(state.batch.reserveToCollateral).toHaveLength(2);
  });

  test('throws when pending broadcast', () => {
    const state = makeState({ pendingBroadcast: true });
    expect(() => batchAddReserveToCollateral(state, LEFT, RIGHT, 1, 500n)).toThrow(/pending broadcast/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// batchAddReserveToReserve
// ═══════════════════════════════════════════════════════════════════════════════

describe('batchAddReserveToReserve', () => {
  test('adds R2R entry', () => {
    const state = makeState();
    batchAddReserveToReserve(state, RIGHT, 1, 1000n);
    expect(state.batch.reserveToReserve).toHaveLength(1);
    expect(state.batch.reserveToReserve[0]).toEqual({ receivingEntity: RIGHT, tokenId: 1, amount: 1000n });
  });

  test('multiple R2R entries accumulate', () => {
    const state = makeState();
    batchAddReserveToReserve(state, RIGHT, 1, 100n);
    batchAddReserveToReserve(state, THIRD, 2, 200n);
    expect(state.batch.reserveToReserve).toHaveLength(2);
  });

  test('throws when pending broadcast', () => {
    const state = makeState({ pendingBroadcast: true });
    expect(() => batchAddReserveToReserve(state, RIGHT, 1, 100n)).toThrow(/pending broadcast/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// batchAddRevealSecret
// ═══════════════════════════════════════════════════════════════════════════════

describe('batchAddRevealSecret', () => {
  const TRANSFORMER = '0x1234567890abcdef1234567890abcdef12345678';
  const SECRET = '0xdeadbeef';

  test('adds secret reveal', () => {
    const state = makeState();
    batchAddRevealSecret(state, TRANSFORMER, SECRET);
    expect(state.batch.revealSecrets).toHaveLength(1);
    expect(state.batch.revealSecrets[0]).toEqual({ transformer: TRANSFORMER, secret: SECRET });
  });

  test('idempotent — duplicate transformer+secret ignored', () => {
    const state = makeState();
    batchAddRevealSecret(state, TRANSFORMER, SECRET);
    batchAddRevealSecret(state, TRANSFORMER, SECRET);
    expect(state.batch.revealSecrets).toHaveLength(1);
  });

  test('different secrets are separate entries', () => {
    const state = makeState();
    batchAddRevealSecret(state, TRANSFORMER, SECRET);
    batchAddRevealSecret(state, TRANSFORMER, '0xcafebabe');
    expect(state.batch.revealSecrets).toHaveLength(2);
  });

  test('throws when pending broadcast', () => {
    const state = makeState({ pendingBroadcast: true });
    expect(() => batchAddRevealSecret(state, TRANSFORMER, SECRET)).toThrow(/pending broadcast/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// batchAddSettlement
// ═══════════════════════════════════════════════════════════════════════════════

describe('batchAddSettlement', () => {
  const SIG = '0xdeadbeef1234';

  test('adds settlement with diffs and sig', () => {
    const state = makeState();
    const diffs = [makeDiff(1, 100n, -100n, 0n, 100n)];
    batchAddSettlement(state, LEFT, RIGHT, diffs, [], [], SIG);
    expect(state.batch.settlements).toHaveLength(1);
    expect(state.batch.settlements[0]!.leftEntity).toBe(LEFT);
    expect(state.batch.settlements[0]!.rightEntity).toBe(RIGHT);
    expect(state.batch.settlements[0]!.diffs).toEqual(diffs);
    expect(state.batch.settlements[0]!.sig).toBe(SIG);
  });

  test('throws when left >= right (not canonical order)', () => {
    const state = makeState();
    const diffs = [makeDiff(1, 100n, -100n, 0n, 100n)];
    expect(() => batchAddSettlement(state, RIGHT, LEFT, diffs, [], [], SIG)).toThrow(/must be ordered/);
  });

  test('throws when changes present but no sig', () => {
    const state = makeState();
    const diffs = [makeDiff(1, 100n, -100n, 0n, 100n)];
    expect(() => batchAddSettlement(state, LEFT, RIGHT, diffs)).toThrow(/missing hanko signature/);
  });

  test('allows empty settlement without sig', () => {
    const state = makeState();
    batchAddSettlement(state, LEFT, RIGHT, []);
    expect(state.batch.settlements).toHaveLength(1);
    expect(state.batch.settlements[0]!.sig).toBe('');
  });

  test('compresses pure C2R left-withdraws into collateralToReserve', () => {
    const state = makeState();
    // left-withdraws pattern: leftDiff=+100, rightDiff=0, collateralDiff=-100, ondeltaDiff=-100
    const diffs = [makeDiff(1, 100n, 0n, -100n, -100n)];
    batchAddSettlement(state, LEFT, RIGHT, diffs, [], [], SIG);
    // Should NOT be in settlements
    expect(state.batch.settlements).toHaveLength(0);
    // Should be in collateralToReserve
    expect(state.batch.collateralToReserve).toHaveLength(1);
    expect(state.batch.collateralToReserve[0]!.counterparty).toBe(RIGHT);
    expect(state.batch.collateralToReserve[0]!.amount).toBe(100n);
    expect(state.batch.collateralToReserve[0]!.sig).toBe(SIG);
  });

  test('compresses pure C2R right-withdraws into collateralToReserve', () => {
    const state = makeState();
    // right-withdraws pattern: leftDiff=0, rightDiff=+200, collateralDiff=-200, ondeltaDiff=0
    const diffs = [makeDiff(1, 0n, 200n, -200n, 0n)];
    batchAddSettlement(state, LEFT, RIGHT, diffs, [], [], SIG);
    expect(state.batch.settlements).toHaveLength(0);
    expect(state.batch.collateralToReserve).toHaveLength(1);
    expect(state.batch.collateralToReserve[0]!.counterparty).toBe(LEFT);
    expect(state.batch.collateralToReserve[0]!.amount).toBe(200n);
  });

  test('skips C2R compression when initiator is not withdrawer', () => {
    const state = makeState();
    // left-withdraws pattern, but initiator is RIGHT (not the withdrawer)
    const diffs = [makeDiff(1, 100n, 0n, -100n, -100n)];
    batchAddSettlement(state, LEFT, RIGHT, diffs, [], [], SIG, undefined, undefined, 0, RIGHT);
    // Should fall through to full settlement
    expect(state.batch.settlements).toHaveLength(1);
    expect(state.batch.collateralToReserve).toHaveLength(0);
  });

  test('allows C2R compression when initiator is the withdrawer', () => {
    const state = makeState();
    const diffs = [makeDiff(1, 100n, 0n, -100n, -100n)];
    batchAddSettlement(state, LEFT, RIGHT, diffs, [], [], SIG, undefined, undefined, 0, LEFT);
    expect(state.batch.settlements).toHaveLength(0);
    expect(state.batch.collateralToReserve).toHaveLength(1);
  });

  test('rejects duplicate settlement with existing diffs', () => {
    const state = makeState();
    const diffs = [makeDiff(1, 100n, -100n, 0n, 100n)];
    batchAddSettlement(state, LEFT, RIGHT, diffs, [], [], SIG);
    // Second add with diffs should throw (can't merge without fresh sig)
    expect(() => batchAddSettlement(state, LEFT, RIGHT, diffs, [], [], SIG)).toThrow(/already queued/);
  });

  test('merges into empty existing settlement', () => {
    const state = makeState();
    // First: empty settlement
    batchAddSettlement(state, LEFT, RIGHT, []);
    // Second: add diffs
    const diffs = [makeDiff(1, 100n, -100n, 0n, 100n)];
    batchAddSettlement(state, LEFT, RIGHT, diffs, [], [], SIG);
    expect(state.batch.settlements).toHaveLength(1);
    expect(state.batch.settlements[0]!.diffs).toHaveLength(1);
    expect(state.batch.settlements[0]!.sig).toBe(SIG);
  });

  test('deduplicates forgiveDebtsInTokenIds', () => {
    const state = makeState();
    batchAddSettlement(state, LEFT, RIGHT, [], [1, 2], [], SIG);
    batchAddSettlement(state, LEFT, RIGHT, [], [2, 3], [], SIG);
    expect(state.batch.settlements[0]!.forgiveDebtsInTokenIds).toEqual([1, 2, 3]);
  });

  test('appends insurance regs on merge', () => {
    const state = makeState();
    const reg1: InsuranceReg = { insured: LEFT, insurer: RIGHT, tokenId: 1, limit: 100n, expiresAt: 9999n };
    const reg2: InsuranceReg = { insured: RIGHT, insurer: LEFT, tokenId: 2, limit: 200n, expiresAt: 8888n };
    batchAddSettlement(state, LEFT, RIGHT, [], [], [reg1], SIG);
    batchAddSettlement(state, LEFT, RIGHT, [], [], [reg2], SIG);
    expect(state.batch.settlements[0]!.insuranceRegs).toHaveLength(2);
  });

  test('throws when pending broadcast', () => {
    const state = makeState({ pendingBroadcast: true });
    expect(() => batchAddSettlement(state, LEFT, RIGHT, [])).toThrow(/pending broadcast/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// batchAddInsurance
// ═══════════════════════════════════════════════════════════════════════════════

describe('batchAddInsurance', () => {
  const reg: InsuranceReg = { insured: LEFT, insurer: RIGHT, tokenId: 1, limit: 500n, expiresAt: 99999n };

  test('creates settlement if none exists and adds insurance', () => {
    const state = makeState();
    batchAddInsurance(state, LEFT, RIGHT, reg);
    expect(state.batch.settlements).toHaveLength(1);
    expect(state.batch.settlements[0]!.insuranceRegs).toHaveLength(1);
    expect(state.batch.settlements[0]!.diffs).toHaveLength(0);
  });

  test('adds insurance to existing settlement', () => {
    const state = makeState();
    batchAddSettlement(state, LEFT, RIGHT, []);
    batchAddInsurance(state, LEFT, RIGHT, reg);
    expect(state.batch.settlements).toHaveLength(1);
    expect(state.batch.settlements[0]!.insuranceRegs).toHaveLength(1);
  });

  test('normalizes entity order (right, left → left, right)', () => {
    const state = makeState();
    // Pass in reverse order
    batchAddInsurance(state, RIGHT, LEFT, reg);
    // Settlement should have canonical left < right order
    expect(state.batch.settlements[0]!.leftEntity).toBe(LEFT);
    expect(state.batch.settlements[0]!.rightEntity).toBe(RIGHT);
  });

  test('throws when pending broadcast', () => {
    const state = makeState({ pendingBroadcast: true });
    expect(() => batchAddInsurance(state, LEFT, RIGHT, reg)).toThrow(/pending broadcast/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// preflightBatchForE2
// ═══════════════════════════════════════════════════════════════════════════════

describe('preflightBatchForE2', () => {
  test('no issues on empty batch', () => {
    expect(preflightBatchForE2(LEFT, createEmptyBatch())).toEqual([]);
  });

  test('no issues for valid batch', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [makeDiff(1, 100n, -100n, 0n, 100n)],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [],
      sig: '0xvalidSig',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    expect(preflightBatchForE2(LEFT, batch)).toEqual([]);
  });

  test('detects settlement left >= right', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: RIGHT, // wrong order
      rightEntity: LEFT,
      diffs: [],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [],
      sig: '',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('left>=right'))).toBe(true);
  });

  test('detects settlement missing sig with changes', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [makeDiff(1, 100n, -100n, 0n, 100n)],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [],
      sig: '', // missing
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('missing sig'))).toBe(true);
  });

  test('detects insurance self-insured', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [{ insured: LEFT, insurer: LEFT, tokenId: 1, limit: 100n, expiresAt: 99999n }],
      sig: '',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('insured==insurer'))).toBe(true);
  });

  test('detects insurance limit=0', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [{ insured: LEFT, insurer: RIGHT, tokenId: 1, limit: 0n, expiresAt: 99999n }],
      sig: '',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('limit=0'))).toBe(true);
  });

  test('detects expired insurance', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [{ insured: LEFT, insurer: RIGHT, tokenId: 1, limit: 100n, expiresAt: 10n }],
      sig: '',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    // blockTimestampSec = 100 > expiresAt = 10
    const issues = preflightBatchForE2(LEFT, batch, 100);
    expect(issues.some(i => i.includes('expired'))).toBe(true);
  });

  test('does not flag non-expired insurance when no timestamp', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [{ insured: LEFT, insurer: RIGHT, tokenId: 1, limit: 100n, expiresAt: 10n }],
      sig: '',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    // No blockTimestampSec → nowSec defaults to 0, skip expiry check
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('expired'))).toBe(false);
  });

  test('detects externalTokenToReserve entity mismatch', () => {
    const batch = createEmptyBatch();
    batch.externalTokenToReserve.push({
      entity: RIGHT, // not our entity
      contractAddress: '0x0000000000000000000000000000000000000001',
      externalTokenId: 0n,
      tokenType: 0,
      internalTokenId: 1,
      amount: 100n,
    });
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('entity mismatch'))).toBe(true);
  });

  test('detects revealSecrets with zero transformer', () => {
    const batch = createEmptyBatch();
    batch.revealSecrets.push({
      transformer: '0x0000000000000000000000000000000000000000',
      secret: '0xdeadbeef',
    });
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('transformer=0'))).toBe(true);
  });

  test('detects cooperative dispute finalization missing sig', () => {
    const batch = createEmptyBatch();
    batch.disputeFinalizations.push({
      counterentity: RIGHT,
      initialCooperativeNonce: 0,
      finalCooperativeNonce: 1,
      initialDisputeNonce: 0,
      finalDisputeNonce: 1,
      initialProofbodyHash: '0x00',
      finalProofbody: null,
      finalArguments: '0x',
      initialArguments: '0x',
      sig: '', // missing
      startedByLeft: true,
      disputeUntilBlock: 100,
      cooperative: true,
    });
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('cooperative dispute finalize missing sig'))).toBe(true);
  });

  test('detects counterdispute nonce order violation', () => {
    const batch = createEmptyBatch();
    batch.disputeFinalizations.push({
      counterentity: RIGHT,
      initialCooperativeNonce: 0,
      finalCooperativeNonce: 1,
      initialDisputeNonce: 5,
      finalDisputeNonce: 3, // initial >= final → bad
      initialProofbodyHash: '0x00',
      finalProofbody: null,
      finalArguments: '0x',
      initialArguments: '0x',
      sig: '0xsomesig',
      startedByLeft: true,
      disputeUntilBlock: 100,
      cooperative: false,
    });
    const issues = preflightBatchForE2(LEFT, batch);
    expect(issues.some(i => i.includes('counterdispute nonce order'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// shouldBroadcastBatch
// ═══════════════════════════════════════════════════════════════════════════════

describe('shouldBroadcastBatch', () => {
  test('false for empty batch', () => {
    const state = makeState();
    expect(shouldBroadcastBatch(state, 10000)).toBe(false);
  });

  test('true when batch size >= 50', () => {
    const state = makeState();
    // Push 50 R2R entries
    for (let i = 0; i < 50; i++) {
      state.batch.reserveToReserve.push({ receivingEntity: RIGHT, tokenId: 1, amount: 1n });
    }
    expect(shouldBroadcastBatch(state, 0)).toBe(true);
  });

  test('true when timeout exceeded (5000ms)', () => {
    const state = makeState({ lastBroadcast: 0 });
    state.batch.reserveToReserve.push({ receivingEntity: RIGHT, tokenId: 1, amount: 1n });
    expect(shouldBroadcastBatch(state, 5000)).toBe(true);
  });

  test('false when within timeout and under max size', () => {
    const state = makeState({ lastBroadcast: 1000 });
    state.batch.reserveToReserve.push({ receivingEntity: RIGHT, tokenId: 1, amount: 1n });
    // 4999ms since lastBroadcast = within 5000ms timeout
    expect(shouldBroadcastBatch(state, 5999)).toBe(false);
  });

  test('true at exactly timeout boundary', () => {
    const state = makeState({ lastBroadcast: 1000 });
    state.batch.reserveToReserve.push({ receivingEntity: RIGHT, tokenId: 1, amount: 1n });
    // Exactly 5000ms since lastBroadcast
    expect(shouldBroadcastBatch(state, 6000)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// cloneJBatch
// ═══════════════════════════════════════════════════════════════════════════════

describe('cloneJBatch', () => {
  test('clone of empty batch equals original', () => {
    const batch = createEmptyBatch();
    const clone = cloneJBatch(batch);
    expect(clone).toEqual(batch);
    expect(clone).not.toBe(batch);
  });

  test('clone is independent — mutations do not propagate', () => {
    const batch = createEmptyBatch();
    batch.reserveToReserve.push({ receivingEntity: LEFT, tokenId: 1, amount: 100n });
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [makeDiff(1, 50n, -50n, 0n, 50n)],
      forgiveDebtsInTokenIds: [1],
      insuranceRegs: [{ insured: LEFT, insurer: RIGHT, tokenId: 1, limit: 100n, expiresAt: 9999n }],
      sig: '0xsig',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 1,
    });
    batch.revealSecrets.push({ transformer: '0x1234567890abcdef1234567890abcdef12345678', secret: '0xbeef' });

    const clone = cloneJBatch(batch);

    // Mutate clone, verify original unaffected
    clone.reserveToReserve[0]!.amount = 999n;
    expect(batch.reserveToReserve[0]!.amount).toBe(100n);

    clone.settlements[0]!.diffs[0]!.leftDiff = 999n;
    expect(batch.settlements[0]!.diffs[0]!.leftDiff).toBe(50n);

    clone.settlements[0]!.forgiveDebtsInTokenIds.push(2);
    expect(batch.settlements[0]!.forgiveDebtsInTokenIds).toEqual([1]);

    clone.settlements[0]!.insuranceRegs[0]!.limit = 999n;
    expect(batch.settlements[0]!.insuranceRegs[0]!.limit).toBe(100n);

    clone.revealSecrets.push({ transformer: '0x00', secret: '0x00' });
    expect(batch.revealSecrets).toHaveLength(1);
  });

  test('preserves hub_id', () => {
    const batch = createEmptyBatch();
    batch.hub_id = 42;
    const clone = cloneJBatch(batch);
    expect(clone.hub_id).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// encodeJBatch / decodeJBatch roundtrip
// ═══════════════════════════════════════════════════════════════════════════════

describe('encodeJBatch / decodeJBatch', () => {
  test('roundtrip empty batch', () => {
    const batch = createEmptyBatch();
    const encoded = encodeJBatch(batch);
    expect(typeof encoded).toBe('string');
    expect(encoded.startsWith('0x')).toBe(true);
    const decoded = decodeJBatch(encoded);
    // After roundtrip, arrays should be empty
    expect(decoded.flashloans).toHaveLength(0);
    expect(decoded.reserveToReserve).toHaveLength(0);
    expect(decoded.settlements).toHaveLength(0);
    expect(decoded.revealSecrets).toHaveLength(0);
  });

  test('roundtrip batch with R2R', () => {
    const batch = createEmptyBatch();
    batch.reserveToReserve.push({ receivingEntity: LEFT, tokenId: 1, amount: 12345n });
    const decoded = decodeJBatch(encodeJBatch(batch));
    expect(decoded.reserveToReserve).toHaveLength(1);
    // ethers decodes as BigInt
    expect(BigInt(decoded.reserveToReserve[0]!.amount)).toBe(12345n);
    expect(Number(decoded.reserveToReserve[0]!.tokenId)).toBe(1);
  });

  test('roundtrip batch with settlement diffs', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [makeDiff(1, 100n, -100n, 0n, 100n)],
      forgiveDebtsInTokenIds: [1],
      insuranceRegs: [],
      sig: '0x1234',
      entityProvider: '0x0000000000000000000000000000000000000001',
      hankoData: '0x5678',
      nonce: 5,
    });
    const decoded = decodeJBatch(encodeJBatch(batch));
    expect(decoded.settlements).toHaveLength(1);
    expect(decoded.settlements[0]!.diffs).toHaveLength(1);
    expect(BigInt(decoded.settlements[0]!.diffs[0]!.leftDiff)).toBe(100n);
    expect(BigInt(decoded.settlements[0]!.diffs[0]!.rightDiff)).toBe(-100n);
  });

  test('roundtrip batch with flashloan', () => {
    const batch = createEmptyBatch();
    batch.flashloans.push({ tokenId: 0, amount: 1_000_000n });
    const decoded = decodeJBatch(encodeJBatch(batch));
    expect(decoded.flashloans).toHaveLength(1);
    expect(BigInt(decoded.flashloans[0]!.amount)).toBe(1_000_000n);
  });

  test('roundtrip batch with revealSecrets', () => {
    const batch = createEmptyBatch();
    const transformerAddr = '0x1234567890abcdef1234567890abcdef12345678';
    const secret = '0x' + 'ab'.repeat(32);
    batch.revealSecrets.push({ transformer: transformerAddr, secret });
    const decoded = decodeJBatch(encodeJBatch(batch));
    expect(decoded.revealSecrets).toHaveLength(1);
    expect(decoded.revealSecrets[0]!.transformer.toLowerCase()).toBe(transformerAddr.toLowerCase());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeBatchHankoHash
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeBatchHankoHash', () => {
  test('returns 0x-prefixed 66-char hex string (keccak256)', () => {
    const batch = createEmptyBatch();
    const encoded = encodeJBatch(batch);
    const hash = computeBatchHankoHash(1n, '0x0000000000000000000000000000000000000001', encoded, 0n);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('deterministic — same inputs produce same hash', () => {
    const batch = createEmptyBatch();
    const encoded = encodeJBatch(batch);
    const addr = '0x0000000000000000000000000000000000000001';
    const h1 = computeBatchHankoHash(1n, addr, encoded, 0n);
    const h2 = computeBatchHankoHash(1n, addr, encoded, 0n);
    expect(h1).toBe(h2);
  });

  test('different nonce produces different hash', () => {
    const batch = createEmptyBatch();
    const encoded = encodeJBatch(batch);
    const addr = '0x0000000000000000000000000000000000000001';
    const h1 = computeBatchHankoHash(1n, addr, encoded, 0n);
    const h2 = computeBatchHankoHash(1n, addr, encoded, 1n);
    expect(h1).not.toBe(h2);
  });

  test('different chainId produces different hash', () => {
    const batch = createEmptyBatch();
    const encoded = encodeJBatch(batch);
    const addr = '0x0000000000000000000000000000000000000001';
    const h1 = computeBatchHankoHash(1n, addr, encoded, 0n);
    const h2 = computeBatchHankoHash(31337n, addr, encoded, 0n);
    expect(h1).not.toBe(h2);
  });

  test('different depository address produces different hash', () => {
    const batch = createEmptyBatch();
    const encoded = encodeJBatch(batch);
    const h1 = computeBatchHankoHash(1n, '0x0000000000000000000000000000000000000001', encoded, 0n);
    const h2 = computeBatchHankoHash(1n, '0x0000000000000000000000000000000000000002', encoded, 0n);
    expect(h1).not.toBe(h2);
  });

  test('different batch content produces different hash', () => {
    const addr = '0x0000000000000000000000000000000000000001';
    const batch1 = createEmptyBatch();
    const batch2 = createEmptyBatch();
    batch2.hub_id = 42;
    const h1 = computeBatchHankoHash(1n, addr, encodeJBatch(batch1), 0n);
    const h2 = computeBatchHankoHash(1n, addr, encodeJBatch(batch2), 0n);
    expect(h1).not.toBe(h2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// summarizeBatch
// ═══════════════════════════════════════════════════════════════════════════════

describe('summarizeBatch', () => {
  test('summarizes empty batch', () => {
    const summary = summarizeBatch(createEmptyBatch());
    expect(summary.hub_id).toBe(0);
    expect((summary.flashloans as { count: number }).count).toBe(0);
    expect((summary.settlements as { count: number }).count).toBe(0);
  });

  test('summarizes batch with settlement sample', () => {
    const batch = createEmptyBatch();
    batch.settlements.push({
      leftEntity: LEFT,
      rightEntity: RIGHT,
      diffs: [makeDiff(1, 100n, -100n, 0n, 100n)],
      forgiveDebtsInTokenIds: [],
      insuranceRegs: [],
      sig: '0xabc',
      entityProvider: ZERO_ENTITY,
      hankoData: '0x',
      nonce: 0,
    });
    const summary = summarizeBatch(batch);
    const s = summary.settlements as { count: number; sample: { left: string; diffs: number } };
    expect(s.count).toBe(1);
    expect(s.sample.left).toBe(LEFT);
    expect(s.sample.diffs).toBe(1);
  });
});
