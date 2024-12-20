import { ethers } from 'ethers';
import { BaseService, ServiceError, IServiceConfig } from './BaseService';
import { ChannelService } from './ChannelService';
import { IChannelState } from '../core/Channel';
import { createTransition, TransitionType } from '../core/Transition';

/**
 * Resolution strategy enum
 */
export enum ResolutionStrategy {
  LATEST_STATE = 'latest_state',
  MAJORITY_VOTE = 'majority_vote',
  ARBITRATOR = 'arbitrator',
}

/**
 * Resolution result enum
 */
export enum ResolutionResult {
  INITIATOR_WINS = 'initiator_wins',
  RESPONDENT_WINS = 'respondent_wins',
  SPLIT = 'split',
}

/**
 * Vote interface
 */
export interface IVote {
  voter: string;
  choice: ResolutionResult;
  timestamp: number;
}

/**
 * Dispute service configuration
 */
export interface IDisputeServiceConfig extends IServiceConfig {
  channelService: ChannelService;
  disputePeriod?: number; // Time in seconds for dispute resolution
  resolutionStrategy?: ResolutionStrategy;
  arbitrator?: string;
}

/**
 * Dispute status enum
 */
export enum DisputeStatus {
  PENDING = 'pending',
  RESOLVED = 'resolved',
  EXPIRED = 'expired',
  CHALLENGED = 'challenged',
  VOTING = 'voting',
}

/**
 * Dispute interface
 */
export interface IDispute {
  id: string;
  channelId: string;
  initiator: string;
  respondent: string;
  disputedState: IChannelState;
  challengeState?: IChannelState;
  status: DisputeStatus;
  evidence?: string;
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
  resolutionStrategy: ResolutionStrategy;
  votes?: IVote[];
  result?: ResolutionResult;
}

/**
 * Service for handling channel disputes
 */
export class DisputeService extends BaseService {
  private readonly channelService: ChannelService;
  private readonly disputePeriod: number;
  private readonly resolutionStrategy: ResolutionStrategy;
  private readonly arbitrator?: string;

  constructor(config: IDisputeServiceConfig) {
    super(config);
    this.channelService = config.channelService;
    this.disputePeriod = config.disputePeriod || 86400; // Default 24 hours
    this.resolutionStrategy = config.resolutionStrategy || ResolutionStrategy.LATEST_STATE;
    this.arbitrator = config.arbitrator;
  }

  /**
   * Initiates a dispute for a channel
   */
  public async initiateDispute(params: { channelId: string; initiator: string; evidence?: string }): Promise<IDispute> {
    const channel = await this.channelService.getChannel(params.channelId);
    const state = channel.getState();

    if (state.left !== params.initiator && state.right !== params.initiator) {
      throw new ServiceError('Only channel participants can initiate disputes', 'UNAUTHORIZED');
    }

    const respondent = state.left === params.initiator ? state.right : state.left;
    const dispute: IDispute = {
      id: ethers.solidityPackedKeccak256(
        ['string', 'string', 'uint256'],
        [params.channelId, params.initiator, Date.now()],
      ),
      channelId: params.channelId,
      initiator: params.initiator,
      respondent,
      disputedState: state,
      status: DisputeStatus.PENDING,
      evidence: params.evidence,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.disputePeriod * 1000,
      resolutionStrategy: this.resolutionStrategy,
    };

    await this.store(`dispute:${dispute.id}`, dispute);
    await this.store(`channel:${params.channelId}:disputes`, dispute.id);

    this.logger.info(`Dispute ${dispute.id} initiated for channel ${params.channelId} by ${params.initiator}`);

    return dispute;
  }

  /**
   * Challenges a dispute with a newer state
   */
  public async challengeDispute(params: {
    disputeId: string;
    challenger: string;
    challengeState: IChannelState;
  }): Promise<IDispute> {
    const dispute = await this.getDispute(params.disputeId);
    if (!dispute) {
      throw new ServiceError('Dispute not found', 'DISPUTE_NOT_FOUND');
    }

    if (dispute.status !== DisputeStatus.PENDING) {
      throw new ServiceError('Dispute cannot be challenged', 'INVALID_STATE');
    }

    if (params.challenger !== dispute.respondent) {
      throw new ServiceError('Only the respondent can challenge the dispute', 'UNAUTHORIZED');
    }

    if (params.challengeState.nonce <= dispute.disputedState.nonce) {
      throw new ServiceError('Challenge state must be newer than disputed state', 'INVALID_STATE');
    }

    const updatedDispute: IDispute = {
      ...dispute,
      status: DisputeStatus.CHALLENGED,
      challengeState: params.challengeState,
    };

    await this.store(`dispute:${dispute.id}`, updatedDispute);
    this.logger.info(`Dispute ${dispute.id} challenged by ${params.challenger}`);

    return updatedDispute;
  }

  /**
   * Submits a vote for dispute resolution
   */
  public async submitVote(params: { disputeId: string; voter: string; choice: ResolutionResult }): Promise<void> {
    const dispute = await this.getDispute(params.disputeId);
    if (!dispute) {
      throw new ServiceError('Dispute not found', 'DISPUTE_NOT_FOUND');
    }

    if (dispute.resolutionStrategy !== ResolutionStrategy.MAJORITY_VOTE) {
      throw new ServiceError('Voting is not enabled for this dispute', 'INVALID_STRATEGY');
    }

    if (dispute.status !== DisputeStatus.VOTING) {
      throw new ServiceError('Dispute is not in voting phase', 'INVALID_STATE');
    }

    const vote: IVote = {
      voter: params.voter,
      choice: params.choice,
      timestamp: Date.now(),
    };

    const votes = dispute.votes || [];
    votes.push(vote);

    await this.store(`dispute:${dispute.id}`, {
      ...dispute,
      votes,
    });

    this.logger.info(`Vote submitted for dispute ${dispute.id} by ${params.voter}`);
  }

  /**
   * Resolves a dispute
   */
  public async resolveDispute(params: { disputeId: string; resolver: string }): Promise<void> {
    const dispute = await this.getDispute(params.disputeId);
    if (!dispute) {
      throw new ServiceError('Dispute not found', 'DISPUTE_NOT_FOUND');
    }

    if (dispute.status !== DisputeStatus.PENDING && dispute.status !== DisputeStatus.CHALLENGED) {
      throw new ServiceError('Dispute cannot be resolved', 'INVALID_STATE');
    }

    // Check resolver authorization
    if (dispute.resolutionStrategy === ResolutionStrategy.ARBITRATOR && params.resolver !== this.arbitrator) {
      throw new ServiceError('Only the arbitrator can resolve this dispute', 'UNAUTHORIZED');
    }

    // Determine final state based on resolution strategy
    let finalState: IChannelState;
    let result: ResolutionResult;

    switch (dispute.resolutionStrategy) {
      case ResolutionStrategy.LATEST_STATE:
        finalState = dispute.challengeState || dispute.disputedState;
        result = dispute.challengeState ? ResolutionResult.RESPONDENT_WINS : ResolutionResult.INITIATOR_WINS;
        break;

      case ResolutionStrategy.MAJORITY_VOTE:
        if (!dispute.votes || dispute.votes.length === 0) {
          throw new ServiceError('No votes available for resolution', 'INVALID_STATE');
        }
        result = this.calculateVoteResult(dispute.votes);
        finalState = result === ResolutionResult.RESPONDENT_WINS ? dispute.challengeState! : dispute.disputedState;
        break;

      case ResolutionStrategy.ARBITRATOR:
        finalState = params.resolver === dispute.initiator ? dispute.disputedState : dispute.challengeState!;
        result =
          params.resolver === dispute.initiator ? ResolutionResult.INITIATOR_WINS : ResolutionResult.RESPONDENT_WINS;
        break;

      default:
        throw new ServiceError('Invalid resolution strategy', 'INVALID_STRATEGY');
    }

    const channel = await this.channelService.getChannel(dispute.channelId);
    const transition = createTransition(TransitionType.DISPUTE_RESOLVE, {
      state: finalState,
      resolver: params.resolver,
      result,
    });

    await transition.apply(channel);
    await this.store(`dispute:${dispute.id}`, {
      ...dispute,
      status: DisputeStatus.RESOLVED,
      resolvedAt: Date.now(),
      result,
    });

    this.logger.info(`Dispute ${dispute.id} resolved by ${params.resolver} with result ${result}`);
  }

  /**
   * Gets a dispute by ID
   */
  public async getDispute(disputeId: string): Promise<IDispute | null> {
    return this.retrieve<IDispute>(`dispute:${disputeId}`);
  }

  /**
   * Lists all disputes for a channel
   */
  public async listDisputes(channelId: string): Promise<IDispute[]> {
    const disputeIds = await this.retrieve<string[]>(`channel:${channelId}:disputes`);
    if (!disputeIds) {
      return [];
    }

    const disputes: IDispute[] = [];
    for (const id of disputeIds) {
      const dispute = await this.getDispute(id);
      if (dispute) {
        disputes.push(dispute);
      }
    }

    return disputes;
  }

  /**
   * Checks and updates expired disputes
   */
  public async checkExpiredDisputes(): Promise<void> {
    const keys = await this.listKeys('dispute:');
    for (const key of keys) {
      const dispute = await this.retrieve<IDispute>(key);
      if (dispute && dispute.status === DisputeStatus.PENDING && Date.now() > dispute.expiresAt) {
        await this.store(key, {
          ...dispute,
          status: DisputeStatus.EXPIRED,
        });
        this.logger.info(`Dispute ${dispute.id} marked as expired`);
      }
    }
  }

  /**
   * Calculates the result of a vote
   */
  private calculateVoteResult(votes: IVote[]): ResolutionResult {
    const tally = votes.reduce(
      (acc, vote) => {
        acc[vote.choice]++;
        return acc;
      },
      {
        [ResolutionResult.INITIATOR_WINS]: 0,
        [ResolutionResult.RESPONDENT_WINS]: 0,
        [ResolutionResult.SPLIT]: 0,
      },
    );

    if (tally[ResolutionResult.INITIATOR_WINS] > tally[ResolutionResult.RESPONDENT_WINS]) {
      return ResolutionResult.INITIATOR_WINS;
    } else if (tally[ResolutionResult.RESPONDENT_WINS] > tally[ResolutionResult.INITIATOR_WINS]) {
      return ResolutionResult.RESPONDENT_WINS;
    } else {
      return ResolutionResult.SPLIT;
    }
  }
}
