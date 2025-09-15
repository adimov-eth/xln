#!/usr/bin/env bun

/**
 * Mock deployment script to test deployment infrastructure
 * without spending real gas on testnets
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';

async function mockDeploy() {
  console.log(chalk.blue('═'.repeat(60)));
  console.log(chalk.blue.bold('       XLN MOCK DEPLOYMENT (Testing)'));
  console.log(chalk.blue('═'.repeat(60)));
  console.log();

  const deployments = [];

  // Simulate deployment to multiple networks
  const networks = ['sepolia', 'mumbai', 'arbitrumSepolia'];

  for (const network of networks) {
    console.log(chalk.cyan(`\n🚀 Mock deploying to ${network}...`));

    // Simulate compilation
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(chalk.gray('   Compiling contracts...'));

    // Simulate deployment
    await new Promise(resolve => setTimeout(resolve, 1000));

    const deployment = {
      network,
      chainId: network === 'sepolia' ? 11155111 :
                network === 'mumbai' ? 80001 : 421614,
      contracts: {
        Depository: '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0'),
        EntityProvider: '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0'),
        SubcontractProvider: '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0')
      },
      deployer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
      blockNumber: Math.floor(Math.random() * 1000000),
      timestamp: Date.now(),
      gasUsed: (Math.random() * 1000000).toFixed(0),
      transactionHashes: [
        '0x' + Math.random().toString(16).slice(2, 66),
        '0x' + Math.random().toString(16).slice(2, 66),
        '0x' + Math.random().toString(16).slice(2, 66)
      ]
    };

    console.log(chalk.green(`   ✓ Depository: ${deployment.contracts.Depository}`));
    console.log(chalk.green(`   ✓ EntityProvider: ${deployment.contracts.EntityProvider}`));
    console.log(chalk.green(`   ✓ SubcontractProvider: ${deployment.contracts.SubcontractProvider}`));

    deployments.push(deployment);
  }

  // Save mock artifacts
  const artifacts = {
    timestamp: new Date().toISOString(),
    environment: 'mock',
    deployments,
    crossChainConfig: deployments.map(d => ({
      chainId: d.chainId,
      network: d.network,
      depository: d.contracts.Depository,
      entityProvider: d.contracts.EntityProvider
    }))
  };

  await fs.mkdir('deployments', { recursive: true });
  await fs.writeFile(
    'deployments/mock-latest.json',
    JSON.stringify(artifacts, null, 2)
  );

  console.log(chalk.blue('\n' + '═'.repeat(60)));
  console.log(chalk.blue.bold('           MOCK DEPLOYMENT SUMMARY'));
  console.log(chalk.blue('═'.repeat(60)));

  for (const deployment of deployments) {
    console.log(chalk.white(`\n${deployment.network}:`));
    console.log(chalk.gray(`  Chain ID: ${deployment.chainId}`));
    console.log(chalk.gray(`  Block: ${deployment.blockNumber}`));
    console.log(chalk.gray(`  Gas Used: ${deployment.gasUsed}`));
  }

  console.log(chalk.green('\n✅ Mock deployment complete!'));
  console.log(chalk.gray('\nArtifacts saved to deployments/mock-latest.json'));
  console.log(chalk.yellow('\n⚠️  This was a mock deployment for testing'));
  console.log(chalk.yellow('To deploy to real testnets, run: bun run scripts/deploy-testnets.ts'));
}

mockDeploy().catch(console.error);