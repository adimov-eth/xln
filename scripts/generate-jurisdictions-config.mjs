#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const deploymentsDir = path.join(root, 'jurisdictions', 'deployments');
const outputPath = path.join(root, 'jurisdictions', 'jurisdictions.json');

// Network registry: each entry maps a deployment file to its config
const networks = {
  sepolia: {
    file: 'sepolia.json',
    name: 'Sepolia',
    chainId: 11155111,
    rpcEnv: 'SEPOLIA_RPC',
    rpcDefault: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    currency: 'ETH',
  },
  'base-sepolia': {
    file: 'base-sepolia.json',
    name: 'Base Sepolia',
    chainId: 84532,
    rpcEnv: 'BASE_SEPOLIA_RPC',
    rpcDefault: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    currency: 'ETH',
  },
};

const jurisdictions = {};
let found = 0;

for (const [key, net] of Object.entries(networks)) {
  const deploymentPath = path.join(deploymentsDir, net.file);
  if (!fs.existsSync(deploymentPath)) continue;

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const rpcUrl = process.env[net.rpcEnv] || net.rpcDefault;

  jurisdictions[key] = {
    name: net.name,
    chainId: net.chainId,
    rpc: rpcUrl,
    contracts: {
      account: deployment.contracts?.account || '',
      entityProvider: deployment.contracts?.entityProvider || '',
      depository: deployment.contracts?.depository || '',
      deltaTransformer: deployment.contracts?.deltaTransformer || '',
    },
    tokens: deployment.tokens || [],
    explorer: net.explorer,
    currency: net.currency,
    status: 'active',
  };
  found++;
  console.log(`✅ Found ${key} deployment (${net.file})`);
}

if (found === 0) {
  console.error(`❌ No deployment files found in ${deploymentsDir}`);
  process.exit(1);
}

const config = {
  version: '1.0.0',
  lastUpdated: new Date().toISOString(),
  jurisdictions,
  defaults: {
    timeout: 30000,
    retryAttempts: 3,
    gasLimit: 1500000,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
console.log(`\n📁 Wrote ${outputPath} (${found} jurisdiction${found > 1 ? 's' : ''})`);
