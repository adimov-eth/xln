#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const deploymentPath = path.join(root, 'jurisdictions', 'deployments', 'base-sepolia.json');
const outputPath = path.join(root, 'jurisdictions', 'jurisdictions.json');

if (!fs.existsSync(deploymentPath)) {
  console.error(`❌ Missing deployment file: ${deploymentPath}`);
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const rpcUrl = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';

const config = {
  version: '1.0.0',
  lastUpdated: new Date().toISOString(),
  jurisdictions: {
    'base-sepolia': {
      name: 'Base Sepolia',
      chainId: 84532,
      rpc: rpcUrl,
      contracts: {
        token: deployment.contracts?.token || '',
        account: deployment.contracts?.account || '',
        entityProvider: deployment.contracts?.entityProvider || '',
        depository: deployment.contracts?.depository || '',
        deltaTransformer: deployment.contracts?.deltaTransformer || '',
      },
      explorer: 'https://sepolia.basescan.org',
      currency: 'ETH',
      status: 'active',
    },
  },
  defaults: {
    timeout: 30000,
    retryAttempts: 3,
    gasLimit: 1500000,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
console.log(`✅ Wrote ${outputPath}`);
