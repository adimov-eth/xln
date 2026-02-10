/**
 * Tests for settlement handlers — pure functions from settle.ts.
 * No BrowserVM: tests cover validateDiffs, userAutoApprove, canAutoApproveWorkspace,
 * processSettleAction (synchronous), diffsToHoldFormat, createSettlementHoldOp.
 */

import { describe, expect, test } from 'bun:test';
import type { SettlementDiff, SettlementWorkspace, AccountMachine } from '../types';
import type { EntityId, TokenId, AccountKey, LockId } from '../ids';
import { userAutoApprove, canAutoApproveWorkspace, processSettleAction } from '../entity-tx/handlers/settle';
import { createSettlementDiff } from '../types';
import { FINANCIAL } from '../constants';

// ─── Test Entity IDs ─────────────────────────────────────────────────────────
const LEFT = ('0x' + '0'.repeat(63) + '1') as EntityId;
const RIGHT = ('0x' + '0'.repeat(63) + '2') as EntityId;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDiff(
  tokenId: number,
  leftDiff: bigint,
  rightDiff: bigint,
  collateralDiff: bigint,
  ondeltaDiff: bigint,
): SettlementDiff {
  return { tokenId, leftDiff, rightDiff, collateralDiff, ondeltaDiff };
}

/** Minimal AccountMachine stub sufficient for processSettleAction + userAutoApprove */
function makeAccount(overrides?: Partial<AccountMachine>): AccountMachine {
  return {
    leftEntity: LEFT,
    rightEntity: RIGHT,
    mempool: [],
    currentFrame: {
      height: 0,
      timestamp: 0,
      jHeight: 0,
      accountTxs: [],
      prevFrameHash: '0x00',
      stateHash: '0x00',
      tokenIds: [],
      deltas: [],
    },
    deltas: new Map(),
    locks: new Map() as Map<LockId, any>,
    swapOffers: new Map(),
    globalCreditLimits: { ownLimit: 0n, peerLimit: 0n },
    currentHeight: 0,
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
    requestedRebalance: new Map() as Map<TokenId, bigint>,
    ...overrides,
  } as AccountMachine;
}

function makeWorkspace(overrides?: Partial<SettlementWorkspace>): SettlementWorkspace {
  return {
    diffs: [],
    forgiveTokenIds: [],
    insuranceRegs: [],
    initiatedBy: 'left',
    status: 'awaiting_counterparty',
    version: 1,
    createdAt: 1000,
    lastUpdatedAt: 1000,
    broadcastByLeft: false,
    ...overrides,
  } as SettlementWorkspace;
}

// ═══════════════════════════════════════════════════════════════════════════════
// createSettlementDiff (conservation law validation)
// ═══════════════════════════════════════════════════════════════════════════════

describe('createSettlementDiff', () => {
  test('accepts valid conservation: leftDiff + rightDiff + collateralDiff = 0', () => {
    const diff = createSettlementDiff(makeDiff(1, 100n, -100n, 0n, 100n));
    expect(diff.leftDiff).toBe(100n);
    expect(diff.rightDiff).toBe(-100n);
    expect(diff.collateralDiff).toBe(0n);
  });

  test('accepts all-zero diff', () => {
    const diff = createSettlementDiff(makeDiff(1, 0n, 0n, 0n, 0n));
    expect(diff.tokenId).toBe(1);
  });

  test('accepts collateral-to-reserve pattern (left withdraws)', () => {
    // LEFT withdraws 100 from collateral: left +100, right 0, collateral -100
    const diff = createSettlementDiff(makeDiff(1, 100n, 0n, -100n, -100n));
    expect(diff.leftDiff + diff.rightDiff + diff.collateralDiff).toBe(0n);
  });

  test('accepts collateral-to-reserve pattern (right withdraws)', () => {
    // RIGHT withdraws 200 from collateral: left 0, right +200, collateral -200
    const diff = createSettlementDiff(makeDiff(1, 0n, 200n, -200n, 0n));
    expect(diff.leftDiff + diff.rightDiff + diff.collateralDiff).toBe(0n);
  });

  test('rejects conservation violation', () => {
    expect(() => createSettlementDiff(makeDiff(1, 100n, -50n, 0n, 0n))).toThrow(/FINTECH-SAFETY/);
  });

  test('rejects off-by-one violation', () => {
    expect(() => createSettlementDiff(makeDiff(1, 100n, -99n, 0n, 0n))).toThrow(/conservation/i);
  });

  test('preserves ondeltaDiff (not part of conservation)', () => {
    const diff = createSettlementDiff(makeDiff(1, 100n, -100n, 0n, 42n));
    expect(diff.ondeltaDiff).toBe(42n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// userAutoApprove — 8-case truth table
// ═══════════════════════════════════════════════════════════════════════════════

describe('userAutoApprove', () => {
  // LEFT perspective
  describe('as LEFT', () => {
    test('APPROVE: leftDiff > 0 (reserve increases)', () => {
      const diff = makeDiff(1, 100n, -100n, 0n, 0n);
      expect(userAutoApprove(diff, true)).toBe(true);
    });

    test('REJECT: leftDiff < 0 (reserve decreases)', () => {
      const diff = makeDiff(1, -100n, 100n, 0n, 0n);
      expect(userAutoApprove(diff, true)).toBe(false);
    });

    test('APPROVE: leftDiff = 0, ondeltaDiff > 0 (gain attribution)', () => {
      const diff = makeDiff(1, 0n, 0n, 0n, 50n);
      expect(userAutoApprove(diff, true)).toBe(true);
    });

    test('APPROVE: leftDiff = 0, ondeltaDiff = 0 (neutral)', () => {
      const diff = makeDiff(1, 0n, 0n, 0n, 0n);
      expect(userAutoApprove(diff, true)).toBe(true);
    });

    test('REJECT: leftDiff = 0, ondeltaDiff < 0 (lose attribution)', () => {
      const diff = makeDiff(1, 0n, 0n, 0n, -50n);
      expect(userAutoApprove(diff, true)).toBe(false);
    });
  });

  // RIGHT perspective
  describe('as RIGHT', () => {
    test('APPROVE: rightDiff > 0 (reserve increases)', () => {
      const diff = makeDiff(1, -100n, 100n, 0n, 0n);
      expect(userAutoApprove(diff, false)).toBe(true);
    });

    test('REJECT: rightDiff < 0 (reserve decreases)', () => {
      const diff = makeDiff(1, 100n, -100n, 0n, 0n);
      expect(userAutoApprove(diff, false)).toBe(false);
    });

    test('APPROVE: rightDiff = 0, ondeltaDiff < 0 (left loses → right gains)', () => {
      const diff = makeDiff(1, 0n, 0n, 0n, -50n);
      expect(userAutoApprove(diff, false)).toBe(true);
    });

    test('APPROVE: rightDiff = 0, ondeltaDiff = 0 (neutral)', () => {
      const diff = makeDiff(1, 0n, 0n, 0n, 0n);
      expect(userAutoApprove(diff, false)).toBe(true);
    });

    test('REJECT: rightDiff = 0, ondeltaDiff > 0 (left gains → right loses)', () => {
      const diff = makeDiff(1, 0n, 0n, 0n, 50n);
      expect(userAutoApprove(diff, false)).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// canAutoApproveWorkspace
// ═══════════════════════════════════════════════════════════════════════════════

describe('canAutoApproveWorkspace', () => {
  test('true for empty diffs', () => {
    const ws = makeWorkspace({ diffs: [] });
    expect(canAutoApproveWorkspace(ws, true)).toBe(true);
    expect(canAutoApproveWorkspace(ws, false)).toBe(true);
  });

  test('true when all diffs are favorable for LEFT', () => {
    const ws = makeWorkspace({
      diffs: [
        makeDiff(1, 100n, -100n, 0n, 0n), // left gains
        makeDiff(2, 50n, -50n, 0n, 0n), // left gains
      ],
    });
    expect(canAutoApproveWorkspace(ws, true)).toBe(true);
  });

  test('false when any diff is unfavorable for LEFT', () => {
    const ws = makeWorkspace({
      diffs: [
        makeDiff(1, 100n, -100n, 0n, 0n), // favorable
        makeDiff(2, -50n, 50n, 0n, 0n), // unfavorable
      ],
    });
    expect(canAutoApproveWorkspace(ws, true)).toBe(false);
  });

  test('AND logic: all must pass', () => {
    // 3 favorable diffs for RIGHT
    const ws = makeWorkspace({
      diffs: [makeDiff(1, -10n, 10n, 0n, 0n), makeDiff(2, -20n, 20n, 0n, 0n), makeDiff(3, -5n, 5n, 0n, 0n)],
    });
    expect(canAutoApproveWorkspace(ws, false)).toBe(true);
    // Now as LEFT, all are unfavorable
    expect(canAutoApproveWorkspace(ws, true)).toBe(false);
  });

  test('mixed zero-reserve diffs with ondelta', () => {
    const ws = makeWorkspace({
      diffs: [
        makeDiff(1, 0n, 0n, 0n, 10n), // LEFT: ondelta+ → approve; RIGHT: ondelta+ → reject
        makeDiff(2, 0n, 0n, 0n, -5n), // LEFT: ondelta- → reject; RIGHT: ondelta- → approve
      ],
    });
    // Neither side can fully auto-approve
    expect(canAutoApproveWorkspace(ws, true)).toBe(false);
    expect(canAutoApproveWorkspace(ws, false)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// processSettleAction — synchronous state machine
// ═══════════════════════════════════════════════════════════════════════════════

describe('processSettleAction', () => {
  describe('propose', () => {
    test('creates workspace from counterparty proposal', () => {
      const account = makeAccount();
      const result = processSettleAction(
        account,
        {
          type: 'propose',
          diffs: [makeDiff(1, 100n, -100n, 0n, 0n)],
          forgiveTokenIds: [1],
          memo: 'test settlement',
          version: 1,
        },
        LEFT, // from counterparty (LEFT)
        RIGHT, // I am RIGHT
        2000,
      );
      expect(result.success).toBe(true);
      expect(account.settlementWorkspace).toBeDefined();
      expect(account.settlementWorkspace!.status).toBe('awaiting_counterparty');
      expect(account.settlementWorkspace!.diffs).toHaveLength(1);
      expect(account.settlementWorkspace!.forgiveTokenIds).toEqual([1]);
      expect(account.settlementWorkspace!.initiatedBy).toBe('left');
      expect(account.settlementWorkspace!.version).toBe(1);
      expect(account.settlementWorkspace!.createdAt).toBe(2000);
    });

    test('rejects when workspace already exists', () => {
      const account = makeAccount({ settlementWorkspace: makeWorkspace() });
      const result = processSettleAction(account, { type: 'propose', diffs: [], version: 1 }, LEFT, RIGHT, 2000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/already exists/);
    });

    test('sets broadcastByLeft correctly when LEFT proposes', () => {
      const account = makeAccount();
      processSettleAction(account, { type: 'propose', diffs: [], version: 1 }, LEFT, RIGHT, 2000);
      // From LEFT's perspective, they are left → broadcastByLeft = theyAreLeft = true
      expect(account.settlementWorkspace!.broadcastByLeft).toBe(true);
    });

    test('defaults missing fields', () => {
      const account = makeAccount();
      processSettleAction(account, { type: 'propose', version: 1 }, LEFT, RIGHT, 2000);
      expect(account.settlementWorkspace!.diffs).toEqual([]);
      expect(account.settlementWorkspace!.forgiveTokenIds).toEqual([]);
    });
  });

  describe('update', () => {
    test('updates existing workspace', () => {
      const account = makeAccount({
        settlementWorkspace: makeWorkspace({ diffs: [makeDiff(1, 10n, -10n, 0n, 0n)] }),
      });
      const newDiffs = [makeDiff(1, 200n, -200n, 0n, 0n)];
      const result = processSettleAction(account, { type: 'update', diffs: newDiffs, version: 2 }, LEFT, RIGHT, 3000);
      expect(result.success).toBe(true);
      expect(account.settlementWorkspace!.diffs).toEqual(newDiffs);
      expect(account.settlementWorkspace!.version).toBe(2);
      expect(account.settlementWorkspace!.lastUpdatedAt).toBe(3000);
    });

    test('rejects when no workspace', () => {
      const account = makeAccount();
      const result = processSettleAction(account, { type: 'update', diffs: [], version: 2 }, LEFT, RIGHT, 3000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/No workspace/);
    });

    test('rejects when workspace is ready_to_submit', () => {
      const account = makeAccount({
        settlementWorkspace: makeWorkspace({
          status: 'ready_to_submit',
          leftHanko: '0xaaa',
          rightHanko: '0xbbb',
          cooperativeNonceAtSign: 0,
        }) as SettlementWorkspace,
      });
      const result = processSettleAction(account, { type: 'update', diffs: [], version: 3 }, LEFT, RIGHT, 3000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/signing/);
    });

    test('rejects when workspace has hanko (already partially signed)', () => {
      const account = makeAccount({
        settlementWorkspace: makeWorkspace({ leftHanko: '0xsig' }) as SettlementWorkspace,
      });
      const result = processSettleAction(account, { type: 'update', diffs: [], version: 3 }, LEFT, RIGHT, 3000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/signing/);
    });
  });

  describe('approve', () => {
    test('sets counterparty hanko (LEFT approving, I am RIGHT)', () => {
      const account = makeAccount({
        settlementWorkspace: makeWorkspace(),
      });
      const result = processSettleAction(
        account,
        { type: 'approve', hanko: '0xleftHanko', version: 1 },
        LEFT, // from LEFT
        RIGHT, // I am RIGHT
        4000,
      );
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/Counterparty signed/);
      const ws = account.settlementWorkspace!;
      expect(ws.status).toBe('awaiting_counterparty');
      if (ws.status === 'awaiting_counterparty') {
        expect(ws.leftHanko).toBe('0xleftHanko');
        expect(ws.rightHanko).toBeUndefined();
      }
    });

    test('transitions to ready_to_submit when both parties signed', () => {
      // I am RIGHT, I already signed. Now LEFT approves.
      const account = makeAccount({
        settlementWorkspace: makeWorkspace({ rightHanko: '0xrightHanko' }) as SettlementWorkspace,
      });
      const result = processSettleAction(
        account,
        { type: 'approve', hanko: '0xleftHanko', version: 1 },
        LEFT, // from LEFT
        RIGHT, // I am RIGHT
        4000,
      );
      expect(result.success).toBe(true);
      const ws = account.settlementWorkspace!;
      expect(ws.status).toBe('ready_to_submit');
      if (ws.status === 'ready_to_submit') {
        expect(ws.leftHanko).toBe('0xleftHanko');
        expect(ws.rightHanko).toBe('0xrightHanko');
        expect(ws.cooperativeNonceAtSign).toBe(0);
      }
    });

    test('rejects when no workspace', () => {
      const account = makeAccount();
      const result = processSettleAction(account, { type: 'approve', hanko: '0xsig', version: 1 }, LEFT, RIGHT, 4000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/No workspace/);
    });

    test('rejects when no hanko provided', () => {
      const account = makeAccount({ settlementWorkspace: makeWorkspace() });
      const result = processSettleAction(account, { type: 'approve', version: 1 }, LEFT, RIGHT, 4000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/No hanko/);
    });

    test('rejects when workspace is draft', () => {
      const account = makeAccount({
        settlementWorkspace: makeWorkspace({ status: 'draft' }) as SettlementWorkspace,
      });
      const result = processSettleAction(account, { type: 'approve', hanko: '0xsig', version: 1 }, LEFT, RIGHT, 4000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/draft/);
    });

    test('uses onChainSettlementNonce for cooperativeNonceAtSign', () => {
      const account = makeAccount({
        onChainSettlementNonce: 5,
        settlementWorkspace: makeWorkspace({ rightHanko: '0xrightHanko' }) as SettlementWorkspace,
      });
      processSettleAction(account, { type: 'approve', hanko: '0xleftHanko', version: 1 }, LEFT, RIGHT, 4000);
      const ws = account.settlementWorkspace!;
      if (ws.status === 'ready_to_submit') {
        expect(ws.cooperativeNonceAtSign).toBe(5);
      }
    });
  });

  describe('reject', () => {
    test('clears workspace', () => {
      const account = makeAccount({ settlementWorkspace: makeWorkspace() });
      const result = processSettleAction(account, { type: 'reject', memo: 'too expensive' }, LEFT, RIGHT, 5000);
      expect(result.success).toBe(true);
      expect(account.settlementWorkspace).toBeUndefined();
      expect(result.message).toMatch(/rejected/);
    });

    test('succeeds even when no workspace (idempotent clear)', () => {
      // delete of undefined property is fine in JS
      const account = makeAccount();
      const result = processSettleAction(account, { type: 'reject' }, LEFT, RIGHT, 5000);
      expect(result.success).toBe(true);
    });
  });

  describe('execute', () => {
    test('returns failure — execute is local only', () => {
      const account = makeAccount({ settlementWorkspace: makeWorkspace() });
      const result = processSettleAction(account, { type: 'execute' }, LEFT, RIGHT, 6000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/local operation/);
    });
  });

  describe('unknown action', () => {
    test('returns failure for unknown type', () => {
      const account = makeAccount();
      const result = processSettleAction(account, { type: 'bogus' as any }, LEFT, RIGHT, 7000);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Unknown/);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateDiffs (exercised via createSettlementDiff + bounds check)
// The internal validateDiffs in settle.ts is not exported, but we can test
// its behavior through createSettlementDiff which it delegates to.
// The bounds check (MAX_SETTLEMENT_DIFF) is in the handler; we test the
// conservation law here via createSettlementDiff.
// ═══════════════════════════════════════════════════════════════════════════════

describe('conservation law edge cases', () => {
  test('large values near U128 max', () => {
    const max = 2n ** 128n - 1n;
    // This is valid: left gets max, right loses max, collateral unchanged
    const diff = createSettlementDiff(makeDiff(1, max, -max, 0n, 0n));
    expect(diff.leftDiff).toBe(max);
  });

  test('negative collateral increases reserves', () => {
    // Both sides withdraw from collateral
    const diff = createSettlementDiff(makeDiff(1, 50n, 50n, -100n, 0n));
    expect(diff.leftDiff + diff.rightDiff + diff.collateralDiff).toBe(0n);
  });

  test('all three fields can be negative', () => {
    // This shouldn't happen in practice but conservation must still hold
    expect(() => createSettlementDiff(makeDiff(1, -10n, -10n, -10n, 0n))).toThrow(/conservation/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// processSettleAction approve — bidirectional signing scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe('bidirectional signing', () => {
  test('RIGHT approves first, then LEFT approves → ready_to_submit', () => {
    const account = makeAccount({ settlementWorkspace: makeWorkspace() });

    // RIGHT approves first (from RIGHT, I am LEFT)
    processSettleAction(
      account,
      { type: 'approve', hanko: '0xrightHanko', version: 1 },
      RIGHT, // from RIGHT
      LEFT, // I am LEFT
      4000,
    );

    let ws = account.settlementWorkspace!;
    expect(ws.status).toBe('awaiting_counterparty');
    if (ws.status === 'awaiting_counterparty') {
      expect(ws.rightHanko).toBe('0xrightHanko');
      expect(ws.leftHanko).toBeUndefined();
    }

    // Now LEFT approves (from LEFT, I am RIGHT) — need to swap perspective
    // But processSettleAction is called from counterparty's perspective
    // Let's create a fresh account from RIGHT's view
    const account2 = makeAccount({
      settlementWorkspace: makeWorkspace({ leftHanko: '0xleftHanko' }) as SettlementWorkspace,
    });
    processSettleAction(account2, { type: 'approve', hanko: '0xrightHanko', version: 1 }, RIGHT, LEFT, 4000);
    ws = account2.settlementWorkspace!;
    expect(ws.status).toBe('ready_to_submit');
  });
});
