#!/usr/bin/env bun

/**
 * Simple P2P WebSocket layer for XLN bilateral channels
 *
 * This is the REAL networking layer - direct WebSocket connections
 * between peers. No DHT, no libp2p, no complexity.
 *
 * Run two instances:
 * - Alice: bun run bilateral-p2p.ts --alice
 * - Bob:   bun run bilateral-p2p.ts --bob
 */

import { ethers } from 'ethers';
import { Level } from 'level';

interface ChannelMessage {
  type: 'payment' | 'settle' | 'sync';
  nonce: number;
  amount?: string;
  signature: string;
}

interface ChannelState {
  nonce: number;
  offdelta: bigint;
  ondelta: bigint;
  lastUpdate: number;
}

class P2PChannel {
  private ws?: WebSocket;
  private db: Level<string, string>;
  private state: ChannelState;
  private wallet: ethers.Wallet;

  constructor(
    private role: 'alice' | 'bob',
    private port: number
  ) {
    // Deterministic wallets for demo
    const seed = role === 'alice' ? '0x01' : '0x02';
    this.wallet = new ethers.Wallet(seed.padEnd(66, '0'));

    this.db = new Level(`./p2p-data/${role}`);
    this.state = {
      nonce: 0,
      offdelta: 0n,
      ondelta: 0n,
      lastUpdate: Date.now()
    };
  }

  async init(): Promise<void> {
    await this.db.open();

    // Load state
    try {
      const saved = await this.db.get('state');
      this.state = JSON.parse(saved, (k, v) => {
        if (typeof v === 'string' && v.endsWith('n')) {
          return BigInt(v.slice(0, -1));
        }
        return v;
      });
      console.log('📦 Loaded state at nonce', this.state.nonce);
    } catch {
      console.log('🆕 New channel state');
      await this.save();
    }
  }

  private async save(): Promise<void> {
    await this.db.put('state', JSON.stringify(this.state, (k, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      return v;
    }));
  }

  async startServer(): Promise<void> {
    const server = Bun.serve({
      port: this.port,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response('WebSocket server', { status: 200 });
      },
      websocket: {
        open: (ws) => {
          console.log('🤝 Peer connected');
          this.ws = ws;
          this.syncState();
        },
        message: async (ws, message) => {
          const msg = JSON.parse(message.toString()) as ChannelMessage;
          await this.handleMessage(msg);
        },
        close: () => {
          console.log('👋 Peer disconnected');
          this.ws = undefined;
        }
      }
    });

    console.log(`🌐 WebSocket server on port ${this.port}`);
  }

  async connectToPeer(peerPort: number): Promise<void> {
    const ws = new WebSocket(`ws://localhost:${peerPort}`);

    ws.onopen = () => {
      console.log('🤝 Connected to peer');
      this.ws = ws;
      this.syncState();
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data) as ChannelMessage;
      await this.handleMessage(msg);
    };

    ws.onclose = () => {
      console.log('👋 Disconnected from peer');
      this.ws = undefined;
    };

    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };
  }

  private async handleMessage(msg: ChannelMessage): Promise<void> {
    // Verify signature
    const msgHash = ethers.id(JSON.stringify({
      type: msg.type,
      nonce: msg.nonce,
      amount: msg.amount
    }));

    // In real implementation, verify peer's signature
    // For demo, just trust it

    switch (msg.type) {
      case 'payment':
        if (msg.nonce > this.state.nonce) {
          const amount = BigInt(msg.amount!);

          // Peer is sending us money
          this.state.offdelta -= amount;
          this.state.nonce = msg.nonce;
          this.state.lastUpdate = Date.now();
          await this.save();

          console.log(`💰 Received ${ethers.formatEther(amount)} ETH`);
          console.log(`   New balance: ${ethers.formatEther(-this.state.offdelta)} ETH`);
        }
        break;

      case 'sync':
        console.log(`🔄 Peer state: nonce ${msg.nonce}`);
        break;
    }
  }

  async sendPayment(amount: bigint): Promise<void> {
    if (!this.ws) {
      throw new Error('Not connected to peer');
    }

    this.state.nonce++;
    this.state.offdelta += amount;
    this.state.lastUpdate = Date.now();
    await this.save();

    const msg: ChannelMessage = {
      type: 'payment',
      nonce: this.state.nonce,
      amount: amount.toString(),
      signature: await this.sign({
        type: 'payment',
        nonce: this.state.nonce,
        amount: amount.toString()
      })
    };

    this.ws.send(JSON.stringify(msg));

    console.log(`💸 Sent ${ethers.formatEther(amount)} ETH`);
    console.log(`   New balance: ${ethers.formatEther(-this.state.offdelta)} ETH`);
  }

  private syncState(): void {
    if (!this.ws) return;

    const msg: ChannelMessage = {
      type: 'sync',
      nonce: this.state.nonce,
      signature: ''  // Skip for sync
    };

    this.ws.send(JSON.stringify(msg));
  }

  private async sign(data: any): Promise<string> {
    const hash = ethers.id(JSON.stringify(data));
    return await this.wallet.signMessage(hash);
  }

  printStatus(): void {
    const balance = -this.state.offdelta;  // Negative offdelta = we have money
    console.log('\n📊 Channel Status:');
    console.log('├─ Role:', this.role);
    console.log('├─ Address:', this.wallet.address);
    console.log('├─ Nonce:', this.state.nonce);
    console.log('├─ Balance:', ethers.formatEther(balance), 'ETH');
    console.log('└─ Connected:', this.ws ? '✅' : '❌');
  }
}

// Main demo
async function runP2P() {
  const isAlice = process.argv.includes('--alice');
  const isBob = process.argv.includes('--bob');

  if (!isAlice && !isBob) {
    console.log('Usage:');
    console.log('  Terminal 1: bun run bilateral-p2p.ts --alice');
    console.log('  Terminal 2: bun run bilateral-p2p.ts --bob');
    process.exit(1);
  }

  const role = isAlice ? 'alice' : 'bob';
  const port = isAlice ? 8080 : 8081;
  const peerPort = isAlice ? 8081 : 8080;

  console.log('═══════════════════════════════════════════════════════');
  console.log(`        XLN P2P CHANNEL - ${role.toUpperCase()}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log();

  const channel = new P2PChannel(role, port);
  await channel.init();

  // Alice starts server, Bob connects
  if (isAlice) {
    await channel.startServer();
    console.log('⏳ Waiting for Bob to connect...');
  } else {
    console.log('🔌 Connecting to Alice...');
    await new Promise(r => setTimeout(r, 1000));  // Give Alice time to start
    await channel.connectToPeer(peerPort);
  }

  channel.printStatus();

  // Simple CLI
  console.log('\n🎮 Commands:');
  console.log('  send <amount>  - Send ETH to peer');
  console.log('  status         - Show channel status');
  console.log('  exit           - Close channel');
  console.log();

  process.stdout.write('> ');

  for await (const line of console) {
    const parts = line.trim().split(' ');
    const cmd = parts[0];

    try {
      switch (cmd) {
        case 'send':
          const amount = ethers.parseEther(parts[1] || '1');
          await channel.sendPayment(amount);
          break;

        case 'status':
          channel.printStatus();
          break;

        case 'exit':
          console.log('👋 Goodbye!');
          process.exit(0);

        default:
          console.log('Unknown command');
      }
    } catch (error: any) {
      console.error('❌', error.message);
    }

    process.stdout.write('> ');
  }
}

if (import.meta.main) {
  runP2P().catch(console.error);
}