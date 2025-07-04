import keccak256 from 'keccak256'
import { encodeRlp } from './encodeRlp'
import { merkle } from './merkle'
import type { EntityTx, FrameHeader, ServerState } from './types'

// Y-2: Canonical transaction sorting algorithm
// Sort by: nonce → from (signerId) → kind → insertion-index
export const sortTransactions = (txs: EntityTx[]): EntityTx[] => {
  // Add insertion index to preserve order for identical transactions
  const indexed = txs.map((tx, index) => ({ tx, index }))

  return indexed
    .sort((a, b) => {
      // 1. Sort by nonce (ascending)
      if (a.tx.nonce < b.tx.nonce) return -1
      if (a.tx.nonce > b.tx.nonce) return 1

      // 2. Sort by signer (lexicographic)
      // Extract signer from signature (first 42 chars of sig)
      const signerA = a.tx.sig.slice(0, 42).toLowerCase()
      const signerB = b.tx.sig.slice(0, 42).toLowerCase()
      if (signerA < signerB) return -1
      if (signerA > signerB) return 1

      // 3. Sort by kind (lexicographic)
      if (a.tx.kind < b.tx.kind) return -1
      if (a.tx.kind > b.tx.kind) return 1

      // 4. Sort by insertion index
      return a.index - b.index
    })
    .map(({ tx }) => tx)
}

// Compute merkle root of sorted transaction list
export const computeMemRoot = (txs: EntityTx[]): string => {
  const sortedTxs = sortTransactions(txs)
  const leaves = sortedTxs.map((tx) => encodeRlp(tx))
  return '0x' + keccak256(Buffer.from(merkle(leaves))).toString('hex')
}

// R-1: Frame hash = keccak256(rlp(header ‖ txs))
export const hashFrame = (header: FrameHeader, txs: unknown[]): string => {
  const encoded = encodeRlp([header, txs])
  return '0x' + keccak256(Buffer.from(encoded)).toString('hex')
}

// Hash entity state for postStateRoot
export const hashEntityState = (state: unknown): string => {
  const encoded = encodeRlp(state)
  return '0x' + keccak256(Buffer.from(encoded)).toString('hex')
}

export const computeServerRoot = (state: ServerState) => {
  const leaves = [...state.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, r]) => encodeRlp(r.state))
  return keccak256(Buffer.from(merkle(leaves)))
}
