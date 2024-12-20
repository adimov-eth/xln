import { expect } from 'chai';
import http from 'http';
import WebSocket from 'ws';
import { TransportService } from '../services/TransportService';
import { WebSocketRouter } from '../routes/websocketRouter';
import { PaymentWebSocketHandler } from '../routes/paymentWebSocket';
import { SwapWebSocketHandler } from '../routes/swapWebSocket';
import { PaymentService } from '../services/PaymentService';
import { SwapService } from '../services/SwapService';
import { ChannelService } from '../services/ChannelService';
import { MessageType } from '@xln/types';
import { Logger } from '../utils/Logger';

describe('Transport Integration Tests', () => {
  let server: http.Server;
  let transport: TransportService;
  let wsRouter: WebSocketRouter;
  let channelService: ChannelService;
  let paymentService: PaymentService;
  let swapService: SwapService;
  let paymentHandler: PaymentWebSocketHandler;
  let swapHandler: SwapWebSocketHandler;
  let clientWs: WebSocket;
  const port = 8081;

  beforeEach(async () => {
    // Initialize services
    channelService = new ChannelService({
      dbPath: ':memory:',
      logger: new Logger({ name: 'channel-test' }),
    });

    paymentService = new PaymentService({
      dbPath: ':memory:',
      logger: new Logger({ name: 'payment-test' }),
      channelService,
    });

    swapService = new SwapService({
      dbPath: ':memory:',
      logger: new Logger({ name: 'swap-test' }),
      channelService,
    });

    transport = new TransportService({
      dbPath: ':memory:',
      logger: new Logger({ name: 'transport-test' }),
      transportOptions: {
        host: 'localhost',
        port,
      },
    });

    // Initialize handlers
    paymentHandler = new PaymentWebSocketHandler({
      paymentService,
      logger: new Logger({ name: 'payment-ws-test' }),
    });

    swapHandler = new SwapWebSocketHandler({
      swapService,
      logger: new Logger({ name: 'swap-ws-test' }),
    });

    // Create HTTP server
    server = http.createServer();
    wsRouter = new WebSocketRouter({
      server,
      transport,
      logger: new Logger({ name: 'ws-router-test' }),
    });

    // Initialize all services
    await channelService.initialize();
    await paymentService.initialize();
    await swapService.initialize();
    await transport.initialize();

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(port, () => resolve());
    });

    // Connect client
    clientWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => {
      clientWs.on('open', () => resolve());
    });
  });

  afterEach(async () => {
    clientWs.close();
    wsRouter.close();
    server.close();
    await transport.close();
    await paymentService.close();
    await swapService.close();
    await channelService.close();
  });

  describe('End-to-End Message Flow', () => {
    it('should handle payment request and response', (done) => {
      const paymentRequest = {
        type: MessageType.PAYMENT_REQUEST,
        channelId: '123',
        amount: '100',
        tokenId: 'ETH',
        hashlock: '0x123',
        timelock: 100,
        timestamp: Date.now(),
        sender: 'client',
        recipient: transport.getAddress(),
      };

      // Handle payment response
      clientWs.on('message', (data: WebSocket.Data) => {
        const response = JSON.parse(data.toString());
        expect(response.type).to.equal(MessageType.PAYMENT_RESPONSE);
        expect(response.channelId).to.equal(paymentRequest.channelId);
        expect(response.status).to.equal('accepted');
        done();
      });

      // Send payment request
      clientWs.send(JSON.stringify(paymentRequest));
    });

    it('should handle swap request and response', (done) => {
      const swapRequest = {
        type: MessageType.SWAP_REQUEST,
        channelId: '123',
        tokenIdA: 'ETH',
        tokenIdB: 'DAI',
        amountA: '1',
        amountB: '1000',
        timelock: 100,
        timestamp: Date.now(),
        sender: 'client',
        recipient: transport.getAddress(),
      };

      // Handle swap response
      clientWs.on('message', (data: WebSocket.Data) => {
        const response = JSON.parse(data.toString());
        expect(response.type).to.equal(MessageType.SWAP_RESPONSE);
        expect(response.channelId).to.equal(swapRequest.channelId);
        expect(response.status).to.equal('accepted');
        done();
      });

      // Send swap request
      clientWs.send(JSON.stringify(swapRequest));
    });
  });

  describe('Connection Management', () => {
    it('should handle reconnection', async () => {
      // Close client connection
      clientWs.close();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Reconnect
      clientWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => {
        clientWs.on('open', () => resolve());
      });

      expect(clientWs.readyState).to.equal(WebSocket.OPEN);
    });

    it('should handle multiple clients', async () => {
      const client2 = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => {
        client2.on('open', () => resolve());
      });

      expect(client2.readyState).to.equal(WebSocket.OPEN);
      client2.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid message format', (done) => {
      clientWs.on('message', (data: WebSocket.Data) => {
        const response = JSON.parse(data.toString());
        expect(response.type).to.equal(MessageType.ERROR);
        done();
      });

      clientWs.send('invalid json');
    });

    it('should handle unknown message type', (done) => {
      const invalidMessage = {
        type: 'UNKNOWN_TYPE',
        timestamp: Date.now(),
        sender: 'client',
        recipient: transport.getAddress(),
      };

      clientWs.on('message', (data: WebSocket.Data) => {
        const response = JSON.parse(data.toString());
        expect(response.type).to.equal(MessageType.ERROR);
        done();
      });

      clientWs.send(JSON.stringify(invalidMessage));
    });
  });

  describe('Performance', () => {
    it('should handle high message throughput', async () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        type: MessageType.PING,
        timestamp: Date.now(),
        sender: 'client',
        recipient: transport.getAddress(),
        data: `message-${i}`,
      }));

      let received = 0;
      clientWs.on('message', () => {
        received++;
      });

      // Send messages rapidly
      for (const message of messages) {
        clientWs.send(JSON.stringify(message));
      }

      // Wait for all responses
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(received).to.be.greaterThan(0);
    });

    it('should compress large messages', (done) => {
      const largeData = Buffer.alloc(10000).fill('x').toString();
      const message = {
        type: MessageType.PING,
        timestamp: Date.now(),
        sender: 'client',
        recipient: transport.getAddress(),
        data: largeData,
      };

      clientWs.on('message', () => {
        const metrics = transport.getMetrics();
        expect(metrics.compressionRatio).to.be.lessThan(1);
        done();
      });

      clientWs.send(JSON.stringify(message));
    });
  });
});
