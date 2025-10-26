#!/usr/bin/env node

// Simple Keccak256 wrapper for Racket FFI
// Usage: node keccak256.js <hex-string-without-0x>

import { keccak256 } from 'ethers';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node keccak256.js <hex-string>');
  process.exit(1);
}

const hash = keccak256('0x' + input);
// Output just the hash without 0x prefix
console.log(hash.slice(2));
