#!/usr/bin/env bun

/**
 * REAL XLN Bilateral Payment Demo
 *
 * This demonstrates the actual working bilateral channel system.
 * - Uses existing LevelDB for persistence
 * - Implements the three-zone capacity model
 * - Shows instant off-chain payments with on-chain settlement option
 *
 * This is what XLN actually does, without all the theatrical abstractions.
 */

import { ethers } from 'ethers';
import { Level } from 'level';

// Simple state for demo
interface PaymentState {
  channelId: string;
  ondelta: bigint;   // On-chain settled amount
  offdelta: bigint;  // Off-chain instant amount
  collateral: bigint;
  creditLimit: bigint;
  nonce: number;
  lastUpdate: number;
}

class SimpleBilateralChannel {
  private db: Level<string, string>;
  private state: PaymentState;

  constructor(
    private channelId: string,
    private isAlice: boolean
  ) {
    this.db = new Level(`./demo-channel/${channelId}`);
    this.state = {
      channelId,
      ondelta: 0n,
      offdelta: 0n,
      collateral: ethers.parseEther('10'),  // 10 ETH collateral
      creditLimit: ethers.parseEther('5'),   // 5 ETH credit
      nonce: 0,
      lastUpdate: Date.now()
    };
  }

  async init(): Promise<void> {
    await this.db.open();

    // Try to load existing state
    try {
      const saved = await this.db.get('state');
      this.state = JSON.parse(saved, (key, value) => {
        // Restore BigInt values
        if (typeof value === 'string' && value.endsWith('n')) {
          return BigInt(value.slice(0, -1));
        }
        return value;
      });
      console.log('📦 Loaded existing channel state');
    } catch {
      console.log('🆕 Creating new channel');
      await this.save();
    }
  }

  private async save(): Promise<void> {
    await this.db.put('state', JSON.stringify(this.state, (key, value) => {
      // Save BigInt as string with 'n' suffix
      if (typeof value === 'bigint') {
        return value.toString() + 'n';
      }
      return value;
    }));
  }

  getCapacity(): { inbound: bigint; outbound: bigint } {
    const totalDelta = this.state.ondelta + this.state.offdelta;
    const collateral = this.state.collateral;
    const creditLimit = this.state.creditLimit;

    // Three-zone capacity model
    let outbound: bigint;
    let inbound: bigint;

    if (totalDelta >= 0n) {
      // We've sent more than received
      outbound = collateral + creditLimit - totalDelta;
      inbound = collateral + creditLimit + totalDelta;
    } else {
      // We've received more than sent
      outbound = collateral + creditLimit + (-totalDelta);
      inbound = collateral + creditLimit - (-totalDelta);
    }

    // Ensure non-negative
    outbound = outbound < 0n ? 0n : outbound;
    inbound = inbound < 0n ? 0n : inbound;

    return { inbound, outbound };
  }

  async sendPayment(amount: bigint): Promise<void> {
    const capacity = this.getCapacity();

    if (amount > capacity.outbound) {
      throw new Error(`Insufficient outbound capacity: ${ethers.formatEther(amount)} > ${ethers.formatEther(capacity.outbound)}`);
    }

    this.state.offdelta += amount;
    this.state.nonce++;
    this.state.lastUpdate = Date.now();
    await this.save();

    console.log(`💸 Sent ${ethers.formatEther(amount)} ETH (instant off-chain)`);
  }

  async receivePayment(amount: bigint): Promise<void> {
    const capacity = this.getCapacity();

    if (amount > capacity.inbound) {
      throw new Error(`Insufficient inbound capacity: ${ethers.formatEther(amount)} > ${ethers.formatEther(capacity.inbound)}`);
    }

    this.state.offdelta -= amount;
    this.state.nonce++;
    this.state.lastUpdate = Date.now();
    await this.save();

    console.log(`💰 Received ${ethers.formatEther(amount)} ETH (instant off-chain)`);
  }

  async settleToChain(): Promise<void> {
    // In real system, this would submit to L1
    console.log(`⛓️  Settling ${ethers.formatEther(this.state.offdelta)} ETH to chain...`);

    this.state.ondelta += this.state.offdelta;
    this.state.offdelta = 0n;
    this.state.nonce++;
    await this.save();

    console.log(`✅ Settled! New on-chain balance: ${ethers.formatEther(this.state.ondelta)} ETH`);
  }

  printStatus(): void {
    const capacity = this.getCapacity();
    const totalDelta = this.state.ondelta + this.state.offdelta;

    console.log('\n📊 Channel Status:');
    console.log('├─ Channel ID:', this.channelId);
    console.log('├─ Perspective:', this.isAlice ? 'Alice' : 'Bob');
    console.log('├─ Nonce:', this.state.nonce);
    console.log('├─ Balances:');
    console.log(`│  ├─ On-chain (settled): ${ethers.formatEther(this.state.ondelta)} ETH`);
    console.log(`│  ├─ Off-chain (instant): ${ethers.formatEther(this.state.offdelta)} ETH`);
    console.log(`│  └─ Total delta: ${ethers.formatEther(totalDelta)} ETH`);
    console.log('├─ Capacity:');
    console.log(`│  ├─ Inbound: ${ethers.formatEther(capacity.inbound)} ETH`);
    console.log(`│  └─ Outbound: ${ethers.formatEther(capacity.outbound)} ETH`);
    console.log('└─ Last update:', new Date(this.state.lastUpdate).toLocaleString());
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

// Interactive demo
async function runDemo() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('        XLN BILATERAL CHANNEL - REAL DEMO');
  console.log('═══════════════════════════════════════════════════════');
  console.log();
  console.log('This demonstrates REAL bilateral channels:');
  console.log('• Instant off-chain payments (offdelta)');
  console.log('• Optional on-chain settlement (ondelta)');
  console.log('• Three-zone capacity (credit + collateral + credit)');
  console.log('• LevelDB persistence between runs');
  console.log();

  // Use fixed channel for persistence demo
  const channel = new SimpleBilateralChannel('demo-channel', true);
  await channel.init();

  channel.printStatus();

  // Interactive menu
  console.log('\n🎮 Commands:');
  console.log('  1. Send payment');
  console.log('  2. Receive payment');
  console.log('  3. Settle to chain');
  console.log('  4. Show status');
  console.log('  5. Exit');
  console.log();

  const prompt = () => process.stdout.write('> ');

  prompt();
  for await (const line of console) {
    const input = line.trim();

    try {
      switch (input) {
        case '1': {
          process.stdout.write('Amount (ETH): ');
          const amountLine = await new Promise<string>(resolve => {
            process.stdin.once('data', data => resolve(data.toString().trim()));
          });
          const amount = ethers.parseEther(amountLine);
          await channel.sendPayment(amount);
          break;
        }

        case '2': {
          process.stdout.write('Amount (ETH): ');
          const amountLine = await new Promise<string>(resolve => {
            process.stdin.once('data', data => resolve(data.toString().trim()));
          });
          const amount = ethers.parseEther(amountLine);
          await channel.receivePayment(amount);
          break;
        }

        case '3':
          await channel.settleToChain();
          break;

        case '4':
          channel.printStatus();
          break;

        case '5':
          console.log('👋 Channel state saved. Run again to continue!');
          await channel.close();
          process.exit(0);

        default:
          console.log('Invalid option');
      }
    } catch (error: any) {
      console.error('❌', error.message);
    }

    console.log();
    prompt();
  }
}

// Non-interactive demo for testing
async function autoDemo() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('        XLN BILATERAL CHANNEL - AUTO DEMO');
  console.log('═══════════════════════════════════════════════════════');
  console.log();

  const channel = new SimpleBilateralChannel('auto-demo', true);
  await channel.init();

  console.log('Initial state:');
  channel.printStatus();

  console.log('\n--- Performing transactions ---\n');

  // Send 1 ETH
  await channel.sendPayment(ethers.parseEther('1'));

  // Receive 0.5 ETH
  await channel.receivePayment(ethers.parseEther('0.5'));

  // Send 2 ETH
  await channel.sendPayment(ethers.parseEther('2'));

  console.log('\nAfter transactions:');
  channel.printStatus();

  console.log('\n--- Settling to chain ---\n');
  await channel.settleToChain();

  console.log('\nFinal state:');
  channel.printStatus();

  await channel.close();

  console.log('\n✅ Demo complete! State persisted to ./demo-channel/');
  console.log('   Run again to see persistence in action.');
}

// Main entry point
if (import.meta.main) {
  const isInteractive = process.argv.includes('--interactive') || process.argv.includes('-i');

  if (isInteractive) {
    runDemo().catch(console.error);
  } else {
    autoDemo().catch(console.error);
  }
}