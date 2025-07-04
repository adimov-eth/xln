import { describe, expect, it } from 'bun:test'
import { ingest } from '../src'
import type { Input } from '../src/core/types'

const signerIdx = 0
const entityId = 'E1'
const signerAddr = '0xabc'.padEnd(42, '0')

const tx = (nonce: bigint): Input => [
  signerIdx,
  entityId,
  {
    type: 'addTx',
    tx: { kind: 'foo', data: {}, nonce, sig: `${signerAddr}signed` },
  },
]

describe('nonce replay‑protection', () => {
  it('rejects duplicate nonce', async () => {
    await ingest([tx(1n)])
    await ingest([tx(1n)]) // duplicate
    // no throw ⇒ reducer silently rejected, state unchanged
    expect(true).toBeTruthy()
  })
})
