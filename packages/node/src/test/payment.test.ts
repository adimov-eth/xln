import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { PaymentRouter } from '../routes/paymentRouter';
import { PaymentService } from '../services/PaymentService';
import { ChannelService } from '../services/ChannelService';
import { Logger } from '../utils/Logger';
import { PaymentStatus } from '@xln/types';

describe('Payment Router Tests', () => {
  let app: express.Application;
  let channelService: ChannelService;
  let paymentService: PaymentService;
  let paymentRouter: PaymentRouter;

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

    // Initialize router
    paymentRouter = new PaymentRouter({
      paymentService,
      logger: new Logger({ name: 'payment-router-test' }),
    });

    // Create Express app
    app = express();
    app.use(express.json());
    app.use('/api', paymentRouter.getRouter());

    // Initialize services
    await channelService.initialize();
    await paymentService.initialize();
  });

  afterEach(async () => {
    await paymentService.close();
    await channelService.close();
  });

  describe('POST /api/payments', () => {
    it('should create a new payment', async () => {
      const paymentData = {
        channelId: '123',
        chainId: 1,
        tokenId: 'ETH',
        amount: '100',
        secret: '0x123',
        timelock: 3600,
        encryptedData: 'encrypted-data',
      };

      const response = await request(app).post('/api/payments').send(paymentData).expect(201);

      expect(response.body.status).to.equal('success');
      expect(response.body.data).to.have.property('id');
      expect(response.body.data.status).to.equal(PaymentStatus.PENDING);
    });

    it('should validate payment request data', async () => {
      const invalidData = {
        channelId: '',
        chainId: -1,
        tokenId: '',
        amount: '',
        timelock: 0,
      };

      const response = await request(app).post('/api/payments').send(invalidData).expect(400);

      expect(response.body.status).to.equal('error');
      expect(response.body.errors).to.be.an('array');
    });
  });

  describe('GET /api/payments/:paymentId', () => {
    it('should get payment by ID', async () => {
      // Create a payment first
      const payment = await paymentService.createPayment({
        channelId: '123',
        chainId: 1,
        tokenId: 'ETH',
        amount: '100',
        secret: '0x123',
        timelock: 3600,
        encryptedData: 'encrypted-data',
      });

      const response = await request(app).get(`/api/payments/${payment.id}`).expect(200);

      expect(response.body.status).to.equal('success');
      expect(response.body.data.id).to.equal(payment.id);
    });

    it('should return 404 for non-existent payment', async () => {
      const response = await request(app).get('/api/payments/non-existent').expect(404);

      expect(response.body.status).to.equal('error');
      expect(response.body.message).to.equal('Payment not found');
    });
  });

  describe('GET /api/channels/:channelId/payments', () => {
    it('should list payments by channel', async () => {
      // Create some payments
      await paymentService.createPayment({
        channelId: '123',
        chainId: 1,
        tokenId: 'ETH',
        amount: '100',
        secret: '0x123',
        timelock: 3600,
        encryptedData: 'encrypted-data',
      });

      await paymentService.createPayment({
        channelId: '123',
        chainId: 1,
        tokenId: 'ETH',
        amount: '200',
        secret: '0x456',
        timelock: 3600,
        encryptedData: 'encrypted-data',
      });

      const response = await request(app).get('/api/channels/123/payments').expect(200);

      expect(response.body.status).to.equal('success');
      expect(response.body.data).to.be.an('array');
      expect(response.body.data).to.have.lengthOf(2);
    });
  });

  describe('POST /api/payments/:paymentId/settle', () => {
    it('should settle a payment', async () => {
      // Create a payment first
      const payment = await paymentService.createPayment({
        channelId: '123',
        chainId: 1,
        tokenId: 'ETH',
        amount: '100',
        secret: '0x123',
        timelock: 3600,
        encryptedData: 'encrypted-data',
      });

      const settleData = {
        channelId: '123',
        chainId: 1,
        tokenId: 'ETH',
        amount: '100',
        secret: '0x123',
      };

      const response = await request(app).post(`/api/payments/${payment.id}/settle`).send(settleData).expect(200);

      expect(response.body.status).to.equal('success');
      expect(response.body.data.status).to.equal(PaymentStatus.SETTLED);
    });
  });

  describe('POST /api/payments/:paymentId/cancel', () => {
    it('should cancel a payment', async () => {
      // Create a payment first
      const payment = await paymentService.createPayment({
        channelId: '123',
        chainId: 1,
        tokenId: 'ETH',
        amount: '100',
        secret: '0x123',
        timelock: 3600,
        encryptedData: 'encrypted-data',
      });

      const cancelData = {
        channelId: '123',
        chainId: 1,
        tokenId: 'ETH',
        amount: '100',
        timelock: 3600,
      };

      const response = await request(app).post(`/api/payments/${payment.id}/cancel`).send(cancelData).expect(200);

      expect(response.body.status).to.equal('success');
      expect(response.body.data.status).to.equal(PaymentStatus.CANCELLED);
    });
  });
});
