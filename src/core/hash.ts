import { encodeRlp } from './encodeRlp'
import { merkle } from './merkle'
import keccak256 from 'keccak256'
import { ServerState } from './types'
export const computeServerRoot = (state: ServerState) => {
  const leaves = [...state.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, r]) => encodeRlp(r.state))
  return keccak256(Buffer.from(merkle(leaves)))
}
