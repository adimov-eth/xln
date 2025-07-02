import type { Frame } from '../../src/types'
import { hashFrame } from '../../src/core/entity'
import { encFrame } from '../../src/codec/rlp'

export const mkFrame = (over: Partial<Frame<any>> = {}): Frame<any> => ({
  height: 0n,
  ts: 0,
  txs: [],
  state: { quorum: { threshold: 3, members: {} }, chat: [] },
  ...over,
})

export const frameHash = (f: Frame<any>) => hashFrame(f)
export const enc = (f: Frame<any>) => encFrame(f as any)
