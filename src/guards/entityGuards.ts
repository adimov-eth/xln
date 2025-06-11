import type { EntityTx, MintTx, TransferTx, UnknownTx } from '../types/entity.ts';
import type { Result } from '../types/result.ts';
import { err, ok } from '../types/result.ts';

/* ------------------------------ type guards ------------------------------ */

export const isMintTx = (tx: EntityTx): tx is MintTx => tx.op === 'mint';
export const isTransferTx = (tx: EntityTx): tx is TransferTx => tx.op === 'transfer';
export const isUnknownTx = (tx: EntityTx): tx is UnknownTx => tx.op === '__unknown__';

/* ---------------------------- validations ---------------------------- */

export const validateMintTx = (tx: EntityTx): Result<MintTx, string> => {
  if (!isMintTx(tx)) return err('tx is not mint');
  if (typeof tx.data.amount !== 'bigint' || tx.data.amount <= 0n)
    return err('invalid amount');
  return ok(tx);
};

export const validateTransferTx = (tx: EntityTx): Result<TransferTx, string> => {
  if (!isTransferTx(tx)) return err('tx is not transfer');
  const { amount, to } = tx.data;
  if (typeof amount !== 'bigint' || amount <= 0n) return err('invalid amount');
  if (typeof to !== 'string' || to.length === 0) return err('invalid recipient');
  return ok(tx);
};

export const validateEntityTx = (tx: EntityTx): Result<EntityTx, string> => {
  if (isMintTx(tx)) return validateMintTx(tx);
  if (isTransferTx(tx)) return validateTransferTx(tx);
  return err('unsupported op');
}; 