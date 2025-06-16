import type { Brand } from './brand';
import { make } from './brand';

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