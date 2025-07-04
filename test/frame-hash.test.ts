import { describe, expect, it } from 'bun:test'
import { hashFrame, hashEntityState } from '../src/core/hash'

it('changes when postStateRoot changes', () => {
  const frame = {
    height: 1n,
    timestamp: 0n,
    prevStateRoot: new Uint8Array(32),
    txs: [],
    postStateRoot: new Uint8Array(32),
  }
  const h1 = hashFrame(frame)
  frame.postStateRoot = hashEntityState({} as any)
  const h2 = hashFrame(frame)
  expect(Buffer.compare(h1, h2)).not.toBe(0)
})
