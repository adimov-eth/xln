import type { ChatTx } from '../../src/types'

export const createChatTx = (sender: string, msg: string): ChatTx => ({
  kind: 'chat',
  nonce: 0n,
  from: sender as any,
  body: { message: msg },
  sig: '0x'
})
