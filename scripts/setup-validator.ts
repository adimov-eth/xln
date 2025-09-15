#!/usr/bin/env bun

/**
 * Validator node setup script for XLN
 *
 * This script sets up a validator node with:
 * 1. Key generation/import
 * 2. Stake management
 * 3. P2P networking
 * 4. Consensus participation
 * 5. Monitoring integration
 */

import { ethers } from 'ethers';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import { program } from 'commander';
import inquirer from 'inquirer';

interface ValidatorConfig {
  id: string;
  address: string;
  privateKey: string;
  stake: bigint;
  host: string;
  port: number;
  p2pPort: number;
  chains: ChainConfig[];
  peers: string[];
  monitoring: {
    enabled: boolean;
    prometheusPort: number;
  };
}

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  depositoryAddress: string;
  entityProviderAddress: string;
}

class ValidatorSetup {
  private config: ValidatorConfig;

  constructor() {
    this.config = {
      id: '',
      address: '',
      privateKey: '',
      stake: 0n,
      host: 'localhost',
      port: 8545,
      p2pPort: 30303,
      chains: [],
      peers: [],
      monitoring: {
        enabled: true,
        prometheusPort: 9090
      }
    };
  }

  /**
   * Interactive setup wizard
   */
  async runSetupWizard(): Promise<void> {
    console.log(chalk.blue('═'.repeat(60)));
    console.log(chalk.blue.bold('       XLN VALIDATOR SETUP WIZARD'));
    console.log(chalk.blue('═'.repeat(60)));
    console.log();

    // Step 1: Validator identity
    await this.setupIdentity();

    // Step 2: Network configuration
    await this.setupNetwork();

    // Step 3: Chain configuration
    await this.setupChains();

    // Step 4: Stake configuration
    await this.setupStake();

    // Step 5: Monitoring
    await this.setupMonitoring();

    // Step 6: Generate configuration files
    await this.generateConfigs();

    // Step 7: Install systemd service
    await this.installService();

    // Step 8: Final verification
    await this.verify();

    console.log(chalk.green('\n✅ Validator setup complete!'));
    this.printSummary();
  }

  /**
   * Setup validator identity
   */
  private async setupIdentity(): Promise<void> {
    console.log(chalk.cyan('\n📝 Validator Identity'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'id',
        message: 'Validator ID:',
        default: `validator-${Date.now()}`,
        validate: (input) => input.length > 0
      },
      {
        type: 'list',
        name: 'keyOption',
        message: 'Private key:',
        choices: [
          'Generate new key',
          'Import existing key',
          'Use hardware wallet'
        ]
      }
    ]);

    this.config.id = answers.id;

    if (answers.keyOption === 'Generate new key') {
      const wallet = ethers.Wallet.createRandom();
      this.config.privateKey = wallet.privateKey;
      this.config.address = wallet.address;

      console.log(chalk.yellow('\n⚠️  IMPORTANT: Save this private key securely!'));
      console.log(chalk.red(`Private Key: ${wallet.privateKey}`));
      console.log(chalk.green(`Address: ${wallet.address}`));

      const saveKey = await inquirer.prompt({
        type: 'confirm',
        name: 'save',
        message: 'Save key to encrypted keystore?',
        default: true
      });

      if (saveKey.save) {
        await this.saveKeystore(wallet);
      }
    } else if (answers.keyOption === 'Import existing key') {
      const keyAnswer = await inquirer.prompt({
        type: 'password',
        name: 'privateKey',
        message: 'Enter private key:',
        validate: (input) => {
          try {
            new ethers.Wallet(input);
            return true;
          } catch {
            return 'Invalid private key';
          }
        }
      });

      const wallet = new ethers.Wallet(keyAnswer.privateKey);
      this.config.privateKey = wallet.privateKey;
      this.config.address = wallet.address;

      console.log(chalk.green(`✓ Imported address: ${wallet.address}`));
    } else {
      // Hardware wallet support would go here
      console.log(chalk.yellow('Hardware wallet support coming soon'));
      process.exit(0);
    }
  }

  /**
   * Setup network configuration
   */
  private async setupNetwork(): Promise<void> {
    console.log(chalk.cyan('\n🌐 Network Configuration'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'Validator host/IP:',
        default: this.config.host
      },
      {
        type: 'number',
        name: 'port',
        message: 'RPC port:',
        default: this.config.port,
        validate: (input) => input > 0 && input < 65536
      },
      {
        type: 'number',
        name: 'p2pPort',
        message: 'P2P port:',
        default: this.config.p2pPort,
        validate: (input) => input > 0 && input < 65536
      },
      {
        type: 'input',
        name: 'peers',
        message: 'Bootstrap peers (comma-separated):',
        default: 'validator1.xln.network:30303,validator2.xln.network:30303'
      }
    ]);

    this.config.host = answers.host;
    this.config.port = answers.port;
    this.config.p2pPort = answers.p2pPort;
    this.config.peers = answers.peers.split(',').map(p => p.trim()).filter(p => p);
  }

  /**
   * Setup chain configurations
   */
  private async setupChains(): Promise<void> {
    console.log(chalk.cyan('\n⛓️  Chain Configuration'));

    // Load existing deployments if available
    let deployments: any = {};
    try {
      const data = await fs.readFile('deployments/testnet-latest.json', 'utf-8');
      deployments = JSON.parse(data);
    } catch {
      console.log(chalk.yellow('No existing deployments found'));
    }

    const chainChoices = [
      { name: 'Sepolia', value: 'sepolia', chainId: 11155111 },
      { name: 'Mumbai', value: 'mumbai', chainId: 80001 },
      { name: 'Arbitrum Sepolia', value: 'arbitrumSepolia', chainId: 421614 },
      { name: 'Optimism Sepolia', value: 'optimismSepolia', chainId: 11155420 },
      { name: 'Base Sepolia', value: 'baseSepolia', chainId: 84532 }
    ];

    const answers = await inquirer.prompt({
      type: 'checkbox',
      name: 'chains',
      message: 'Select chains to validate:',
      choices: chainChoices,
      validate: (input) => input.length > 0 || 'Select at least one chain'
    });

    for (const chainName of answers.chains) {
      const chainInfo = chainChoices.find(c => c.value === chainName)!;
      const deployment = deployments.deployments?.find((d: any) => d.network === chainName);

      if (deployment) {
        // Use existing deployment
        this.config.chains.push({
          chainId: chainInfo.chainId,
          name: chainInfo.name,
          rpcUrl: process.env[`${chainName.toUpperCase()}_RPC_URL`] || '',
          depositoryAddress: deployment.contracts.Depository,
          entityProviderAddress: deployment.contracts.EntityProvider
        });
      } else {
        // Manual configuration
        const chainAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'rpcUrl',
            message: `${chainInfo.name} RPC URL:`,
            default: `https://rpc.${chainName}.org`
          },
          {
            type: 'input',
            name: 'depositoryAddress',
            message: `${chainInfo.name} Depository address:`,
            validate: (input) => ethers.isAddress(input) || 'Invalid address'
          },
          {
            type: 'input',
            name: 'entityProviderAddress',
            message: `${chainInfo.name} EntityProvider address:`,
            validate: (input) => ethers.isAddress(input) || 'Invalid address'
          }
        ]);

        this.config.chains.push({
          chainId: chainInfo.chainId,
          name: chainInfo.name,
          ...chainAnswers
        });
      }
    }
  }

  /**
   * Setup stake configuration
   */
  private async setupStake(): Promise<void> {
    console.log(chalk.cyan('\n💰 Stake Configuration'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'stake',
        message: 'Stake amount (in ETH):',
        default: '32',
        validate: (input) => {
          const value = parseFloat(input);
          return value > 0 || 'Stake must be positive';
        }
      },
      {
        type: 'confirm',
        name: 'autoStake',
        message: 'Auto-stake on startup?',
        default: true
      }
    ]);

    this.config.stake = ethers.parseEther(answers.stake);

    // Check balance on each chain
    console.log(chalk.gray('\nChecking balances...'));
    for (const chain of this.config.chains) {
      try {
        const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
        const balance = await provider.getBalance(this.config.address);
        const formatted = ethers.formatEther(balance);

        if (balance < this.config.stake) {
          console.log(chalk.yellow(`  ${chain.name}: ${formatted} ETH (insufficient)`));
        } else {
          console.log(chalk.green(`  ${chain.name}: ${formatted} ETH`));
        }
      } catch {
        console.log(chalk.red(`  ${chain.name}: Connection failed`));
      }
    }
  }

  /**
   * Setup monitoring
   */
  private async setupMonitoring(): Promise<void> {
    console.log(chalk.cyan('\n📊 Monitoring Configuration'));

    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enabled',
        message: 'Enable Prometheus metrics?',
        default: true
      },
      {
        type: 'number',
        name: 'port',
        message: 'Metrics port:',
        default: 9090,
        when: (answers) => answers.enabled,
        validate: (input) => input > 0 && input < 65536
      }
    ]);

    this.config.monitoring.enabled = answers.enabled;
    if (answers.enabled) {
      this.config.monitoring.prometheusPort = answers.port;
    }
  }

  /**
   * Generate configuration files
   */
  private async generateConfigs(): Promise<void> {
    console.log(chalk.cyan('\n📁 Generating configuration files...'));

    // Create validator directory
    const validatorDir = `validators/${this.config.id}`;
    await fs.mkdir(validatorDir, { recursive: true });

    // Generate main config
    const mainConfig = {
      id: this.config.id,
      address: this.config.address,
      host: this.config.host,
      port: this.config.port,
      p2pPort: this.config.p2pPort,
      chains: this.config.chains,
      peers: this.config.peers,
      stake: this.config.stake.toString(),
      monitoring: this.config.monitoring
    };

    await fs.writeFile(
      `${validatorDir}/config.json`,
      JSON.stringify(mainConfig, null, 2)
    );
    console.log(chalk.green(`  ✓ Created ${validatorDir}/config.json`));

    // Generate start script
    const startScript = `#!/bin/bash
# XLN Validator Start Script
# Generated: ${new Date().toISOString()}

set -e

# Load environment
export VALIDATOR_ID="${this.config.id}"
export VALIDATOR_CONFIG="./config.json"
export NODE_ENV="production"

# Start validator
echo "Starting XLN Validator ${this.config.id}..."
bun run ../../src/consensus/ValidatorNode.ts

# Keep running
while true; do
  sleep 10
done
`;

    await fs.writeFile(`${validatorDir}/start.sh`, startScript);
    await fs.chmod(`${validatorDir}/start.sh`, 0o755);
    console.log(chalk.green(`  ✓ Created ${validatorDir}/start.sh`));

    // Generate docker-compose.yml
    const dockerCompose = `version: '3.8'

services:
  validator:
    image: xln/validator:latest
    container_name: xln-${this.config.id}
    restart: unless-stopped
    ports:
      - "${this.config.port}:${this.config.port}"
      - "${this.config.p2pPort}:${this.config.p2pPort}"
      - "${this.config.monitoring.prometheusPort}:${this.config.monitoring.prometheusPort}"
    volumes:
      - ./config.json:/app/config.json:ro
      - ./data:/app/data
    environment:
      - VALIDATOR_ID=${this.config.id}
      - VALIDATOR_CONFIG=/app/config.json
      - NODE_ENV=production
    networks:
      - xln-network

networks:
  xln-network:
    driver: bridge
`;

    await fs.writeFile(`${validatorDir}/docker-compose.yml`, dockerCompose);
    console.log(chalk.green(`  ✓ Created ${validatorDir}/docker-compose.yml`));
  }

  /**
   * Install systemd service
   */
  private async installService(): Promise<void> {
    console.log(chalk.cyan('\n🔧 Service Installation'));

    const install = await inquirer.prompt({
      type: 'confirm',
      name: 'install',
      message: 'Install systemd service?',
      default: false
    });

    if (!install.install) {
      return;
    }

    const service = `[Unit]
Description=XLN Validator ${this.config.id}
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PWD/validators/${this.config.id}
ExecStart=/usr/local/bin/bun run ../../src/consensus/ValidatorNode.ts
Restart=always
RestartSec=10
StandardOutput=append:/var/log/xln-${this.config.id}.log
StandardError=append:/var/log/xln-${this.config.id}.error.log

[Install]
WantedBy=multi-user.target
`;

    const servicePath = `xln-${this.config.id}.service`;
    await fs.writeFile(servicePath, service);

    console.log(chalk.yellow('\nTo install the service, run:'));
    console.log(chalk.gray(`  sudo cp ${servicePath} /etc/systemd/system/`));
    console.log(chalk.gray(`  sudo systemctl daemon-reload`));
    console.log(chalk.gray(`  sudo systemctl enable xln-${this.config.id}`));
    console.log(chalk.gray(`  sudo systemctl start xln-${this.config.id}`));
  }

  /**
   * Save encrypted keystore
   */
  private async saveKeystore(wallet: ethers.Wallet): Promise<void> {
    const password = await inquirer.prompt({
      type: 'password',
      name: 'password',
      message: 'Keystore password:',
      validate: (input) => input.length >= 8 || 'Password must be at least 8 characters'
    });

    const keystore = await wallet.encrypt(password.password);
    const keystorePath = `validators/${this.config.id}/keystore.json`;

    await fs.mkdir(`validators/${this.config.id}`, { recursive: true });
    await fs.writeFile(keystorePath, keystore);
    await fs.chmod(keystorePath, 0o600);

    console.log(chalk.green(`✓ Keystore saved to ${keystorePath}`));
  }

  /**
   * Verify setup
   */
  private async verify(): Promise<void> {
    console.log(chalk.cyan('\n✅ Verifying setup...'));

    // Check connectivity to chains
    for (const chain of this.config.chains) {
      try {
        const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
        await provider.getBlockNumber();
        console.log(chalk.green(`  ✓ Connected to ${chain.name}`));
      } catch {
        console.log(chalk.red(`  ✗ Cannot connect to ${chain.name}`));
      }
    }

    // Check P2P connectivity
    for (const peer of this.config.peers) {
      // Would actually ping peer here
      console.log(chalk.gray(`  - Peer: ${peer} (not checked)`));
    }
  }

  /**
   * Print setup summary
   */
  private printSummary(): void {
    console.log(chalk.blue('\n' + '═'.repeat(60)));
    console.log(chalk.blue.bold('           VALIDATOR SUMMARY'));
    console.log(chalk.blue('═'.repeat(60)));

    console.log(chalk.white(`\nValidator ID: ${this.config.id}`));
    console.log(chalk.white(`Address: ${this.config.address}`));
    console.log(chalk.white(`Stake: ${ethers.formatEther(this.config.stake)} ETH`));
    console.log(chalk.white(`\nNetwork:`));
    console.log(chalk.gray(`  RPC: ${this.config.host}:${this.config.port}`));
    console.log(chalk.gray(`  P2P: ${this.config.host}:${this.config.p2pPort}`));
    console.log(chalk.white(`\nChains:`));
    for (const chain of this.config.chains) {
      console.log(chalk.gray(`  - ${chain.name} (${chain.chainId})`));
    }

    console.log(chalk.green('\n🚀 Ready to start validating!'));
    console.log(chalk.gray('\nTo start the validator:'));
    console.log(chalk.cyan(`  cd validators/${this.config.id}`));
    console.log(chalk.cyan(`  ./start.sh`));
    console.log(chalk.gray('\nOr with Docker:'));
    console.log(chalk.cyan(`  docker-compose up -d`));
  }
}

// CLI setup
program
  .name('setup-validator')
  .description('XLN Validator Setup Wizard')
  .version('1.0.0')
  .option('-c, --config <path>', 'Load configuration from file')
  .option('-i, --interactive', 'Run interactive setup wizard', true)
  .action(async (options) => {
    const setup = new ValidatorSetup();

    if (options.config) {
      // Load from config file
      console.log('Loading from config not yet implemented');
    } else {
      // Run interactive wizard
      await setup.runSetupWizard();
    }
  });

program.parse();