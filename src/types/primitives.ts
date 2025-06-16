// Branded types for type safety
export type EntityId = string & { readonly __brand: 'EntityId' };
export type SignerIdx = number & { readonly __brand: 'SignerIdx' };
export type BlockHeight = number & { readonly __brand: 'BlockHeight' };
export type BlockHash = string & { readonly __brand: 'BlockHash' };
export type TxHash = string & { readonly __brand: 'TxHash' };

// Type constructors
export const toEntityId = (s: string): EntityId => s as EntityId;
export const toSignerIdx = (n: number): SignerIdx => n as SignerIdx;
export const toBlockHeight = (n: number): BlockHeight => n as BlockHeight;
export const toBlockHash = (s: string): BlockHash => s as BlockHash;
export const toTxHash = (s: string): TxHash => s as TxHash;

// Type guards
export const isEntityId = (x: any): x is EntityId => typeof x === 'string';
export const isSignerIdx = (x: any): x is SignerIdx => typeof x === 'number';
export const isBlockHeight = (x: any): x is BlockHeight => typeof x === 'number';
export const isBlockHash = (x: any): x is BlockHash => typeof x === 'string';
export const isTxHash = (x: any): x is TxHash => typeof x === 'string';