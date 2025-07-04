import { concat } from 'uint8arrays';

const toUint = (n: number | bigint) => {
  if (n === 0n || n === 0) return new Uint8Array([0x80]);
  const hex = BigInt(n).toString(16);
  const bytes = hex.length % 2 ? '0' + hex : hex;
  return new Uint8Array(Buffer.from(bytes, 'hex'));
};

const encodeStr = (buf: Uint8Array) =>
  buf.length === 1 && buf[0] < 0x80
    ? buf
    : concat([new Uint8Array([0x80 + buf.length]), buf]);

const encodeLen = (len: number, offset: number) => {
  if (len < 56) return new Uint8Array([offset + len]);
  const b = toUint(len);
  return concat([new Uint8Array([offset + 55 + b.length]), b]);
};

export const encodeRlp = (v: unknown): Uint8Array => {
  if (v === null || v === undefined) return new Uint8Array([0x80]);
  if (typeof v === 'number' || typeof v === 'bigint') return encodeStr(toUint(v));
  if (typeof v === 'string')
    return encodeStr(new Uint8Array(Buffer.from(v.slice(2), 'hex')));
  if (v instanceof Uint8Array) return encodeStr(v);
  if (Array.isArray(v)) {
    const encoded = v.map(encodeRlp);
    const joined = concat(encoded);
    return concat([encodeLen(joined.length, 0xc0), joined]);
  }
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return encodeRlp(entries.map(([, val]) => val));
};
