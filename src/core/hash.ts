import keccak256 from 'keccak256'
import { ecrecover, pubToAddress, toBuffer } from 'ethereumjs-util'
import { encodeRlp } from './encodeRlp'
import { merkle } from './merkle'
import type { EntityState, Frame, ServerState, EntityTx, Address } from './types'

/* ---------- helpers ---------- */
export const getSender = (tx: EntityTx): Address => {
  // TODO: Replace with proper ecrecover when signatures are real
  // For now, extract from sig as per legacy format
  return tx.sig.slice(0, 42) as Address
}

export const hashTransaction = (tx: EntityTx): Uint8Array => {
  // Hash the transaction data for signing
  const data = encodeRlp([tx.kind, tx.data, tx.nonce])
  return keccak256(Buffer.from(data))
}

export const recoverSender = (tx: EntityTx): Address | null => {
  try {
    const sig = tx.sig

    // Handle empty or mock signatures for testing
    if (!sig || sig === '') {
      // Empty signature - return null
      return null
    }

    if (sig.length === 42 || (sig.length > 42 && sig.length < 132)) {
      // Mock format - extract address from first 42 chars
      return getSender(tx)
    }

    // Parse real signature components (132 chars = 0x + 64 chars r + 64 chars s + 2 chars v)
    if (!sig.startsWith('0x') || sig.length !== 132) {
      // Invalid format
      return null
    }

    const r = toBuffer(sig.slice(0, 66))
    const s = toBuffer('0x' + sig.slice(66, 130))
    const v = parseInt(sig.slice(130, 132), 16)

    // Recover public key from signature
    const msgHash = hashTransaction(tx)
    const pubKey = ecrecover(msgHash, v, r, s)

    // Derive address from public key
    const address = '0x' + pubToAddress(pubKey).toString('hex')
    return address as Address
  } catch (error) {
    // If recovery fails, try mock format
    return getSender(tx)
  }
}

/* ---------- entity‑level hashing ---------- */
export const hashEntityState = (s: EntityState): Uint8Array =>
  keccak256(Buffer.from(encodeRlp(s.domainState)))

export const sortTransactions = (txs: ReadonlyArray<Frame['txs'][number]>) =>
  [...txs].sort((a, b) =>
    a.nonce === b.nonce ? a.sig.localeCompare(b.sig) : a.nonce < b.nonce ? -1 : 1,
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
