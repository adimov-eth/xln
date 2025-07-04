import { test, expect } from 'bun:test'
import { applyServerFrame } from '../src/core/reducer'
import { EntityState, Input } from '../src/core/types'

const base = (): EntityState => ({
  height: 0n,
  quorum: {
    threshold: 2n,
    members: [
      { address: '0x1', shares: 1n },
      { address: '0x2', shares: 1n },
    ],
  },
  signerRecords: {},
  domainState: {},
  mempool: [],
})

test('duplicate signFrame ignored', async () => {
  const snap = base()
  let state = new Map()
  const attachA: Input = [0, 'e', { type: 'attachReplica', snapshot: snap }]
  const attachB: Input = [1, 'e', { type: 'attachReplica', snapshot: snap }]
  const header = {
    entityId: 'e',
    height: 1n,
    memRoot: '0x0',
    prevStateRoot: '0x0',
    proposer: '0x1',
  }
  const proposeA: Input = [0, 'e', { type: 'proposeFrame', header }]
  const proposeB: Input = [1, 'e', { type: 'proposeFrame', header }]
  const sigBase = '0x2000000000000000000000000000000000000000'
  const sign1: Input = [1, 'e', { type: 'signFrame', sig: sigBase + 'aaaa' }]
  const signAgain: Input = [1, 'e', { type: 'signFrame', sig: sigBase + 'bbbb' }]
  state = (await applyServerFrame(state, [attachA, attachB], () => 0n)).next
  state = (await applyServerFrame(state, [proposeA, proposeB], () => 1n)).next
  state = (await applyServerFrame(state, [sign1], () => 2n)).next
  state = (await applyServerFrame(state, [signAgain], () => 3n)).next
  const rep = state.get('1:e')!.state
  expect(Object.keys(rep.proposal!.sigs).length).toBe(1)
})
