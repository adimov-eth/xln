#!/usr/bin/env bun

/**
 * REAL BFT Consensus over P2P WebSocket
 *
 * This wires the WORKING entity-consensus.ts BFT implementation
 * to actual WebSocket networking for demonstrating Byzantine Fault Tolerance.
 *
 * Run 3+ nodes:
 * - Node 1: bun run consensus-p2p.ts --port 3001 --proposer
 * - Node 2: bun run consensus-p2p.ts --port 3002
 * - Node 3: bun run consensus-p2p.ts --port 3003
 */

import { applyEntityInput, calculateQuorumPower } from '../../src/entity-consensus';
import {
  EntityInput, EntityReplica, EntityState, ConsensusConfig,
  ProposedEntityFrame, EntityTx, Env
} from '../../src/types';
import { ethers } from 'ethers';

// Network message types
interface NetworkMessage {
  type: 'entity-input' | 'heartbeat' | 'join';
  from: string;
  data: EntityInput | { nodeId: string; port: number };
  signature: string;
}

class ConsensusNode {
  private nodeId: string;
  private port: number;
  private isProposer: boolean;
  private wallet: ethers.Wallet;

  // Network state
  private peers: Map<string, WebSocket> = new Map();
  private server?: any;

  // Consensus state
  private entityReplica?: EntityReplica;
  private env: Env;

  constructor(port: number, isProposer: boolean = false) {
    this.port = port;
    this.isProposer = isProposer;

    // Deterministic wallet based on port for demo
    const seed = `0x${port.toString(16).padStart(64, '0')}`;
    this.wallet = new ethers.Wallet(seed);
    this.nodeId = this.wallet.address.slice(0, 10).toLowerCase();

    // Mock environment
    this.env = {
      timestamp: Date.now(),
      randomBytes: () => Buffer.from(ethers.randomBytes(32))
    } as any;
  }

  async init(): Promise<void> {
    console.log(`🚀 Initializing ${this.isProposer ? 'PROPOSER' : 'VALIDATOR'} node ${this.nodeId} on port ${this.port}`);

    // Initialize entity replica with real BFT config
    const validators = ['node1', 'node2', 'node3']; // Will be dynamically updated
    const config: ConsensusConfig = {
      threshold: BigInt(2), // 2 out of 3 for Byzantine fault tolerance
      validators: validators,
      shares: {
        'node1': BigInt(1),
        'node2': BigInt(1),
        'node3': BigInt(1)
      },
      mode: 'proposer-based' // Use proposer mode for clarity
    };

    const initialState: EntityState = {
      height: 0,
      timestamp: Date.now(),
      config: config,
      messages: [],
      nonces: {}  // Fixed: should be nonces not nonce
    };

    this.entityReplica = {
      entityId: 'demo-entity',
      signerId: this.nodeId,
      isProposer: this.isProposer,
      state: initialState,
      mempool: [],
      proposal: undefined,
      lockedFrame: undefined
    };

    // Start WebSocket server
    await this.startServer();

    // Connect to other nodes if not proposer
    if (!this.isProposer) {
      await this.sleep(1000); // Wait for proposer to start
      await this.connectToPeer(3001); // Connect to proposer
    }
  }

  private async startServer(): Promise<void> {
    this.server = Bun.serve({
      port: this.port,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response('BFT Consensus Node', { status: 200 });
      },
      websocket: {
        open: (ws) => {
          console.log(`🤝 Peer connected`);
        },
        message: async (ws, message) => {
          try {
            const msg = JSON.parse(message.toString()) as NetworkMessage;
            await this.handleNetworkMessage(msg, ws);
          } catch (error) {
            console.error('❌ Message handling error:', error);
          }
        },
        close: (ws) => {
          // Remove peer
          for (const [id, peer] of this.peers) {
            if (peer === ws) {
              this.peers.delete(id);
              console.log(`👋 Peer ${id} disconnected`);
              break;
            }
          }
        }
      }
    });

    console.log(`🌐 WebSocket server listening on port ${this.port}`);
  }

  private async connectToPeer(peerPort: number): Promise<void> {
    try {
      const ws = new WebSocket(`ws://localhost:${peerPort}`);

      ws.onopen = () => {
        console.log(`🔗 Connected to peer on port ${peerPort}`);

        // Send join message
        const joinMsg: NetworkMessage = {
          type: 'join',
          from: this.nodeId,
          data: { nodeId: this.nodeId, port: this.port },
          signature: this.sign({ nodeId: this.nodeId })
        };
        ws.send(JSON.stringify(joinMsg));
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data) as NetworkMessage;
          await this.handleNetworkMessage(msg, ws);
        } catch (error) {
          console.error('❌ Message handling error:', error);
        }
      };

      ws.onclose = () => {
        console.log(`👋 Disconnected from peer on port ${peerPort}`);
      };

      ws.onerror = (error) => {
        console.error(`❌ WebSocket error:`, error);
      };

    } catch (error) {
      console.error(`❌ Failed to connect to peer on port ${peerPort}:`, error);
    }
  }

  private async handleNetworkMessage(msg: NetworkMessage, ws: any): Promise<void> {
    console.log(`📨 Received ${msg.type} from ${msg.from}`);

    switch (msg.type) {
      case 'join':
        // Register peer
        const joinData = msg.data as { nodeId: string; port: number };
        this.peers.set(joinData.nodeId, ws);
        console.log(`✅ Registered peer ${joinData.nodeId}`);

        // Update validator list
        if (this.entityReplica) {
          const validators = Array.from(new Set([
            ...this.entityReplica.state.config.validators,
            joinData.nodeId
          ]));
          this.entityReplica.state.config.validators = validators;

          // Update shares
          this.entityReplica.state.config.shares[joinData.nodeId] = BigInt(1);

          // Recalculate threshold (2/3 majority)
          const totalShares = BigInt(validators.length);
          this.entityReplica.state.config.threshold = (totalShares * BigInt(2)) / BigInt(3) + BigInt(1);

          console.log(`📊 Updated validators: ${validators.join(', ')}`);
          console.log(`📊 New threshold: ${this.entityReplica.state.config.threshold}/${totalShares}`);
        }
        break;

      case 'entity-input':
        // Process consensus message through real BFT
        const entityInput = msg.data as EntityInput;
        await this.processEntityInput(entityInput);
        break;

      case 'heartbeat':
        // Keep connection alive
        break;
    }
  }

  private async processEntityInput(input: EntityInput): Promise<void> {
    if (!this.entityReplica) return;

    console.log(`⚙️ Processing entity input: ${input.entityTxs?.length || 0} txs, ${input.precommits?.size || 0} precommits`);

    // Apply input through real BFT consensus
    const outputs = applyEntityInput(this.env, this.entityReplica, input);

    // Send outputs to network
    for (const output of outputs) {
      await this.sendEntityInput(output);
    }

    // Log state after processing
    this.logConsensusState();
  }

  private async sendEntityInput(output: EntityInput): Promise<void> {
    const targetNode = output.signerId;

    // If sending to self, process directly
    if (targetNode === this.nodeId) {
      await this.processEntityInput(output);
      return;
    }

    // Send to peer
    const peer = this.peers.get(targetNode);
    if (peer) {
      const msg: NetworkMessage = {
        type: 'entity-input',
        from: this.nodeId,
        data: output,
        signature: this.sign(output)
      };

      peer.send(JSON.stringify(msg));
      console.log(`📤 Sent entity input to ${targetNode}`);
    } else {
      console.warn(`⚠️ No connection to ${targetNode}`);
    }
  }

  // Submit a transaction to consensus
  async submitTransaction(data: string): Promise<void> {
    if (!this.entityReplica) return;

    const tx: EntityTx = {
      type: 'chat',
      data: { message: data, from: this.nodeId }
    };

    const input: EntityInput = {
      entityId: this.entityReplica.entityId,
      signerId: this.nodeId,
      entityTxs: [tx]
    };

    console.log(`📝 Submitting transaction: "${data}"`);
    await this.processEntityInput(input);
  }

  private logConsensusState(): void {
    if (!this.entityReplica) return;

    const state = this.entityReplica.state;
    const proposal = this.entityReplica.proposal;

    console.log('\n📊 Consensus State:');
    console.log(`├─ Height: ${state.height}`);
    console.log(`├─ Messages: ${state.messages.length}`);
    console.log(`├─ Mempool: ${this.entityReplica.mempool.length}`);
    console.log(`├─ Proposal: ${proposal ? proposal.hash.slice(0, 10) : 'none'}`);
    console.log(`├─ Signatures: ${proposal?.signatures.size || 0}/${this.entityReplica.state.config.threshold}`);
    console.log(`└─ Is Proposer: ${this.entityReplica.isProposer}`);
  }

  private sign(data: any): string {
    const hash = ethers.id(JSON.stringify(data));
    return `sig_${this.nodeId}_${hash.slice(0, 10)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Interactive CLI
  async runCLI(): Promise<void> {
    console.log('\n🎮 Commands:');
    console.log('  send <message>  - Submit transaction to consensus');
    console.log('  status          - Show consensus state');
    console.log('  peers           - List connected peers');
    console.log('  exit            - Shutdown node');
    console.log();

    process.stdout.write('> ');

    for await (const line of console) {
      const [cmd, ...args] = line.trim().split(' ');

      switch (cmd) {
        case 'send':
          const message = args.join(' ');
          if (message) {
            await this.submitTransaction(message);
          } else {
            console.log('Usage: send <message>');
          }
          break;

        case 'status':
          this.logConsensusState();
          break;

        case 'peers':
          console.log(`Connected peers: ${Array.from(this.peers.keys()).join(', ')}`);
          break;

        case 'exit':
          console.log('👋 Shutting down...');
          process.exit(0);

        default:
          if (cmd) {
            console.log(`Unknown command: ${cmd}`);
          }
      }

      process.stdout.write('> ');
    }
  }
}

// Main
async function main() {
  const port = parseInt(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || '3001');
  const isProposer = process.argv.includes('--proposer');

  if (!port) {
    console.log('Usage:');
    console.log('  Proposer: bun run consensus-p2p.ts --port=3001 --proposer');
    console.log('  Validator: bun run consensus-p2p.ts --port=3002');
    console.log('  Validator: bun run consensus-p2p.ts --port=3003');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('        XLN BFT CONSENSUS NODE');
  console.log('═══════════════════════════════════════════════════════');
  console.log();

  const node = new ConsensusNode(port, isProposer);
  await node.init();
  await node.runCLI();
}

main().catch(console.error);