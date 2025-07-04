import { performance } from 'node:perf_hooks'
import { applyServerFrame } from '../core/reducer'
import type { Input, ServerState } from '../core/types'
let state: ServerState = new Map()
const now = () => BigInt(Math.floor(performance.now()))
export const ingest = async (batch: Input[]) => {
  const { next } = await applyServerFrame(state, batch, now)
  state = next
}
