import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { TransportService } from '../services/TransportService';
import { MockTransportService } from '../services/MockTransportService';
import { MessageType, TransportEventType } from '@xln/types';
import { Logger } from '../utils/Logger';

describe('Transport Service Tests', () => {
  let transport: TransportService;

  beforeEach(async () => {
    transport = new TransportService({
      dbPath: ':memory:',
      logger: new Logger({ name: 'transport-test' }),
      transportOptions: {
        host: 'localhost',
        port: 8080,
      },
    });
    await transport.initialize();
  });

  afterEach(async () => {
    await transport.close();
  });

  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      expect(transport.isConnected()).to.be.true;
    });

    it('should disconnect successfully', async () => {
      await transport.disconnect();
      expect(transport.isConnected()).to.be.false;
    });

    it('should reconnect after disconnection', async () => {
      await transport.disconnect();
      await transport.connect();
      expect(transport.isConnected()).to.be.true;
    });

    it('should handle connection errors gracefully', async () => {
      const badTransport = new TransportService({
        dbPath: ':memory:',
        transportOptions: {
          host: 'invalid-host',
          port: 9999,
        },
      });

      try {
        await badTransport.connect();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.code).to.equal('TRANSPORT_CONNECT_FAILED');
      }
    });
  });

  describe('Message Handling', () => {
    it('should send messages successfully', async () => {
      const message = {
        type: MessageType.STATE_UPDATE,
        channelId: '123',
        timestamp: Date.now(),
        sender: transport.getAddress(),
        recipient: 'test-recipient',
        state: { balance: '100' },
        nonce: 1,
      };

      await transport.send(message);
      // Success if no error thrown
    });

    it('should handle message events', (done) => {
      const message = {
        type: MessageType.PING,
        channelId: 'system',
        timestamp: Date.now(),
        sender: 'test-sender',
        recipient: transport.getAddress(),
      };

      transport.subscribe((event) => {
        if (event.type === TransportEventType.MESSAGE) {
          expect(event.data).to.deep.equal(message);
          done();
        }
      });

      // Simulate receiving a message
      transport['handleMessage'](Buffer.from(JSON.stringify(message)));
    });

    it('should compress large messages', async () => {
      const largeData = Buffer.alloc(2048).fill('x').toString();
      const message = {
        type: MessageType.STATE_UPDATE,
        channelId: '123',
        timestamp: Date.now(),
        sender: transport.getAddress(),
        recipient: 'test-recipient',
        state: { data: largeData },
        nonce: 1,
      };

      await transport.send(message);
      const metrics = transport['getMetrics']();
      expect(metrics.compressionRatio).to.be.lessThan(1);
    });
  });

  describe('Event Handling', () => {
    it('should emit connection events', (done) => {
      transport.subscribe((event) => {
        if (event.type === TransportEventType.CONNECTED) {
          done();
        }
      });

      transport.connect();
    });

    it('should emit disconnection events', (done) => {
      transport.subscribe((event) => {
        if (event.type === TransportEventType.DISCONNECTED) {
          done();
        }
      });

      transport.disconnect();
    });

    it('should emit error events', (done) => {
      transport.subscribe((event) => {
        if (event.type === TransportEventType.ERROR) {
          expect(event.error).to.exist;
          done();
        }
      });

      // Simulate an error
      transport['handleMessage'](Buffer.from('invalid-json'));
    });
  });
});

describe('Mock Transport Service Tests', () => {
  let mockTransport1: MockTransportService;
  let mockTransport2: MockTransportService;

  beforeEach(async () => {
    mockTransport1 = new MockTransportService({
      dbPath: ':memory:',
      logger: new Logger({ name: 'mock1-test' }),
      latency: 10,
      packetLoss: 0.1,
      bandwidth: 1024 * 1024,
      jitter: 5,
      disconnectProbability: 0,
    });

    mockTransport2 = new MockTransportService({
      dbPath: ':memory:',
      logger: new Logger({ name: 'mock2-test' }),
      latency: 10,
      packetLoss: 0,
      bandwidth: 1024 * 1024,
      jitter: 5,
      disconnectProbability: 0,
    });

    await mockTransport1.initialize();
    await mockTransport2.initialize();

    // Connect the peers
    mockTransport1.addPeer(mockTransport2);
    mockTransport2.addPeer(mockTransport1);
  });

  afterEach(async () => {
    await mockTransport1.close();
    await mockTransport2.close();
  });

  describe('Network Simulation', () => {
    it('should simulate network latency', async () => {
      const start = Date.now();
      const message = {
        type: MessageType.PING,
        channelId: 'system',
        timestamp: Date.now(),
        sender: mockTransport1.getAddress(),
        recipient: mockTransport2.getAddress(),
      };

      await mockTransport1.send(message);
      const end = Date.now();
      const duration = end - start;

      expect(duration).to.be.at.least(5); // Minimum latency
    });

    it('should simulate packet loss', async () => {
      const message = {
        type: MessageType.PING,
        channelId: 'system',
        timestamp: Date.now(),
        sender: mockTransport1.getAddress(),
        recipient: mockTransport2.getAddress(),
      };

      // Send multiple messages to test packet loss
      const attempts = 100;
      for (let i = 0; i < attempts; i++) {
        await mockTransport1.send(message);
      }

      const stats = mockTransport1.getNetworkStats();
      expect(stats.droppedPackets).to.be.greaterThan(0);
      expect(stats.droppedPackets / attempts).to.be.approximately(0.1, 0.05); // ~10% packet loss
    });

    it('should enforce bandwidth limits', async () => {
      const largeData = Buffer.alloc(1024 * 1024 + 1)
        .fill('x')
        .toString(); // Exceeds 1MB limit
      const message = {
        type: MessageType.STATE_UPDATE,
        channelId: '123',
        timestamp: Date.now(),
        sender: mockTransport1.getAddress(),
        recipient: mockTransport2.getAddress(),
        state: { data: largeData },
        nonce: 1,
      };

      try {
        await mockTransport1.send(message);
        expect.fail('Should have thrown bandwidth exceeded error');
      } catch (error: any) {
        expect(error.code).to.equal('MOCK_BANDWIDTH_EXCEEDED');
      }
    });

    it('should track network statistics', async () => {
      const message = {
        type: MessageType.PING,
        channelId: 'system',
        timestamp: Date.now(),
        sender: mockTransport1.getAddress(),
        recipient: mockTransport2.getAddress(),
      };

      await mockTransport1.send(message);
      const stats = mockTransport1.getNetworkStats();

      expect(stats.totalPackets).to.be.greaterThan(0);
      expect(stats.bytesTransferred).to.be.greaterThan(0);
      expect(stats.averageLatency).to.be.greaterThan(0);
    });
  });

  describe('Peer Management', () => {
    it('should deliver messages between peers', (done) => {
      const message = {
        type: MessageType.PING,
        channelId: 'system',
        timestamp: Date.now(),
        sender: mockTransport1.getAddress(),
        recipient: mockTransport2.getAddress(),
      };

      mockTransport2.subscribe((event) => {
        if (event.type === TransportEventType.MESSAGE) {
          expect(event.data).to.deep.equal(message);
          done();
        }
      });

      mockTransport1.send(message);
    });

    it('should handle unknown peers', async () => {
      const message = {
        type: MessageType.PING,
        channelId: 'system',
        timestamp: Date.now(),
        sender: mockTransport1.getAddress(),
        recipient: 'unknown-peer',
      };

      try {
        await mockTransport1.send(message);
        expect.fail('Should have thrown peer not found error');
      } catch (error: any) {
        expect(error.code).to.equal('MOCK_PEER_NOT_FOUND');
      }
    });

    it('should handle peer removal', async () => {
      const peer2Address = mockTransport2.getAddress();
      mockTransport1.removePeer(peer2Address);

      const message = {
        type: MessageType.PING,
        channelId: 'system',
        timestamp: Date.now(),
        sender: mockTransport1.getAddress(),
        recipient: peer2Address,
      };

      try {
        await mockTransport1.send(message);
        expect.fail('Should have thrown peer not found error');
      } catch (error: any) {
        expect(error.code).to.equal('MOCK_PEER_NOT_FOUND');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle reconnection throttling', async () => {
      await mockTransport1.disconnect();

      try {
        await mockTransport1.connect();
        await mockTransport1.connect(); // Immediate reconnect attempt
        expect.fail('Should have thrown reconnect too fast error');
      } catch (error: any) {
        expect(error.code).to.equal('MOCK_RECONNECT_TOO_FAST');
      }
    });

    it('should handle disconnected state', async () => {
      await mockTransport1.disconnect();

      try {
        await mockTransport1.send({
          type: MessageType.PING,
          channelId: 'system',
          timestamp: Date.now(),
          sender: mockTransport1.getAddress(),
          recipient: mockTransport2.getAddress(),
        });
        expect.fail('Should have thrown not connected error');
      } catch (error: any) {
        expect(error.code).to.equal('MOCK_NOT_CONNECTED');
      }
    });
  });
});
