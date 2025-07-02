import { applyServerFrame } from '../core/reducer'
import { Input, ServerState } from '../core/types'
import { performance } from 'node:perf_hooks'
let state: ServerState = new Map()
const now = () => BigInt(Math.floor(performance.now()))
export const ingest = (batch: Input[]) => {
  const { next } = applyServerFrame(state, batch, now)
  state = next
}
