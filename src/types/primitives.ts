// Brand type utilities
export type Brand<TName extends string> = { readonly __brand: TName };
export const make = <TRaw, TName extends string>(raw: TRaw) =>
  raw as unknown as TRaw & Brand<TName>;

export type EntityId    = string & Brand<'EntityId'>;
export type BlockHash   = string & Brand<'BlockHash'>;
export type TxHash      = string & Brand<'TxHash'>;
export type SignerIdx   = number & Brand<'SignerIdx'>;
export type BlockHeight = number & Brand<'BlockHeight'>;

export const toEntityId    = (s: string)  => make<typeof s, 'EntityId'>(s);
export const toBlockHash   = (s: string)  => make<typeof s, 'BlockHash'>(s);
export const toTxHash      = (s: string)  => make<typeof s, 'TxHash'>(s);
export const toSignerIdx   = (n: number)  => make<typeof n, 'SignerIdx'>(n);
export const toBlockHeight = (n: number)  => make<typeof n, 'BlockHeight'>(n);

// Short constructor helpers for ergonomic usage
export const entity = toEntityId;
export const hash   = toBlockHash;
export const txHash = toTxHash;
export const signer = toSignerIdx;
export const height = toBlockHeight;