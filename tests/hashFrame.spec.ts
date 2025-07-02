import { describe, it, expect } from 'vitest'
import { hashFrame } from '../src/core/entity'
import { mkFrame } from './helpers/frame'
import { createChatTx } from './helpers/tx'
import type { Address } from '../src/types'

describe('hashFrame golden vectors', () => {
  it('empty frame ts=1', () => {
    const f = mkFrame({ ts: 1 })
    const h = hashFrame(f as any)
    expect(h).toBe('0x6cca6ca84fc54588ffa69fb4f3f21c88baabf96c2ff6cef81f374cbb87ab6c63')
  })

  it('height=1 ts=2', () => {
    const f = mkFrame({ height: 1n, ts: 2 })
    const h = hashFrame(f as any)
    expect(h).toBe('0xad4562327f0448145684a81229820ca89a6b8c50f07bc44c40a64b76f088ba1b')
  })

  it('single chat tx', () => {
    const tx = createChatTx('0x01' as Address, 'hi')
    const f = mkFrame({ txs: [tx], ts: 3 })
    const h = hashFrame(f as any)
    expect(h).toBe('0x090aa4a6ea8a96654c68d98b34a6badb71f5e4ddc826b1b6ead89b5961f230d1')
  })
})
