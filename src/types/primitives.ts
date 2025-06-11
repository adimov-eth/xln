/**
 * Branded primitive types to prevent accidental mixing of numeric domains.
 */
export type Branded<T, B extends string> = T & { readonly __brand?: B };

export type Height = Branded<number, 'Height'>;
export type SignerIdx = Branded<number, 'SignerIdx'>;

export const toHeight = (n: number): Height => n as Height;
export const toSignerIdx = (n: number): SignerIdx => n as SignerIdx; 