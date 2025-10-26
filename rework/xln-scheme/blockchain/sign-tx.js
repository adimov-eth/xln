#!/usr/bin/env node

/**
 * Sign Ethereum transaction using ethers.js
 * Usage: node sign-tx.js <private-key> <tx-json>
 *
 * Returns signed transaction hex
 */

import { Wallet } from 'ethers';

const privateKey = process.argv[2];
const txJson = process.argv[3];

if (!privateKey || !txJson) {
  console.error('Usage: node sign-tx.js <private-key> <tx-json>');
  process.exit(1);
}

try {
  const wallet = new Wallet(privateKey);
  const tx = JSON.parse(txJson);

  // Sign transaction
  const signedTx = await wallet.signTransaction(tx);

  // Output signed transaction (without 0x prefix for Racket)
  console.log(signedTx.slice(2));
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
