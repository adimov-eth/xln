import { Buffer } from 'buffer';
import { createHash } from 'crypto';

/**
 * Compute SHA-256 hash of the given input.
 * Accepts either UTF-8 string or raw bytes. Returns lowercase hex string.
 */
export const sha256 = (data: string | Uint8Array): string => {
  const buf: Uint8Array = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return createHash('sha256').update(buf).digest('hex');
};

/**
 * BigInt-aware JSON replacer. Serialises bigint values as `"__bigint__<value>"` strings.
 */
export const jsonReplacer = (_: string, value: unknown): unknown =>
  typeof value === 'bigint' ? `__bigint__${value.toString()}` : value;

/**
 * BigInt-aware JSON reviver. Restores bigint values previously encoded by {@link jsonReplacer}.
 */
export const jsonReviver = (_: string, value: unknown): unknown =>
  typeof value === 'string' && value.startsWith('__bigint__')
    ? BigInt(value.slice(10))
    : value;

export class MerkleTree {
  static computeRoot(leaves: string[]): string {
    if (leaves.length === 0) return sha256('empty');
    if (leaves.length === 1) return leaves[0]!;
    
    let currentLevel = [...leaves];
    
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i]!; // guaranteed by loop bounds
        const right = currentLevel[i + 1]; // may be undefined for odd count
        const rightHash = right ?? left; // duplicate if odd
        const combined = sha256(`${left}:${rightHash}`);
        nextLevel.push(combined);
      }
      
      currentLevel = nextLevel;
    }
    
    const root = currentLevel[0];
    return root || sha256('fallback');
  }
}

export class StreamingHash {
  private hash = createHash('sha256');
  
  update(data: string | Uint8Array): this {
    this.hash.update(data);
    return this;
  }
  
  digest(): string {
    return this.hash.digest('hex');
  }
  
  static create(): StreamingHash {
    return new StreamingHash();
  }
}

export const bigJsonEncoding = {
  encode: (val: unknown) => Buffer.from(JSON.stringify(val, jsonReplacer), 'utf8'),
  decode: (buf: Buffer) => JSON.parse(buf.toString('utf8'), jsonReviver),
  buffer: true as const,
  type: 'bigjson' as const,
}; 