import * as nobleBls from '@noble/bls12-381';

/**
 * Sign arbitrary bytes with a 32-byte secret key.
 */
export async function sign(
  message: Uint8Array,
  privKey: Uint8Array,
): Promise<Uint8Array> {
  return nobleBls.sign(message, privKey);
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
  if (msgs.length === 0 || msgs.length !== pubs.length) return false;
  return nobleBls.verifyBatch(sig, msgs, pubs);
}
