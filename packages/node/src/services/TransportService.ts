import { ethers } from 'ethers';
import { BaseService, ServiceError, IServiceConfig } from './BaseService';
import {
  IMessage,
  ITransport,
  ITransportOptions,
  TransportEventType,
  ITransportEvent,
  TransportEventHandler,
} from '@xln/types';
import { Logger } from '../utils/Logger';
import * as zlib from 'zlib';
import WebSocket from 'ws';

/**
 * Transport service configuration
 */
export interface ITransportServiceConfig extends IServiceConfig {
  transportOptions?: ITransportOptions;
  compressionThreshold?: number; // Size in bytes above which messages are compressed
  batchSize?: number; // Maximum number of messages in a batch
  batchTimeout?: number; // Maximum time to wait before sending a batch (ms)
}

/**
 * Transport metrics interface
 */
interface ITransportMetrics {
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  compressionRatio: number;
  batchSize: number;
  latency: number;
  reconnectAttempts: number;
  lastPingTime?: number;
  lastPongTime?: number;
}

/**
 * Message batch interface
 */
interface IMessageBatch {
  messages: IMessage[];
  timestamp: number;
  compressed: boolean;
}

/**
 * WebSocket transport implementation
 */
export class TransportService extends BaseService implements ITransport {
  private readonly options: ITransportOptions;
  private readonly compressionThreshold: number;
  private readonly batchSize: number;
  private readonly batchTimeout: number;
  private readonly metrics: ITransportMetrics;
  private readonly eventHandlers: Set<TransportEventHandler>;
  private readonly messageBatch: IMessage[];
  private readonly address: string;

  private ws?: WebSocket;
  private connected: boolean;
  private batchTimeoutId?: ReturnType<typeof setTimeout>;
  private reconnectAttempts: number;

  constructor(config: ITransportServiceConfig) {
    super(config);
    this.options = {
      host: 'localhost',
      port: 8080,
      ssl: false,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      pingInterval: 30000,
      pongTimeout: 5000,
      ...config.transportOptions,
    };
    this.compressionThreshold = config.compressionThreshold || 1024; // 1KB
    this.batchSize = config.batchSize || 100;
    this.batchTimeout = config.batchTimeout || 100; // 100ms
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      compressionRatio: 0,
      batchSize: 0,
      latency: 0,
      reconnectAttempts: 0,
    };
    this.eventHandlers = new Set();
    this.messageBatch = [];
    this.connected = false;
    this.reconnectAttempts = 0;
    this.address = ethers.Wallet.createRandom().address;
  }

  /**
   * Initializes the transport service
   */
  public async initialize(): Promise<void> {
    await super.initialize();
    await this.connect();
    this.startPingInterval();
  }

  /**
   * Connects to the transport network
   */
  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      const protocol = this.options.ssl ? 'wss' : 'ws';
      const url = `${protocol}://${this.options.host}:${this.options.port}`;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.emitEvent({ type: TransportEventType.CONNECTED });
        this.logger.info('Connected to transport network');
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.handleDisconnect();
      });

      this.ws.on('error', (error: Error) => {
        this.emitEvent({ type: TransportEventType.ERROR, error });
        this.logger.error('Transport error:', error);
      });

      this.ws.on('pong', () => {
        this.metrics.lastPongTime = Date.now();
        this.metrics.latency = this.metrics.lastPongTime - (this.metrics.lastPingTime || 0);
      });
    } catch (error) {
      this.handleDisconnect();
      throw new ServiceError('Failed to connect to transport network', 'TRANSPORT_CONNECT_FAILED', error);
    }
  }

  /**
   * Disconnects from the transport network
   */
  public async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      this.ws?.close();
      this.connected = false;
      this.emitEvent({ type: TransportEventType.DISCONNECTED });
      this.logger.info('Disconnected from transport network');
    } catch (error) {
      throw new ServiceError('Failed to disconnect from transport network', 'TRANSPORT_DISCONNECT_FAILED', error);
    }
  }

  /**
   * Sends a message to a peer
   */
  public async send(message: IMessage): Promise<void> {
    if (!this.connected) {
      throw new ServiceError('Not connected to transport network', 'TRANSPORT_NOT_CONNECTED');
    }

    try {
      this.messageBatch.push(message);
      this.metrics.messagesSent++;

      if (this.messageBatch.length >= this.batchSize) {
        await this.sendBatch();
      } else if (!this.batchTimeoutId) {
        this.batchTimeoutId = setTimeout(() => this.sendBatch(), this.batchTimeout);
      }
    } catch (error) {
      throw new ServiceError('Failed to send message', 'TRANSPORT_SEND_FAILED', error);
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
   * Gets the local node address
   */
  public getAddress(): string {
    return this.address;
  }

  /**
   * Gets transport metrics
   */
  public getMetrics(): ITransportMetrics {
    return { ...this.metrics };
  }

  /**
   * Handles incoming messages
   */
  private async handleMessage(data: Buffer): Promise<void> {
    try {
      this.metrics.bytesReceived += data.length;
      this.metrics.messagesReceived++;

      const batch = await this.decompressMessage(data);
      for (const message of batch.messages) {
        this.emitEvent({ type: TransportEventType.MESSAGE, data: message });
      }

      // Update compression ratio
      const originalSize = JSON.stringify(batch).length;
      const compressedSize = data.length;
      this.metrics.compressionRatio = compressedSize / originalSize;
    } catch (error) {
      this.logger.error('Failed to handle message:', error);
      this.emitEvent({ type: TransportEventType.ERROR, error: error as Error });
    }
  }

  /**
   * Handles disconnection and reconnection
   */
  private handleDisconnect(): void {
    this.connected = false;
    this.emitEvent({ type: TransportEventType.DISCONNECTED });
    this.logger.warn('Disconnected from transport network');

    if (this.reconnectAttempts < (this.options.maxReconnectAttempts || 10)) {
      this.reconnectAttempts++;
      this.metrics.reconnectAttempts = this.reconnectAttempts;
      setTimeout(() => this.connect(), this.options.reconnectInterval);
      this.logger.info(`Reconnecting... Attempt ${this.reconnectAttempts}`);
    } else {
      this.logger.error('Max reconnection attempts reached');
    }
  }

  /**
   * Sends a batch of messages
   */
  private async sendBatch(): Promise<void> {
    if (this.messageBatch.length === 0) {
      return;
    }

    try {
      const batch: IMessageBatch = {
        messages: [...this.messageBatch],
        timestamp: Date.now(),
        compressed: false,
      };

      const data = await this.compressMessage(batch);
      this.ws?.send(data);

      this.metrics.bytesSent += data.length;
      this.metrics.batchSize = this.messageBatch.length;
      this.messageBatch.length = 0;

      if (this.batchTimeoutId) {
        clearTimeout(this.batchTimeoutId);
        this.batchTimeoutId = undefined;
      }
    } catch (error) {
      this.logger.error('Failed to send batch:', error);
      throw new ServiceError('Failed to send message batch', 'TRANSPORT_BATCH_FAILED', error);
    }
  }

  /**
   * Compresses a message batch
   */
  private async compressMessage(batch: IMessageBatch): Promise<Buffer> {
    const json = JSON.stringify(batch);
    const buffer = Buffer.from(json);

    if (buffer.length < this.compressionThreshold) {
      return buffer;
    }

    return new Promise((resolve, reject) => {
      zlib.deflate(buffer, (error, result) => {
        if (error) {
          reject(error);
        } else {
          batch.compressed = true;
          resolve(result);
        }
      });
    });
  }

  /**
   * Decompresses a message batch
   */
  private async decompressMessage(data: Buffer): Promise<IMessageBatch> {
    // Try to parse as uncompressed JSON first
    try {
      const json = data.toString();
      const batch = JSON.parse(json) as IMessageBatch;
      if (!batch.compressed) {
        return batch;
      }
    } catch {
      // If parsing fails, assume it's compressed
    }

    return new Promise((resolve, reject) => {
      zlib.inflate(data, (error, result) => {
        if (error) {
          reject(error);
        } else {
          try {
            const json = result.toString();
            const batch = JSON.parse(json) as IMessageBatch;
            resolve(batch);
          } catch (parseError) {
            reject(parseError);
          }
        }
      });
    });
  }

  /**
   * Starts the ping interval
   */
  private startPingInterval(): void {
    setInterval(() => {
      if (this.connected) {
        this.metrics.lastPingTime = Date.now();
        this.ws?.ping();

        // Check for pong timeout
        setTimeout(() => {
          const pongTime = this.metrics.lastPongTime || 0;
          const pingTime = this.metrics.lastPingTime || 0;
          if (pongTime < pingTime) {
            this.logger.warn('Pong timeout, reconnecting...');
            this.handleDisconnect();
          }
        }, this.options.pongTimeout);
      }
    }, this.options.pingInterval);
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
}
