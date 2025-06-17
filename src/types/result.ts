// ============================================================================
// types/result.ts - Result type for error handling
// ============================================================================

export type Result<T, E = string> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T, E = string>(value: T): Result<T, E> => ({ ok: true, value });
export const Err = <E = string>(error: E): Result<never, E> => ({ ok: false, error });

// Result utilities
export const mapResult = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> => 
  result.ok ? Ok<U, E>(fn(result.value)) : result;

export const flatMapResult = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> => 
  result.ok ? fn(result.value) : result;

export const collectResults = <T, E>(
  results: Result<T, E>[]
): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return Ok<T[], E>(values);
};


