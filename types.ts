// --- Branded Types ---
export type EntityId = string & { readonly _brand: 'EntityId' };
export type SignerIdx = number & { readonly _brand: 'SignerIdx' };
export type BlockHeight = number & { readonly _brand: 'BlockHeight' };
export type BlockHash = string & { readonly _brand: 'BlockHash' };
export type TxHash = string & { readonly _brand: 'TxHash' };

// Type guards and constructors
export const toEntityId = (s: string): EntityId => s as EntityId;
export const toSignerIdx = (n: number): SignerIdx => n as SignerIdx;
export const toBlockHeight = (n: number): BlockHeight => n as BlockHeight;
export const toBlockHash = (s: string): BlockHash => s as BlockHash;
export const toTxHash = (s: string): TxHash => s as TxHash;

// Type guards
export const isEntityId = (value: unknown): value is EntityId => 
  typeof value === 'string' && value.length > 0;

export const isSignerIdx = (value: unknown): value is SignerIdx => 
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const isBlockHeight = (value: unknown): value is BlockHeight => 
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const isBlockHash = (value: unknown): value is BlockHash => 
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export const isTxHash = (value: unknown): value is TxHash => 
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

// Result type for error handling
export type Result<T, E = Error> = 
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T, E = Error>(value: T): Result<T, E> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Common error types
export type ValidationError = {
  readonly type: 'validation';
  readonly field: string;
  readonly message: string;
};

export type NotFoundError = {
  readonly type: 'not_found';
  readonly resource: string;
  readonly id: string;
};

export type UnauthorizedError = {
  readonly type: 'unauthorized';
  readonly signer: SignerIdx;
  readonly entity: EntityId;
};

export type ProcessingError = 
  | ValidationError 
  | NotFoundError 
  | UnauthorizedError;