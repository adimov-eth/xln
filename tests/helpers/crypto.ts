import { bls12_381 as bls } from '@noble/curves/bls12-381'

export const signerKeyPair = () => {
  const priv = bls.utils.randomPrivateKey()
  return { priv, pub: bls.getPublicKey(priv) }
}

export const aggregateSigs = (msgHash: string, signers: string[]) => {
  return signers.map((s, i) => ({ signer: s, sig: `0x${i}` }))
}
