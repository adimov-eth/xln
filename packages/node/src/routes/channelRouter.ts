import express from 'express';
import { ethers } from 'ethers';
import { ChannelService } from '../services/ChannelService';
import { PaymentService } from '../services/PaymentService';
import { SwapService } from '../services/SwapService';
import { DisputeService, ResolutionResult } from '../services/DisputeService';

export interface IChannelRouterConfig {
  channelService: ChannelService;
  paymentService: PaymentService;
  swapService: SwapService;
  disputeService: DisputeService;
}

export function createChannelRouter(config: IChannelRouterConfig): express.Router {
  const router = express.Router();

  // Create a new channel
  router.post('/create', async (req, res) => {
    try {
      const { userAddress, peerAddress } = req.body;
      const state = await config.channelService.createChannel({
        userAddress,
        peerAddress,
      });
      res.json(state);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create channel',
      });
    }
  });

  // Get channel by ID
  router.get('/:channelId', async (req, res) => {
    try {
      const channel = await config.channelService.getChannel(req.params.channelId);
      res.json(channel.getState());
    } catch (error) {
      res.status(404).json({
        error: error instanceof Error ? error.message : 'Channel not found',
      });
    }
  });

  // List channels for user
  router.get('/user/:userAddress', async (req, res) => {
    try {
      const channels = await config.channelService.listChannels(req.params.userAddress);
      res.json(channels);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to list channels',
      });
    }
  });

  // Open subchannel
  router.post('/:channelId/subchannel', async (req, res) => {
    try {
      const { chainId, tokenId, capacity } = req.body;
      const subchannel = await config.channelService.openSubchannel({
        channelId: req.params.channelId,
        chainId,
        tokenId,
        capacity,
      });
      res.json(subchannel);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to open subchannel',
      });
    }
  });

  // Update subchannel balance
  router.put('/:channelId/subchannel/:subchannelId', async (req, res) => {
    try {
      const { newBalance } = req.body;
      await config.channelService.updateBalance({
        channelId: req.params.channelId,
        subchannelId: req.params.subchannelId,
        newBalance,
      });
      res.sendStatus(200);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to update balance',
      });
    }
  });

  // Close subchannel
  router.post('/:channelId/subchannel/:subchannelId/close', async (req, res) => {
    try {
      const { finalBalance } = req.body;
      await config.channelService.closeSubchannel({
        channelId: req.params.channelId,
        subchannelId: req.params.subchannelId,
        finalBalance,
      });
      res.sendStatus(200);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to close subchannel',
      });
    }
  });

  // Sign channel state
  router.post('/:channelId/sign', async (req, res) => {
    try {
      const { privateKey } = req.body;
      const signer = new ethers.Wallet(privateKey);
      await config.channelService.signState({
        channelId: req.params.channelId,
        signer,
      });
      res.sendStatus(200);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to sign state',
      });
    }
  });

  // Create payment
  router.post('/:channelId/payment', async (req, res) => {
    try {
      const { chainId, tokenId, amount, secret, timelock, encryptedData } = req.body;
      const payment = await config.paymentService.createPayment({
        channelId: req.params.channelId,
        chainId,
        tokenId,
        amount,
        secret,
        timelock,
        encryptedData,
      });
      res.json(payment);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create payment',
      });
    }
  });

  // Settle payment
  router.post('/:channelId/payment/settle', async (req, res) => {
    try {
      const { chainId, tokenId, amount, secret } = req.body;
      await config.paymentService.settlePayment({
        channelId: req.params.channelId,
        chainId,
        tokenId,
        amount,
        secret,
      });
      res.sendStatus(200);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to settle payment',
      });
    }
  });

  // Cancel payment
  router.post('/:channelId/payment/cancel', async (req, res) => {
    try {
      const { chainId, tokenId, amount, timelock } = req.body;
      await config.paymentService.cancelPayment({
        channelId: req.params.channelId,
        chainId,
        tokenId,
        amount,
        timelock,
      });
      res.sendStatus(200);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to cancel payment',
      });
    }
  });

  // Create swap
  router.post('/:channelId/swap', async (req, res) => {
    try {
      const { chainId, tokenIdA, tokenIdB, amountA, amountB, initiator, timelock } = req.body;
      const swap = await config.swapService.createSwap({
        channelId: req.params.channelId,
        chainId,
        tokenIdA,
        tokenIdB,
        amountA,
        amountB,
        initiator,
        timelock,
      });
      res.json(swap);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create swap',
      });
    }
  });

  // Settle swap
  router.post('/:channelId/swap/settle', async (req, res) => {
    try {
      const { chainId, tokenIdA, tokenIdB, amountA, amountB, initiator } = req.body;
      await config.swapService.settleSwap({
        channelId: req.params.channelId,
        chainId,
        tokenIdA,
        tokenIdB,
        amountA,
        amountB,
        initiator,
      });
      res.sendStatus(200);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to settle swap',
      });
    }
  });

  // Initiate dispute
  router.post('/:channelId/dispute', async (req, res) => {
    try {
      const { initiator, evidence } = req.body;
      const dispute = await config.disputeService.initiateDispute({
        channelId: req.params.channelId,
        initiator,
        evidence,
      });
      res.json(dispute);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to initiate dispute',
      });
    }
  });

  // Challenge dispute
  router.post('/dispute/:disputeId/challenge', async (req, res) => {
    try {
      const { challenger, challengeState } = req.body;
      const dispute = await config.disputeService.challengeDispute({
        disputeId: req.params.disputeId,
        challenger,
        challengeState,
      });
      res.json(dispute);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to challenge dispute',
      });
    }
  });

  // Resolve dispute
  router.post('/dispute/:disputeId/resolve', async (req, res) => {
    try {
      const { resolver } = req.body;
      await config.disputeService.resolveDispute({
        disputeId: req.params.disputeId,
        resolver,
      });
      res.sendStatus(200);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to resolve dispute',
      });
    }
  });

  // Get dispute by ID
  router.get('/dispute/:disputeId', async (req, res) => {
    try {
      const dispute = await config.disputeService.getDispute(req.params.disputeId);
      if (!dispute) {
        res.status(404).json({
          error: 'Dispute not found',
        });
        return;
      }
      res.json(dispute);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to get dispute',
      });
    }
  });

  // List disputes for channel
  router.get('/:channelId/disputes', async (req, res) => {
    try {
      const disputes = await config.disputeService.listDisputes(req.params.channelId);
      res.json(disputes);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to list disputes',
      });
    }
  });

  // Submit vote for dispute
  router.post('/dispute/:disputeId/vote', async (req, res) => {
    try {
      const { voter, choice } = req.body;
      if (!Object.values(ResolutionResult).includes(choice)) {
        res.status(400).json({
          error: 'Invalid resolution choice',
        });
        return;
      }
      await config.disputeService.submitVote({
        disputeId: req.params.disputeId,
        voter,
        choice,
      });
      res.sendStatus(200);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to submit vote',
      });
    }
  });

  // Get dispute votes
  router.get('/dispute/:disputeId/votes', async (req, res) => {
    try {
      const dispute = await config.disputeService.getDispute(req.params.disputeId);
      if (!dispute) {
        res.status(404).json({
          error: 'Dispute not found',
        });
        return;
      }
      res.json(dispute.votes || []);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to get votes',
      });
    }
  });

  // Get dispute result
  router.get('/dispute/:disputeId/result', async (req, res) => {
    try {
      const dispute = await config.disputeService.getDispute(req.params.disputeId);
      if (!dispute) {
        res.status(404).json({
          error: 'Dispute not found',
        });
        return;
      }
      if (dispute.status !== 'resolved') {
        res.status(400).json({
          error: 'Dispute is not resolved yet',
        });
        return;
      }
      res.json({
        result: dispute.result,
        resolvedAt: dispute.resolvedAt,
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to get result',
      });
    }
  });

  return router;
}
