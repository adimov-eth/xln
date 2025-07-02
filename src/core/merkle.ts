import keccak256 from 'keccak256'
import { concat } from 'uint8arrays'
export const merkle = (leaves: Uint8Array[]): Uint8Array => {
  if (leaves.length === 1) return leaves[0]
  const next: Uint8Array[] = []
  for (let i = 0; i < leaves.length; i += 2) {
    const left = leaves[i]
    const right = i + 1 < leaves.length ? leaves[i + 1] : left
    next.push(keccak256(Buffer.from(concat([left, right]))))
  }
  return merkle(next)
}
