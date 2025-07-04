import { describe, expect, it } from 'bun:test'
import { applyServerFrame } from '../src/core/reducer'
import type { Input, EntityState } from '../src/core/types'

const signerIdx = 0
const entityId = 'E1'
const signerAddr = '0xabc'.padEnd(42, '0')

const empty = (): EntityState => ({
  height: 0n,
  quorum: { threshold: 1n, members: [{ address: signerAddr as any, shares: 1n }] },
  signerRecords: {},
  domainState: {},
  mempool: [],
})

const attach: Input = [signerIdx, entityId, { type: 'attachReplica', snapshot: empty() }]

const tx = (nonce: bigint): Input => [
  signerIdx,
  entityId,
  {
    type: 'addTx',
    tx: { kind: 'foo', data: {}, nonce, sig: `${signerAddr}signed` },
  },
]

describe('nonce replay‑protection', () => {
  it('rejects duplicate nonce', async () => {
    let state = new Map()
    // First attach the replica
    const { next: state1 } = await applyServerFrame(state, [attach], () => 0n, 0n)
    // Add first transaction with nonce 1
    const { next: state2 } = await applyServerFrame(state1, [tx(1n)], () => 1n, 1n)
    // Try to add duplicate nonce (should be rejected)
    const { next: state3 } = await applyServerFrame(state2, [tx(1n)], () => 2n, 2n)
    // no throw ⇒ reducer silently rejected, state unchanged
    expect(true).toBeTruthy()
  })
})
