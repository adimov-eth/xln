import { test, expect } from 'bun:test';
import { MerkleTree } from '../utils/merkle.js';

test('merkle tree root hash calculation', () => {
  const tree = new MerkleTree();
  tree.insert(Buffer.from('key1'), Buffer.from('value1'));
  tree.insert(Buffer.from('key2'), Buffer.from('value2'));
  
  const rootHash1 = tree.getRootHash();
  
  const tree2 = new MerkleTree();
  tree2.insert(Buffer.from('key2'), Buffer.from('value2'));
  tree2.insert(Buffer.from('key1'), Buffer.from('value1'));
  
  const rootHash2 = tree2.getRootHash();
  
  expect(rootHash1).toBeDefined();
  expect(rootHash1).not.toBe('0');
  expect(rootHash1).toEqual(rootHash2); // Should be deterministic regardless of insertion order
});

test('merkle proof generation and verification', () => {
  const tree = new MerkleTree();
  const k1 = Buffer.from('key1');
  const v1 = Buffer.from('value1');
  const k2 = Buffer.from('key2');
  const v2 = Buffer.from('value2');
  const k3 = Buffer.from('key3');
  const v3 = Buffer.from('value3');
  
  tree.insert(k1, v1);
  tree.insert(k2, v2);
  tree.insert(k3, v3);
  
  const rootHash = tree.getRootHash();
  
  const proof1 = tree.getProof(k1);
  expect(proof1).not.toBeNull();
  const verified1 = MerkleTree.verifyProof(k1, v1, proof1!, rootHash);
  expect(verified1).toBe(true);
  
  const proof2 = tree.getProof(k2);
  expect(proof2).not.toBeNull();
  const verified2 = MerkleTree.verifyProof(k2, v2, proof2!, rootHash);
  expect(verified2).toBe(true);

  // Verification should fail with wrong value
  const verified3 = MerkleTree.verifyProof(k1, v2, proof1!, rootHash);
  expect(verified3).toBe(false);
});

test('merkle tree handles empty and single-item cases', () => {
  const emptyTree = new MerkleTree();
  expect(emptyTree.getRootHash()).not.toBeNull(); // Should be hash of empty string

  const singleTree = new MerkleTree();
  const key = Buffer.from('key');
  const value = Buffer.from('value');
  singleTree.insert(key, value);
  
  const rootHash = singleTree.getRootHash();
  const proof = singleTree.getProof(key);
  
  expect(proof).not.toBeNull();
  expect(proof!.path.length).toBe(0); // No siblings
  
  const verified = MerkleTree.verifyProof(key, value, proof!, rootHash);
  expect(verified).toBe(true);
});