import { Server } from 'http';
import WebSocket from 'ws';
import { TransportService } from '../services/TransportService';
import {
  MessageType,
  IMessage,
  TransportEventType,
  ITransportEvent,
  IErrorMessage,
  ITransportMetrics,
} from '@xln/types';
import { Logger } from '../utils/Logger';

/**
 * WebSocket router configuration
 */
interface IWebSocketRouterConfig {
  server: Server;
  transport: TransportService;
  logger?: Logger;
}

/**
 * WebSocket connection state
 */
interface IWebSocketConnection {
  ws: WebSocket;
  address: string;
  lastPing?: number;
  lastPong?: number;
}

/**
 * WebSocket router for handling real-time communication
 */
export class WebSocketRouter {
  private readonly wss: WebSocket.Server;
  private readonly transport: TransportService;
  private readonly logger: Logger;
  private readonly connections: Map<string, IWebSocketConnection>;
  private readonly metrics: {
    totalConnections: number;
    activeConnections: number;
    messagesReceived: number;
    messagesSent: number;
    errors: number;
  };

  constructor(config: IWebSocketRouterConfig) {
    this.wss = new WebSocket.Server({ server: config.server });
    this.transport = config.transport;
    this.logger = config.logger || new Logger({ name: 'WebSocketRouter' });
    this.connections = new Map();
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
    };

    this.initialize();
  }

  /**
   * Initializes the WebSocket router
   */
  private initialize(): void {
    // Handle new WebSocket connections
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    // Subscribe to transport events
    this.transport.subscribe((event: ITransportEvent) => {
      this.handleTransportEvent(event);
    });

    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Handles a new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    const address = this.transport.getAddress();
    const connection: IWebSocketConnection = {
      ws,
      address,
      lastPing: Date.now(),
    };

    this.connections.set(address, connection);
    this.metrics.totalConnections++;
    this.metrics.activeConnections++;

    this.logger.info(`New WebSocket connection from ${address}`);

    // Handle incoming messages
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.metrics.messagesReceived++;
        this.handleMessage(connection, message);
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Failed to handle message:', error);
      }
    });

    // Handle connection close
    ws.on('close', () => {
      this.connections.delete(address);
      this.metrics.activeConnections--;
      this.logger.info(`WebSocket connection closed for ${address}`);
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      this.metrics.errors++;
      this.logger.error(`WebSocket error for ${address}:`, error);
    });

    // Handle pong messages
    ws.on('pong', () => {
      connection.lastPong = Date.now();
    });
  }

  /**
   * Handles an incoming message
   */
  private async handleMessage(connection: IWebSocketConnection, message: IMessage): Promise<void> {
    if (!this.validateMessage(message)) {
      this.sendError(connection, 'Invalid message format');
      return;
    }

    try {
      await this.transport.send({
        ...message,
        sender: connection.address,
        timestamp: Date.now(),
      });
      this.metrics.messagesSent++;
    } catch (error) {
      this.metrics.errors++;
      this.sendError(connection, error instanceof Error ? error.message : 'Failed to process message');
    }
  }

  /**
   * Handles transport events
   */
  private handleTransportEvent(event: ITransportEvent): void {
    switch (event.type) {
      case TransportEventType.MESSAGE:
        if (event.data?.recipient) {
          const connection = this.connections.get(event.data.recipient);
          if (connection) {
            this.sendMessage(connection, event.data);
          }
        }
        break;

      case TransportEventType.ERROR:
        this.metrics.errors++;
        this.logger.error('Transport error:', event.error);
        break;
    }
  }

  /**
   * Sends a message to a WebSocket connection
   */
  private sendMessage(connection: IWebSocketConnection, message: IMessage): void {
    try {
      connection.ws.send(JSON.stringify(message));
      this.metrics.messagesSent++;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error(`Failed to send message to ${connection.address}:`, error);
    }
  }

  /**
   * Sends an error message to a WebSocket connection
   */
  private sendError(connection: IWebSocketConnection, error: string): void {
    this.sendMessage(connection, {
      type: MessageType.ERROR,
      channelId: '',
      timestamp: Date.now(),
      sender: 'server',
      recipient: connection.address,
      error,
    } as IErrorMessage);
  }

  /**
   * Validates message format
   */
  private validateMessage(message: IMessage): boolean {
    return (
      message &&
      typeof message === 'object' &&
      typeof message.type === 'string' &&
      typeof message.recipient === 'string'
    );
  }

  /**
   * Starts the monitoring system
   */
  private startMonitoring(): void {
    // Monitor connection health
    setInterval(() => {
      const now = Date.now();
      for (const [address, connection] of this.connections) {
        // Check if connection is still alive
        if (connection.lastPong && now - connection.lastPong > 30000) {
          this.logger.warn(`Connection timeout for ${address}`);
          connection.ws.terminate();
          continue;
        }

        // Send ping
        if (now - (connection.lastPing || 0) > 10000) {
          connection.lastPing = now;
          connection.ws.ping();
        }
      }
    }, 10000);

    // Log metrics periodically
    setInterval(() => {
      this.logger.info('WebSocket metrics:', {
        totalConnections: this.metrics.totalConnections,
        activeConnections: this.metrics.activeConnections,
        messagesReceived: this.metrics.messagesReceived,
        messagesSent: this.metrics.messagesSent,
        errors: this.metrics.errors,
        transportMetrics: this.transport.getMetrics(),
      });
    }, 60000);
  }

  /**
   * Gets current WebSocket metrics
   */
  public getMetrics(): {
    totalConnections: number;
    activeConnections: number;
    messagesReceived: number;
    messagesSent: number;
    errors: number;
    transportMetrics: ITransportMetrics;
  } {
    return {
      ...this.metrics,
      transportMetrics: this.transport.getMetrics(),
    };
  }

  /**
   * Closes all connections
   */
  public close(): void {
    for (const connection of this.connections.values()) {
      connection.ws.close();
    }
    this.wss.close();
  }
}
