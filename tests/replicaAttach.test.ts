import { test, expect } from 'bun:test'
import { applyServerFrame } from '../src/core/reducer'
import { Input, EntityState } from '../src/core/types'
const empty = (): EntityState => ({
  height: 0n,
  quorum: { threshold: 1n, members: [{ address: '0x1', shares: 1n }] },
  signerRecords: {},
  domainState: {},
  mempool: [],
})
test('replica attach stays in sync', () => {
  let state = new Map()
  const snap = empty()
  const attachA: Input = [0, 'e', { type: 'attachReplica', snapshot: snap }]
  const attachB: Input = [1, 'e', { type: 'attachReplica', snapshot: snap }]
  const txA: Input = [0, 'e', { type: 'addTx', tx: { kind: 'chat', data: 1, nonce: 0n, sig: '' } }]
  const txB: Input = [1, 'e', { type: 'addTx', tx: { kind: 'chat', data: 1, nonce: 0n, sig: '' } }]
  for (let i = 0; i < 100; i++) {
    const batch = i === 0 ? [attachA, attachB] : [txA, txB]
    state = applyServerFrame(state, batch, () => BigInt(i)).next
  }
  const [a, b] = ['0:e', '1:e'].map((k) => state.get(k)!.state)
  const ser = (v: unknown) =>
    JSON.stringify(v, (_, val) => (typeof val === 'bigint' ? val.toString() : val))
  expect(ser(a)).toBe(ser(b))
})
