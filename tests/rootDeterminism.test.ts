import { test } from 'bun:test'
import fc from 'fast-check'
import { encodeRlp } from '../src/core/encodeRlp'
import keccak256 from 'keccak256'
test('rlp stable hash', () =>
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.bigInt()), (dict) => {
      const a = encodeRlp(dict)
      const b = encodeRlp(Object.fromEntries(Object.entries(dict).reverse()))
      return keccak256(Buffer.from(a)).toString('hex') === keccak256(Buffer.from(b)).toString('hex')
    }),
  ))
