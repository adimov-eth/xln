#!/usr/bin/env bun

/**
 * XLN CLI - Command-line interface for bilateral sovereignty
 *
 * Commands:
 * - channel: Manage bilateral channels
 * - swap: Execute swaps
 * - htlc: Create/claim HTLCs
 * - flash: Flash loan operations
 * - monitor: Real-time monitoring
 * - simulate: Run simulations
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { WebSocket } from 'ws';
import {
  SwapTransformer,
  HTLCTransformer,
  FlashLoanTransformer,
  LiquidityPoolTransformer,
  type TransformContext
} from '../src/transformers';
import { EntityChannelBridgeEnhanced } from '../src/EntityChannelBridgeEnhanced';
import { StatePersistence } from '../src/persistence/StatePersistence';
import { NetworkSimulator } from '../src/simulator/NetworkSimulator';

const program = new Command();

// ASCII art banner
const banner = `
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   ██╗  ██╗██╗     ███╗   ██╗                        ║
║   ╚██╗██╔╝██║     ████╗  ██║                        ║
║    ╚███╔╝ ██║     ██╔██╗ ██║                        ║
║    ██╔██╗ ██║     ██║╚██╗██║                        ║
║   ██╔╝ ██╗███████╗██║ ╚████║                        ║
║   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝                        ║
║                                                       ║
║   Bilateral Sovereignty Protocol                     ║
║   No global consensus. Just trust.                   ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`;

// Configuration
interface CLIConfig {
  entityId: string;
  dataDir: string;
  wsEndpoint: string;
  rpcEndpoint: string;
}

let config: CLIConfig = {
  entityId: '',
  dataDir: '~/.xln',
  wsEndpoint: 'ws://localhost:8080',
  rpcEndpoint: 'http://localhost:8080'
};

let bridge: EntityChannelBridgeEnhanced;
let persistence: StatePersistence;

// Initialize CLI
program
  .name('xln')
  .description('XLN Command Line Interface')
  .version('1.0.0');

// Channel commands
const channel = program
  .command('channel')
  .description('Manage bilateral channels');

channel
  .command('open <counterparty>')
  .description('Open new bilateral channel')
  .option('-c, --collateral <amount>', 'Collateral amount', '1000000')
  .option('-l, --credit-limit <amount>', 'Credit limit', '100000')
  .action(async (counterparty, options) => {
    const spinner = ora('Opening channel...').start();

    try {
      await initialize();

      const channelKey = await bridge.openChannel(counterparty, [
        {
          id: `${config.entityId}-${counterparty}-1`,
          tokenId: 1,
          leftEntity: config.entityId,
          rightEntity: counterparty,
          leftBalance: BigInt(options.collateral) * 10n ** 6n,
          rightBalance: BigInt(options.collateral) * 10n ** 6n,
          leftCreditLimit: BigInt(options.creditLimit) * 10n ** 6n,
          rightCreditLimit: BigInt(options.creditLimit) * 10n ** 6n,
          collateral: BigInt(options.collateral) * 10n ** 6n / 2n,
          ondelta: 0n,
          offdelta: 0n,
          leftNonce: 1n,
          rightNonce: 1n,
          leftAllowence: 0n,
          rightAllowence: 0n,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ]);

      spinner.succeed(chalk.green(`Channel opened: ${channelKey}`));

      // Display channel info
      const table = new Table({
        head: ['Property', 'Value'],
        style: { head: ['cyan'] }
      });

      table.push(
        ['Channel Key', channelKey],
        ['Counterparty', counterparty],
        ['Collateral', `${options.collateral} USDC`],
        ['Credit Limit', `${options.creditLimit} USDC`],
        ['Status', chalk.green('Active')]
      );

      console.log(table.toString());

    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

channel
  .command('list')
  .description('List all channels')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (options) => {
    await initialize();

    const channels = await getChannels();

    const table = new Table({
      head: ['Channel', 'Counterparty', 'Status', 'Offdelta', 'Volume', 'Last Activity'],
      style: { head: ['cyan'] }
    });

    for (const ch of channels) {
      if (options.status && ch.status !== options.status) continue;

      table.push([
        ch.channelKey,
        ch.counterparty,
        getStatusBadge(ch.status),
        formatAmount(ch.offdelta),
        formatAmount(ch.volume),
        new Date(ch.lastActivity).toLocaleString()
      ]);
    }

    console.log(table.toString());
    console.log(chalk.gray(`Total: ${channels.length} channels`));
  });

channel
  .command('close <channelKey>')
  .description('Close channel cooperatively')
  .action(async (channelKey) => {
    const spinner = ora('Closing channel...').start();

    try {
      await initialize();
      await bridge.closeChannel(channelKey);
      spinner.succeed(chalk.green('Channel closed successfully'));
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

// Swap command
program
  .command('swap')
  .description('Execute bilateral swap')
  .requiredOption('-c, --channel <key>', 'Channel key')
  .requiredOption('-f, --from <asset>', 'From asset')
  .requiredOption('-t, --to <asset>', 'To asset')
  .requiredOption('-a, --amount <amount>', 'Amount to swap')
  .option('-m, --min <amount>', 'Minimum received', '0')
  .action(async (options) => {
    const spinner = ora('Executing swap...').start();

    try {
      await initialize();

      const result = await bridge.executeTransformer(
        options.channel,
        'swap',
        'execute',
        {
          fromAsset: options.from,
          toAsset: options.to,
          amount: BigInt(options.amount) * 10n ** 6n,
          minReceived: BigInt(options.min) * 10n ** 6n,
          slippageTolerance: 100n
        }
      );

      if (result.success) {
        spinner.succeed(chalk.green('Swap executed successfully'));

        const table = new Table({
          head: ['Property', 'Value'],
          style: { head: ['cyan'] }
        });

        table.push(
          ['From', `${options.amount} ${options.from}`],
          ['To', `${result.data?.received || '?'} ${options.to}`],
          ['Gas Used', formatGas(result.data?.gasUsed)],
          ['State Hash', result.proof?.afterState || 'N/A']
        );

        console.log(table.toString());
      } else {
        spinner.fail(chalk.red(`Swap failed: ${result.error}`));
      }
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

// HTLC command
program
  .command('htlc')
  .description('HTLC operations')
  .option('-c, --create', 'Create new HTLC')
  .option('-l, --claim <htlcId>', 'Claim HTLC with preimage')
  .option('-e, --expire <htlcId>', 'Expire HTLC')
  .action(async (options) => {
    if (options.create) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'channel',
          message: 'Channel key:'
        },
        {
          type: 'input',
          name: 'amount',
          message: 'Amount (USDC):',
          default: '100'
        },
        {
          type: 'input',
          name: 'timelock',
          message: 'Timelock (hours):',
          default: '24'
        }
      ]);

      const spinner = ora('Creating HTLC...').start();

      try {
        await initialize();

        const result = await bridge.executeTransformer(
          answers.channel,
          'htlc',
          'create',
          {
            tokenId: 1,
            amount: BigInt(answers.amount) * 10n ** 6n,
            hashlock: generateHashlock(),
            timelock: Date.now() + parseInt(answers.timelock) * 3600000,
            sender: 'left',
            receiver: 'right'
          }
        );

        if (result.success) {
          spinner.succeed(chalk.green('HTLC created'));
          console.log('HTLC ID:', result.data?.htlcId);
          console.log('Hashlock:', result.data?.hashlock);
        } else {
          spinner.fail(chalk.red(`Failed: ${result.error}`));
        }
      } catch (error) {
        spinner.fail(chalk.red(`Failed: ${error.message}`));
      }
    }
  });

// Monitor command
program
  .command('monitor')
  .description('Real-time network monitoring')
  .option('-i, --interval <ms>', 'Refresh interval', '1000')
  .action(async (options) => {
    console.clear();
    console.log(chalk.cyan(banner));

    const ws = new WebSocket(config.wsEndpoint);

    ws.on('open', () => {
      console.log(chalk.green('✓ Connected to network'));
    });

    ws.on('message', (data: string) => {
      const message = JSON.parse(data);
      displayMetrics(message);
    });

    ws.on('error', (error) => {
      console.error(chalk.red(`WebSocket error: ${error.message}`));
    });

    // Keep connection alive
    setInterval(() => {
      ws.ping();
    }, 30000);
  });

// Simulate command
program
  .command('simulate')
  .description('Run network simulation')
  .option('-e, --entities <n>', 'Number of entities', '100')
  .option('-c, --channels <n>', 'Number of channels', '500')
  .option('-b, --byzantine <n>', 'Byzantine percentage', '20')
  .option('-d, --duration <s>', 'Duration in seconds', '60')
  .action(async (options) => {
    console.log(chalk.cyan('Starting simulation...'));

    const config = {
      numEntities: parseInt(options.entities),
      numChannels: parseInt(options.channels),
      numValidators: 7,
      byzantineRatio: parseInt(options.byzantine),
      networkLatency: 10,
      packetLoss: 1,
      transactionRate: 100,
      simulationDuration: parseInt(options.duration),
      checkpointInterval: 10
    };

    const simulator = new NetworkSimulator(config);

    try {
      await simulator.initialize();

      console.log(chalk.green('✓ Network initialized'));
      console.log(chalk.gray(`  Entities: ${config.numEntities}`));
      console.log(chalk.gray(`  Channels: ${config.numChannels}`));
      console.log(chalk.gray(`  Byzantine: ${config.byzantineRatio}%`));

      const result = await simulator.run();

      simulator.printReport();

      // Save results
      const filename = `simulation_${Date.now()}.json`;
      await Bun.write(filename, JSON.stringify(result, null, 2));
      console.log(chalk.green(`\n✓ Results saved to ${filename}`));

    } catch (error) {
      console.error(chalk.red(`Simulation failed: ${error.message}`));
    }
  });

// Interactive mode
program
  .command('interactive')
  .description('Interactive XLN shell')
  .action(async () => {
    console.clear();
    console.log(chalk.cyan(banner));

    await initialize();

    while (true) {
      const { command } = await inquirer.prompt([
        {
          type: 'list',
          name: 'command',
          message: 'What would you like to do?',
          choices: [
            'Open Channel',
            'Execute Swap',
            'Create HTLC',
            'Flash Loan',
            'View Channels',
            'View Metrics',
            'Run Simulation',
            'Exit'
          ]
        }
      ]);

      switch (command) {
        case 'Open Channel':
          await interactiveOpenChannel();
          break;
        case 'Execute Swap':
          await interactiveSwap();
          break;
        case 'View Channels':
          await viewChannels();
          break;
        case 'Exit':
          process.exit(0);
        default:
          console.log(chalk.yellow('Not implemented yet'));
      }
    }
  });

// Helper functions

async function initialize() {
  if (!config.entityId) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'entityId',
        message: 'Enter your entity ID:',
        default: 'alice'
      }
    ]);
    config.entityId = answers.entityId;
  }

  if (!bridge) {
    bridge = new EntityChannelBridgeEnhanced({
      entityId: config.entityId,
      maxChannels: 10000,
      checkpointInterval: 60000,
      disputeTimeout: 3600000,
      slashingAmount: 1000000n * 10n ** 6n
    });
  }

  if (!persistence) {
    persistence = new StatePersistence({
      dataDir: config.dataDir,
      walDir: `${config.dataDir}/wal`,
      snapshotDir: `${config.dataDir}/snapshots`,
      maxWalSize: 100 * 1024 * 1024,
      snapshotInterval: 1000,
      compressionLevel: 6,
      checksumAlgorithm: 'sha256'
    });

    await persistence.initialize();
  }
}

async function getChannels(): Promise<any[]> {
  // In production, this would fetch from actual state
  return [
    {
      channelKey: 'alice-bob',
      counterparty: 'bob',
      status: 'active',
      offdelta: 1000n * 10n ** 6n,
      volume: 50000n * 10n ** 6n,
      lastActivity: Date.now() - 60000
    }
  ];
}

function getStatusBadge(status: string): string {
  const badges = {
    active: chalk.green('● Active'),
    disputed: chalk.yellow('● Disputed'),
    closing: chalk.red('● Closing'),
    closed: chalk.gray('● Closed')
  };
  return badges[status] || status;
}

function formatAmount(amount: bigint): string {
  const value = Number(amount) / 1e6;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function formatGas(gas: bigint | undefined): string {
  if (!gas) return 'N/A';
  return `${(Number(gas) / 1e9).toFixed(4)} gwei`;
}

function generateHashlock(): Uint8Array {
  const hash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    hash[i] = Math.floor(Math.random() * 256);
  }
  return hash;
}

function displayMetrics(metrics: any) {
  console.clear();
  console.log(chalk.cyan('═══ XLN Network Monitor ═══\n'));

  const table = new Table({
    head: ['Metric', 'Value'],
    style: { head: ['cyan'] },
    colWidths: [20, 20]
  });

  table.push(
    ['TPS', chalk.yellow(metrics.tps?.toFixed(0) || '0')],
    ['Active Channels', chalk.green(metrics.activeChannels || '0')],
    ['Total Volume', formatAmount(metrics.totalVolume || 0n)],
    ['Avg Latency', `${metrics.averageLatency?.toFixed(1) || '0'} ms`],
    ['Byzantine Faults', chalk.red(metrics.byzantineFaults || '0')],
    ['Slashing Events', chalk.red(metrics.slashingEvents || '0')]
  );

  console.log(table.toString());

  // TPS graph (simple ASCII)
  if (metrics.tpsHistory) {
    console.log('\nTPS History (last 60s):');
    const maxTps = Math.max(...metrics.tpsHistory);
    const scale = 20 / maxTps;

    for (let i = 0; i < metrics.tpsHistory.length; i++) {
      const bars = '█'.repeat(Math.floor(metrics.tpsHistory[i] * scale));
      console.log(chalk.green(bars));
    }
  }
}

async function interactiveOpenChannel() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'counterparty',
      message: 'Counterparty entity ID:'
    },
    {
      type: 'input',
      name: 'collateral',
      message: 'Collateral amount (USDC):',
      default: '100000'
    },
    {
      type: 'input',
      name: 'creditLimit',
      message: 'Credit limit (USDC):',
      default: '10000'
    }
  ]);

  const spinner = ora('Opening channel...').start();

  try {
    const channelKey = await bridge.openChannel(answers.counterparty, [
      {
        id: `${config.entityId}-${answers.counterparty}-1`,
        tokenId: 1,
        leftEntity: config.entityId,
        rightEntity: answers.counterparty,
        leftBalance: BigInt(answers.collateral) * 10n ** 6n,
        rightBalance: BigInt(answers.collateral) * 10n ** 6n,
        leftCreditLimit: BigInt(answers.creditLimit) * 10n ** 6n,
        rightCreditLimit: BigInt(answers.creditLimit) * 10n ** 6n,
        collateral: BigInt(answers.collateral) * 10n ** 6n / 2n,
        ondelta: 0n,
        offdelta: 0n,
        leftNonce: 1n,
        rightNonce: 1n,
        leftAllowence: 0n,
        rightAllowence: 0n,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]);

    spinner.succeed(chalk.green(`Channel opened: ${channelKey}`));
  } catch (error) {
    spinner.fail(chalk.red(`Failed: ${error.message}`));
  }
}

async function interactiveSwap() {
  const channels = await getChannels();

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'channel',
      message: 'Select channel:',
      choices: channels.map(c => c.channelKey)
    },
    {
      type: 'input',
      name: 'amount',
      message: 'Amount to swap (USDC):',
      default: '100'
    }
  ]);

  const spinner = ora('Executing swap...').start();

  try {
    const result = await bridge.executeTransformer(
      answers.channel,
      'swap',
      'execute',
      {
        fromAsset: 'USDC',
        toAsset: 'ETH',
        amount: BigInt(answers.amount) * 10n ** 6n,
        minReceived: 0n,
        slippageTolerance: 100n
      }
    );

    if (result.success) {
      spinner.succeed(chalk.green('Swap executed successfully'));
    } else {
      spinner.fail(chalk.red(`Swap failed: ${result.error}`));
    }
  } catch (error) {
    spinner.fail(chalk.red(`Failed: ${error.message}`));
  }
}

async function viewChannels() {
  const channels = await getChannels();

  const table = new Table({
    head: ['Channel', 'Status', 'Delta', 'Volume'],
    style: { head: ['cyan'] }
  });

  for (const ch of channels) {
    table.push([
      ch.channelKey,
      getStatusBadge(ch.status),
      formatAmount(ch.offdelta),
      formatAmount(ch.volume)
    ]);
  }

  console.log(table.toString());
}

// Parse arguments
program.parse(process.argv);

// Show help if no command
if (!process.argv.slice(2).length) {
  console.log(chalk.cyan(banner));
  program.outputHelp();
}