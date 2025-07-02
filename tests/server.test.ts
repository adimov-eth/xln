import { describe, it, expect } from 'vitest'
import { applyServerBlock } from '../src/core/server'
import { createServer } from '../src/core/init'
import { createChatTx } from './helpers/tx'
import type { Input, Address } from '../src/types'

describe('Server block processing', () => {
  it.skip('commits when quorum signatures collected', () => {
    const srv = createServer()
    const [key] = [...srv.replicas.keys()]
    const signer = key.split.skip(':').pop() as Address
    const tx = createChatTx(signer, 'Hello')
    let batch: Input[] = [{ from: signer, to: signer, cmd: { type: 'ADD_TX', addrKey: 'demo:chat', tx } }]
    let state = srv
    let outbox: Input[] = []

    // tick0 ADD_TX
    let res = applyServerBlock(state, batch, 0)
    state = res.state; outbox = res.outbox
    // tick1 PROPOSE
    res = applyServerBlock(state, outbox, 1)
    state = res.state; outbox = res.outbox
    // tick2 idle
    res = applyServerBlock(state, outbox, 2)
    state = res.state; outbox = res.outbox
    // tick3 SIGN
    const frameHash = state.replicas.get(key)!.proposal!.hash
    batch = [{ from: signer, to: signer, cmd: { type: 'SIGN', addrKey: 'demo:chat', signer, frameHash, sig: '0x1' } }]
    res = applyServerBlock(state, batch, 3)
    state = res.state; outbox = res.outbox
    // tick4 COMMIT
    res = applyServerBlock(state, outbox, 4)
    state = res.state

    const heights = [...state.replicas.values()].map(r => r.last.height)
    expect(new Set(heights).size).toBe(1)
    expect(heights[0]).toBe(1n)
  })
})
