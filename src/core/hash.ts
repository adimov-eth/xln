import keccak256 from 'keccak256'
import { concat } from 'uint8arrays'
import { encodeRlp } from './encodeRlp'
import { merkle } from './merkle'
import type { EntityState, Frame, ServerState } from './types'

/* ---------- entity‑level hashing ---------- */
export const hashEntityState = (s: EntityState): Uint8Array =>
  keccak256(Buffer.from(encodeRlp(s.domainState)))

export const sortTransactions = (txs: ReadonlyArray<Frame['txs'][number]>) =>
  [...txs].sort((a, b) =>
    a.nonce === b.nonce
      ? a.sig.localeCompare(b.sig)
      : a.nonce < b.nonce
      ? -1
      : 1,
  )

export const hashFrame = (f: Frame): Uint8Array => {
  const body = encodeRlp([
    f.height,
    f.timestamp,
    f.prevStateRoot,
    sortTransactions(f.txs),
    f.postStateRoot,
  ])
  return keccak256(Buffer.from(body))
}

/* ---------- server‑level hashing ---------- */
export const computeServerRoot = (state: ServerState): Uint8Array => {
  const leaves = [...state.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, r]) => encodeRlp(r.state))
  return keccak256(Buffer.from(merkle(leaves)))
}

export const computeInputsRoot = (batch: Parameters<typeof encodeRlp>[0][]): Uint8Array =>
  keccak256(Buffer.from(merkle(batch.map(encodeRlp))))