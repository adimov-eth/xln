import { ethers } from 'ethers';

// EIP-712 typed data helpers for EntityProvider actions

export const EIP712_DOMAIN = (chainId: number, verifyingContract: string) => ({
  name: 'XLN EntityProvider',
  version: '1',
  chainId,
  verifyingContract,
});

export const EIP712_TYPES = {
  EntityAction: [
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'actionHash', type: 'bytes32' },
  ],
} as const;

export type EntityAction = {
  nonce: bigint;
  deadline: bigint;
  actionHash: string; // 0x…32
};

export const buildEntityAction = (nonce: bigint, deadline: bigint, actionHash: string): EntityAction => ({
  nonce,
  deadline,
  actionHash,
});

export const signEntityAction = async (
  signer: ethers.Signer,
  verifyingContract: string,
  nonce: bigint,
  deadline: bigint,
  actionHash: string,
): Promise<string> => {
  const chainId = await signer.provider!.getNetwork().then((n) => Number(n.chainId));
  const domain = EIP712_DOMAIN(chainId, verifyingContract);
  const value = buildEntityAction(nonce, deadline, actionHash);
  // ethers v6: signTypedData(domain, types, value)
  // @ts-ignore - Signer interface in ethers v6 supports signTypedData at runtime
  return await (signer as any).signTypedData(domain, EIP712_TYPES, value);
};

// Convenience builders for action hashes used by the contract
export const buildTransferActionHash = (
  entityNumber: bigint,
  to: string,
  tokenId: bigint,
  amount: bigint,
): string => {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'uint256', 'address', 'uint256', 'uint256'],
      ['ENTITY_TRANSFER', entityNumber, to, tokenId, amount],
    ),
  );
};

export const buildReleaseActionHash = (
  entityNumber: bigint,
  depository: string,
  controlAmount: bigint,
  dividendAmount: bigint,
  purpose: string,
): string => {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'uint256', 'address', 'uint256', 'uint256', 'bytes32'],
      ['RELEASE_CONTROL_SHARES', entityNumber, depository, controlAmount, dividendAmount, ethers.id(purpose)],
    ),
  );
};

