import { describe, it, expect } from 'vitest'
import { Runtime } from '../src/runtime'
import { createChatTx } from './helpers/tx'

describe('End-to-end consensus', () => {
  it.skip('all replicas see same chat after commit', () => {
    const rt = new Runtime({ logLevel: 'silent' })
    const signer = rt.replicas[0].proposer
    const tx = createChatTx(signer, 'gm')
    rt.injectClientTx(tx)
    for (let i = 0; i < 4; i++) rt.tick()
    const chats = rt.replicas.map(r => r.chat.length)
    expect(new Set(chats).size).toBe(1)
    expect(chats[0]).toBeGreaterThan(0)
  })
})
