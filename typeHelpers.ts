import {
  EntityId, SignerIdx, BlockHeight, BlockHash,
  toEntityId, toSignerIdx, toBlockHeight, toBlockHash
} from './types';

// Parse helpers for common string-to-branded-type conversions
export const parseSignerIdx = (value: string | number): SignerIdx => {
  const num = typeof value === 'string' ? parseInt(value, 10) : value;
  if (isNaN(num) || num < 0) {
    throw new Error(`Invalid SignerIdx: ${value}`);
  }
  return toSignerIdx(num);
};

export const parseBlockHeight = (value: string | number): BlockHeight => {
  const num = typeof value === 'string' ? parseInt(value, 10) : value;
  if (isNaN(num) || num < 0) {
    throw new Error(`Invalid BlockHeight: ${value}`);
  }
  return toBlockHeight(num);
};

export const parseEntityId = (value: string): EntityId => {
  if (!value || value.trim() === '') {
    throw new Error('EntityId cannot be empty');
  }
  return toEntityId(value);
};

export const parseBlockHash = (value: string): BlockHash => {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`Invalid BlockHash: ${value}`);
  }
  return toBlockHash(value);
};

// Safe increment helpers
export const incrementBlockHeight = (height: BlockHeight): BlockHeight => {
  return toBlockHeight(Number(height) + 1);
};

// Array mapping helpers
export const mapToSignerIdx = (values: (string | number)[]): SignerIdx[] => {
  return values.map(parseSignerIdx);
};

export const mapToEntityId = (values: string[]): EntityId[] => {
  return values.map(parseEntityId);
};

// Type conversion helpers for common patterns
export const signerIdxFromAny = (value: any): SignerIdx => {
  if (typeof value === 'number') {
    return parseSignerIdx(value);
  }
  if (typeof value === 'string') {
    return parseSignerIdx(value);
  }
  throw new Error(`Cannot convert ${typeof value} to SignerIdx`);
};

export const blockHeightFromAny = (value: any): BlockHeight => {
  if (typeof value === 'number') {
    return parseBlockHeight(value);
  }
  if (typeof value === 'string') {
    return parseBlockHeight(value);
  }
  throw new Error(`Cannot convert ${typeof value} to BlockHeight`);
};

// Common pattern: next height
export const nextBlockHeight = (server: { height: BlockHeight }): BlockHeight => {
  return incrementBlockHeight(server.height);
};