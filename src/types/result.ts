export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T, E = Error>(value: T): Result<T, E> => ({ ok: true, value });

export const err = <T = never, E = Error>(error: E): Result<T, E> => ({ ok: false, error });

export const mapResult = <A, B, E = Error>(
  res: Result<A, E>,
  fn: (value: A) => B,
): Result<B, E> => (res.ok ? ok(fn(res.value)) : res);

export const flatMapResult = <A, B, E1 = Error, E2 = Error>(
  res: Result<A, E1>,
  fn: (value: A) => Result<B, E2>,
): Result<B, E1 | E2> => (res.ok ? fn(res.value) : res as Result<B, E1 | E2>); 