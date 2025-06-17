// ============================================================================
// types/primitives.ts - Core primitive types
// ============================================================================

import type { Brand } from './brand.js';

export type EntityId = Brand<string, 'EntityId'>;
export type SignerIdx = Brand<number, 'SignerIdx'>;
export type BlockHeight = Brand<number, 'BlockHeight'>;
export type BlockHash = Brand<string, 'BlockHash'>;
export type TxHash = Brand<string, 'TxHash'>;

// Ergonomic constructors
export const id = (s: string): EntityId => s as EntityId;
export const signer = (n: number): SignerIdx => n as SignerIdx;
export const height = (n: number): BlockHeight => n as BlockHeight;
export const hash = (s: string): BlockHash => s as BlockHash;
export const txHash = (s: string): TxHash => s as TxHash;