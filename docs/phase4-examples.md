# XLN Phase 4: Practical Examples

## Basic Server Setup

### Development Server

```typescript
// dev-server.ts
import { startServer, events, logger } from './src/index.ts';

// Development configuration
const devConfig = {
  server: {
    tickMs: 10,           // Fast blocks for testing
    snapshotInterval: 10, // Frequent snapshots
  },
  storage: {
    type: 'memory' as const,
    path: '',
  },
  logging: {
    level: 'debug' as const,
  },
  features: {
    metrics: true,
    events: true,
  },
};

// Start development server
await startServer(devConfig);
```

### Production Server

```typescript
// prod-server.ts
import { startServer, loadConfig } from './src/index.ts';

// Load configuration from environment
const config = loadConfig(process.env);

// Override production-specific settings
const prodConfig = {
  ...config,
  server: {
    ...config.server,
    tickMs: 100,
    snapshotInterval: 1000,
  },
  storage: {
    type: 'leveldb' as const,
    path: '/var/lib/xln',
  },
  logging: {
    level: 'info' as const,
  },
};

await startServer(prodConfig);
```

## Event System Examples

### Real-time Dashboard

```typescript
// dashboard.ts
import { events, logger } from './src/index.ts';

interface DashboardMetrics {
  blocksProcessed: number;
  totalTransactions: number;
  failureRate: number;
  activeEntities: Set<string>;
}

class Dashboard {
  private metrics: DashboardMetrics = {
    blocksProcessed: 0,
    totalTransactions: 0,
    failureRate: 0,
    activeEntities: new Set(),
  };
  
  private failures = 0;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    events.on('block:processed', (height, txCount, hash) => {
      this.metrics.blocksProcessed++;
      this.metrics.totalTransactions += txCount;
      this.updateFailureRate();
      
      logger.info('Dashboard', 'Block processed', {
        height,
        txCount,
        hash: hash.slice(0, 8),
        totalBlocks: this.metrics.blocksProcessed,
        totalTxs: this.metrics.totalTransactions,
      });
      
      // Emit to WebSocket clients
      this.broadcastUpdate('block', { height, txCount, hash });
    });

    events.on('block:failed', (height, error) => {
      this.failures++;
      this.updateFailureRate();
      
      logger.error('Dashboard', 'Block failed', {
        height,
        error: error.message,
        failureRate: this.metrics.failureRate,
      });
      
      // Alert system
      this.sendAlert('BLOCK_FAILURE', { height, error: error.message });
    });

    events.on('entity:updated', (signerIdx, entityId, height) => {
      this.metrics.activeEntities.add(entityId);
      
      logger.debug('Dashboard', 'Entity updated', {
        signerIdx,
        entityId,
        height,
        activeCount: this.metrics.activeEntities.size,
      });
      
      this.broadcastUpdate('entity', { signerIdx, entityId, height });
    });

    events.on('shutdown', () => {
      logger.info('Dashboard', 'Saving dashboard state before shutdown');
      this.saveDashboardState();
    });
  }

  private updateFailureRate() {
    this.metrics.failureRate = 
      this.metrics.blocksProcessed > 0 
        ? (this.failures / (this.metrics.blocksProcessed + this.failures)) * 100 
        : 0;
  }

  private broadcastUpdate(type: string, data: any) {
    // WebSocket broadcast implementation
    this.wss?.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, data, timestamp: Date.now() }));
      }
    });
  }

  private sendAlert(level: string, data: any) {
    // Integration with alerting system
    logger.warn('Alert', `${level} triggered`, data);
    // Send to Slack, PagerDuty, etc.
  }

  private saveDashboardState() {
    // Persist dashboard metrics
    fs.writeFileSync('./dashboard-state.json', JSON.stringify(this.metrics));
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

export const dashboard = new Dashboard();
```

### WebSocket Real-time Updates

```typescript
// websocket-server.ts
import { WebSocketServer } from 'ws';
import { events, logger } from './src/index.ts';

export class XLNWebSocketServer {
  private wss: WebSocketServer;
  private clientCount = 0;

  constructor(port: number = 8080) {
    this.wss = new WebSocketServer({ port });
    this.setupWebSocketServer();
    this.setupEventForwarding();
    
    logger.info('WebSocket', `Server started on port ${port}`);
  }

  private setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      this.clientCount++;
      const clientId = this.clientCount;
      
      logger.info('WebSocket', 'Client connected', { 
        clientId, 
        totalClients: this.wss.clients.size,
        userAgent: req.headers['user-agent']
      });

      // Send initial state
      ws.send(JSON.stringify({
        type: 'connection',
        data: { clientId, timestamp: Date.now() }
      }));

      ws.on('close', () => {
        logger.info('WebSocket', 'Client disconnected', { 
          clientId, 
          totalClients: this.wss.clients.size - 1 
        });
      });

      ws.on('error', (error) => {
        logger.error('WebSocket', 'Client error', { clientId, error: error.message });
      });
    });
  }

  private setupEventForwarding() {
    // Forward block events
    events.on('block:processed', (height, txCount, hash) => {
      this.broadcast({
        type: 'block:processed',
        data: { height, txCount, hash: hash.slice(0, 8), timestamp: Date.now() }
      });
    });

    events.on('block:failed', (height, error) => {
      this.broadcast({
        type: 'block:failed',
        data: { height, error: error.message, timestamp: Date.now() }
      });
    });

    events.on('entity:updated', (signerIdx, entityId, height) => {
      this.broadcast({
        type: 'entity:updated',
        data: { signerIdx, entityId, height, timestamp: Date.now() }
      });
    });
  }

  private broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
        sentCount++;
      }
    });
    
    logger.debug('WebSocket', 'Message broadcast', { 
      type: message.type, 
      clients: sentCount 
    });
  }

  getStats() {
    return {
      connectedClients: this.wss.clients.size,
      totalClients: this.clientCount,
    };
  }
}

// Usage
const wsServer = new XLNWebSocketServer(8080);
```

## Custom Logging Examples

### File Logger

```typescript
// file-logger.ts
import fs from 'fs';
import path from 'path';
import { events, type LogEntry } from './src/index.ts';

export class FileLogger {
  private logFile: string;
  private errorFile: string;

  constructor(logDir: string = './logs') {
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const date = new Date().toISOString().split('T')[0];
    this.logFile = path.join(logDir, `xln-${date}.log`);
    this.errorFile = path.join(logDir, `xln-errors-${date}.log`);

    this.setupLogging();
  }

  private setupLogging() {
    // Capture all log entries
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args) => {
      originalLog(...args);
      this.writeToFile(this.logFile, args.join(' '));
    };

    console.error = (...args) => {
      originalError(...args);
      this.writeToFile(this.errorFile, args.join(' '));
    };

    // Log structured events
    events.on('block:processed', (height, txCount, hash) => {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'block:processed',
        data: { height, txCount, hash }
      };
      this.writeToFile(this.logFile, JSON.stringify(logEntry));
    });

    events.on('block:failed', (height, error) => {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        event: 'block:failed',
        data: { height, error: error.message, stack: error.stack }
      };
      this.writeToFile(this.errorFile, JSON.stringify(logEntry));
    });
  }

  private writeToFile(filename: string, content: string) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${content}\n`;
    
    fs.appendFileSync(filename, logLine, 'utf8');
  }

  // Log rotation
  rotateOldLogs(retentionDays: number = 7) {
    const logDir = path.dirname(this.logFile);
    const files = fs.readdirSync(logDir);
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    files.forEach(file => {
      if (file.startsWith('xln-')) {
        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          console.log(`Deleted old log file: ${file}`);
        }
      }
    });
  }
}

// Usage
const fileLogger = new FileLogger('./logs');

// Rotate logs daily
setInterval(() => {
  fileLogger.rotateOldLogs(7);
}, 24 * 60 * 60 * 1000);
```

### External Monitoring Integration

```typescript
// monitoring.ts
import { events, metricsCollector, logger } from './src/index.ts';

export class MonitoringIntegration {
  private prometheusGateway?: any;
  private slackWebhook?: string;

  constructor(config: {
    prometheusGateway?: string;
    slackWebhook?: string;
  }) {
    this.slackWebhook = config.slackWebhook;
    this.setupPrometheusIntegration(config.prometheusGateway);
    this.setupAlertIntegration();
  }

  private setupPrometheusIntegration(gatewayUrl?: string) {
    if (!gatewayUrl) return;

    // Push metrics every 30 seconds
    setInterval(async () => {
      const metrics = metricsCollector.getMetrics();
      
      try {
        const response = await fetch(`${gatewayUrl}/metrics/job/xln-server`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: metricsCollector.getPrometheusFormat(),
        });

        if (!response.ok) {
          logger.warn('Monitoring', 'Failed to push metrics to Prometheus', {
            status: response.status,
            statusText: response.statusText,
          });
        } else {
          logger.debug('Monitoring', 'Metrics pushed to Prometheus', {
            metricsCount: Object.keys(metrics).length,
          });
        }
      } catch (error) {
        logger.error('Monitoring', 'Prometheus push error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, 30000);
  }

  private setupAlertIntegration() {
    // High failure rate alert
    let lastFailureRate = 0;
    events.on('block:failed', () => {
      const metrics = metricsCollector.getMetrics();
      const failureRate = (metrics.blocksFailed / (metrics.blocksProcessed + metrics.blocksFailed)) * 100;
      
      if (failureRate > 5 && failureRate > lastFailureRate) {
        this.sendSlackAlert('🚨 High Block Failure Rate', {
          failureRate: `${failureRate.toFixed(2)}%`,
          totalBlocks: metrics.blocksProcessed,
          totalFailures: metrics.blocksFailed,
        });
      }
      lastFailureRate = failureRate;
    });

    // Server health check
    setInterval(() => {
      const metrics = metricsCollector.getMetrics();
      
      // Alert if no blocks processed in last 5 minutes
      if (metrics.uptime > 300000 && metrics.blocksProcessed === 0) {
        this.sendSlackAlert('⚠️ Server Appears Idle', {
          uptime: `${Math.floor(metrics.uptime / 60000)} minutes`,
          blocksProcessed: metrics.blocksProcessed,
        });
      }
    }, 60000);
  }

  private async sendSlackAlert(title: string, data: Record<string, any>) {
    if (!this.slackWebhook) return;

    const payload = {
      text: title,
      attachments: [{
        color: 'danger',
        fields: Object.entries(data).map(([key, value]) => ({
          title: key,
          value: value.toString(),
          short: true,
        })),
        ts: Math.floor(Date.now() / 1000),
      }],
    };

    try {
      const response = await fetch(this.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        logger.info('Monitoring', 'Slack alert sent', { title });
      } else {
        logger.warn('Monitoring', 'Failed to send Slack alert', {
          status: response.status,
          title,
        });
      }
    } catch (error) {
      logger.error('Monitoring', 'Slack webhook error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        title,
      });
    }
  }
}

// Usage
const monitoring = new MonitoringIntegration({
  prometheusGateway: process.env.PROMETHEUS_GATEWAY,
  slackWebhook: process.env.SLACK_WEBHOOK,
});
```

## Testing Examples

### Event-Driven Tests

```typescript
// tests/server.test.ts
import { test, expect } from 'bun:test';
import { events, startServer, addMessage } from '../src/index.ts';

test('server processes blocks and emits events', async () => {
  const eventsReceived: string[] = [];
  let blockHeight = 0;

  // Set up event listeners
  events.on('block:processed', (height, txCount, hash) => {
    eventsReceived.push(`processed:${height}:${txCount}`);
    blockHeight = height;
  });

  events.on('block:failed', (height, error) => {
    eventsReceived.push(`failed:${height}:${error.message}`);
  });

  events.on('entity:updated', (signerIdx, entityId, height) => {
    eventsReceived.push(`entity:${entityId}:${height}`);
  });

  // Start test server
  const serverPromise = startServer({
    server: { tickMs: 10, snapshotInterval: 5 },
    storage: { type: 'memory', path: '' },
    logging: { level: 'error' }, // Quiet during tests
  });

  // Give server time to start
  await new Promise(resolve => setTimeout(resolve, 50));

  // Add a test message
  const testMessage = {
    scope: 'direct' as const,
    signer: 0,
    entityId: 'test-entity',
    input: {
      type: 'add_tx' as const,
      tx: { op: 'mint', data: { amount: 100n } }
    }
  };

  // Server should process the message and emit events
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify events were emitted
  expect(blockHeight).toBeGreaterThan(0);
  expect(eventsReceived.some(e => e.startsWith('processed:'))).toBe(true);
});

test('metrics track operations correctly', async () => {
  const { metricsCollector } = await import('../src/index.ts');
  
  const initialMetrics = metricsCollector.getMetrics();
  
  // Simulate events
  events.emit('block:processed', 1, 5, 'abcd1234');
  events.emit('block:processed', 2, 3, 'efgh5678');
  events.emit('block:failed', 3, new Error('Test failure'));
  events.emit('entity:updated', 0, 'test-entity', 1);

  await new Promise(resolve => setTimeout(resolve, 10));
  
  const finalMetrics = metricsCollector.getMetrics();
  
  expect(finalMetrics.blocksProcessed).toBe(initialMetrics.blocksProcessed + 2);
  expect(finalMetrics.blocksFailed).toBe(initialMetrics.blocksFailed + 1);
  expect(finalMetrics.entitiesUpdated).toBe(initialMetrics.entitiesUpdated + 1);
});
```

### Configuration Tests

```typescript
// tests/config.test.ts
import { test, expect } from 'bun:test';
import { loadConfig } from '../src/index.ts';

test('loads configuration from environment', () => {
  const testEnv = {
    XLN_TICK_MS: '50',
    XLN_STORAGE_TYPE: 'memory',
    XLN_LOG_LEVEL: 'debug',
    XLN_ENABLE_METRICS: 'true',
  };

  const config = loadConfig(testEnv);

  expect(config.server.tickMs).toBe(50);
  expect(config.storage.type).toBe('memory');
  expect(config.logging.level).toBe('debug');
  expect(config.features.metrics).toBe(true);
});

test('uses defaults for missing environment variables', () => {
  const config = loadConfig({});

  expect(config.server.tickMs).toBe(100);
  expect(config.storage.type).toBe('leveldb');
  expect(config.logging.level).toBe('info');
  expect(config.features.metrics).toBe(false);
  expect(config.features.events).toBe(true);
});
```

## Performance Testing

```typescript
// tests/performance.test.ts
import { test, expect } from 'bun:test';
import { startServer, addMessage, events } from '../src/index.ts';

test('processes 1000 transactions within reasonable time', async () => {
  let processedBlocks = 0;
  let totalTransactions = 0;

  events.on('block:processed', (height, txCount) => {
    processedBlocks++;
    totalTransactions += txCount;
  });

  // Start high-performance server
  await startServer({
    server: { tickMs: 1, snapshotInterval: 1000 },
    storage: { type: 'memory', path: '' },
    logging: { level: 'error' },
  });

  const startTime = Date.now();
  
  // Generate 1000 transactions
  for (let i = 0; i < 1000; i++) {
    const message = {
      scope: 'direct' as const,
      signer: 0,
      entityId: 'perf-test',
      input: {
        type: 'add_tx' as const,
        tx: { op: 'mint', data: { amount: BigInt(i) } }
      }
    };
    // Add to server (would need actual server instance)
  }

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  const tps = totalTransactions / (duration / 1000);

  console.log(`Processed ${totalTransactions} transactions in ${duration}ms`);
  console.log(`TPS: ${tps.toFixed(2)}`);

  expect(totalTransactions).toBe(1000);
  expect(tps).toBeGreaterThan(100); // Target: >100 TPS
});
```

## Docker Integration

```dockerfile
# Dockerfile
FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY index.ts ./

# Set production defaults
ENV XLN_STORAGE_TYPE=leveldb
ENV XLN_STORAGE_PATH=/data
ENV XLN_LOG_LEVEL=info
ENV XLN_ENABLE_METRICS=true
ENV XLN_TICK_MS=100
ENV XLN_SNAPSHOT_INTERVAL=1000

# Create data volume
VOLUME ["/data"]

# Expose metrics port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start server
CMD ["bun", "run", "index.ts"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  xln-server:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - xln-data:/data
      - ./logs:/app/logs
    environment:
      - XLN_STORAGE_TYPE=leveldb
      - XLN_LOG_LEVEL=info
      - XLN_ENABLE_METRICS=true
      - XLN_TICK_MS=100
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'

volumes:
  xln-data:
  prometheus-data:
```

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'xln'
    static_configs:
      - targets: ['xln-server:3001']
    metrics_path: '/metrics'
    scrape_interval: 10s
```

## Environment Scripts

```bash
#!/bin/bash
# scripts/dev.sh - Development server
export XLN_STORAGE_TYPE=memory
export XLN_LOG_LEVEL=debug
export XLN_TICK_MS=10
export XLN_ENABLE_METRICS=true

echo "Starting XLN development server..."
bun run index.ts
```

```bash
#!/bin/bash
# scripts/prod.sh - Production server
export XLN_STORAGE_TYPE=leveldb
export XLN_STORAGE_PATH=/var/lib/xln
export XLN_LOG_LEVEL=info
export XLN_ENABLE_METRICS=true
export XLN_TICK_MS=100
export XLN_SNAPSHOT_INTERVAL=1000

echo "Starting XLN production server..."
bun run index.ts
```

```bash
#!/bin/bash
# scripts/test.sh - Test runner with coverage
export XLN_STORAGE_TYPE=memory
export XLN_LOG_LEVEL=error

echo "Running XLN tests..."
bun test --coverage
```

These examples demonstrate the full capabilities of XLN's Phase 4 architecture, showing how to build production-ready applications with comprehensive observability, monitoring, and operational features. 