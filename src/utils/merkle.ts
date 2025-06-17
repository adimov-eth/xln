import { createHash } from 'crypto';

export type MerkleProof = {
  readonly path: string[];
  readonly index: number;
};

export type MerkleNode = {
  readonly hash: string;
  readonly key?: Buffer;
  readonly value?: Buffer;
  readonly left?: MerkleNode;
  readonly right?: MerkleNode;
};

const EMPTY_HASH = createHash('sha256').digest('hex');

const sha256 = (data: Buffer): Buffer => {
  return createHash('sha256').update(data).digest();
};

export class MerkleTree {
  private root: MerkleNode | null = null;
  private nodes: Map<string, Buffer> = new Map();
  private levels: MerkleNode[][] = [];
  private leafMap: Map<string, number> = new Map();

  constructor(
    private readonly hashFn: (data: Buffer) => Buffer = sha256,
  ) {}

  insert(key: Buffer, value: Buffer): void {
    const keyHash = this.hashFn(key);
    this.nodes.set(keyHash.toString('hex'), value);
    this.rebuild();
  }

  batchInsert(items: { key: Buffer; value: Buffer }[]): void {
    for (const { key, value } of items) {
      const keyHash = this.hashFn(key);
      this.nodes.set(keyHash.toString('hex'), value);
    }
    this.rebuild();
  }

  get(key: Buffer): Buffer | null {
    const keyHash = this.hashFn(key);
    return this.nodes.get(keyHash.toString('hex')) ?? null;
  }

  getProof(key: Buffer): MerkleProof | null {
    const keyHash = this.hashFn(key).toString('hex');
    const leafIndex = this.leafMap.get(keyHash);

    if (leafIndex === undefined) {
      return null;
    }

    const path: string[] = [];
    let currentIndex = leafIndex;

    for (let i = this.levels.length - 1; i > 0; i--) {
      const level = this.levels[i];
      if (!level) continue;
      
      const isRight = currentIndex % 2;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < level.length && level[siblingIndex]) {
        path.push(level[siblingIndex]!.hash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { path, index: leafIndex };
  }

  static verifyProof(
    key: Buffer,
    value: Buffer,
    proof: MerkleProof,
    rootHash: string,
    hashFn: (data: Buffer) => Buffer = sha256,
  ): boolean {
    const keyHash = hashFn(key);
    const leafData = Buffer.concat([keyHash, value]);
    let computedHash = hashFn(leafData).toString('hex');

    let currentIndex = proof.index;
    for (const siblingHash of proof.path) {
      const isRight = currentIndex % 2;
      const pair = isRight
        ? [siblingHash, computedHash]
        : [computedHash, siblingHash];
      computedHash = hashFn(
        Buffer.concat([Buffer.from(pair[0]!, 'hex'), Buffer.from(pair[1]!, 'hex')]),
      ).toString('hex');
      currentIndex = Math.floor(currentIndex / 2);
    }

    return computedHash === rootHash;
  }

  getRootHash(): string {
    return this.root?.hash ?? EMPTY_HASH;
  }

  private rebuild(): void {
    this.levels = [];
    this.leafMap.clear();

    if (this.nodes.size === 0) {
      this.root = null;
      return;
    }

    const sortedKeys = Array.from(this.nodes.keys()).sort();

    let level = sortedKeys.map((key, index) => {
      const value = this.nodes.get(key)!;
      const leafData = Buffer.concat([Buffer.from(key, 'hex'), value]);
      const node: MerkleNode = {
        hash: this.hashFn(leafData).toString('hex'),
        key: Buffer.from(key, 'hex'),
        value,
      };
      this.leafMap.set(key, index);
      return node;
    });
    this.levels.push(level);

    while (level.length > 1) {
      const nextLevel: MerkleNode[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]!;
        const right = i + 1 < level.length && level[i + 1] ? level[i + 1]! : left;
        const parentHash = this.hashFn(
          Buffer.concat([
            Buffer.from(left.hash, 'hex'),
            Buffer.from(right.hash, 'hex'),
          ]),
        );
        nextLevel.push({
          hash: parentHash.toString('hex'),
          left,
          right: right === left ? undefined : right,
        });
      }
      level = nextLevel;
      this.levels.push(level);
    }

    this.root = level[0] ?? null;
    this.levels.reverse(); // Root at index 0
  }
}