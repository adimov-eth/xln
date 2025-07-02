import { applyServerFrame } from '../core/reducer'
import { Input, ServerState } from '../core/types'
import { performance } from 'node:perf_hooks'
let state: ServerState = new Map()
const now = () => BigInt(Math.floor(performance.now()))
export const ingest = async (batch: Input[]) => {
  const { next } = await applyServerFrame(state, batch, now)
  state = next
}
