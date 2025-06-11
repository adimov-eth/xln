import { toSignerIdx } from './types/primitives.ts';
import type { Result } from './types/result.ts';
import { err, ok } from './types/result.ts';

export const MAX_BALANCE = 2n ** 256n - 1n;

export const validateAmount = (amount: unknown): Result<bigint, string> => {
  if (typeof amount !== 'bigint') return err('amount must be bigint');
  if (amount <= 0n) return err('amount must be > 0');
  if (amount > MAX_BALANCE) return err('amount exceeds max');
  return ok(amount);
};

export const validateEntityId = (id: unknown): Result<string, string> => {
  return typeof id === 'string' && id.length > 0 ? ok(id) : err('invalid entity id');
};

export const validateSignerIdx = (idx: unknown): Result<import('./types/primitives.ts').SignerIdx, string> => {
  if (typeof idx !== 'number' || idx < 0 || !Number.isInteger(idx)) return err('invalid signer index');
  return ok(toSignerIdx(idx));
}; 