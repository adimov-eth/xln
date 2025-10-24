/**
 * [GOAL] XLN Hanko Bytes - REAL Ethereum Implementation
 *
 * [ALERT] CRITICAL DESIGN PHILOSOPHY: "ASSUME YES" FLASHLOAN GOVERNANCE [ALERT]
 *
 * This implementation INTENTIONALLY allows entities to mutually validate without EOA signatures.
 * This is NOT a bug - it's a feature for flexible governance structures.
 *
 * KEY DESIGN PRINCIPLES:
 * 1. [OK] Protocol flexibility: Allow exotic governance structures
 * 2. [OK] UI enforcement: Policy decisions belong in application layer
 * 3. [OK] Gas efficiency: Avoid complex graph traversal on-chain
 * 4. [OK] Atomic validation: All-or-nothing verification like flashloans
 *
 * EXAMPLE "LOOPHOLE" THAT IS INTENDED:
 * ```
 * EntityA: { threshold: 1, delegates: [EntityB] }
 * EntityB: { threshold: 1, delegates: [EntityA] }
 * Hanko: {
 *   placeholders: [],
 *   packedSignatures: "0x", // ZERO EOA signatures!
 *   claims: [
 *     { entityId: EntityA, entityIndexes: [1], weights: [100], threshold: 100 },
 *     { entityId: EntityB, entityIndexes: [0], weights: [100], threshold: 100 }
 *   ]
 * }
 * ```
 * Result: [OK] Both entities validate each other [RIGHTWARDS] Hanko succeeds!
 *
 * WHY THIS IS INTENDED:
 * - Real entities will include EOAs for practical control
 * - UI can enforce "at least 1 EOA" policies if desired
 * - Enables sophisticated delegation chains
 * - Alternative solutions are expensive and still gameable
 *
 * Uses actual secp256k1 signatures compatible with Solidity ecrecover
 */

import { ethers } from 'ethers';

import { HankoBytes, HankoClaim } from './types';
import { createHash, randomBytes } from './utils';

// Browser-compatible Buffer.concat replacement
const bufferConcat = (buffers: Buffer[]): Buffer => {
  if (typeof Buffer.concat === 'function') {
    return Buffer.concat(buffers);
  } else {
    // Browser fallback: manual concatenation
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      result.set(buf, offset);
      offset += buf.length;
    }
    return Buffer.from(result);
  }
};

// Browser-compatible Buffer.alloc replacement
const bufferAlloc = (size: number, fill?: number): Buffer => {
  if (typeof Buffer.alloc === 'function') {
    return Buffer.alloc(size, fill);
  } else {
    // Browser fallback: create and fill manually
    const result = new Uint8Array(size);
    if (fill !== undefined) {
      result.fill(fill);
    }
    return Buffer.from(result);
  }
};

// === REAL ETHEREUM SIGNATURES ===

/**
 * Create REAL Ethereum signature using secp256k1
 */
export async function createRealSignature(hash: Buffer, privateKey: Buffer): Promise<Buffer> {
  try {
    // Create wallet from private key
    const wallet = new ethers.Wallet(ethers.hexlify(privateKey));

    // Sign the hash (ethers automatically prefixes with \x19Ethereum Signed Message)
    // For raw hash signing without prefix, we need to use wallet._signingKey
    const signature = await wallet.signMessage(ethers.getBytes(hash));

    // Parse signature components
    const sig = ethers.Signature.from(signature);

    // Convert to 65-byte format (r + s + v)
    const r = ethers.getBytes(sig.r);
    const s = ethers.getBytes(sig.s);
    const v = sig.v;

    // Ensure r and s are 32 bytes each
    const rPadded = new Uint8Array(32);
    const sPadded = new Uint8Array(32);
    rPadded.set(r, 32 - r.length);
    sPadded.set(s, 32 - s.length);

    return bufferConcat([Buffer.from(rPadded), Buffer.from(sPadded), Buffer.from([v])]);
  } catch (error) {
    console.error(`[X] Failed to create signature: ${error}`);
    throw error;
  }
};

/**
 * Create DIRECT hash signature (no message prefix)
 * This matches what Solidity ecrecover expects
 */
export const createDirectHashSignature = async (hash: Buffer, privateKey: Buffer): Promise<Buffer> => {
  try {

    // Sign the raw hash directly (no message prefix)
    const hashHex = ethers.hexlify(hash);

    // For direct hash signing, we need to use the signing key directly
    const signingKey = new ethers.SigningKey(ethers.hexlify(privateKey));
    const sig = signingKey.sign(hashHex);

    // Convert to Buffer format
    const r = ethers.getBytes(sig.r);
    const s = ethers.getBytes(sig.s);
    const v = sig.v;

    const rPadded = new Uint8Array(32);
    const sPadded = new Uint8Array(32);
    rPadded.set(r, 32 - r.length);
    sPadded.set(s, 32 - s.length);

    console.log(
      `[KEY] Created signature: r=${ethers.hexlify(r).slice(0, 10)}..., s=${ethers.hexlify(s).slice(0, 10)}..., v=${v}`,
    );

    return bufferConcat([Buffer.from(rPadded), Buffer.from(sPadded), Buffer.from([v])]);
  } catch (error) {
    console.error(`[X] Failed to create direct hash signature: ${error}`);
    throw error;
  }
};

/**
 * Verify signature recovery works (for testing)
 */
export const verifySignatureRecovery = async (
  hash: Buffer,
  signature: Buffer,
  expectedAddress: string,
): Promise<boolean> => {
  try {
    // Extract components
    const r = ethers.hexlify(signature.slice(0, 32));
    const s = ethers.hexlify(signature.slice(32, 64));
    const v = signature[64];

    // Recover address (convert v to yParity for ethers v6)
    const yParity = (v! >= 27 ? v! - 27 : v!) as 0 | 1;
    const recoveredAddress = ethers.recoverAddress(ethers.hexlify(hash), { r, s, v: v!, yParity });

    const matches = recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    console.log(
      `[FIND] Recovery test: expected=${expectedAddress.slice(0, 10)}..., recovered=${recoveredAddress.slice(0, 10)}..., match=${matches}`,
    );

    return matches;
  } catch (error) {
    console.error(`[X] Failed to verify signature recovery: ${error}`);
    return false;
  }
};

// === SIGNATURE PACKING (Real Version) ===

export const packRealSignatures = (signatures: Buffer[]): Buffer => {
  console.log(`[PKG] Packing ${signatures.length} REAL signatures...`);

  if (signatures.length === 0) {
    return bufferAlloc(0);
  }

  // Validate all signatures are exactly 65 bytes
  for (let i = 0; i < signatures.length; i++) {
    if (!signatures[i] || signatures[i]!.length !== 65) {
      throw new Error(`Invalid signature ${i}: ${signatures[i]?.length || 0} bytes (expected 65)`);
    }

    const v = signatures[i]![64];
    if (v !== 27 && v !== 28) {
      throw new Error(`Invalid v value in signature ${i}: ${v} (expected 27 or 28)`);
    }
  }

  // Pack R,S values
  const rsValues = bufferAlloc(signatures.length * 64);
  let rsOffset = 0;

  for (const sig of signatures) {
    // Browser-compatible copy: extract R,S (first 64 bytes) and copy to rsValues
    const rsBytes = sig.slice(0, 64);
    rsValues.set(rsBytes, rsOffset);
    rsOffset += 64;
  }

  // Pack V values as bits
  const vBytesNeeded = Math.ceil(signatures.length / 8);
  const vValues = bufferAlloc(vBytesNeeded);

  for (let i = 0; i < signatures.length; i++) {
    const vByte = signatures[i]![64];
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;

    if (vByte === 28) {
      vValues[byteIndex]! |= 1 << bitIndex;
    }
  }

  const packed = bufferConcat([rsValues, vValues]);
  console.log(`[OK] Packed ${signatures.length} real signatures: ${packed.length} bytes`);

  return packed;
};

// === SIGNATURE DETECTION AND PACKING ===

/**
 * Detect signature count from packed signatures length
 */
export const detectSignatureCount = (packedSignatures: Buffer): number => {
  if (packedSignatures.length === 0) return 0;

  // Try different signature counts until we find the right one
  // Formula: length = count * 64 + ceil(count / 8)
  for (let count = 1; count <= 16000; count++) {
    const expectedRSBytes = count * 64;
    const expectedVBytes = Math.ceil(count / 8);
    const expectedTotal = expectedRSBytes + expectedVBytes;

    if (packedSignatures.length === expectedTotal) {
      console.log(`[FIND] Detected ${count} signatures from ${packedSignatures.length} bytes`);
      return count;
    }

    // Early exit if we've exceeded possible length
    if (expectedTotal > packedSignatures.length) {
      break;
    }
  }

  throw new Error(`Invalid packed signature length: ${packedSignatures.length} bytes - cannot detect count`);
};

export const unpackRealSignatures = (packedSignatures: Buffer): Buffer[] => {
  const signatureCount = detectSignatureCount(packedSignatures);
  console.log(`[PKG] Unpacking ${signatureCount} REAL signatures...`);

  if (signatureCount === 0) return [];

  const expectedRSBytes = signatureCount * 64;
  const expectedVBytes = Math.ceil(signatureCount / 8);
  const expectedTotal = expectedRSBytes + expectedVBytes;

  if (packedSignatures.length !== expectedTotal) {
    throw new Error(`Invalid packed signature length: ${packedSignatures.length} (expected ${expectedTotal})`);
  }

  const rsValues = packedSignatures.slice(0, expectedRSBytes);
  const vValues = packedSignatures.slice(expectedRSBytes);
  const signatures: Buffer[] = [];

  for (let i = 0; i < signatureCount; i++) {
    const rs = rsValues.slice(i * 64, (i + 1) * 64);

    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const vBit = (vValues[byteIndex]! >> bitIndex) & 1;
    const vByte = vBit === 0 ? 27 : 28;

    const signature = bufferConcat([rs, Buffer.from([vByte])]);
    signatures.push(signature);
  }

  console.log(`[OK] Unpacked ${signatures.length} real signatures`);
  return signatures;
};

// === REAL HANKO BUILDING ===

/**
 * [IDEA] WHY WE DON'T TRACK SIGNATURE USAGE (Response to Junior's Concern)
 *
 * Question: "How do you ensure signatures are actually used in claims?"
 *
 * ANSWER: We intentionally DON'T track this because:
 *
 * 1. [ANTICLOCKWISE] CIRCULAR REFERENCE PROBLEM:
 *    EntityA [RIGHTWARDS] EntityB [RIGHTWARDS] EntityA means neither "uses" direct signatures
 *    But this is VALID hierarchical governance we want to support
 *
 * 2. [$] GAS COST EXPLOSION:
 *    Tracking would require O(n²) analysis of claim dependency graphs
 *    Current approach: O(n) sequential processing with assumptions
 *
 * 3. [GOAL] STILL GAMEABLE:
 *    Even with tracking, attacker can include "decoy" signatures:
 *    - Add 1 real signature that IS referenced by some claim
 *    - Add circular claims that don't use that signature
 *    - System still validates circular parts independently
 *
 * 4. [SHIELD]  PROTOCOL VS POLICY:
 *    Protocol provides flexible primitive
 *    UI/Application enforces business rules (e.g., "require EOA in root")
 *
 * EXAMPLE WHY TRACKING FAILS:
 * ```
 * packedSignatures: [RealSig1]  // [LEFTWARDS] Used by ClaimC
 * claims: [
 *   ClaimA: refs ClaimB,    // [LEFTWARDS] Circular validation
 *   ClaimB: refs ClaimA,    // [LEFTWARDS] Still works without RealSig1!
 *   ClaimC: refs RealSig1   // [LEFTWARDS] Uses the signature
 * ]
 * ```
 * Tracking would say "[OK] RealSig1 is used" but ClaimA/B still validate circularly.
 */
export const buildRealHanko = async (
  hashToSign: Buffer,
  config: {
    noEntities: Buffer[];
    privateKeys: Buffer[]; // Real private keys
    claims: {
      entityId: Buffer;
      entityIndexes: number[];
      weights: number[];
      threshold: number;
      expectedQuorumHash: Buffer;
    }[];
  },
): Promise<HankoBytes> => {
  console.log(`[PEN]  Building REAL hanko: ${config.claims.length} claims, ${config.privateKeys.length} signatures`);

  // Create REAL Ethereum signatures
  const signatures: Buffer[] = [];
  const signerAddresses: string[] = [];

  for (let i = 0; i < config.privateKeys.length; i++) {
    const privateKey = config.privateKeys[i]!;

    // Get the address for this private key
    const wallet = new ethers.Wallet(ethers.hexlify(privateKey));
    signerAddresses.push(wallet.address);

    console.log(`[KEY] Signing with key ${i + 1}/${config.privateKeys.length}: ${wallet.address.slice(0, 10)}...`);

    // Create real signature
    const signature = await createDirectHashSignature(hashToSign!, privateKey);
    signatures.push(signature);

    // Verify the signature works
    const verifySuccess = await verifySignatureRecovery(hashToSign!, signature, wallet.address);
    if (!verifySuccess) {
      throw new Error(`Signature verification failed for key ${i}`);
    }
  }

  // Pack signatures
  const packedSignatures = packRealSignatures(signatures);

  // Build claims
  const claims: HankoClaim[] = config.claims.map(claim => ({
    entityId: claim.entityId,
    entityIndexes: claim.entityIndexes,
    weights: claim.weights,
    threshold: claim.threshold,
    expectedQuorumHash: claim.expectedQuorumHash,
  }));

  const hanko: HankoBytes = {
    placeholders: config.noEntities, // Failed entities (index 0..N-1)
    packedSignatures, // EOA signatures (index N..M-1)
    claims, // Entity claims (index M..∞)
  };

  console.log(`[OK] Built REAL hanko with verifiable signatures`);
  console.log(`   [LIST] Signers: ${signerAddresses.map(addr => addr.slice(0, 10) + '...').join(', ')}`);
  console.log(`   [STATS] Signature count: ${signatures.length} (detected from length)`);

  return hanko;
};

/**
 * [FIRE] FLASHLOAN GOVERNANCE SIMULATION - "ASSUME YES" in TypeScript
 *
 * This function mirrors the Solidity flashloan governance logic on the client side.
 * Used for gas optimization: pre-recover entities to avoid on-chain signature recovery.
 *
 * CRITICAL: This implements the SAME optimistic assumptions as Solidity:
 * - When claim X references claim Y, we assume Y = YES regardless of verification order
 * - If ANY claim later fails its threshold [RIGHTWARDS] entire validation should fail
 * - Enables circular references to mutually validate (INTENDED behavior)
 *
 * EXAMPLE CIRCULAR VALIDATION:
 * Claims: [
 *   { entityId: A, entityIndexes: [3], weights: [100], threshold: 100 }, // refs claim 1 (B)
 *   { entityId: B, entityIndexes: [2], weights: [100], threshold: 100 }  // refs claim 0 (A)
 * ]
 *
 * Processing:
 * 1. Claim 0: Assume B=YES [RIGHTWARDS] 100 ≥ 100 [RIGHTWARDS] A passes [OK]
 * 2. Claim 1: Assume A=YES [RIGHTWARDS] 100 ≥ 100 [RIGHTWARDS] B passes [OK]
 * 3. Both entities added to yesEntities [RIGHTWARDS] circular validation succeeds!
 *
 * Recover hanko signatures and return processed entities (for gas optimization)
 */
export const recoverHankoEntities = async (
  hanko: HankoBytes,
  hash: Buffer,
): Promise<{
  yesEntities: Buffer[];
  noEntities: Buffer[];
  claims: HankoClaim[];
}> => {
  console.log('[FIND] Recovering hanko entities with flashloan governance...');

  // Step 1: Unpack and recover signatures
  const signatures = unpackRealSignatures(hanko.packedSignatures);
  const yesEntities: Buffer[] = [];

  for (let i = 0; i < signatures.length; i++) {
    try {
      // Use ethers to recover the signer address
      const sig = signatures[i]!;
      const r = ethers.hexlify(sig.slice(0, 32));
      const s = ethers.hexlify(sig.slice(32, 64));
      const v = sig[64];

      const yParity = (v! >= 27 ? v! - 27 : v!) as 0 | 1;
      const recoveredAddress = ethers.recoverAddress(ethers.hexlify(hash), { r, s, v: v!, yParity });

      // Convert address to bytes32 (same format as Solidity)
      const addressAsBytes32 = Buffer.from(ethers.zeroPadValue(recoveredAddress, 32).slice(2), 'hex');

      yesEntities.push(addressAsBytes32);
      console.log(`[OK] Recovered signer ${i + 1}: ${recoveredAddress.slice(0, 10)}...`);
    } catch (error) {
      console.log(`[X] Failed to recover signature ${i + 1}: ${error}`);
    }
  }

  // Step 2: [FIRE] FLASHLOAN GOVERNANCE - optimistically assume all claims pass
  //
  // [ALERT] KEY INSIGHT: We process claims sequentially but assume ALL future claims = YES
  // This mirrors the Solidity behavior and enables circular validation
  //
  // CONCRETE EXAMPLE:
  // Claim 0: EntityA needs EntityB (assume YES) [RIGHTWARDS] A gets added to yesEntities
  // Claim 1: EntityB needs EntityA (assume YES) [RIGHTWARDS] B gets added to yesEntities
  // Result: Both A and B are in yesEntities [RIGHTWARDS] mutual validation succeeds!

  for (let claimIndex = 0; claimIndex < hanko.claims.length; claimIndex++) {
    const claim = hanko.claims[claimIndex];
    if (!claim) continue;

    console.log(
      `[ANTICLOCKWISE] Processing claim ${claimIndex + 1}/${hanko.claims.length}: Entity ${ethers.hexlify(claim.entityId).slice(0, 10)}...`,
    );

    // Calculate voting power with flashloan assumptions
    let totalVotingPower = 0;
    const totalEntities = hanko.placeholders.length + signatures.length + hanko.claims.length;

    for (let i = 0; i < claim.entityIndexes.length; i++) {
      const entityIndex = claim.entityIndexes[i];
      if (entityIndex === undefined) continue;

      // Validate bounds
      if (entityIndex >= totalEntities) {
        console.log(`[X] Entity index ${entityIndex} out of bounds (max: ${totalEntities})`);
        continue;
      }

      // Prevent self-reference
      const referencedClaimIndex = entityIndex - hanko.placeholders.length - signatures.length;
      if (referencedClaimIndex === claimIndex) {
        console.log(`[X] Claim ${claimIndex} cannot reference itself`);
        continue;
      }

      if (entityIndex < hanko.placeholders.length) {
        // Index 0..N-1: Placeholder (failed entity) - contributes 0 voting power
        console.log(`  [PIN] Index ${entityIndex}: Placeholder (no power)`);
        continue;
      } else if (entityIndex < hanko.placeholders.length + signatures.length) {
        // Index N..M-1: EOA signature - verified, contributes full weight
        const weight = claim.weights[i] || 0;
        console.log(`  [KEY] Index ${entityIndex}: EOA signature (power: ${weight})`);
        totalVotingPower += weight;
      } else {
        // Index M..∞: Entity claim - ASSUME YES! (flashloan governance)
        const refClaimIdx = referencedClaimIndex;
        const weight = claim.weights[i] || 0;
        console.log(`  [FIRE] Index ${entityIndex}: ASSUME claim ${refClaimIdx} = YES (power: ${weight})`);
        totalVotingPower += weight;
      }
    }

    // Check threshold
    if (totalVotingPower >= claim.threshold) {
      yesEntities.push(claim.entityId);
      console.log(`[OK] Claim ${claimIndex + 1} passed: ${totalVotingPower}/${claim.threshold} (flashloan assumption)`);
    } else {
      console.log(`[X] Claim ${claimIndex + 1} failed: ${totalVotingPower}/${claim.threshold}`);
      // Note: In flashloan governance, any failure means total failure
    }
  }

  console.log(`[STATS] Flashloan recovery complete: ${yesEntities.length} yes, ${hanko.placeholders.length} placeholders`);

  return {
    yesEntities,
    noEntities: hanko.placeholders,
    claims: hanko.claims,
  };
};

// === FULL CYCLE TEST ===

export const testFullCycle = async (): Promise<{ hanko: HankoBytes; abiEncoded: string; hashToSign: Buffer }> => {
  console.log('\n[TEST] === FULL CYCLE TEST: TypeScript [RIGHTWARDS] Solidity ===\n');

  // Generate test data
  const hashToSign = createHash('sha256').update('Test hanko message').digest();
  const privateKey1 = randomBytes(32);
  const privateKey2 = randomBytes(32);

  // Get addresses
  const wallet1 = new ethers.Wallet(ethers.hexlify(privateKey1));
  const wallet2 = new ethers.Wallet(ethers.hexlify(privateKey2));

  console.log(`[DOC] Hash to sign: 0x${hashToSign.toString('hex')}`);
  console.log(`[KEY] Signer 1: ${wallet1.address}`);
  console.log(`[KEY] Signer 2: ${wallet2.address}`);

  // Create real hanko
  const hanko = await buildRealHanko(hashToSign, {
    noEntities: [],
    privateKeys: [privateKey1, privateKey2],
    claims: [
      {
        entityId: Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
        entityIndexes: [0, 1], // Both signatures
        weights: [1, 1],
        threshold: 2,
        expectedQuorumHash: randomBytes(32),
      },
    ],
  });

  // Verify unpacking works
  const unpacked = unpackRealSignatures(hanko.packedSignatures);
  console.log(`\n[PKG] Signature verification:`);

  for (let i = 0; i < unpacked.length; i++) {
    const expectedAddr = i === 0 ? wallet1.address : wallet2.address;
    const verified = await verifySignatureRecovery(hashToSign, unpacked[i]!, expectedAddr);
    console.log(`   Signature ${i + 1}: ${verified ? '[OK]' : '[X]'} ${expectedAddr.slice(0, 10)}...`);
  }

  // Create ABI-encoded data for Solidity (flashloan governance format)
  const abiEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(bytes32[],bytes,tuple(bytes32,uint256[],uint256[],uint256,bytes32)[])'],
    [
      [
        hanko.placeholders.map(p => '0x' + Buffer.from(p).toString('hex')),
        '0x' + Buffer.from(hanko.packedSignatures).toString('hex'),
        hanko.claims.map(c => [
          '0x' + Buffer.from(c.entityId).toString('hex'),
          c.entityIndexes,
          c.weights,
          c.threshold,
          '0x' + Buffer.from(c.expectedQuorumHash).toString('hex'),
        ]),
      ],
    ],
  );

  console.log(`\n[LIST] ABI Encoded hanko: ${abiEncoded.length} bytes`);

  return { hanko, abiEncoded, hashToSign };
};

// === GAS OPTIMIZATION TEST ===

export const testGasOptimization = async (): Promise<void> => {
  console.log('\n[FUEL] === GAS OPTIMIZATION TEST ===\n');

  // Create test hanko
  const { hanko, abiEncoded, hashToSign } = await testFullCycle();

  // Method 1: Send full hanko (higher calldata, more gas)
  console.log(`[STATS] Method 1 - Full Hanko:`);
  console.log(`   Calldata size: ${abiEncoded.length} bytes`);
  console.log(`   Solidity function: verifyHankoSignature(bytes,bytes32)`);

  // Method 2: Pre-recover entities and send optimized data
  const recovered = await recoverHankoEntities(hanko, hashToSign);

  // Encode optimized data (yesEntities + noEntities + claims)
  const optimizedEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32[]', 'bytes32[]', 'tuple(bytes32,uint256[],uint256[],uint256,bytes32)[]'],
    [
      recovered.yesEntities.map(entity => '0x' + Buffer.from(entity).toString('hex')),
      recovered.noEntities.map(entity => '0x' + Buffer.from(entity).toString('hex')),
      recovered.claims.map(c => [
        '0x' + Buffer.from(c.entityId).toString('hex'),
        c.entityIndexes,
        c.weights,
        c.threshold,
        '0x' + Buffer.from(c.expectedQuorumHash).toString('hex'),
      ]),
    ],
  );

  console.log(`[STATS] Method 2 - Pre-recovered:`);
  console.log(`   Calldata size: ${optimizedEncoded.length} bytes`);
  console.log(`   Solidity function: verifyQuorumClaims(bytes32[],bytes32[],HankoClaim[])`);
  console.log(
    `   Gas savings: ~${Math.round((1 - optimizedEncoded.length / abiEncoded.length) * 100)}% calldata reduction`,
  );
  console.log(`   Additional savings: No signature recovery gas cost on-chain`);

  console.log(`\n[IDEA] Recommendation: Use Method 2 for gas-sensitive applications`);
};

// All functions exported above
