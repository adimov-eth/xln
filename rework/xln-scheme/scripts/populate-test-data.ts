#!/usr/bin/env bun

/**
 * Populate deployed contracts with test data
 * Run with: bun run scripts/populate-test-data.ts
 */

import { ethers } from 'ethers';

// Connect to Hardhat network
const provider = new ethers.JsonRpcProvider('http://localhost:8545');

// Contract addresses from deployment (Hardhat Ignition)
const ENTITY_PROVIDER = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const DEPOSITORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

// Hardhat default accounts
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// ABI snippets (minimal for the methods we need)
const ENTITY_PROVIDER_ABI = [
  'function registerNumberedEntity(bytes32 boardHash) external returns (uint256)',
  'function getEntityInfo(bytes32 entityId) external view returns (uint256 number, bytes32 id, bool exists)',
];

const DEPOSITORY_ABI = [
  'function debugFundReserves(uint256 entity, uint256 token, uint256 amount) external',
  'function _reserves(uint256, uint256) external view returns (uint256)',
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Populating Test Data on Hardhat Network');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Create signer
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  console.log(`[OK] Connected with account: ${wallet.address}`);

  // Get contract instances
  const entityProvider = new ethers.Contract(ENTITY_PROVIDER, ENTITY_PROVIDER_ABI, wallet);
  const depository = new ethers.Contract(DEPOSITORY, DEPOSITORY_ABI, wallet);

  console.log(`[OK] EntityProvider at: ${ENTITY_PROVIDER}`);
  console.log(`[OK] Depository at: ${DEPOSITORY}\n`);

  // Register test entities
  console.log('=== Step 1: Register Test Entities ===');

  const boardHashes = [
    ethers.zeroPadValue('0x2a', 32), // Simple test hash (42)
    ethers.zeroPadValue('0x45', 32), // Another test hash (69)
    ethers.zeroPadValue('0xaa', 32), // Third test hash (170)
  ];

  const entityNumbers = [];

  for (let i = 0; i < boardHashes.length; i++) {
    const boardHash = boardHashes[i];
    console.log(`[FIND] Registering entity ${i + 1}...`);

    // Get fresh nonce to avoid conflicts
    const nonce = await provider.getTransactionCount(wallet.address, 'latest');
    const tx = await entityProvider.registerNumberedEntity(boardHash, { nonce });
    const receipt = await tx.wait();

    // Get entity number from logs
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = entityProvider.interface.parseLog(log);
        return parsed?.name === 'EntityRegistered';
      } catch {
        return false;
      }
    });

    let entityNumber;
    if (event) {
      const parsed = entityProvider.interface.parseLog(event);
      entityNumber = parsed?.args?.number || (i + 1);
    } else {
      entityNumber = i + 1; // Fallback
    }

    entityNumbers.push(entityNumber);
    console.log(`[OK] Entity ${i + 1} registered with number: ${entityNumber}`);
  }

  console.log('');

  // Fund reserves
  console.log('=== Step 2: Fund Reserves ===');

  const fundingPlan = [
    { entity: 1, token: 1, amount: ethers.parseEther('1000') },
    { entity: 1, token: 2, amount: ethers.parseEther('500') },
    { entity: 2, token: 1, amount: ethers.parseEther('2000') },
    { entity: 2, token: 2, amount: ethers.parseEther('750') },
    { entity: 3, token: 1, amount: ethers.parseEther('1500') },
  ];

  for (const { entity, token, amount } of fundingPlan) {
    console.log(`[FIND] Funding entity ${entity}, token ${token} with ${ethers.formatEther(amount)} units...`);

    const nonce = await provider.getTransactionCount(wallet.address, 'latest');
    const tx = await depository.debugFundReserves(entity, token, amount, { nonce });
    await tx.wait();

    console.log(`[OK] Funded successfully`);
  }

  console.log('');

  // Verify reserves
  console.log('=== Step 3: Verify Reserves ===');

  for (const { entity, token, amount } of fundingPlan) {
    const reserve = await depository._reserves(entity, token);
    console.log(`[OK] Entity ${entity}, Token ${token}: ${ethers.formatEther(reserve)} units`);
  }

  console.log('');
  console.log('[OK] Test data populated successfully!');
  console.log('');
  console.log('=== Ready for Racket RPC Testing ===');
  console.log('You can now run examples/simple-query-demo.rkt to verify queries work');
  console.log('');
  console.log('λ.');
}

main().catch((error) => {
  console.error('[X] Error:', error);
  process.exit(1);
});
