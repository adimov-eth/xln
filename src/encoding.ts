// encoding.ts
import { createHash } from 'crypto';
import { decode as rlpDecode, encode as rlpEncode } from 'rlp';

export function encode(obj: any): Buffer {
  return Buffer.from(rlpEncode(serialize(obj)));
}

export function decode(buf: Buffer): any {
  return deserialize(rlpDecode(buf));
}

export function hash(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function serialize(obj: any): any {
  if (Buffer.isBuffer(obj)) return obj;
  if (typeof obj === 'number') {
    // Ensure all numbers are non-negative for RLP
    if (obj < 0) {
      return ['__neg__', Math.abs(obj)];
    }
    if (!Number.isInteger(obj) || obj > Number.MAX_SAFE_INTEGER) {
      return obj.toString();
    }
    return obj;
  }
  if (typeof obj === 'string') {
    // Don't convert strings to buffers - let RLP handle them as strings
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(serialize);
  if (obj instanceof Map) {
    return ['__map__', Array.from(obj.entries()).map(([k, v]) => [serialize(k), serialize(v)])];
  }
  if (obj instanceof Date) {
    return ['__date__', obj.toISOString()];
  }
  if (typeof obj === 'object' && obj !== null) {
    // Skip undefined values and functions
    const entries = Object.entries(obj).filter(([_, v]) => v !== undefined && typeof v !== 'function');
    return entries.map(([k, v]) => [k, serialize(v)]);
  }
  if (obj === undefined) return null; // Convert undefined to null for RLP
  if (obj === null) return null;
  return obj;
}

function deserialize(data: any): any {
  if (Buffer.isBuffer(data)) {
    // Simple heuristic: if it's 32 bytes, keep as buffer (likely a hash)
    if (data.length === 32) return data;
    // Otherwise decode as string
    return data.toString();
  }
  if (Array.isArray(data)) {
    // Check for special encodings
    if (data.length === 2 && data[0] === '__neg__') {
      return -data[1];
    }
    if (data.length === 2 && data[0] === '__map__') {
      const map = new Map();
      for (const [k, v] of data[1]) {
        map.set(deserialize(k), deserialize(v));
      }
      return map;
    }
    if (data.length === 2 && data[0] === '__date__') {
      return new Date(data[1]);
    }
    // Check if it looks like an object (array of key-value pairs)
    if (data.length > 0 && Array.isArray(data[0]) && data[0].length === 2 && typeof data[0][0] === 'string') {
      const obj: any = {};
      for (const [key, value] of data) {
        obj[key] = deserialize(value);
      }
      return obj;
    }
    return data.map(deserialize);
  }
  return data;
}