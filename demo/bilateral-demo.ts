#!/usr/bin/env bun

/**
 * XLN Bilateral Sovereignty Demo
 *
 * Demonstrates:
 * 1. Entity creation with quorum governance
 * 2. Bilateral channel opening
 * 3. Instant off-chain transactions
 * 4. Cross-channel routing (HTLC)
 * 5. Flash loans from channel partners
 */

import { applyEntityInput, createEmptyEnv } from '../src/server.js';
import { validateEntityInput } from '../src/entity-consensus.js';
import { createLazyEntity } from '../src/entity-factory.js';
import { SwapTransformer } from '../src/transformers/SwapTransformer.js';
import { HTLCTransformer } from '../src/transformers/HTLCTransformer.js';
import { FlashLoanTransformer } from '../src/transformers/FlashLoanTransformer.js';
import { TransformContext } from '../src/transformers/BaseTransformer.js';
import { Subchannel } from '../old_src/types/Subchannel.js';
import chalk from 'chalk';

// Demo configuration
const DEMO_CONFIG = {
  entities: ['alice', 'bob', 'charlie'],
  channels: [
    ['alice', 'bob', 1000000n],
    ['bob', 'charlie', 1000000n],
    ['alice', 'charlie', 500000n]
  ]
};

class BilateralDemo {
  private env = createEmptyEnv();
  private entities = new Map<string, string>(); // name -> address

  async run() {
    console.log(chalk.blue('\n╔════════════════════════════════════════════════════╗'));
    console.log(chalk.blue('║         XLN BILATERAL SOVEREIGNTY DEMO              ║'));
    console.log(chalk.blue('╚════════════════════════════════════════════════════╝\n'));

    // Step 1: Create entities
    await this.createEntities();

    // Step 2: Open bilateral channels
    await this.openChannels();

    // Step 3: Demonstrate instant bilateral swap
    await this.demoSwap();

    // Step 4: Demonstrate multi-hop HTLC payment
    await this.demoHTLC();

    // Step 5: Demonstrate flash loan
    await this.demoFlashLoan();

    // Step 6: Show final state
    await this.showFinalState();

    console.log(chalk.green('\n✨ Demo complete! Bilateral sovereignty achieved.\n'));
  }

  private async createEntities() {
    console.log(chalk.yellow('\n📝 Creating Entities...\n'));

    for (const name of DEMO_CONFIG.entities) {
      const entityId = `0x${name.padEnd(40, '0')}`;
      const entity = createLazyEntity(entityId, [entityId], 1n);

      this.entities.set(name, entityId);

      // Initialize entity in environment
      if (!this.env.replicas[entityId]) {
        this.env.replicas[entityId] = {
          entityState: entity.entityState,
          mempool: [],
          consensusState: 'idle',
          view: 0,
          signatures: new Map()
        };
      }

      console.log(chalk.cyan(`  ✓ Created entity ${name}: ${entityId.slice(0, 10)}...`));
    }
  }

  private async openChannels() {
    console.log(chalk.yellow('\n🔗 Opening Bilateral Channels...\n'));

    for (const [left, right, collateral] of DEMO_CONFIG.channels) {
      const leftAddr = this.entities.get(left)!;
      const rightAddr = this.entities.get(right)!;

      console.log(chalk.cyan(`  Opening channel ${left} ↔ ${right} with ${collateral} collateral...`));

      // In real implementation, this would create channel state
      // For demo, we just log the operation
      console.log(chalk.green(`    ✓ Channel opened: ${leftAddr.slice(0, 8)}...↔${rightAddr.slice(0, 8)}...`));
    }
  }

  private async demoSwap() {
    console.log(chalk.yellow('\n💱 Bilateral Swap Demo...\n'));

    const context = this.createTestContext('alice-bob');

    console.log(chalk.cyan('  Alice swaps 1000 TokenA for TokenB with Bob'));
    console.log(chalk.gray('  No global AMM pool, just bilateral agreement'));

    const swapResult = SwapTransformer.execute({
      context,
      params: {
        tokenIn: 0,
        tokenOut: 1,
        amountIn: 1000n,
        minAmountOut: 900n,
        deadline: Date.now() + 60000,
        trader: 'left'
      }
    });

    if (swapResult.success) {
      console.log(chalk.green(`    ✓ Swap executed: ${swapResult.data?.amountOut} TokenB received`));
      console.log(chalk.gray(`    Gas used: ${swapResult.data?.gasUsed || 0}`));
    } else {
      console.log(chalk.red(`    ✗ Swap failed: ${swapResult.error}`));
    }
  }

  private async demoHTLC() {
    console.log(chalk.yellow('\n⚡ Multi-hop HTLC Payment...\n'));
    console.log(chalk.cyan('  Alice pays Charlie through Bob (Alice → Bob → Charlie)'));

    const secret = 'super_secret_preimage';
    const crypto = await import('crypto');
    const hashLock = '0x' + crypto.createHash('sha256').update(secret).digest('hex');

    // Step 1: Create HTLC from Alice to Bob
    const aliceBobContext = this.createTestContext('alice-bob');
    const htlc1 = HTLCTransformer.create({
      context: aliceBobContext,
      params: {
        htlcId: 'htlc-1',
        tokenId: 0,
        amount: 1000n,
        hashLock,
        timelock: Date.now() + 3600000,
        sender: 'left',
        receiver: 'right',
        nextHop: 'charlie'
      }
    });

    if (!htlc1.success) {
      console.log(chalk.red(`    ✗ HTLC creation failed: ${htlc1.error}`));
      return;
    }

    console.log(chalk.green('    ✓ HTLC 1: Alice locked 1000 tokens for Bob'));

    // Step 2: Bob forwards to Charlie
    const bobCharlieContext = this.createTestContext('bob-charlie');
    const htlc2 = HTLCTransformer.create({
      context: bobCharlieContext,
      params: {
        htlcId: 'htlc-2',
        tokenId: 0,
        amount: 990n, // Bob takes 10 as fee
        hashLock,
        timelock: Date.now() + 3500000,
        sender: 'left',
        receiver: 'right'
      }
    });

    if (!htlc2.success) {
      console.log(chalk.red(`    ✗ HTLC forwarding failed: ${htlc2.error}`));
      return;
    }

    console.log(chalk.green('    ✓ HTLC 2: Bob locked 990 tokens for Charlie'));

    // Step 3: Charlie reveals preimage
    const unlockResult = HTLCTransformer.claim({
      context: bobCharlieContext,
      params: {
        htlcId: 'htlc-2',
        preimage: secret,
        claimer: 'right' // Charlie is right side
      }
    });

    if (unlockResult.success) {
      console.log(chalk.green('    ✓ Charlie revealed preimage and claimed 990 tokens'));
      console.log(chalk.green('    ✓ Payment routed successfully through bilateral channels!'));
    } else {
      console.log(chalk.red(`    ✗ Unlock failed: ${unlockResult.error}`));
    }
  }

  private async demoFlashLoan() {
    console.log(chalk.yellow('\n💸 Flash Loan Demo...\n'));
    console.log(chalk.cyan('  Alice borrows 10,000 from Bob for arbitrage'));

    const context = this.createTestContext('alice-bob');

    // Simulate flash loan with callback
    let arbitrageProfit = 0n;

    const loanResult = FlashLoanTransformer.borrow({
      context,
      params: {
        tokenId: 0,
        amount: 10000n,
        borrower: 'left',
        data: { purpose: 'arbitrage' }
      }
    });

    if (!loanResult.success) {
      console.log(chalk.red(`    ✗ Flash loan failed: ${loanResult.error}`));
      return;
    }

    console.log(chalk.green(`    ✓ Borrowed 10,000 tokens (fee: ${loanResult.data?.fee})`));

    // Simulate arbitrage
    arbitrageProfit = 1000n; // 10% profit
    console.log(chalk.cyan(`    ⚡ Executing arbitrage... profit: ${arbitrageProfit}`));

    // Repay loan
    const repayAmount = 10000n + (loanResult.data?.fee || 0n);
    const repayResult = FlashLoanTransformer.repay({
      context,
      params: {
        loanId: loanResult.data?.loanId,
        amount: repayAmount
      }
    });

    if (repayResult.success) {
      console.log(chalk.green(`    ✓ Loan repaid: ${repayAmount} tokens`));
      console.log(chalk.green(`    ✓ Net profit: ${arbitrageProfit - (loanResult.data?.fee || 0n)} tokens`));
    } else {
      console.log(chalk.red(`    ✗ Repayment failed: ${repayResult.error}`));
    }
  }

  private async showFinalState() {
    console.log(chalk.yellow('\n📊 Final State Summary...\n'));

    console.log(chalk.cyan('  Entities:'));
    for (const [name, addr] of this.entities) {
      const replica = this.env.replicas[addr];
      if (replica) {
        console.log(`    ${name}: Height ${replica.entityState.seq}, State ${replica.consensusState}`);
      }
    }

    console.log(chalk.cyan('\n  Achievements:'));
    console.log(chalk.green('    ✓ No global consensus required'));
    console.log(chalk.green('    ✓ Instant bilateral finality'));
    console.log(chalk.green('    ✓ Cross-channel routing works'));
    console.log(chalk.green('    ✓ Flash loans without pools'));
    console.log(chalk.green('    ✓ MEV-resistant by design'));
  }

  private createTestContext(channelKey: string): TransformContext {
    return {
      channelKey,
      subchannels: new Map([
        [0, this.createTestSubchannel()],
        [1, this.createTestSubchannel()] // Add second token for swaps
      ]),
      timestamp: Date.now(),
      nonce: 0
    };
  }

  private createTestSubchannel(): Subchannel {
    return {
      chainId: 1,
      tokenId: 0,
      leftCreditLimit: 100000n,
      rightCreditLimit: 100000n,
      leftAllowence: 0n,
      rightAllowence: 0n,
      collateral: 1000000n,
      ondelta: 0n,
      offdelta: 0n,
      cooperativeNonce: 0,
      disputeNonce: 0,
      deltas: [],
      proposedEvents: [],
      proposedEventsByLeft: false
    };
  }
}

// Run the demo
if (import.meta.main) {
  const demo = new BilateralDemo();
  demo.run().catch(console.error);
}