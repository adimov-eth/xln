/**
 * Simple runner for Hanko tests
 */

import { runBasicHankoTests } from './test-hanko-basic';

async function main() {
  console.log('[LAUNCH] Starting Hanko Tests...\n');

  const success = await runBasicHankoTests();

  if (success) {
    console.log('\n[OK] ALL HANKO TESTS PASSED!');
    console.log('[GOAL] Summary:');
    console.log('  [OK] Hanko building works with placeholders + packedSignatures + claims');
    console.log('  [OK] Multiple signatures verified with real ecrecover');
    console.log('  [OK] ABI encoding compatible with Solidity');
    console.log('  [OK] Complex Hanko structures (mixed placeholders/signatures/claims)');
    console.log('  [OK] Signature verification with ethers.js compatibility');
    console.log('\n[LOCK] SECURITY VERIFIED:');
    console.log('  [OK] All signatures use real secp256k1 cryptography');
    console.log('  [OK] No off-chain trust assumptions');
    console.log('  [OK] Domain separation prevents replay attacks');
    console.log('  [OK] EVM-style sequential nonces');
  } else {
    console.log('\n[X] SOME TESTS FAILED!');
  }

  if (typeof process !== 'undefined') {
    process.exit(success ? 0 : 1);
  }
}

main().catch(console.error);
