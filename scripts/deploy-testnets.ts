#!/usr/bin/env bun

/**
 * Real testnet deployment script for XLN
 *
 * This script actually deploys contracts to testnets, unlike the theatrical version.
 * It handles:
 * 1. Contract compilation
 * 2. Multi-chain deployment
 * 3. Contract verification on Etherscan
 * 4. Cross-chain configuration
 * 5. Initial entity setup
 */

import { ethers } from 'hardhat';
import hre from 'hardhat';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';

// Testnet configurations
const TESTNETS = {
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    explorer: 'https://sepolia.etherscan.io',
    faucet: 'https://sepoliafaucet.com'
  },
  mumbai: {
    chainId: 80001,
    name: 'Mumbai',
    explorer: 'https://mumbai.polygonscan.com',
    faucet: 'https://faucet.polygon.technology'
  },
  arbitrumSepolia: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    explorer: 'https://sepolia.arbiscan.io',
    faucet: 'https://faucet.arbitrum.io'
  },
  optimismSepolia: {
    chainId: 11155420,
    name: 'Optimism Sepolia',
    explorer: 'https://sepolia-optimism.etherscan.io',
    faucet: 'https://faucet.optimism.io'
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    explorer: 'https://sepolia.basescan.org',
    faucet: 'https://faucet.base.org'
  }
};

interface DeploymentResult {
  network: string;
  chainId: number;
  contracts: {
    Depository: string;
    EntityProvider: string;
    SubcontractProvider?: string;
  };
  deployer: string;
  blockNumber: number;
  timestamp: number;
  gasUsed: string;
  transactionHashes: string[];
}

interface CrossChainConfig {
  chainId: number;
  depositoryAddress: string;
  entityProviderAddress: string;
}

class TestnetDeployer {
  private deployments: DeploymentResult[] = [];
  private gasUsedTotal = BigInt(0);

  /**
   * Deploy to all configured testnets
   */
  async deployAll(networks: string[]): Promise<void> {
    console.log(chalk.blue('═'.repeat(60)));
    console.log(chalk.blue.bold('       XLN TESTNET DEPLOYMENT'));
    console.log(chalk.blue('═'.repeat(60)));
    console.log();

    // Compile contracts first
    await this.compileContracts();

    // Deploy to each network
    for (const network of networks) {
      if (!TESTNETS[network]) {
        console.log(chalk.yellow(`⚠️  Unknown network: ${network}, skipping...`));
        continue;
      }

      try {
        await this.deployToNetwork(network);
      } catch (error) {
        console.error(chalk.red(`❌ Failed to deploy to ${network}:`), error);
        // Continue with other networks
      }
    }

    // Configure cross-chain after all deployments
    if (this.deployments.length > 1) {
      await this.configureCrossChain();
    }

    // Save deployment artifacts
    await this.saveArtifacts();

    // Print summary
    this.printSummary();
  }

  /**
   * Compile contracts
   */
  private async compileContracts(): Promise<void> {
    console.log(chalk.cyan('📦 Compiling contracts...'));

    try {
      await hre.run('compile');
      console.log(chalk.green('✅ Contracts compiled successfully\n'));
    } catch (error) {
      throw new Error(`Compilation failed: ${error}`);
    }
  }

  /**
   * Deploy to a specific network
   */
  private async deployToNetwork(network: string): Promise<void> {
    const config = TESTNETS[network];
    console.log(chalk.cyan(`\n🚀 Deploying to ${config.name}...`));
    console.log(chalk.gray(`   Chain ID: ${config.chainId}`));
    console.log(chalk.gray(`   Explorer: ${config.explorer}`));

    // Switch to network
    await hre.changeNetwork(network);

    // Get deployer account
    const [deployer] = await ethers.getSigners();
    const balance = await deployer.provider.getBalance(deployer.address);

    console.log(chalk.gray(`   Deployer: ${deployer.address}`));
    console.log(chalk.gray(`   Balance: ${ethers.formatEther(balance)} ETH`));

    if (balance === 0n) {
      console.log(chalk.yellow(`   ⚠️  Zero balance! Get funds from: ${config.faucet}`));
      return;
    }

    const deployment: DeploymentResult = {
      network,
      chainId: config.chainId,
      contracts: {
        Depository: '',
        EntityProvider: ''
      },
      deployer: deployer.address,
      blockNumber: 0,
      timestamp: Date.now(),
      gasUsed: '0',
      transactionHashes: []
    };

    // Deploy contracts
    const startBlock = await deployer.provider.getBlockNumber();

    // 1. Deploy Depository
    console.log(chalk.gray('\n   Deploying Depository...'));
    const Depository = await ethers.getContractFactory('Depository');
    const depository = await Depository.deploy();
    await depository.waitForDeployment();
    const depositoryAddress = await depository.getAddress();
    deployment.contracts.Depository = depositoryAddress;
    deployment.transactionHashes.push(depository.deploymentTransaction()?.hash || '');
    console.log(chalk.green(`   ✓ Depository: ${depositoryAddress}`));

    // 2. Deploy EntityProvider
    console.log(chalk.gray('   Deploying EntityProvider...'));
    const EntityProvider = await ethers.getContractFactory('EntityProvider');
    const entityProvider = await EntityProvider.deploy();
    await entityProvider.waitForDeployment();
    const entityProviderAddress = await entityProvider.getAddress();
    deployment.contracts.EntityProvider = entityProviderAddress;
    deployment.transactionHashes.push(entityProvider.deploymentTransaction()?.hash || '');
    console.log(chalk.green(`   ✓ EntityProvider: ${entityProviderAddress}`));

    // 3. Deploy SubcontractProvider (optional)
    try {
      console.log(chalk.gray('   Deploying SubcontractProvider...'));
      const SubcontractProvider = await ethers.getContractFactory('SubcontractProvider');
      const subcontractProvider = await SubcontractProvider.deploy();
      await subcontractProvider.waitForDeployment();
      const subcontractAddress = await subcontractProvider.getAddress();
      deployment.contracts.SubcontractProvider = subcontractAddress;
      deployment.transactionHashes.push(subcontractProvider.deploymentTransaction()?.hash || '');
      console.log(chalk.green(`   ✓ SubcontractProvider: ${subcontractAddress}`));
    } catch (error) {
      console.log(chalk.yellow('   ⚠️  SubcontractProvider deployment skipped'));
    }

    // Initialize contracts
    console.log(chalk.gray('\n   Initializing contracts...'));

    // Set up Depository parameters
    try {
      const tx1 = await depository.setEntityProvider(entityProviderAddress);
      await tx1.wait();
      console.log(chalk.green('   ✓ Depository configured'));
    } catch (error) {
      console.log(chalk.yellow('   ⚠️  Depository initialization failed'));
    }

    // Calculate gas used
    const endBlock = await deployer.provider.getBlockNumber();
    deployment.blockNumber = endBlock;

    let totalGas = BigInt(0);
    for (let i = startBlock + 1; i <= endBlock; i++) {
      const block = await deployer.provider.getBlock(i);
      if (block) {
        totalGas += block.gasUsed;
      }
    }
    deployment.gasUsed = totalGas.toString();
    this.gasUsedTotal += totalGas;

    // Verify contracts on Etherscan
    if (process.env.VERIFY_CONTRACTS === 'true') {
      await this.verifyContracts(network, deployment);
    }

    this.deployments.push(deployment);
    console.log(chalk.green(`\n✅ Deployment to ${config.name} complete!\n`));
  }

  /**
   * Verify contracts on Etherscan
   */
  private async verifyContracts(network: string, deployment: DeploymentResult): Promise<void> {
    console.log(chalk.gray('\n   Verifying contracts on Etherscan...'));

    for (const [name, address] of Object.entries(deployment.contracts)) {
      if (!address) continue;

      try {
        await hre.run('verify:verify', {
          address,
          constructorArguments: [],
          network
        });
        console.log(chalk.green(`   ✓ ${name} verified`));
      } catch (error: any) {
        if (error.message.includes('Already Verified')) {
          console.log(chalk.gray(`   - ${name} already verified`));
        } else {
          console.log(chalk.yellow(`   ⚠️  ${name} verification failed`));
        }
      }
    }
  }

  /**
   * Configure cross-chain connections
   */
  private async configureCrossChain(): Promise<void> {
    console.log(chalk.cyan('\n🔗 Configuring cross-chain connections...'));

    const configs: CrossChainConfig[] = this.deployments.map(d => ({
      chainId: d.chainId,
      depositoryAddress: d.contracts.Depository,
      entityProviderAddress: d.contracts.EntityProvider
    }));

    for (const deployment of this.deployments) {
      console.log(chalk.gray(`\n   Configuring ${deployment.network}...`));

      try {
        await hre.changeNetwork(deployment.network);
        const [deployer] = await ethers.getSigners();

        // Get contract instances
        const depository = await ethers.getContractAt(
          'Depository',
          deployment.contracts.Depository,
          deployer
        );

        // Configure peer chains
        for (const config of configs) {
          if (config.chainId === deployment.chainId) continue;

          try {
            const tx = await depository.addPeerChain(
              config.chainId,
              config.depositoryAddress,
              config.entityProviderAddress
            );
            await tx.wait();
            console.log(chalk.green(`   ✓ Added peer chain ${config.chainId}`));
          } catch (error) {
            console.log(chalk.yellow(`   ⚠️  Failed to add peer chain ${config.chainId}`));
          }
        }
      } catch (error) {
        console.log(chalk.yellow(`   ⚠️  Cross-chain config failed for ${deployment.network}`));
      }
    }

    console.log(chalk.green('\n✅ Cross-chain configuration complete'));
  }

  /**
   * Save deployment artifacts
   */
  private async saveArtifacts(): Promise<void> {
    const artifacts = {
      timestamp: new Date().toISOString(),
      deployments: this.deployments,
      totalGasUsed: this.gasUsedTotal.toString(),
      crossChainConfig: this.deployments.map(d => ({
        chainId: d.chainId,
        network: d.network,
        depository: d.contracts.Depository,
        entityProvider: d.contracts.EntityProvider
      }))
    };

    const filename = `deployments/testnet-${Date.now()}.json`;
    await fs.mkdir('deployments', { recursive: true });
    await fs.writeFile(filename, JSON.stringify(artifacts, null, 2));

    console.log(chalk.gray(`\n📄 Artifacts saved to ${filename}`));

    // Also save a "latest" file for easy reference
    await fs.writeFile('deployments/testnet-latest.json', JSON.stringify(artifacts, null, 2));
  }

  /**
   * Print deployment summary
   */
  private printSummary(): void {
    console.log(chalk.blue('\n' + '═'.repeat(60)));
    console.log(chalk.blue.bold('              DEPLOYMENT SUMMARY'));
    console.log(chalk.blue('═'.repeat(60)));

    for (const deployment of this.deployments) {
      const config = TESTNETS[deployment.network];
      console.log(chalk.white(`\n${config.name}:`));
      console.log(chalk.gray(`  Chain ID: ${deployment.chainId}`));
      console.log(chalk.gray(`  Deployer: ${deployment.deployer}`));
      console.log(chalk.gray(`  Contracts:`));
      for (const [name, address] of Object.entries(deployment.contracts)) {
        if (address) {
          console.log(chalk.cyan(`    ${name}: ${address}`));
        }
      }
      console.log(chalk.gray(`  Gas Used: ${deployment.gasUsed}`));
      console.log(chalk.gray(`  Explorer: ${config.explorer}/address/${deployment.contracts.Depository}`));
    }

    console.log(chalk.white(`\n📊 Total Gas Used: ${this.gasUsedTotal}`));
    console.log(chalk.white(`💾 Total Deployments: ${this.deployments.length}`));

    if (this.deployments.length > 0) {
      console.log(chalk.green('\n🎉 XLN is now live on testnets!'));
      console.log(chalk.gray('\nNext steps:'));
      console.log(chalk.gray('  1. Fund validator addresses'));
      console.log(chalk.gray('  2. Register initial entities'));
      console.log(chalk.gray('  3. Deploy validator nodes'));
      console.log(chalk.gray('  4. Test cross-chain transfers'));
    }
  }
}

/**
 * Main execution
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let networks = args.filter(arg => !arg.startsWith('--'));

  // If no networks specified, deploy to all
  if (networks.length === 0) {
    networks = ['sepolia', 'mumbai', 'arbitrumSepolia', 'optimismSepolia', 'baseSepolia'];
  }

  // Check for environment variables
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error(chalk.red('❌ DEPLOYER_PRIVATE_KEY not set in .env file'));
    console.log(chalk.yellow('\nCreate a .env file with:'));
    console.log(chalk.gray('DEPLOYER_PRIVATE_KEY=your_private_key_here'));
    console.log(chalk.gray('SEPOLIA_RPC_URL=https://rpc.sepolia.org'));
    console.log(chalk.gray('MUMBAI_RPC_URL=https://rpc-mumbai.maticvigil.com'));
    console.log(chalk.gray('ETHERSCAN_API_KEY=your_etherscan_api_key'));
    console.log(chalk.gray('VERIFY_CONTRACTS=true'));
    process.exit(1);
  }

  const deployer = new TestnetDeployer();
  await deployer.deployAll(networks);
}

// Execute if run directly
if (import.meta.main) {
  main().catch(error => {
    console.error(chalk.red('Deployment failed:'), error);
    process.exit(1);
  });
}