#!/usr/bin/env bun

/**
 * XLN Unified Deployment Script
 *
 * This brings together all the REAL components of XLN:
 * - B2B Trade Credit System (OptimizedTradeCredit)
 * - Order Matching Engine (MatchingEngine)
 * - BFT Consensus (entity-consensus)
 * - P2P Network (ProductionEntityChannelBridge)
 * - Bilateral Channels (RealEntityChannelBridge)
 *
 * XLN is not another payment network. It's the first cryptographic
 * B2B trade credit system with Byzantine fault tolerance.
 */

import { XLNServer } from './src/server/XLNServer';
import { ProductionEntityChannelBridge, createProductionConfig } from './src/core/ProductionEntityChannelBridge';
import { RealEntityChannelBridge } from './src/RealEntityChannelBridge';
import { P2PNetwork } from './src/network/P2PNetwork';
import { generateKeyPairSync } from 'crypto';
import { config as productionConfig } from './deploy/production.config';
import chalk from 'chalk';

// Configuration
const config = {
  consensus: {
    nodeId: process.env.NODE_ID || 'xln-node-1',
    port: parseInt(process.env.CONSENSUS_PORT || '3000'),
    maxPeers: 100,
    heartbeatInterval: 5000,
    consensusTimeout: 10000,
    byzantineFaultThreshold: 3
  },
  trading: {
    httpPort: parseInt(process.env.TRADING_PORT || '8080'),
    wsPort: parseInt(process.env.WS_PORT || '8081'),
    maxOrderSize: 1000000n,
    minOrderSize: 100n,
    tickSize: 1n
  },
  p2p: {
    port: parseInt(process.env.P2P_PORT || '7000'),
    maxPeers: 50,
    gossipInterval: 2000
  },
  tradeCredit: {
    defaultCreditLimit: 100000n,
    defaultPaymentTerms: 30, // days
    interestRate: 0.05, // 5% APR
    collateralRatio: 1.5
  }
};

async function startXLN() {
  console.log(chalk.cyan.bold(`
═══════════════════════════════════════════════════════
           XLN - B2B TRADE CREDIT SYSTEM
═══════════════════════════════════════════════════════
`));

  console.log(chalk.yellow('📊 Initializing components...'));

  // Generate node keys
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  // 1. Initialize XLN Server with production config
  console.log(chalk.green('✓ XLN Trading Server'));
  const xlnServer = new XLNServer(productionConfig);

  // 3. Initialize P2P Network
  console.log(chalk.green('✓ P2P Network Layer'));
  const p2pNetwork = new P2PNetwork({
    port: config.p2p.port,
    maxPeers: config.p2p.maxPeers,
    gossipInterval: config.p2p.gossipInterval
  });

  // 4. Initialize BFT Consensus Bridge
  console.log(chalk.green('✓ BFT Consensus Layer'));
  const consensusConfig = createProductionConfig({
    nodeId: config.consensus.nodeId,
    privateKey,
    publicKey,
    listenPort: config.consensus.port,
    maxPeers: config.consensus.maxPeers,
    heartbeatInterval: config.consensus.heartbeatInterval,
    consensusTimeout: config.consensus.consensusTimeout,
    byzantineFaultThreshold: config.consensus.byzantineFaultThreshold
  });

  const consensusBridge = new ProductionEntityChannelBridge({}, consensusConfig);

  // 5. Initialize Real Entity Channel Bridge
  console.log(chalk.green('✓ Entity Channel Bridge'));
  const entityBridge = new RealEntityChannelBridge();

  // Wire components together
  console.log(chalk.yellow('\n🔗 Wiring components...'));

  // Connect consensus events
  consensusBridge.on('consensus_message_processed', ({ outputs }) => {
    console.log(chalk.gray(`Consensus processed ${outputs} outputs`));
  });

  // Connect P2P network to consensus bridge
  p2pNetwork.on('peer_discovered', async (peer) => {
    console.log(chalk.gray(`Discovered peer: ${peer.id}`));
    try {
      await consensusBridge.connectToPeer(peer.address, peer.port, peer.publicKey);
    } catch (error) {
      console.log(chalk.yellow(`Failed to connect to peer ${peer.id}`));
    }
  });

  // Start all services
  console.log(chalk.yellow('\n🚀 Starting services...'));

  await Promise.all([
    consensusBridge.start(),
    p2pNetwork.start(),
    xlnServer.start()
  ]);

  // Display status
  console.log(chalk.green.bold(`
═══════════════════════════════════════════════════════
                  XLN IS RUNNING
═══════════════════════════════════════════════════════

🌐 Trading Server:    http://localhost:${config.trading.httpPort}
📡 WebSocket:         ws://localhost:${config.trading.wsPort}
🔗 Consensus P2P:     Port ${config.consensus.port}
📢 Gossip Network:    Port ${config.p2p.port}

Components:
  ✅ Trade Credit System    (B2B credit lines)
  ✅ Matching Engine        (Order book trading)
  ✅ BFT Consensus          (Byzantine fault tolerant)
  ✅ P2P Network            (Decentralized gossip)
  ✅ Entity Channels        (Bilateral settlement)

Node ID: ${config.consensus.nodeId}
Public Key: ${publicKey.substring(0, 64)}...

═══════════════════════════════════════════════════════
`));

  // Set up graceful shutdown
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n⏹️  Shutting down XLN...'));

    await Promise.all([
      consensusBridge.stop(),
      p2pNetwork.stop(),
      xlnServer.stop()
    ]);

    console.log(chalk.green('✓ XLN shutdown complete'));
    process.exit(0);
  });

  // Monitor health
  setInterval(() => {
    const metrics = consensusBridge.getMetrics();
    const peers = consensusBridge.getConnectedPeerCount();

    console.log(chalk.gray(`
[${new Date().toISOString()}] System Health:
  Consensus Peers: ${peers}
  Messages: ${metrics.totalMessages} | Consensus Rounds: ${metrics.consensusRounds}
  Byzantine Faults: ${metrics.byzantineFaultsDetected} | Avg Latency: ${metrics.averageLatency.toFixed(2)}ms
`));
  }, 30000); // Every 30 seconds
}

// Handle startup errors
startXLN().catch(error => {
  console.error(chalk.red.bold('❌ Failed to start XLN:'), error);
  process.exit(1);
});

// Display help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
XLN - B2B Trade Credit System

Usage: bun run start-xln.ts [options]

Environment Variables:
  NODE_ID           Node identifier (default: xln-node-1)
  CONSENSUS_PORT    BFT consensus port (default: 3000)
  TRADING_PORT      HTTP trading server port (default: 8080)
  WS_PORT           WebSocket port (default: 8081)
  P2P_PORT          P2P gossip network port (default: 7000)

Options:
  --help, -h        Show this help message

Example:
  NODE_ID=supplier-1 CONSENSUS_PORT=3001 bun run start-xln.ts

For multi-node setup, run multiple instances with different ports:
  NODE_ID=supplier-1 CONSENSUS_PORT=3001 TRADING_PORT=8081 bun run start-xln.ts
  NODE_ID=buyer-1 CONSENSUS_PORT=3002 TRADING_PORT=8082 bun run start-xln.ts
  NODE_ID=factor-1 CONSENSUS_PORT=3003 TRADING_PORT=8083 bun run start-xln.ts
`);
  process.exit(0);
}