import express from 'express';
import http from 'http';
import cors from 'cors';
import { config } from 'dotenv';
import { ChannelService } from './services/ChannelService';
import { PaymentService } from './services/PaymentService';
import { SwapService } from './services/SwapService';
import { DisputeService } from './services/DisputeService';
import { createChannelRouter } from './routes/channelRouter';
import { Logger } from './utils/Logger';
import { TransportService } from './services/TransportService';
import { WebSocketRouter } from './routes/websocketRouter';

// Load environment variables
config();

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;
const logger = new Logger({ name: 'App' });

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
const channelService = new ChannelService({
  dbPath: process.env.DB_PATH || './data/channels',
  logger: new Logger({ name: 'ChannelService' }),
});

const paymentService = new PaymentService({
  dbPath: process.env.DB_PATH || './data/payments',
  logger: new Logger({ name: 'PaymentService' }),
  channelService,
});

const swapService = new SwapService({
  dbPath: process.env.DB_PATH || './data/swaps',
  logger: new Logger({ name: 'SwapService' }),
  channelService,
});

const disputeService = new DisputeService({
  dbPath: process.env.DB_PATH || './data/disputes',
  logger: new Logger({ name: 'DisputeService' }),
  channelService,
  disputePeriod: parseInt(process.env.DISPUTE_PERIOD || '86400'),
});

const transport = new TransportService({
  dbPath: process.env.DB_PATH || ':memory:',
  logger: new Logger({ name: 'Transport' }),
  transportOptions: {
    host: process.env.WS_HOST || 'localhost',
    port: parseInt(process.env.WS_PORT || '8080'),
  },
});

// Initialize WebSocket router
const wsRouter = new WebSocketRouter({
  server,
  transport,
  logger: new Logger({ name: 'WebSocket' }),
});

// Initialize services
async function initializeServices() {
  try {
    await channelService.initialize();
    await paymentService.initialize();
    await swapService.initialize();
    await disputeService.initialize();
    await transport.initialize();
    logger.info('Services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Start periodic dispute check
function startDisputeCheck() {
  const checkInterval = parseInt(process.env.DISPUTE_CHECK_INTERVAL || '300') * 1000; // Default 5 minutes
  setInterval(async () => {
    try {
      await disputeService.checkExpiredDisputes();
    } catch (error) {
      logger.error('Failed to check expired disputes:', error);
    }
  }, checkInterval);
  logger.info(`Dispute check scheduled every ${checkInterval / 1000} seconds`);
}

// Routes
app.use(
  '/api/channels',
  createChannelRouter({
    channelService,
    paymentService,
    swapService,
    disputeService,
  }),
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    metrics: {
      websocket: wsRouter.getMetrics(),
      transport: transport.getMetrics(),
    },
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
  });
});

// Start server
async function startServer() {
  await initializeServices();
  startDisputeCheck();
  server.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });
}

startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

// Handle shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  wsRouter.close();
  await transport.close();
  server.close();
  process.exit(0);
});
