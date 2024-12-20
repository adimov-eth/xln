# WebSocket API Documentation

## Overview

The WebSocket API provides real-time communication for payment channels, payments, and atomic swaps. It uses a message-based protocol with JSON payloads and supports automatic reconnection, compression, and message batching.

## Connection

### Endpoint

```
ws://localhost:8080
```

### Connection Lifecycle

1. Connect to WebSocket endpoint
2. Receive connection confirmation
3. Start sending/receiving messages
4. Handle disconnections with automatic reconnection

## Message Format

All messages follow this basic structure:

```typescript
{
  type: string;        // Message type
  timestamp: number;   // Unix timestamp in milliseconds
  sender: string;      // Sender's address
  recipient: string;   // Recipient's address
  channelId?: string; // Channel ID (if applicable)
  // Additional fields based on message type
}
```

## Message Types

### Payment Messages

#### Payment Request

```typescript
{
  type: 'payment_request',
  channelId: string,
  amount: string,
  tokenId: string,
  hashlock: string,
  timelock: number,
  encryptedData?: string,
  timestamp: number,
  sender: string,
  recipient: string,
}
```

#### Payment Response

```typescript
{
  type: 'payment_response',
  channelId: string,
  paymentId: string,
  status: 'accepted' | 'rejected',
  reason?: string,
  timestamp: number,
  sender: string,
  recipient: string,
}
```

### Swap Messages

#### Swap Request

```typescript
{
  type: 'swap_request',
  channelId: string,
  tokenIdA: string,
  tokenIdB: string,
  amountA: string,
  amountB: string,
  timelock: number,
  timestamp: number,
  sender: string,
  recipient: string,
}
```

#### Swap Response

```typescript
{
  type: 'swap_response',
  channelId: string,
  swapId: string,
  status: 'accepted' | 'rejected',
  reason?: string,
  timestamp: number,
  sender: string,
  recipient: string,
}
```

### System Messages

#### Ping/Pong

```typescript
{
  type: 'ping' | 'pong',
  timestamp: number,
  sender: string,
  recipient: string,
}
```

#### Error

```typescript
{
  type: 'error',
  error: string,
  timestamp: number,
  sender: string,
  recipient: string,
}
```

## Message Flow Examples

### Payment Flow

1. Client sends payment request:

```typescript
{
  type: 'payment_request',
  channelId: '123',
  amount: '100',
  tokenId: 'ETH',
  hashlock: '0x...',
  timelock: 3600,
  timestamp: 1234567890,
  sender: 'client-address',
  recipient: 'server-address',
}
```

2. Server responds with acceptance:

```typescript
{
  type: 'payment_response',
  channelId: '123',
  paymentId: 'payment-123',
  status: 'accepted',
  timestamp: 1234567891,
  sender: 'server-address',
  recipient: 'client-address',
}
```

### Swap Flow

1. Client sends swap request:

```typescript
{
  type: 'swap_request',
  channelId: '123',
  tokenIdA: 'ETH',
  tokenIdB: 'DAI',
  amountA: '1',
  amountB: '1000',
  timelock: 3600,
  timestamp: 1234567890,
  sender: 'client-address',
  recipient: 'server-address',
}
```

2. Server responds with acceptance:

```typescript
{
  type: 'swap_response',
  channelId: '123',
  swapId: 'swap-123',
  status: 'accepted',
  timestamp: 1234567891,
  sender: 'server-address',
  recipient: 'client-address',
}
```

## Error Handling

### Error Types

- Invalid message format
- Unknown message type
- Channel not found
- Payment failed
- Swap failed
- Network error

### Error Response Example

```typescript
{
  type: 'error',
  error: 'Invalid message format',
  timestamp: 1234567890,
  sender: 'server-address',
  recipient: 'client-address',
}
```

## Best Practices

1. **Connection Management**

   - Implement exponential backoff for reconnection
   - Handle connection timeouts
   - Monitor connection health with ping/pong

2. **Message Handling**

   - Validate message format before sending
   - Handle all message types appropriately
   - Implement proper error handling
   - Use unique message IDs for tracking

3. **Security**

   - Use SSL/TLS in production
   - Validate message signatures
   - Implement proper authentication
   - Protect sensitive data

4. **Performance**
   - Use message batching for high throughput
   - Enable compression for large messages
   - Monitor message latency
   - Handle rate limiting

## Client Examples

### JavaScript/TypeScript

```typescript
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => {
  console.log('Connected');

  // Send payment request
  ws.send(
    JSON.stringify({
      type: 'payment_request',
      channelId: '123',
      amount: '100',
      tokenId: 'ETH',
      hashlock: '0x...',
      timelock: 3600,
      timestamp: Date.now(),
      sender: 'client-address',
      recipient: 'server-address',
    }),
  );
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected');
  // Implement reconnection logic
};
```

### Python

```python
import websockets
import json
import time

async def connect():
    async with websockets.connect('ws://localhost:8080') as ws:
        # Send payment request
        await ws.send(json.dumps({
            'type': 'payment_request',
            'channelId': '123',
            'amount': '100',
            'tokenId': 'ETH',
            'hashlock': '0x...',
            'timelock': 3600,
            'timestamp': int(time.time() * 1000),
            'sender': 'client-address',
            'recipient': 'server-address',
        }))

        # Receive response
        response = await ws.recv()
        print('Received:', json.loads(response))
```

## Testing

1. **Connection Tests**

   - Test connection establishment
   - Test reconnection behavior
   - Test connection timeout handling

2. **Message Tests**

   - Test all message types
   - Test invalid messages
   - Test message flow sequences
   - Test error handling

3. **Performance Tests**

   - Test message throughput
   - Test compression
   - Test latency
   - Test concurrent connections

4. **Integration Tests**
   - Test with actual services
   - Test end-to-end flows
   - Test error scenarios
   - Test recovery procedures
