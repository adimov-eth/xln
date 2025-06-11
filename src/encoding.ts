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
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'string') return Buffer.from(obj);
  if (Array.isArray(obj)) return obj.map(serialize);
  if (obj instanceof Map) {
    return Array.from(obj.entries()).map(([k, v]) => [serialize(k), serialize(v)]);
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj).map(([k, v]) => [k, serialize(v)]);
  }
  return obj;
}

function deserialize(data: any): any {
  if (Buffer.isBuffer(data)) {
    // Simple heuristic: if it's 32 bytes, keep as buffer (likely a hash)
    if (data.length === 32) return data;
    // Otherwise try to decode as string
    return data.toString();
  }
  if (Array.isArray(data)) {
    // Check if it looks like a Map (array of pairs)
    if (data.length > 0 && Array.isArray(data[0]) && data[0].length === 2) {
      const map = new Map();
      for (const [k, v] of data) {
        map.set(deserialize(k), deserialize(v));
      }
      return map;
    }
    return data.map(deserialize);
  }
  return data;
}