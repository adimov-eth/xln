/**
 * Serialization Utils Tests
 * Tests safeStringify, safeParse, bigIntReplacer, bigIntReviver,
 * bufferCompare, buffersEqual — pure functions, no BrowserVM.
 */

import { describe, expect, test } from 'bun:test';

import {
  safeStringify,
  safeParse,
  bigIntReplacer,
  bigIntReviver,
  bufferCompare,
  buffersEqual,
} from '../serialization-utils';

// ═══════════════════════════════════════════════════════════════════════════════
// safeStringify
// ═══════════════════════════════════════════════════════════════════════════════

describe('safeStringify', () => {
  test('handles BigInt values', () => {
    const result = safeStringify({ amount: 100n });
    expect(result).toContain('BigInt(100)');
  });

  test('handles negative BigInt values', () => {
    const result = safeStringify({ amount: -42n });
    expect(result).toContain('BigInt(-42)');
  });

  test('handles zero BigInt', () => {
    const result = safeStringify({ amount: 0n });
    expect(result).toContain('BigInt(0)');
  });

  test('handles very large BigInt', () => {
    const huge = 2n ** 256n - 1n;
    const result = safeStringify({ amount: huge });
    expect(result).toContain(`BigInt(${huge.toString()})`);
  });

  test('handles Map objects by converting to entries', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const result = safeStringify(map);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  test('handles Set objects by converting to array', () => {
    const set = new Set([1, 2, 3]);
    const result = safeStringify(set);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([1, 2, 3]);
  });

  test('handles nested BigInt in objects', () => {
    const obj = { outer: { inner: { value: 999n } } };
    const result = safeStringify(obj);
    expect(result).toContain('BigInt(999)');
  });

  test('handles functions by serializing name', () => {
    function myFunc() {}
    const result = safeStringify({ fn: myFunc });
    expect(result).toContain('[Function: myFunc]');
  });

  test('handles anonymous functions', () => {
    const result = safeStringify({ fn: () => {} });
    expect(result).toContain('[Function:');
  });

  test('handles null gracefully', () => {
    expect(safeStringify(null)).toBe('null');
  });

  test('handles undefined gracefully', () => {
    // JSON.stringify(undefined) returns undefined per spec
    const result = safeStringify(undefined);
    expect(result).toBeUndefined();
  });

  test('returns error message for circular references', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const result = safeStringify(obj);
    expect(result).toContain('[Error stringifying:');
  });

  test('respects space parameter for formatting', () => {
    const result = safeStringify({ a: 1 }, 2);
    expect(result).toContain('\n');
    expect(result).toContain('  ');
  });

  test('handles Buffer-like objects', () => {
    const bufferLike = { type: 'Buffer', data: [1, 2, 3, 4] };
    const result = safeStringify(bufferLike);
    expect(result).toContain('Buffer(4 bytes)');
  });

  test('handles Map with BigInt values', () => {
    const map = new Map<string, bigint>([
      ['token1', 100n],
      ['token2', 200n],
    ]);
    const result = safeStringify(map);
    expect(result).toContain('BigInt(100)');
    expect(result).toContain('BigInt(200)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// safeParse
// ═══════════════════════════════════════════════════════════════════════════════

describe('safeParse', () => {
  test('revives BigInt strings', () => {
    const json = '{"amount":"BigInt(100)"}';
    const result = safeParse(json);
    expect(result.amount).toBe(100n);
  });

  test('revives negative BigInt', () => {
    const json = '{"amount":"BigInt(-42)"}';
    const result = safeParse(json);
    expect(result.amount).toBe(-42n);
  });

  test('revives zero BigInt', () => {
    const json = '{"amount":"BigInt(0)"}';
    const result = safeParse(json);
    expect(result.amount).toBe(0n);
  });

  test('revives very large BigInt', () => {
    const huge = 2n ** 256n - 1n;
    const json = `{"amount":"BigInt(${huge.toString()})"}`;
    const result = safeParse(json);
    expect(result.amount).toBe(huge);
  });

  test('preserves non-BigInt strings', () => {
    const json = '{"name":"hello","value":"BigInt(42)"}';
    const result = safeParse(json);
    expect(result.name).toBe('hello');
    expect(result.value).toBe(42n);
  });

  test('preserves numbers and booleans', () => {
    const json = '{"num":42,"bool":true}';
    const result = safeParse(json);
    expect(result.num).toBe(42);
    expect(result.bool).toBe(true);
  });

  test('throws on invalid JSON', () => {
    expect(() => safeParse('not valid json')).toThrow('Failed to parse JSON');
  });

  test('handles nested BigInt values', () => {
    const json = '{"outer":{"inner":{"value":"BigInt(999)"}}}';
    const result = safeParse(json);
    expect(result.outer.inner.value).toBe(999n);
  });

  test('handles arrays with BigInt values', () => {
    const json = '["BigInt(1)","BigInt(2)","BigInt(3)"]';
    const result = safeParse(json);
    expect(result).toEqual([1n, 2n, 3n]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Round-trip: safeStringify → safeParse
// ═══════════════════════════════════════════════════════════════════════════════

describe('round-trip serialization', () => {
  test('BigInt values survive round-trip', () => {
    const original = { a: 100n, b: -50n, c: 0n };
    const json = safeStringify(original);
    const restored = safeParse(json);
    expect(restored.a).toBe(100n);
    expect(restored.b).toBe(-50n);
    expect(restored.c).toBe(0n);
  });

  test('mixed types survive round-trip', () => {
    const original = { str: 'hello', num: 42, big: 999n, bool: true, nil: null };
    const json = safeStringify(original);
    const restored = safeParse(json);
    expect(restored.str).toBe('hello');
    expect(restored.num).toBe(42);
    expect(restored.big).toBe(999n);
    expect(restored.bool).toBe(true);
    expect(restored.nil).toBeNull();
  });

  test('Map converts to object (not reversible to Map)', () => {
    const map = new Map([
      ['a', 1n],
      ['b', 2n],
    ]);
    const json = safeStringify(map);
    const restored = safeParse(json);
    // Maps become plain objects after round-trip
    expect(restored.a).toBe(1n);
    expect(restored.b).toBe(2n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// bigIntReplacer / bigIntReviver (direct)
// ═══════════════════════════════════════════════════════════════════════════════

describe('bigIntReplacer', () => {
  test('converts BigInt to string format', () => {
    expect(bigIntReplacer('key', 42n)).toBe('BigInt(42)');
  });

  test('passes through non-BigInt values', () => {
    expect(bigIntReplacer('key', 'hello')).toBe('hello');
    expect(bigIntReplacer('key', 42)).toBe(42);
    expect(bigIntReplacer('key', true)).toBe(true);
    expect(bigIntReplacer('key', null)).toBeNull();
  });
});

describe('bigIntReviver', () => {
  test('converts BigInt string back to BigInt', () => {
    expect(bigIntReviver('key', 'BigInt(42)')).toBe(42n);
  });

  test('passes through non-BigInt strings', () => {
    expect(bigIntReviver('key', 'hello')).toBe('hello');
    expect(bigIntReviver('key', 'BigIntfoo')).toBe('BigIntfoo');
  });

  test('passes through non-string values', () => {
    expect(bigIntReviver('key', 42)).toBe(42);
    expect(bigIntReviver('key', true)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// bufferCompare / buffersEqual
// ═══════════════════════════════════════════════════════════════════════════════

describe('bufferCompare', () => {
  test('equal buffers return 0', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([1, 2, 3]);
    expect(bufferCompare(a, b)).toBe(0);
  });

  test('different buffers return non-zero', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([1, 2, 4]);
    expect(bufferCompare(a, b)).not.toBe(0);
  });

  test('shorter buffer is less than longer with same prefix', () => {
    const a = Buffer.from([1, 2]);
    const b = Buffer.from([1, 2, 3]);
    expect(bufferCompare(a, b)).toBeLessThan(0);
  });

  test('empty buffers are equal', () => {
    const a = Buffer.from([]);
    const b = Buffer.from([]);
    expect(bufferCompare(a, b)).toBe(0);
  });

  test('ordering is consistent', () => {
    const a = Buffer.from([0x00]);
    const b = Buffer.from([0xff]);
    expect(bufferCompare(a, b)).toBeLessThan(0);
    expect(bufferCompare(b, a)).toBeGreaterThan(0);
  });
});

describe('buffersEqual', () => {
  test('identical buffers are equal', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([1, 2, 3]);
    expect(buffersEqual(a, b)).toBe(true);
  });

  test('different buffers are not equal', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([1, 2, 4]);
    expect(buffersEqual(a, b)).toBe(false);
  });

  test('different length buffers are not equal', () => {
    const a = Buffer.from([1, 2]);
    const b = Buffer.from([1, 2, 3]);
    expect(buffersEqual(a, b)).toBe(false);
  });

  test('empty buffers are equal', () => {
    expect(buffersEqual(Buffer.from([]), Buffer.from([]))).toBe(true);
  });
});
