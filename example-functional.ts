#!/usr/bin/env bun
import { ingest, createInitialContext, type Context } from './src'
import type { Input } from './src/core/types'

// Example: Using the new functional API
async function runExample() {
  // Create initial context
  let ctx: Context = createInitialContext()

  const entityId = 'test-entity'
  const snapshot = {
    height: 0n,
    quorum: {
      threshold: 1n,
      members: [{ address: '0x1111111111111111111111111111111111111111' as const, shares: 1n }],
    },
    signerRecords: {},
    domainState: { chat: [] },
    mempool: [],
  }

  // Attach replica
  const attachCmd: Input = [0, entityId, { type: 'attachReplica', snapshot }]
  const result1 = await ingest(ctx, [attachCmd])
  ctx = result1.context
  console.log('After attach:', result1.serverFrame)

  // Add transaction
  const addTxCmd: Input = [
    0,
    entityId,
    {
      type: 'addTx',
      tx: {
        kind: 'chat',
        data: { msg: 'Hello, functional XLN!' },
        nonce: 1n,
        sig: '0x1111111111111111111111111111111111111111signed',
      },
    },
  ]
  const result2 = await ingest(ctx, [addTxCmd])
  ctx = result2.context
  console.log('After addTx:', result2.serverFrame)

  // No global state mutated - everything is pure and functional!
  console.log('Final context height:', ctx.height)
}

runExample().catch(console.error)
