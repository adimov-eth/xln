import type { EntityId, SignerIdx } from "./primitives";

// Result type for functional error handling
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const Ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const Err = <E>(error: E): Err<E> => ({ ok: false, error });

// Error types
export type ValidationError = {
  type: 'validation';
  field: string;
  message: string;
};

export type NotFoundError = {
  type: 'not_found';
  resource: string;
  id: string;
};

export type UnauthorizedError = {
  type: 'unauthorized';
  signer: SignerIdx;
  entity: EntityId;
  message?: string;
};

export type ProcessingError = ValidationError | NotFoundError | UnauthorizedError;

// Result helpers
export const mapResult = <T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> => {
  return result.ok ? Ok(fn(result.value)) : result;
};

export const flatMapResult = <T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> => {
  return result.ok ? fn(result.value) : result;
};