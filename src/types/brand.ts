export type Brand<TName extends string> = { readonly __brand: TName };
export const make = <TRaw, TName extends string>(raw: TRaw) =>
  raw as unknown as TRaw & Brand<TName>;