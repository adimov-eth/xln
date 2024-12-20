# Transport Layer Documentation

## Overview

The transport layer provides reliable, efficient, and secure communication between nodes in the network. It implements WebSocket-based messaging with support for compression, batching, and automatic reconnection.

## Components

### TransportService

The core service that handles message transport between nodes.

#### Features

- WebSocket-based communication
- Message compression for large payloads
- Message batching for improved throughput
- Automatic reconnection
- Connection health monitoring
- Comprehensive metrics tracking

#### Configuration

```typescript
interface ITransportOptions {
  host?: string; // WebSocket host (default: 'localhost')
  port?: number; // WebSocket port (default: 8080)
  ssl?: boolean; // Use SSL/TLS (default: false)
  reconnectInterval?: number; // Reconnect delay in ms (default: 5000)
  maxReconnectAttempts?: number; // Max reconnection attempts (default: 10)
  pingInterval?: number; // Ping interval in ms (default: 30000)
  pongTimeout?: number; // Pong timeout in ms (default: 5000)
}

interface ITransportServiceConfig {
  dbPath: string;
  logger?: Logger;
  transportOptions?: ITransportOptions;
  compressionThreshold?: number; // Size in bytes above which messages are compressed
  batchSize?: number; // Maximum messages per batch
  batchTimeout?: number; // Maximum time to wait before sending a batch
}
```

#### Usage

```typescript
const transport = new TransportService({
  dbPath: ':memory:',
  transportOptions: {
    host: 'localhost',
    port: 8080,
  },
});

await transport.initialize();
await transport.send(message);
transport.subscribe(handler);
await transport.disconnect();
```

### WebSocket Router

Handles WebSocket connections and integrates with the transport service.

#### Features

- WebSocket connection management
- Message validation and routing
- Connection health monitoring
- Error handling
- Metrics collection

#### Configuration

```typescript
interface IWebSocketRouterConfig {
  server: http.Server;
  transport: TransportService;
  logger?: Logger;
}
```

#### Usage

```typescript
const wsRouter = new WebSocketRouter({
  server: httpServer,
  transport: transportService,
});

// Get metrics
const metrics = wsRouter.getMetrics();

// Cleanup
wsRouter.close();
```

## Message Types

### State Update

```typescript
{
  type: MessageType.STATE_UPDATE,
  channelId: string,
  state: any,
  nonce: number,
  timestamp: number,
  sender: string,
  recipient: string,
}
```

### Payment Request

```typescript
{
  type: MessageType.PAYMENT_REQUEST,
  channelId: string,
  amount: string,
  tokenId: string,
  hashlock: string,
  timelock: number,
  timestamp: number,
  sender: string,
  recipient: string,
}
```

### Payment Response

```typescript
{
  type: MessageType.PAYMENT_RESPONSE,
  channelId: string,
  paymentId: string,
  status: 'accepted' | 'rejected',
  reason?: string,
  timestamp: number,
  sender: string,
  recipient: string,
}
```

## Events

### Transport Events

- `CONNECTED`: Connection established
- `DISCONNECTED`: Connection lost
- `MESSAGE`: New message received
- `ERROR`: Error occurred

### WebSocket Events

- Connection established/closed
- Message received/sent
- Error occurred
- Ping/pong for connection health

## Metrics

### Transport Metrics

```typescript
{
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  compressionRatio: number;
  batchSize: number;
  latency: number;
  reconnectAttempts: number;
}
```

### WebSocket Metrics

```typescript
{
  totalConnections: number;
  activeConnections: number;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  transportMetrics: ITransportMetrics;
}
```

## Error Handling

### Transport Errors

- `TRANSPORT_CONNECT_FAILED`: Connection failed
- `TRANSPORT_NOT_CONNECTED`: Not connected
- `TRANSPORT_SEND_FAILED`: Message send failed
- `TRANSPORT_BATCH_FAILED`: Batch send failed

### WebSocket Errors

- Invalid message format
- Connection timeout
- Message delivery failure
- Transport layer errors

## Best Practices

1. **Connection Management**

   - Always handle reconnection scenarios
   - Implement proper error handling
   - Monitor connection health

2. **Message Handling**

   - Validate message format
   - Handle message batching appropriately
   - Implement retry logic for failed messages

3. **Performance**

   - Use compression for large messages
   - Implement message batching
   - Monitor metrics for optimization

4. **Security**
   - Validate message signatures
   - Implement proper authentication
   - Use SSL/TLS in production

## Monitoring

1. **Health Checks**

   - Connection status
   - Message throughput
   - Error rates
   - Latency metrics

2. **Alerts**

   - Connection failures
   - High error rates
   - Latency spikes
   - Resource exhaustion

3. **Logging**
   - Connection events
   - Message events
   - Error events
   - Performance metrics

## Testing

1. **Unit Tests**

   - Message handling
   - Connection management
   - Error handling
   - Event handling

2. **Integration Tests**

   - End-to-end message delivery
   - Reconnection scenarios
   - Error recovery
   - Performance testing

3. **Mock Transport**
   - Network simulation
   - Error simulation
   - Latency simulation
   - Bandwidth limitations
