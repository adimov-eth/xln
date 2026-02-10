#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

/**
 * Smoke test a testnet deployment.
 *
 * Usage:
 *   node scripts/smoke-testnet.mjs                    # auto-detect from jurisdictions/deployments/
 *   node scripts/smoke-testnet.mjs --network sepolia
 *   node scripts/smoke-testnet.mjs --network base-sepolia
 */

const root = process.cwd();
const args = process.argv.slice(2);
const networkFlag = args.indexOf('--network');
let networkName = networkFlag >= 0 ? args[networkFlag + 1] : null;

// Auto-detect: prefer sepolia, then base-sepolia
if (!networkName) {
  for (const name of ['sepolia', 'base-sepolia']) {
    if (fs.existsSync(path.join(root, 'jurisdictions', 'deployments', `${name}.json`))) {
      networkName = name;
      break;
    }
  }
}

if (!networkName) {
  console.error('❌ No deployment found. Run deploy-direct.cjs first.');
  process.exit(1);
}

const RPCS = {
  sepolia: process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
  'base-sepolia': process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
};
const CHAIN_IDS = { sepolia: 11155111, 'base-sepolia': 84532 };

const deploymentPath = path.join(root, 'jurisdictions', 'deployments', `${networkName}.json`);
if (!fs.existsSync(deploymentPath)) {
  console.error(`❌ Missing deployment file: ${deploymentPath}`);
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const depository = deployment.contracts?.depository;
const entityProvider = deployment.contracts?.entityProvider;
const deltaTransformer = deployment.contracts?.deltaTransformer;
const account = deployment.contracts?.account;

if (!depository || !entityProvider) {
  console.error('❌ Deployment file missing depository/entityProvider addresses');
  process.exit(1);
}

console.log(`\n🔍 Smoke testing ${networkName} deployment\n`);

const rpcUrl = RPCS[networkName];
const chainId = CHAIN_IDS[networkName];
const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);

// 1. Check contract code exists on-chain
let failed = false;
for (const [name, addr] of [
  ['Depository', depository],
  ['EntityProvider', entityProvider],
  ['Account', account],
  ['DeltaTransformer', deltaTransformer],
]) {
  if (!addr) {
    console.log(`⚠️  ${name}: not in deployment`);
    continue;
  }
  const code = await provider.getCode(addr);
  if (code === '0x') {
    console.error(`❌ ${name} (${addr}): no code on-chain`);
    failed = true;
  } else {
    console.log(`✅ ${name}: ${addr} (${Math.floor(code.length / 2)} bytes)`);
  }
}

// 2. Verify Depository has processBatch
const abi = [
  'function processBatch(bytes encodedBatch,address entityProvider,bytes hankoData,uint256 nonce) external returns (bool)',
  'function tokenToId(bytes32) view returns (uint256)',
];
const dep = new ethers.Contract(depository, abi, provider);
if (!dep.interface.getFunction('processBatch')) {
  console.error('❌ processBatch ABI unavailable');
  failed = true;
} else {
  console.log('✅ processBatch ABI present');
}

// 3. Check registered tokens
if (deployment.tokens?.length > 0) {
  console.log(`\n🪙  Tokens (${deployment.tokens.length}):`);
  for (const tok of deployment.tokens) {
    const code = await provider.getCode(tok.address);
    const status = code !== '0x' ? '✅' : '❌';
    console.log(`   ${status} ${tok.symbol} (id=${tok.tokenId}): ${tok.address}`);
    if (code === '0x') failed = true;
  }
}

// 4. Optional: health check against running server
const serverUrl = process.env.XLN_SERVER_URL || 'http://127.0.0.1:8080';
const health = await fetch(`${serverUrl}/api/health`).catch(() => null);
if (health?.ok) {
  console.log(`\n✅ API health reachable at ${serverUrl}/api/health`);
} else {
  console.log(`\nℹ️  Server not reachable at ${serverUrl} (OK if not running yet)`);
}

if (failed) {
  console.error('\n❌ Smoke test FAILED');
  process.exit(1);
} else {
  console.log('\n🎯 Smoke test PASSED\n');
}
