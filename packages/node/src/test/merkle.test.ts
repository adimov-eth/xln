import { expect } from 'chai';
import { createMerkleTree, CustomMerkleTree, LibMerkleTree, MerkleError } from '../core/Merkle';

describe('Merkle Tree', () => {
  const testImplementations = [
    { name: 'Custom Implementation', useLibrary: false },
    { name: 'Library Implementation', useLibrary: true },
  ];

  testImplementations.forEach(({ name, useLibrary }) => {
    describe(name, () => {
      let tree: ReturnType<typeof createMerkleTree>;

      beforeEach(() => {
        tree = createMerkleTree({ useLibrary, batchSize: 2 });
      });

      describe('build', () => {
        it('should build a tree with single value', () => {
          const value = Buffer.from('test');
          tree.build([value]);
          expect(tree.getRoot()).to.be.instanceOf(Buffer);
        });

        it('should build a tree with multiple values', () => {
          const values = [Buffer.from('test1'), Buffer.from('test2'), Buffer.from('test3')];
          tree.build(values);
          expect(tree.getRoot()).to.be.instanceOf(Buffer);
        });

        it('should handle empty values array', () => {
          tree.build([]);
          expect(() => tree.getRoot()).to.throw(MerkleError);
        });
      });

      describe('getProof and verify', () => {
        const values = [Buffer.from('test1'), Buffer.from('test2'), Buffer.from('test3'), Buffer.from('test4')];

        beforeEach(() => {
          tree.build(values);
        });

        it('should generate and verify proof for existing value', () => {
          const value = values[0];
          const proof = tree.getProof(value);
          expect(proof).to.be.an('array');
          expect(tree.verify(value, proof)).to.be.true;
        });

        it('should fail verification for wrong value', () => {
          const value = values[0];
          const wrongValue = Buffer.from('wrong');
          const proof = tree.getProof(value);
          expect(tree.verify(wrongValue, proof)).to.be.false;
        });

        it('should fail verification for tampered proof', () => {
          const value = values[0];
          const proof = tree.getProof(value);
          proof[0] = Buffer.from('tampered');
          expect(tree.verify(value, proof)).to.be.false;
        });

        it('should throw for non-existent value', () => {
          const nonExistentValue = Buffer.from('nonexistent');
          expect(() => tree.getProof(nonExistentValue)).to.throw(MerkleError);
        });
      });

      describe('getValue', () => {
        it('should retrieve stored value by hash', () => {
          const value = Buffer.from('test');
          tree.build([value]);
          const root = tree.getRoot();
          const storedValue = tree.getValue(root);
          expect(storedValue).to.not.be.undefined;
        });

        it('should return undefined for non-existent hash', () => {
          const nonExistentHash = Buffer.from('nonexistent');
          expect(tree.getValue(nonExistentHash)).to.be.undefined;
        });
      });

      describe('error handling', () => {
        it('should handle invalid hash algorithm', () => {
          const tree = createMerkleTree({ useLibrary, hashAlgorithm: 'invalid' });
          const value = Buffer.from('test');
          expect(() => tree.build([value])).to.throw(MerkleError);
        });

        it('should handle corrupted values', () => {
          const invalidValue = {} as Buffer;
          expect(() => tree.build([invalidValue])).to.throw();
        });
      });

      if (!useLibrary) {
        describe('Custom implementation specific', () => {
          it('should handle batch size correctly', () => {
            const tree = new CustomMerkleTree({ batchSize: 3 });
            const values = [Buffer.from('test1'), Buffer.from('test2'), Buffer.from('test3'), Buffer.from('test4')];
            tree.build(values);
            expect(tree.getRoot()).to.be.instanceOf(Buffer);
          });
        });
      }

      if (useLibrary) {
        describe('Library implementation specific', () => {
          it('should handle library-specific options', () => {
            const tree = new LibMerkleTree({
              batchSize: 2,
              hashAlgorithm: 'sha256',
            });
            const values = [Buffer.from('test1'), Buffer.from('test2')];
            tree.build(values);
            expect(tree.getRoot()).to.be.instanceOf(Buffer);
          });
        });
      }
    });
  });

  describe('Performance comparison', () => {
    const values = Array(1000)
      .fill(null)
      .map((_, i) => Buffer.from(`test${i}`));

    it('should measure build time', () => {
      const customTree = createMerkleTree({ useLibrary: false });
      const libTree = createMerkleTree({ useLibrary: true });

      const customStart = process.hrtime();
      customTree.build(values);
      const customEnd = process.hrtime(customStart);

      const libStart = process.hrtime();
      libTree.build(values);
      const libEnd = process.hrtime(libStart);

      console.log('Custom implementation build time:', customEnd[0] * 1e9 + customEnd[1], 'ns');
      console.log('Library implementation build time:', libEnd[0] * 1e9 + libEnd[1], 'ns');
    });

    it('should measure proof generation time', () => {
      const customTree = createMerkleTree({ useLibrary: false });
      const libTree = createMerkleTree({ useLibrary: true });

      customTree.build(values);
      libTree.build(values);

      const testValue = values[Math.floor(values.length / 2)];

      const customStart = process.hrtime();
      customTree.getProof(testValue);
      const customEnd = process.hrtime(customStart);

      const libStart = process.hrtime();
      libTree.getProof(testValue);
      const libEnd = process.hrtime(libStart);

      console.log('Custom implementation proof time:', customEnd[0] * 1e9 + customEnd[1], 'ns');
      console.log('Library implementation proof time:', libEnd[0] * 1e9 + libEnd[1], 'ns');
    });
  });
});
