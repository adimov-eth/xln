import { describe, it, expect } from 'vitest'
import { applyCommand, hashFrame } from '../src/core/entity'
import { createBlankReplica } from '../src/core/init'
import { createChatTx } from './helpers/tx'
import { mkFrame, enc } from './helpers/frame'
import { keccak_256 as keccak } from '@noble/hashes/sha3'
import type { Command } from '../src/types'

describe('Entity state machine', () => {
  it('hashFrame matches keccak256(RLP(frame))', () => {
    const f = mkFrame({ ts: 1 })
    const expected = hashFrame(f as any)
    const direct = '0x' + Buffer.from(keccak(enc(f))).toString('hex')
    expect(direct).toBe(expected)
  })

  it('rejects duplicate SIGN from same signer', () => {
    let rep = createBlankReplica()
    const tx = createChatTx(rep.proposer, 'hi')
    rep = applyCommand(rep, { type: 'ADD_TX', addrKey: 'demo:chat', tx })
    const proposed = applyCommand(rep, { type: 'PROPOSE', addrKey: 'demo:chat', ts: 0 })
    const frameHash = proposed.proposal!.hash
    const sign: Command = { type: 'SIGN', addrKey: 'demo:chat', signer: rep.proposer, frameHash, sig: '0x1' as any }
    const r1 = applyCommand(proposed, sign)
    const r2 = applyCommand(r1, sign)
    expect(r1.proposal?.sigs.size).toBe(1)
    expect(r2.proposal?.sigs.size).toBe(1)
  })
})
