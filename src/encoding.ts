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
    // RLP only supports non-negative integers
    // Store negative numbers as [sign, absolute value]
    if (obj < 0) {
      return ['__neg__', Math.abs(obj)];
    }
    return obj;
  }
  if (typeof obj === 'string') return Buffer.from(obj);
  if (Array.isArray(obj)) return obj.map(serialize);
  if (obj instanceof Map) {
    return ['__map__', Array.from(obj.entries()).map(([k, v]) => [serialize(k), serialize(v)])];
  }
  if (typeof obj === 'object' && obj !== null) {
    // Skip undefined values to avoid encoding issues
    const entries = Object.entries(obj).filter(([_, v]) => v !== undefined);
    return entries.map(([k, v]) => [k, serialize(v)]);
  }
  if (obj === undefined) return '__undefined__';
  if (obj === null) return '__null__';
  return obj;
}

function deserialize(data: any): any {
  if (Buffer.isBuffer(data)) {
    // Check for special markers first
    const str = data.toString();
    if (str === '__undefined__') return undefined;
    if (str === '__null__') return null;
    
    // Simple heuristic: if it's 32 bytes, keep as buffer (likely a hash)
    if (data.length === 32) return data;
    // Otherwise return as string
    return str;
  }
  if (Array.isArray(data)) {
    // Check for negative number
    if (data.length === 2 && data[0] === '__neg__') {
      return -data[1];
    }
    // Check if it's a serialized Map
    if (data.length === 2 && data[0] === '__map__') {
      const map = new Map();
      for (const [k, v] of data[1]) {
        map.set(deserialize(k), deserialize(v));
      }
      return map;
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