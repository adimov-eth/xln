/**
 * Validation Utils Tests
 * Tests validateDelta, validateEntityState, validateAccountMachine,
 * validateEntityInput, validateEntityOutput, validatePaymentRoute,
 * safeMapGet, isDelta, createDefaultDelta — pure functions, no BrowserVM.
 */

import { describe, expect, test } from 'bun:test';

import type { TokenId } from '../ids';
import {
  validateDelta,
  validateAccountDeltas,
  createDefaultDelta,
  isDelta,
  validateEntityInput,
  validateEntityOutput,
  validatePaymentRoute,
  safeMapGet,
  validateAccountFrame,
  validateAccountMachine,
  validateEntityState,
  safeMapGetFinancial,
  safeArrayGet,
  validateEntityId,
  FinancialDataCorruptionError,
  TypeSafetyViolationError,
} from '../validation-utils';

// ═══════════════════════════════════════════════════════════════════════════════
// validateDelta
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateDelta', () => {
  const validDelta = {
    tokenId: 1,
    collateral: 100n,
    ondelta: 0n,
    offdelta: 50n,
    leftCreditLimit: 1000n,
    rightCreditLimit: 1000n,
    leftAllowance: 0n,
    rightAllowance: 0n,
  };

  test('accepts valid delta', () => {
    const result = validateDelta(validDelta, 'test');
    expect(result.tokenId).toBe(1 as TokenId);
    expect(result.collateral).toBe(100n);
    expect(result.offdelta).toBe(50n);
  });

  test('rejects null', () => {
    expect(() => validateDelta(null, 'test')).toThrow('Invalid Delta object');
  });

  test('rejects undefined', () => {
    expect(() => validateDelta(undefined, 'test')).toThrow('Invalid Delta object');
  });

  test('rejects primitive', () => {
    expect(() => validateDelta(42, 'test')).toThrow('Invalid Delta object');
  });

  test('rejects negative tokenId', () => {
    expect(() => validateDelta({ ...validDelta, tokenId: -1 }, 'test')).toThrow('tokenId must be non-negative integer');
  });

  test('rejects float tokenId', () => {
    expect(() => validateDelta({ ...validDelta, tokenId: 1.5 }, 'test')).toThrow(
      'tokenId must be non-negative integer',
    );
  });

  test('rejects missing BigInt field', () => {
    const { collateral: _, ...incomplete } = validDelta;
    expect(() => validateDelta(incomplete, 'test')).toThrow('collateral cannot be null/undefined');
  });

  test('rejects wrong type for BigInt field', () => {
    expect(() => validateDelta({ ...validDelta, offdelta: 'not a bigint' }, 'test')).toThrow('offdelta must be BigInt');
  });

  test('converts valid BigInt string', () => {
    const result = validateDelta({ ...validDelta, offdelta: '42' }, 'test');
    expect(result.offdelta).toBe(42n);
  });

  test('converts BigInt string with n suffix', () => {
    const result = validateDelta({ ...validDelta, offdelta: '42n' }, 'test');
    expect(result.offdelta).toBe(42n);
  });

  test('includes source in error message', () => {
    expect(() => validateDelta(null, 'mySource')).toThrow('mySource');
  });

  test('validates all BigInt fields', () => {
    // Each BigInt field must be present
    const fields = [
      'collateral',
      'ondelta',
      'offdelta',
      'leftCreditLimit',
      'rightCreditLimit',
      'leftAllowance',
      'rightAllowance',
    ];
    for (const field of fields) {
      const bad = { ...validDelta, [field]: null };
      expect(() => validateDelta(bad, 'test')).toThrow(`${field} cannot be null/undefined`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createDefaultDelta
// ═══════════════════════════════════════════════════════════════════════════════

describe('createDefaultDelta', () => {
  test('creates delta with correct tokenId', () => {
    const delta = createDefaultDelta(1 as TokenId);
    expect(delta.tokenId).toBe(1 as TokenId);
  });

  test('all numeric fields are zero', () => {
    const delta = createDefaultDelta(1 as TokenId);
    expect(delta.collateral).toBe(0n);
    expect(delta.ondelta).toBe(0n);
    expect(delta.offdelta).toBe(0n);
    expect(delta.leftCreditLimit).toBe(0n);
    expect(delta.rightCreditLimit).toBe(0n);
    expect(delta.leftAllowance).toBe(0n);
    expect(delta.rightAllowance).toBe(0n);
  });

  test('includes hold fields at zero', () => {
    const delta = createDefaultDelta(1 as TokenId);
    expect(delta.leftHtlcHold).toBe(0n);
    expect(delta.rightHtlcHold).toBe(0n);
    expect(delta.leftSwapHold).toBe(0n);
    expect(delta.rightSwapHold).toBe(0n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isDelta
// ═══════════════════════════════════════════════════════════════════════════════

describe('isDelta', () => {
  test('returns true for valid delta', () => {
    expect(
      isDelta({
        tokenId: 1,
        collateral: 0n,
        ondelta: 0n,
        offdelta: 0n,
        leftCreditLimit: 0n,
        rightCreditLimit: 0n,
        leftAllowance: 0n,
        rightAllowance: 0n,
      }),
    ).toBe(true);
  });

  test('returns false for null', () => {
    expect(isDelta(null)).toBe(false);
  });

  test('returns false for incomplete object', () => {
    expect(isDelta({ tokenId: 1 })).toBe(false);
  });

  test('returns false for wrong types', () => {
    expect(isDelta({ tokenId: 'bad', collateral: 0, ondelta: 0, offdelta: 0 })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateAccountDeltas
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateAccountDeltas', () => {
  const validDelta = {
    tokenId: 1,
    collateral: 0n,
    ondelta: 0n,
    offdelta: 0n,
    leftCreditLimit: 0n,
    rightCreditLimit: 0n,
    leftAllowance: 0n,
    rightAllowance: 0n,
  };

  test('validates Map input', () => {
    const map = new Map([[1, validDelta]]);
    const result = validateAccountDeltas(map, 'test');
    expect(result.size).toBe(1);
    expect(result.get(1)).toBeDefined();
  });

  test('validates plain object input', () => {
    const obj = { 1: validDelta };
    const result = validateAccountDeltas(obj, 'test');
    expect(result.size).toBe(1);
  });

  test('returns empty Map for null input', () => {
    const result = validateAccountDeltas(null, 'test');
    expect(result.size).toBe(0);
  });

  test('returns empty Map for undefined input', () => {
    const result = validateAccountDeltas(undefined, 'test');
    expect(result.size).toBe(0);
  });

  test('skips invalid deltas in Map', () => {
    const map = new Map<number, unknown>([
      [1, validDelta],
      [2, { bad: true }],
    ]);
    const result = validateAccountDeltas(map, 'test');
    expect(result.size).toBe(1); // Only the valid one
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateEntityInput
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateEntityInput', () => {
  test('accepts valid input with entityTxs', () => {
    const input = { entityId: '0x01', signerId: 'a', entityTxs: [] };
    const result = validateEntityInput(input);
    expect(result.entityId).toBe('0x01');
  });

  test('accepts input with hashPrecommits instead of entityTxs', () => {
    const input = { entityId: '0x01', hashPrecommits: new Map() };
    const result = validateEntityInput(input);
    expect(result.entityId).toBe('0x01');
  });

  test('accepts input with proposedFrame instead of entityTxs', () => {
    const input = { entityId: '0x01', proposedFrame: {} };
    const result = validateEntityInput(input);
    expect(result.entityId).toBe('0x01');
  });

  test('rejects null', () => {
    expect(() => validateEntityInput(null)).toThrow('FINANCIAL-SAFETY');
  });

  test('rejects missing entityId', () => {
    expect(() => validateEntityInput({ signerId: 'a', entityTxs: [] })).toThrow('entityId is missing');
  });

  test('rejects non-string signerId', () => {
    expect(() => validateEntityInput({ entityId: '0x01', signerId: 42, entityTxs: [] })).toThrow(
      'signerId must be string',
    );
  });

  test('rejects missing entityTxs, proposedFrame, and hashPrecommits', () => {
    expect(() => validateEntityInput({ entityId: '0x01' })).toThrow(
      'entityTxs, proposedFrame, or hashPrecommits required',
    );
  });

  test('rejects non-array entityTxs', () => {
    expect(() => validateEntityInput({ entityId: '0x01', entityTxs: 'bad' })).toThrow('entityTxs must be array');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateEntityOutput
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateEntityOutput', () => {
  test('accepts valid output', () => {
    const result = validateEntityOutput({ entityId: '0x01', entityTxs: [] });
    expect(result.entityId).toBe('0x01');
  });

  test('rejects null', () => {
    expect(() => validateEntityOutput(null)).toThrow('FINANCIAL-SAFETY');
  });

  test('rejects missing entityId', () => {
    expect(() => validateEntityOutput({ signerId: 'a' })).toThrow('EntityOutput entityId is missing');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validatePaymentRoute
// ═══════════════════════════════════════════════════════════════════════════════

describe('validatePaymentRoute', () => {
  test('accepts valid route', () => {
    const result = validatePaymentRoute(['0x01', '0x02', '0x03']);
    expect(result.length).toBe(3);
  });

  test('rejects null', () => {
    expect(() => validatePaymentRoute(null)).toThrow('must be a valid array');
  });

  test('rejects empty array', () => {
    expect(() => validatePaymentRoute([])).toThrow('cannot be empty');
  });

  test('rejects route with non-string element', () => {
    expect(() => validatePaymentRoute(['0x01', 42])).toThrow('Route[1] is invalid');
  });

  test('rejects route with empty string', () => {
    expect(() => validatePaymentRoute(['0x01', ''])).toThrow('Route[1] is invalid');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// safeMapGet
// ═══════════════════════════════════════════════════════════════════════════════

describe('safeMapGet', () => {
  test('returns value for existing key', () => {
    const map = new Map([['a', 42]]);
    expect(safeMapGet(map, 'a', 'test')).toBe(42);
  });

  test('throws for missing key with context', () => {
    const map = new Map<string, number>();
    expect(() => safeMapGet(map, 'missing', 'myContext')).toThrow('myContext');
  });

  test('throws with FINANCIAL-SAFETY prefix', () => {
    const map = new Map<string, number>();
    expect(() => safeMapGet(map, 'x', 'test')).toThrow('FINANCIAL-SAFETY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateAccountFrame
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateAccountFrame', () => {
  const validFrame = {
    height: 1,
    timestamp: 1700000000000,
    jHeight: 0,
    accountTxs: [],
    prevFrameHash: 'genesis',
    stateHash: '0xabc',
    tokenIds: [1],
    deltas: [0n],
  };

  test('accepts valid frame', () => {
    const result = validateAccountFrame(validFrame);
    expect(result.height).toBe(1);
  });

  test('rejects null', () => {
    expect(() => validateAccountFrame(null)).toThrow();
  });

  test('rejects missing height', () => {
    const { height: _, ...bad } = validFrame;
    expect(() => validateAccountFrame(bad)).toThrow('height');
  });

  test('rejects empty stateHash', () => {
    expect(() => validateAccountFrame({ ...validFrame, stateHash: '' })).toThrow('stateHash');
  });

  test('rejects zero/negative timestamp', () => {
    expect(() => validateAccountFrame({ ...validFrame, timestamp: 0 })).toThrow('timestamp must be positive');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateAccountMachine
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateAccountMachine', () => {
  test('rejects missing leftEntity', () => {
    expect(() => validateAccountMachine({ rightEntity: '0xbb', deltas: new Map() })).toThrow('leftEntity');
  });

  test('rejects missing rightEntity', () => {
    expect(() => validateAccountMachine({ leftEntity: '0xaa', deltas: new Map() })).toThrow('rightEntity');
  });

  test('rejects non-Map deltas', () => {
    expect(() => validateAccountMachine({ leftEntity: '0xaa', rightEntity: '0xbb', deltas: {} })).toThrow(
      'deltas must be a Map',
    );
  });

  test('rejects wrong canonical order', () => {
    // rightEntity < leftEntity violates canonical ordering
    expect(() => validateAccountMachine({ leftEntity: '0xbb', rightEntity: '0xaa', deltas: new Map() })).toThrow(
      'canonical order violated',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateEntityState
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateEntityState', () => {
  test('rejects missing entityId', () => {
    expect(() => validateEntityState({ height: 0, timestamp: 0, reserves: new Map(), accounts: new Map() })).toThrow(
      'entityId',
    );
  });

  test('rejects non-number height', () => {
    expect(() =>
      validateEntityState({
        entityId: '0x01',
        height: 'bad',
        timestamp: 0,
        reserves: new Map(),
        accounts: new Map(),
      }),
    ).toThrow('height');
  });

  test('rejects non-Map reserves', () => {
    expect(() =>
      validateEntityState({ entityId: '0x01', height: 0, timestamp: 0, reserves: {}, accounts: new Map() }),
    ).toThrow('reserves must be a Map');
  });

  test('rejects non-Map accounts', () => {
    expect(() =>
      validateEntityState({ entityId: '0x01', height: 0, timestamp: 0, reserves: new Map(), accounts: {} }),
    ).toThrow('accounts must be a Map');
  });

  test('rejects non-bigint reserve amount', () => {
    const reserves = new Map([['1', 42]]) as unknown as Map<string, bigint>;
    expect(() =>
      validateEntityState({ entityId: '0x01', height: 0, timestamp: 0, reserves, accounts: new Map() }),
    ).toThrow('Reserve amount');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// safeArrayGet
// ═══════════════════════════════════════════════════════════════════════════════

describe('safeArrayGet', () => {
  test('returns element at valid index', () => {
    expect(safeArrayGet([10, 20, 30], 1, 'test')).toBe(20);
  });

  test('throws for negative index', () => {
    expect(() => safeArrayGet([10], -1, 'test')).toThrow('out of bounds');
  });

  test('throws for index beyond length', () => {
    expect(() => safeArrayGet([10], 1, 'test')).toThrow('out of bounds');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateEntityId
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateEntityId', () => {
  test('accepts valid entity id', () => {
    expect(validateEntityId('0x01', 'test')).toBe('0x01');
  });

  test('rejects empty string', () => {
    expect(() => validateEntityId('', 'test')).toThrow();
  });

  test('rejects string containing undefined', () => {
    expect(() => validateEntityId('0xundefined', 'test')).toThrow('routing corruption');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Custom error classes
// ═══════════════════════════════════════════════════════════════════════════════

describe('error classes', () => {
  test('FinancialDataCorruptionError has correct name', () => {
    const err = new FinancialDataCorruptionError('test');
    expect(err.name).toBe('FinancialDataCorruptionError');
    expect(err.message).toContain('FINANCIAL-SAFETY VIOLATION');
  });

  test('FinancialDataCorruptionError includes context', () => {
    const err = new FinancialDataCorruptionError('test', { key: 'value' });
    expect(err.message).toContain('Context:');
  });

  test('TypeSafetyViolationError has correct name', () => {
    const err = new TypeSafetyViolationError('test');
    expect(err.name).toBe('TypeSafetyViolationError');
    expect(err.message).toContain('TYPE-SAFETY VIOLATION');
  });

  test('TypeSafetyViolationError includes received value', () => {
    const err = new TypeSafetyViolationError('test', 42);
    expect(err.message).toContain('Received:');
    expect(err.message).toContain('number');
  });
});
