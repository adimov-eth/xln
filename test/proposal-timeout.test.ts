import { describe, expect, it } from 'bun:test'
import { applyServerFrame } from '../src/core/reducer'
import type { Input, EntityState, Address } from '../src/core/types'

const empty = (): EntityState => ({
  height: 0n,
  quorum: {
    threshold: 2n,
    members: [
      { address: '0x1111111111111111111111111111111111111111' as Address, shares: 1n },
      { address: '0x2222222222222222222222222222222222222222' as Address, shares: 1n },
      { address: '0x3333333333333333333333333333333333333333' as Address, shares: 1n },
    ],
  },
  signerRecords: {},
  domainState: {},
  mempool: [],
})

describe('proposal timeout', () => {
  it('allows re-proposal after timeout', async () => {
    const state = new Map()
    const entityId = 'test-entity'

    // Attach replicas for 3 validators
    const attach1: Input = [0, entityId, { type: 'attachReplica', snapshot: empty() }]
    const attach2: Input = [1, entityId, { type: 'attachReplica', snapshot: empty() }]
    const attach3: Input = [2, entityId, { type: 'attachReplica', snapshot: empty() }]

    const { next: state1 } = await applyServerFrame(
      state,
      [attach1, attach2, attach3],
      () => 0n,
      0n,
    )

    // Add a transaction
    const tx: Input = [
      0,
      entityId,
      {
        type: 'addTx',
        tx: {
          kind: 'test',
          data: {},
          nonce: 1n,
          sig: '0x1111111111111111111111111111111111111111signed',
        },
      },
    ]
    const { next: state2 } = await applyServerFrame(state1, [tx], () => 1n, 1n)

    // First proposer proposes
    const propose1: Input = [
      0,
      entityId,
      {
        type: 'proposeFrame',
        header: { height: 1n, timestamp: 100n, prevStateRoot: new Uint8Array(32) },
      },
    ]
    const { next: state3 } = await applyServerFrame(state2, [propose1], () => 100n, 2n)

    // Check proposal exists
    const replica1 = state3.get(`0:${entityId}`)
    expect(replica1?.state.proposal).toBeTruthy()

    // Simulate timeout - next proposer can propose
    const propose2: Input = [
      1,
      entityId,
      {
        type: 'proposeFrame',
        header: { height: 1n, timestamp: 200n, prevStateRoot: new Uint8Array(32) },
      },
    ]
    const { next: state4 } = await applyServerFrame(state3, [propose2], () => 200n, 3n)

    // Check new proposal exists
    const replica2 = state4.get(`1:${entityId}`)
    expect(replica2?.state.proposal).toBeTruthy()
    expect(replica2?.state.proposal?.frame.timestamp).toBe(200n)
  })
})
