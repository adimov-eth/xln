import { describe, expect, it } from 'bun:test'
import { sortTransactions } from '../src/core/hash'

it('sorts txs by nonce then sig', () => {
  const a = { nonce: 2n, sig: '0xa1', kind: 'x', data: {} }
  const b = { nonce: 1n, sig: '0xb2', kind: 'x', data: {} }
  expect(sortTransactions([a, b])[0]).toBe(b)
})