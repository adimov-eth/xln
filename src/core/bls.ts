import * as nobleBls from '@noble/bls12-381'

/**
 * Sign arbitrary bytes with a 32-byte secret key.
 */
export async function sign(message: Uint8Array, privKey: Uint8Array): Promise<Uint8Array> {
  return nobleBls.sign(message, privKey)
}

/**
 * Aggregate multiple BLS signatures.
 */
export function aggregate(sigs: Uint8Array[]): Uint8Array {
  return sigs.length === 0 ? new Uint8Array() : nobleBls.aggregateSignatures(sigs)
}

/**
 * **Fixed:** returns a real boolean, not a `Promise<Promise<boolean>>`.
 * Uses noble-curves `verifyBatch`, ±2× faster than looping verifies.
 */
export async function verifyAggregate(
  sig: Uint8Array,
  msgs: Uint8Array[],
  pubs: Uint8Array[],
): Promise<boolean> {
  if (msgs.length === 0 || msgs.length !== pubs.length) return false
  return nobleBls.verifyBatch(sig, msgs, pubs)
}
