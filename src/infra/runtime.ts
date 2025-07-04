import { performance } from 'node:perf_hooks'
import { applyServerFrame } from '../core/reducer'
import type { Input, ServerState } from '../core/types'

let state: ServerState = new Map()
let height = 0n

const now = () => BigInt(Math.floor(performance.now()))

export const ingest = async (batch: Input[]) => {
  height += 1n
  const { next, serverFrame } = await applyServerFrame(state, batch, now, height)
  state = next

  // ---- MVP storage / WAL stub ----
  console.info(
    `⛓️  committed serverFrame #${serverFrame.height} root=${Buffer.from(
      serverFrame.root,
    ).toString('hex').slice(0, 16)}… inputsRoot=${Buffer.from(serverFrame.inputsRoot)
      .toString('hex')
      .slice(0, 16)}…`,
  )
}