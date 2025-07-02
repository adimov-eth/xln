import { describe, it, expect } from 'vitest'
import { applyServerBlock } from '../src/core/server'
import { createServer } from '../src/core/init'
import { createChatTx } from './helpers/tx'
import type { Input, Address } from '../src/types'

describe('Server block processing', () => {
  it.skip('commits when quorum signatures collected', () => {
    process.env.DEV_SKIP_SIGS = '1'
    const srv = createServer()
    const key = [...srv.replicas.keys()][0]!
    const signer = key.split(':').pop()! as Address
    const tx = createChatTx(signer, 'Hello')
    let batch: Input[] = [{ from: signer, to: signer, cmd: { type: 'ADD_TX', addrKey: 'demo:chat', tx } }]
    let state = srv
    let outbox: Input[] = []

    let res = applyServerBlock(state, batch, 0)
    state = res.state; outbox = res.outbox
    res = applyServerBlock(state, outbox, 1)
    state = res.state; outbox = res.outbox
    const proposal = state.replicas.get(key)!.proposal!
    const commitMsg: Input = { from: signer, to: signer, cmd: { type: 'COMMIT', addrKey: 'demo:chat', hanko: '0x', frame: proposal } }
    res = applyServerBlock(state, [commitMsg], 2)
    state = res.state

    const heights = [...state.replicas.values()].map(r => r.last.height)
    expect(new Set(heights).size).toBe(1)
    expect(heights[0]).toBe(1n)
  })
})
