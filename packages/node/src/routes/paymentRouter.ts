import express, { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/PaymentService';
import { Logger } from '../utils/Logger';
import { validateRequest } from '../middleware';
import { PaymentRequest, PaymentSettlement, PaymentCancellation } from '@xln/types';

/**
 * Payment router configuration
 */
interface IPaymentRouterConfig {
  paymentService: PaymentService;
  logger?: Logger;
}

/**
 * Payment router for REST endpoints
 */
export class PaymentRouter {
  private readonly router: express.Router;
  private readonly paymentService: PaymentService;
  private readonly logger: Logger;

  constructor(config: IPaymentRouterConfig) {
    this.router = express.Router();
    this.paymentService = config.paymentService;
    this.logger = config.logger || new Logger({ name: 'PaymentRouter' });
    this.setupRoutes();
  }

  /**
   * Get the Express router
   */
  public getRouter(): express.Router {
    return this.router;
  }

  /**
   * Setup payment routes
   */
  private setupRoutes(): void {
    // Create payment
    this.router.post('/payments', validateRequest(PaymentRequest), this.handleCreatePayment.bind(this));

    // Get payment by ID
    this.router.get('/payments/:paymentId', this.handleGetPayment.bind(this));

    // List payments by channel
    this.router.get('/channels/:channelId/payments', this.handleListPayments.bind(this));

    // Settle payment
    this.router.post(
      '/payments/:paymentId/settle',
      validateRequest(PaymentSettlement),
      this.handleSettlePayment.bind(this),
    );

    // Cancel payment
    this.router.post(
      '/payments/:paymentId/cancel',
      validateRequest(PaymentCancellation),
      this.handleCancelPayment.bind(this),
    );
  }

  /**
   * Handle payment creation
   */
  private async handleCreatePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payment = await this.paymentService.createPayment({
        channelId: req.body.channelId,
        chainId: req.body.chainId,
        tokenId: req.body.tokenId,
        amount: req.body.amount,
        secret: req.body.secret,
        timelock: req.body.timelock,
        encryptedData: req.body.encryptedData,
      });

      res.status(201).json({
        status: 'success',
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle get payment by ID
   */
  private async handleGetPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payment = await this.paymentService.getPayment(req.params.paymentId);

      if (!payment) {
        res.status(404).json({
          status: 'error',
          message: 'Payment not found',
        });
        return;
      }

      res.status(200).json({
        status: 'success',
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle list payments by channel
   */
  private async handleListPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payments = await this.paymentService.listPayments(req.params.channelId);

      res.status(200).json({
        status: 'success',
        data: payments,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle payment settlement
   */
  private async handleSettlePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payment = await this.paymentService.settlePayment({
        channelId: req.body.channelId,
        chainId: req.body.chainId,
        tokenId: req.body.tokenId,
        amount: req.body.amount,
        secret: req.body.secret,
      });

      res.status(200).json({
        status: 'success',
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle payment cancellation
   */
  private async handleCancelPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payment = await this.paymentService.cancelPayment({
        channelId: req.body.channelId,
        chainId: req.body.chainId,
        tokenId: req.body.tokenId,
        amount: req.body.amount,
        timelock: req.body.timelock,
      });

      res.status(200).json({
        status: 'success',
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  }
}
