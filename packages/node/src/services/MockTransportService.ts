import { BaseService, ServiceError, IServiceConfig } from './BaseService';
import {
  IMessage,
  ITransport,
  ITransportOptions,
  TransportEventType,
  ITransportEvent,
  TransportEventHandler,
} from '@xln/types';
import { EventEmitter } from 'events';

/**
 * Mock transport configuration
 */
export interface IMockTransportConfig extends IServiceConfig {
  latency?: number; // Simulated network latency in ms
  packetLoss?: number; // Packet loss probability (0-1)
  bandwidth?: number; // Bandwidth limit in bytes/second
  jitter?: number; // Random latency variation in ms
  disconnectProbability?: number; // Random disconnect probability (0-1)
  reconnectDelay?: number; // Time to wait before reconnecting in ms
}

/**
 * Network simulation stats
 */
interface INetworkStats {
  droppedPackets: number;
  totalPackets: number;
  bytesTransferred: number;
  averageLatency: number;
  disconnections: number;
  reconnections: number;
}

/**
 * Mock transport service for testing
 */
export class MockTransportService extends BaseService implements ITransport {
  private readonly config: IMockTransportConfig;
  private readonly eventEmitter: EventEmitter;
  private readonly eventHandlers: Set<TransportEventHandler>;
  private readonly networkStats: INetworkStats;
  private readonly address: string;
  private readonly peers: Map<string, MockTransportService>;

  private connected: boolean;
  private bandwidthTimer?: ReturnType<typeof setInterval>;
  private currentBandwidth: number;
  private lastReconnectTime: number;

  constructor(config: IMockTransportConfig) {
    super(config);
    this.config = {
      latency: 50, // 50ms default latency
      packetLoss: 0.01, // 1% packet loss
      bandwidth: 1024 * 1024, // 1MB/s
      jitter: 10, // 10ms jitter
      disconnectProbability: 0.001, // 0.1% disconnect chance
      reconnectDelay: 1000, // 1s reconnect delay
      ...config,
    };
    this.eventEmitter = new EventEmitter();
    this.eventHandlers = new Set();
    this.networkStats = {
      droppedPackets: 0,
      totalPackets: 0,
      bytesTransferred: 0,
      averageLatency: 0,
      disconnections: 0,
      reconnections: 0,
    };
    this.address = `mock-${Math.random().toString(36).substring(7)}`;
    this.peers = new Map();
    this.connected = false;
    this.currentBandwidth = 0;
    this.lastReconnectTime = 0;
  }

  /**
   * Initializes the mock transport
   */
  public async initialize(): Promise<void> {
    await super.initialize();
    await this.connect();
    this.startBandwidthControl();
  }

  /**
   * Connects to the mock network
   */
  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const now = Date.now();
    if (now - this.lastReconnectTime < this.config.reconnectDelay!) {
      throw new ServiceError('Too many reconnection attempts', 'MOCK_RECONNECT_TOO_FAST');
    }

    this.connected = true;
    this.lastReconnectTime = now;
    this.networkStats.reconnections++;
    this.emitEvent({ type: TransportEventType.CONNECTED });
    this.logger.info('Connected to mock network');

    // Simulate random disconnects
    this.startDisconnectSimulation();
  }

  /**
   * Disconnects from the mock network
   */
  public async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    this.networkStats.disconnections++;
    this.emitEvent({ type: TransportEventType.DISCONNECTED });
    this.logger.info('Disconnected from mock network');
  }

  /**
   * Sends a message through the mock network
   */
  public async send(message: IMessage): Promise<void> {
    if (!this.connected) {
      throw new ServiceError('Not connected to mock network', 'MOCK_NOT_CONNECTED');
    }

    this.networkStats.totalPackets++;

    // Simulate packet loss
    if (Math.random() < this.config.packetLoss!) {
      this.networkStats.droppedPackets++;
      this.logger.debug('Packet dropped');
      return;
    }

    // Calculate message size
    const messageSize = Buffer.from(JSON.stringify(message)).length;

    // Check bandwidth limit
    if (this.currentBandwidth + messageSize > this.config.bandwidth!) {
      throw new ServiceError('Bandwidth limit exceeded', 'MOCK_BANDWIDTH_EXCEEDED');
    }

    this.currentBandwidth += messageSize;
    this.networkStats.bytesTransferred += messageSize;

    // Calculate latency with jitter
    const latency = this.config.latency! + (Math.random() * 2 - 1) * this.config.jitter!;
    this.networkStats.averageLatency =
      (this.networkStats.averageLatency * (this.networkStats.totalPackets - 1) + latency) /
      this.networkStats.totalPackets;

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, latency));

    // Deliver message to recipient
    const peer = this.peers.get(message.recipient);
    if (peer) {
      peer.receiveMessage(message);
    } else {
      throw new ServiceError('Peer not found', 'MOCK_PEER_NOT_FOUND');
    }
  }

  /**
   * Subscribes to transport events
   */
  public subscribe(handler: TransportEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Unsubscribes from transport events
   */
  public unsubscribe(handler: TransportEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Gets the connection status
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Gets the mock address
   */
  public getAddress(): string {
    return this.address;
  }

  /**
   * Gets network simulation stats
   */
  public getNetworkStats(): INetworkStats {
    return { ...this.networkStats };
  }

  /**
   * Adds a peer to the mock network
   */
  public addPeer(peer: MockTransportService): void {
    this.peers.set(peer.getAddress(), peer);
  }

  /**
   * Removes a peer from the mock network
   */
  public removePeer(address: string): void {
    this.peers.delete(address);
  }

  /**
   * Receives a message from the mock network
   */
  private receiveMessage(message: IMessage): void {
    if (!this.connected) {
      return;
    }

    this.emitEvent({
      type: TransportEventType.MESSAGE,
      data: message,
    });
  }

  /**
   * Starts the bandwidth control simulation
   */
  private startBandwidthControl(): void {
    this.bandwidthTimer = setInterval(() => {
      this.currentBandwidth = 0;
    }, 1000); // Reset bandwidth counter every second
  }

  /**
   * Starts the random disconnect simulation
   */
  private startDisconnectSimulation(): void {
    const checkDisconnect = () => {
      if (this.connected && Math.random() < this.config.disconnectProbability!) {
        this.logger.debug('Random disconnect triggered');
        this.disconnect();

        // Attempt to reconnect after delay
        setTimeout(() => {
          this.connect().catch((error) => {
            this.logger.error('Failed to reconnect:', error);
          });
        }, this.config.reconnectDelay);
      }
    };

    setInterval(checkDisconnect, 1000); // Check for disconnects every second
  }

  /**
   * Emits a transport event
   */
  private emitEvent(event: ITransportEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        this.logger.error('Event handler error:', error);
      }
    }
  }

  /**
   * Cleans up resources
   */
  public async close(): Promise<void> {
    await super.close();
    if (this.bandwidthTimer) {
      clearInterval(this.bandwidthTimer);
    }
    this.eventEmitter.removeAllListeners();
    this.peers.clear();
  }
}
