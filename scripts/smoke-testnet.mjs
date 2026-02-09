#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const root = process.cwd();
const deploymentPath = path.join(root, 'jurisdictions', 'deployments', 'base-sepolia.json');
const serverUrl = process.env.XLN_SERVER_URL || 'http://127.0.0.1:8080';
const rpcUrl = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';

if (!fs.existsSync(deploymentPath)) {
  console.error(`❌ Missing deployment file: ${deploymentPath}`);
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const depository = deployment.contracts?.depository;
const entityProvider = deployment.contracts?.entityProvider;
if (!depository || !entityProvider) {
  console.error('❌ Deployment file missing depository/entityProvider addresses');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(rpcUrl, 84532);
const depCode = await provider.getCode(depository);
const epCode = await provider.getCode(entityProvider);
if (depCode === '0x' || epCode === '0x') {
  console.error('❌ Contract code not found on Base Sepolia');
  process.exit(1);
}
console.log(`✅ On-chain code present: Depository ${depository}, EntityProvider ${entityProvider}`);

const health = await fetch(`${serverUrl}/api/health`).catch(() => null);
if (!health || !health.ok) {
  console.error(`❌ Health check failed at ${serverUrl}/api/health`);
  process.exit(1);
}
console.log(`✅ API health reachable at ${serverUrl}/api/health`);

const tokens = await fetch(`${serverUrl}/api/tokens`).catch(() => null);
if (!tokens || !tokens.ok) {
  console.error(`❌ Token endpoint failed at ${serverUrl}/api/tokens`);
  process.exit(1);
}
console.log(`✅ API tokens reachable at ${serverUrl}/api/tokens`);

const abi = [
  'function processBatch(bytes encodedBatch,address entityProvider,bytes hankoData,uint256 nonce) external returns (bool)'
];
const dep = new ethers.Contract(depository, abi, provider);
if (!dep.interface.getFunction('processBatch')) {
  console.error('❌ processBatch ABI unavailable');
  process.exit(1);
}
console.log('✅ processBatch ABI present');

if (process.env.SMOKE_HANKO_SIGNER_KEY && process.env.SMOKE_HANKO_ENCODED_BATCH && process.env.SMOKE_HANKO_DATA && process.env.SMOKE_HANKO_NONCE) {
  const wallet = new ethers.Wallet(process.env.SMOKE_HANKO_SIGNER_KEY, provider);
  const depWrite = dep.connect(wallet);
  const tx = await depWrite.processBatch(
    process.env.SMOKE_HANKO_ENCODED_BATCH,
    entityProvider,
    process.env.SMOKE_HANKO_DATA,
    BigInt(process.env.SMOKE_HANKO_NONCE)
  );
  await tx.wait();
  console.log(`✅ Hanko processBatch smoke tx mined: ${tx.hash}`);
} else {
  console.log('ℹ️ Hanko transaction smoke skipped (set SMOKE_HANKO_* env vars to enable)');
}
