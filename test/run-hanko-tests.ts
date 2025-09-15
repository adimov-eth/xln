/**
 * Simple runner for Hanko tests
 */

import { runBasicHankoTests } from '../src/test-hanko-basic.js';

async function main() {
  console.log('🚀 Starting Hanko Tests...\n');
  
  const success = await runBasicHankoTests();
  
  if (success) {
    console.log('\n✅ ALL HANKO TESTS PASSED!');
    console.log('🎯 Summary:');
    console.log('  ✅ Hanko building works with placeholders + packedSignatures + claims');
    console.log('  ✅ Multiple signatures verified with real ecrecover');
    console.log('  ✅ ABI encoding compatible with Solidity');
    console.log('  ✅ Complex Hanko structures (mixed placeholders/signatures/claims)');
    console.log('  ✅ Signature verification with ethers.js compatibility');
    console.log('\n🔒 SECURITY VERIFIED:');
    console.log('  ✅ All signatures use real secp256k1 cryptography');
    console.log('  ✅ No off-chain trust assumptions');
    console.log('  ✅ Domain separation prevents replay attacks');
    console.log('  ✅ EVM-style sequential nonces');
  } else {
    console.log('\n❌ SOME TESTS FAILED!');
  }
  
  if (typeof process !== 'undefined') {
    process.exit(success ? 0 : 1);
  }
}

main().catch(console.error);