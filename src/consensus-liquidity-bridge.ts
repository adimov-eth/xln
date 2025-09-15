#!/usr/bin/env bun

/**
 * Consensus-Liquidity Bridge
 *
 * Connects the running consensus nodes to the unified liquidity pool.
 * Orders approved by consensus get submitted to the order book.
 */

import { WebSocket } from 'ws';
import { ethers } from 'ethers';

// Connect to consensus node
const consensusWs = new WebSocket('ws://localhost:3001');

// Connect to XLN core WebSocket
const xlnWs = new WebSocket('ws://localhost:8888');

// HTTP client for XLN core API
const XLN_API = 'http://localhost:8889';

interface ConsensusMessage {
  type: string;
  transaction?: any;
  state?: any;
}

interface Order {
  source: 'custodial' | 'trustless';
  account?: string;
  channel?: string;
  pair: string;
  side: 'buy' | 'sell';
  price: bigint;
  amount: bigint;
}

// Track consensus state
let consensusConnected = false;
let xlnConnected = false;

consensusWs.on('open', () => {
  console.log('✅ Connected to consensus node on port 3001');
  consensusConnected = true;

  // Join consensus network
  consensusWs.send(JSON.stringify({
    type: 'join',
    nodeId: 'liquidity-bridge'
  }));
});

xlnWs.on('open', () => {
  console.log('✅ Connected to XLN Core on port 8888');
  xlnConnected = true;
});

// Handle consensus messages
consensusWs.on('message', (data) => {
  const message: ConsensusMessage = JSON.parse(data.toString());

  if (message.type === 'consensus-reached') {
    console.log('📊 Consensus reached on transaction:', message.transaction);

    // If it's an order transaction, submit to XLN
    if (message.transaction?.type === 'order') {
      submitOrderToXLN(message.transaction.order);
    }
  }
});

// Handle XLN updates
xlnWs.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'match') {
    console.log('✅ Order matched:', message.match);

    // Report match back to consensus
    if (consensusConnected) {
      consensusWs.send(JSON.stringify({
        type: 'submit',
        transaction: {
          type: 'match-report',
          match: message.match,
          timestamp: Date.now()
        }
      }));
    }
  }
});

// Submit order to XLN core
async function submitOrderToXLN(order: Order) {
  try {
    const response = await fetch(`${XLN_API}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('📤 Order submitted to XLN:', result.orderId);
    }
  } catch (error) {
    console.error('Failed to submit order:', error);
  }
}

// Demo: Submit test orders through consensus
setTimeout(() => {
  if (!consensusConnected) {
    console.log('⚠️ Not connected to consensus yet');
    return;
  }

  console.log('\n📊 Submitting test orders through consensus...\n');

  // Submit buy order through consensus
  consensusWs.send(JSON.stringify({
    type: 'submit',
    transaction: {
      type: 'order',
      order: {
        source: 'custodial',
        account: 'consensus-alice',
        pair: 'ETH/USDC',
        side: 'buy',
        price: ethers.parseUnits('4250', 6).toString(),
        amount: ethers.parseEther('0.5').toString()
      }
    }
  }));

  // Submit sell order through consensus
  setTimeout(() => {
    consensusWs.send(JSON.stringify({
      type: 'submit',
      transaction: {
        type: 'order',
        order: {
          source: 'trustless',
          channel: 'consensus-channel',
          pair: 'ETH/USDC',
          side: 'sell',
          price: ethers.parseUnits('4240', 6).toString(),
          amount: ethers.parseEther('0.5').toString()
        }
      }
    }));
  }, 1000);
}, 3000);

// Handle errors
consensusWs.on('error', (error) => {
  console.error('Consensus WebSocket error:', error);
});

xlnWs.on('error', (error) => {
  console.error('XLN WebSocket error:', error);
});

consensusWs.on('close', () => {
  console.log('Consensus connection closed');
  consensusConnected = false;
});

xlnWs.on('close', () => {
  console.log('XLN connection closed');
  xlnConnected = false;
});

console.log('🌉 Consensus-Liquidity Bridge Starting...');
console.log('Connecting to consensus node on port 3001...');
console.log('Connecting to XLN Core on port 8888...');