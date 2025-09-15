/**
 * XLN Entity Consensus and State Management
 * Core entity processing logic, consensus, proposals, and state transitions
 */

import {
  ConsensusConfig, EntityInput, EntityTx, EntityState, ProposedEntityFrame,
  EntityReplica, Env, JurisdictionConfig, Proposal, ViewChangeRequest, NewViewConfirmation,
  SlashingCondition, SlashingEvidence
} from './types.js';
import { applyEntityTx } from './entity-tx';
import { log, DEBUG, formatEntityDisplay, formatSignerDisplay } from './utils.js';

// === SECURITY VALIDATION ===

/**
 * Validates entity input to prevent malicious or corrupted data
 */
const validateEntityInput = (input: EntityInput): boolean => {
  try {
    // Basic required fields
    if (!input.entityId || typeof input.entityId !== 'string') {
      log.error(`❌ Invalid entityId: ${input.entityId}`);
      return false;
    }
    if (!input.signerId || typeof input.signerId !== 'string') {
      log.error(`❌ Invalid signerId: ${input.signerId}`);
      return false;
    }

    // EntityTx validation
    if (input.entityTxs) {
      if (!Array.isArray(input.entityTxs)) {
        log.error(`❌ EntityTxs must be array, got: ${typeof input.entityTxs}`);
        return false;
      }
      if (input.entityTxs.length > 1000) {
        log.error(`❌ Too many transactions: ${input.entityTxs.length} > 1000`);
        return false;
      }
      for (const tx of input.entityTxs) {
        if (!tx.type || !tx.data) {
          log.error(`❌ Invalid transaction: ${JSON.stringify(tx)}`);
          return false;
        }
        if (typeof tx.type !== 'string' || !['chat', 'propose', 'vote', 'profile-update', 'j_event'].includes(tx.type)) {
          log.error(`❌ Invalid transaction type: ${tx.type}`);
          return false;
        }
      }
    }

    // Precommits validation
    if (input.precommits) {
      if (!(input.precommits instanceof Map)) {
        log.error(`❌ Precommits must be Map, got: ${typeof input.precommits}`);
        return false;
      }
      if (input.precommits.size > 100) {
        log.error(`❌ Too many precommits: ${input.precommits.size} > 100`);
        return false;
      }
      for (const [signerId, signature] of input.precommits) {
        if (typeof signerId !== 'string' || typeof signature !== 'string') {
          log.error(`❌ Invalid precommit format: ${signerId} -> ${signature}`);
          return false;
        }
      }
    }

    // ProposedFrame validation
    if (input.proposedFrame) {
      const frame = input.proposedFrame;
      if (typeof frame.height !== 'number' || frame.height < 0) {
        log.error(`❌ Invalid frame height: ${frame.height}`);
        return false;
      }
      if (!Array.isArray(frame.txs)) {
        log.error(`❌ Frame txs must be array`);
        return false;
      }
      if (!frame.hash || typeof frame.hash !== 'string') {
        log.error(`❌ Invalid frame hash: ${frame.hash}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    log.error(`❌ Input validation error: ${error}`);
    return false;
  }
};

/**
 * Validates entity replica to prevent corrupted state
 */
const validateEntityReplica = (replica: EntityReplica): boolean => {
  try {
    if (!replica.entityId || !replica.signerId) {
      log.error(`❌ Invalid replica IDs: ${replica.entityId}:${replica.signerId}`);
      return false;
    }
    if (replica.state.height < 0) {
      log.error(`❌ Invalid state height: ${replica.state.height}`);
      return false;
    }
    if (replica.mempool.length > 10000) {
      log.error(`❌ Mempool overflow: ${replica.mempool.length} > 10000`);
      return false;
    }
    return true;
  } catch (error) {
    log.error(`❌ Replica validation error: ${error}`);
    return false;
  }
};

/**
 * Detects Byzantine faults like double-signing
 */
const detectByzantineFault = (signatures: Map<string, string>, signerId: string, newSignature: string): boolean => {
  try {
    const existingSig = signatures.get(signerId);
    if (existingSig && existingSig !== newSignature) {
      log.error(`❌ BYZANTINE FAULT: Double-sign detected from ${signerId}`);
      log.error(`❌ Existing: ${existingSig}`);
      log.error(`❌ New: ${newSignature}`);
      return true;
    }
    return false;
  } catch (error) {
    log.error(`❌ Byzantine detection error: ${error}`);
    return false;
  }
};

/**
 * Validates timestamp to prevent temporal attacks
 */
const validateTimestamp = (proposedTime: number, currentTime: number): boolean => {
  try {
    const maxDrift = 30000; // 30 seconds
    const drift = Math.abs(proposedTime - currentTime);
    if (drift > maxDrift) {
      log.error(`❌ Timestamp drift too large: ${drift}ms > ${maxDrift}ms`);
      log.error(`❌ Proposed: ${new Date(proposedTime).toISOString()}`);
      log.error(`❌ Current: ${new Date(currentTime).toISOString()}`);
      return false;
    }
    return true;
  } catch (error) {
    log.error(`❌ Timestamp validation error: ${error}`);
    return false;
  }
};

/**
 * Validates voting power to prevent overflow attacks
 */
const validateVotingPower = (power: bigint): boolean => {
  try {
    if (power < 0n) {
      log.error(`❌ Negative voting power: ${power}`);
      return false;
    }
    // Check for overflow (2^53 - 1 in bigint)
    if (power > BigInt(Number.MAX_SAFE_INTEGER)) {
      log.error(`❌ Voting power overflow: ${power} > ${Number.MAX_SAFE_INTEGER}`);
      return false;
    }
    return true;
  } catch (error) {
    log.error(`❌ Voting power validation error: ${error}`);
    return false;
  }
};

// === SLASHING CONDITIONS ===

/**
 * Create a slashing condition record
 */
const createSlashingCondition = (
  type: SlashingCondition['type'],
  validator: string,
  evidence: SlashingEvidence,
  severity: SlashingCondition['severity'] = 'major'
): SlashingCondition => {
  const penalty: SlashingCondition['penalty'] =
    severity === 'critical' ? 'ejection' :
    severity === 'major' ? 'stake_reduction' : 'warning';

  return {
    type,
    validator,
    evidence,
    timestamp: Date.now(),
    severity,
    penalty
  };
};

/**
 * Detect double signing by same validator on different proposals at same height
 */
const detectDoubleSigning = (replica: EntityReplica, signerId: string, proposalHash: string, signature: string): SlashingCondition | null => {
  const existingSignatures = replica.signatureHistory.get(proposalHash) || [];

  // Check if this validator has signed different proposals at same height
  for (const [otherHash, signatures] of replica.signatureHistory) {
    if (otherHash !== proposalHash && signatures.includes(signerId)) {
      // Found same validator signing different proposals - this is double signing
      const evidence: SlashingEvidence = {
        doubleSigning: {
          signature1: signatures[signatures.indexOf(signerId)],
          signature2: signature,
          proposal1: replica.proposalHistory.find(p => p.hash === otherHash)!,
          proposal2: replica.proposalHistory.find(p => p.hash === proposalHash)!
        }
      };

      console.log(`⚔️  SLASHING: Double signing detected from ${signerId} on proposals ${otherHash.slice(0,10)} and ${proposalHash.slice(0,10)}`);
      return createSlashingCondition('double_signing', signerId, evidence, 'critical');
    }
  }

  // Store this signature for future double-signing detection
  if (!replica.signatureHistory.has(proposalHash)) {
    replica.signatureHistory.set(proposalHash, []);
  }
  replica.signatureHistory.get(proposalHash)!.push(signerId);

  return null;
};

/**
 * Detect invalid proposals (malformed, inconsistent, or violating rules)
 */
const detectInvalidProposal = (replica: EntityReplica, proposal: ProposedEntityFrame, fromValidator: string): SlashingCondition | null => {
  const issues: string[] = [];

  // Check proposal integrity
  if (!proposal.hash || !proposal.newState || !proposal.txs) {
    issues.push('Missing required proposal fields');
  }

  // Check height consistency
  if (proposal.height !== replica.state.height + 1) {
    issues.push(`Invalid height: ${proposal.height} != ${replica.state.height + 1}`);
  }

  // Check view consistency
  if (proposal.view !== undefined && proposal.view < replica.currentView) {
    issues.push(`Invalid view: ${proposal.view} < ${replica.currentView}`);
  }

  // Check if proposer is authorized for this view
  const expectedProposer = getProposerForView(replica.state.config, replica.currentView);
  if (fromValidator !== expectedProposer) {
    issues.push(`Invalid proposer: ${fromValidator} != ${expectedProposer}`);
  }

  // Check transaction validity (basic checks)
  for (const tx of proposal.txs) {
    if (!tx.type || !tx.data) {
      issues.push('Invalid transaction format');
    }
  }

  if (issues.length > 0) {
    const evidence: SlashingEvidence = {
      invalidProposal: {
        proposal,
        reason: issues.join('; ')
      }
    };

    console.log(`⚔️  SLASHING: Invalid proposal detected from ${fromValidator}: ${issues.join('; ')}`);
    return createSlashingCondition('invalid_proposal', fromValidator, evidence, 'major');
  }

  return null;
};

/**
 * Detect premature commits (committing before proper validation time)
 */
const detectPrematureCommit = (replica: EntityReplica, proposal: ProposedEntityFrame, commitTime: number): SlashingCondition | null => {
  const minValidationTime = 1000; // 1 second minimum validation time
  const proposalTime = proposal.newState.timestamp;
  const validationDuration = commitTime - proposalTime;

  if (validationDuration < minValidationTime) {
    const evidence: SlashingEvidence = {
      prematureCommit: {
        proposal,
        commitTime,
        expectedCommitTime: proposalTime + minValidationTime
      }
    };

    console.log(`⚔️  SLASHING: Premature commit detected - validation took only ${validationDuration}ms`);
    return createSlashingCondition('premature_commit', replica.signerId, evidence, 'minor');
  }

  return null;
};

/**
 * Detect conflicting votes on same proposal
 */
const detectConflictingVotes = (replica: EntityReplica, proposalId: string, voter: string, vote: string): SlashingCondition | null => {
  const existingVotes = replica.votingHistory.get(proposalId) || [];

  // Check if this voter has already voted differently on this proposal
  for (const existingVote of existingVotes) {
    const [existingVoter, existingChoice] = existingVote.split(':');
    if (existingVoter === voter && existingChoice !== vote) {
      const evidence: SlashingEvidence = {
        conflictingVotes: {
          vote1: existingVote,
          vote2: `${voter}:${vote}`,
          proposal: proposalId
        }
      };

      console.log(`⚔️  SLASHING: Conflicting votes detected from ${voter} on proposal ${proposalId}: ${existingChoice} vs ${vote}`);
      return createSlashingCondition('conflicting_votes', voter, evidence, 'major');
    }
  }

  // Store this vote for future conflict detection
  if (!replica.votingHistory.has(proposalId)) {
    replica.votingHistory.set(proposalId, []);
  }
  replica.votingHistory.get(proposalId)!.push(`${voter}:${vote}`);

  return null;
};

/**
 * Detect equivocation (sending conflicting messages to different validators)
 */
const detectEquivocation = (replica: EntityReplica, validator: string, message1: string, message2: string, context: string): SlashingCondition | null => {
  if (message1 !== message2) {
    const evidence: SlashingEvidence = {
      equivocation: {
        message1,
        message2,
        context
      }
    };

    console.log(`⚔️  SLASHING: Equivocation detected from ${validator} in ${context}`);
    return createSlashingCondition('equivocation', validator, evidence, 'critical');
  }

  return null;
};

/**
 * Apply slashing penalties
 */
const applySlashingPenalty = (replica: EntityReplica, condition: SlashingCondition): void => {
  const config = replica.state.config;
  const validator = condition.validator;

  switch (condition.penalty) {
    case 'warning':
      console.log(`⚠️  SLASHING PENALTY: Warning issued to ${validator} for ${condition.type}`);
      break;

    case 'stake_reduction':
      // Reduce validator's voting power
      if (config.shares[validator]) {
        const originalShares = config.shares[validator];
        const reducedShares = originalShares * BigInt(75) / BigInt(100); // 25% reduction
        config.shares[validator] = reducedShares;
        console.log(`💸 SLASHING PENALTY: Reduced ${validator}'s stake from ${originalShares} to ${reducedShares} (${condition.type})`);
      }
      break;

    case 'ejection':
      // Remove validator from active set
      config.validators = config.validators.filter(v => v !== validator);
      delete config.shares[validator];
      console.log(`🚫 SLASHING PENALTY: Ejected ${validator} from validator set for ${condition.type}`);
      break;
  }

  // Store the slashing record
  replica.slashingConditions.push(condition);
};

/**
 * Check all slashing conditions for an input
 */
const checkSlashingConditions = (replica: EntityReplica, input: EntityInput): SlashingCondition[] => {
  const conditions: SlashingCondition[] = [];

  // Check double signing on precommits
  if (input.precommits && input.proposedFrame) {
    for (const [signerId, signature] of input.precommits) {
      const condition = detectDoubleSigning(replica, signerId, input.proposedFrame.hash, signature);
      if (condition) conditions.push(condition);
    }
  }

  // Check invalid proposals
  if (input.proposedFrame) {
    const condition = detectInvalidProposal(replica, input.proposedFrame, input.signerId);
    if (condition) conditions.push(condition);
  }

  // Check premature commits
  if (input.precommits?.size && input.proposedFrame) {
    const condition = detectPrematureCommit(replica, input.proposedFrame, Date.now());
    if (condition) conditions.push(condition);
  }

  // Check conflicting votes in transactions
  if (input.entityTxs) {
    for (const tx of input.entityTxs) {
      if (tx.type === 'vote') {
        const condition = detectConflictingVotes(replica, tx.data.proposalId, tx.data.voter, tx.data.choice);
        if (condition) conditions.push(condition);
      }
    }
  }

  return conditions;
};

// === VIEW CHANGE LOGIC ===

/**
 * Calculate the next proposer based on view number
 */
const getProposerForView = (config: ConsensusConfig, view: number): string => {
  return config.validators[view % config.validators.length];
};

/**
 * Start view change timeout for proposer failure detection
 */
const startViewChangeTimer = (replica: EntityReplica): void => {
  const timeout = replica.state.config.viewChangeTimeout || 30000; // 30 seconds default

  // Clear existing timer
  if (replica.viewChangeTimer) {
    clearTimeout(replica.viewChangeTimer);
  }

  replica.viewChangeTimer = setTimeout(() => {
    // Timeout reached, initiate view change
    console.log(`⏰ VIEW-CHANGE-TIMEOUT: ${replica.signerId} detected proposer timeout, initiating view change from view ${replica.currentView}`);
    initiateViewChange(replica, 'timeout');
  }, timeout);
};

/**
 * Initiate a view change
 */
const initiateViewChange = (replica: EntityReplica, reason: 'timeout' | 'byzantine' | 'network_partition'): ViewChangeRequest => {
  const newView = replica.currentView + 1;

  const viewChangeRequest: ViewChangeRequest = {
    newView,
    lastCommittedHeight: replica.state.height,
    lastCommittedHash: replica.lockedFrame?.hash,
    reason,
    timestamp: Date.now()
  };

  // Store our own view change request
  replica.viewChangeRequests.set(replica.signerId, viewChangeRequest);

  console.log(`🔄 VIEW-CHANGE: ${replica.signerId} initiated view change from ${replica.currentView} to ${newView} (reason: ${reason})`);

  return viewChangeRequest;
};

/**
 * Process view change request from peer
 */
const processViewChangeRequest = (replica: EntityReplica, request: ViewChangeRequest, fromPeer: string): boolean => {
  // Validate view change request
  if (request.newView <= replica.currentView) {
    console.log(`❌ VIEW-CHANGE: Invalid view number ${request.newView} <= ${replica.currentView} from ${fromPeer}`);
    return false;
  }

  if (request.lastCommittedHeight > replica.state.height) {
    console.log(`❌ VIEW-CHANGE: Invalid height ${request.lastCommittedHeight} > ${replica.state.height} from ${fromPeer}`);
    return false;
  }

  // Store valid view change request
  replica.viewChangeRequests.set(fromPeer, request);
  console.log(`✅ VIEW-CHANGE: Stored view change request from ${fromPeer} for view ${request.newView}`);

  // Check if we have enough view change requests to trigger new view
  return checkViewChangeQuorum(replica);
};

/**
 * Check if we have enough view change requests to start new view
 */
const checkViewChangeQuorum = (replica: EntityReplica): boolean => {
  const config = replica.state.config;
  const totalPower = Array.from(replica.viewChangeRequests.keys())
    .reduce((sum, signerId) => sum + (config.shares[signerId] || 0n), 0n);

  if (totalPower >= config.threshold) {
    // We have enough view change requests, start new view
    const newView = Math.max(...Array.from(replica.viewChangeRequests.values()).map(r => r.newView));
    const newProposer = getProposerForView(config, newView);

    console.log(`🎯 NEW-VIEW: Quorum reached for view ${newView}, new proposer: ${newProposer}`);

    // Update our view
    replica.currentView = newView;
    replica.isProposer = (replica.signerId === newProposer);

    // Clear view change state
    replica.viewChangeRequests.clear();
    replica.proposal = undefined;

    // Clear timer
    if (replica.viewChangeTimer) {
      clearTimeout(replica.viewChangeTimer);
      replica.viewChangeTimer = undefined;
    }

    // Start new timer for the new proposer
    if (!replica.isProposer) {
      startViewChangeTimer(replica);
    }

    return true;
  }

  return false;
};

/**
 * Reset view change timer when we receive activity from proposer
 */
const resetViewChangeTimer = (replica: EntityReplica): void => {
  replica.lastProposalTime = Date.now();

  if (replica.viewChangeTimer) {
    clearTimeout(replica.viewChangeTimer);
    replica.viewChangeTimer = undefined;
  }

  // Start new timer if we're not the proposer
  if (!replica.isProposer) {
    startViewChangeTimer(replica);
  }
};

// === CORE ENTITY PROCESSING ===

/**
 * Main entity input processor - handles consensus, proposals, and state transitions
 */
export const applyEntityInput = (env: Env, entityReplica: EntityReplica, entityInput: EntityInput): EntityInput[] => {
  // Debug: Log every input being processed with timestamp and unique identifier
  const entityDisplay = formatEntityDisplay(entityInput.entityId);
  const timestamp = Date.now();
  const currentProposalHash = entityReplica.proposal?.hash?.slice(0,10) || 'none';
  const frameHash = entityInput.proposedFrame?.hash?.slice(0,10) || 'none';

  console.log(`🔍 INPUT-RECEIVED: [${timestamp}] Processing input for Entity #${entityDisplay}:${formatSignerDisplay(entityInput.signerId)}`);
  console.log(`🔍 INPUT-STATE: Current proposal: ${currentProposalHash}, Mempool: ${entityReplica.mempool.length}, isProposer: ${entityReplica.isProposer}`);
  console.log(`🔍 INPUT-DETAILS: txs=${entityInput.entityTxs?.length || 0}, precommits=${entityInput.precommits?.size || 0}, frame=${frameHash}`);
  if (entityInput.precommits?.size) {
    const precommitSigners = Array.from(entityInput.precommits.keys());
    console.log(`🔍 INPUT-PRECOMMITS: Received precommits from: ${precommitSigners.join(', ')}`);
    // Track exactly which proposal these precommits are for
    const firstPrecommit = entityInput.precommits.values().next().value;
    const proposalHashFromSig = firstPrecommit ? firstPrecommit.split('_')[2]?.slice(0,10) : 'unknown';
    console.log(`🔍 PRECOMMIT-PROPOSAL: These precommits are for proposal: ${proposalHashFromSig}`);
  }

  // SECURITY: Validate all inputs
  if (!validateEntityInput(entityInput)) {
    log.error(`❌ Invalid input for ${entityInput.entityId}:${entityInput.signerId}`);
    return [];
  }
  if (!validateEntityReplica(entityReplica)) {
    log.error(`❌ Invalid replica state for ${entityReplica.entityId}:${entityReplica.signerId}`);
    return [];
  }

  const entityOutbox: EntityInput[] = [];

  // Check for slashing conditions BEFORE processing any consensus logic
  const slashingConditions = checkSlashingConditions(entityReplica, entityInput);
  if (slashingConditions.length > 0) {
    console.log(`⚔️  SLASHING: Detected ${slashingConditions.length} slashing conditions from ${entityInput.signerId}`);

    // Apply penalties for each slashing condition
    for (const condition of slashingConditions) {
      applySlashingPenalty(entityReplica, condition);
    }

    // For critical violations, reject the input entirely
    const criticalViolations = slashingConditions.filter(c => c.severity === 'critical');
    if (criticalViolations.length > 0) {
      console.log(`🚫 SLASHING: Rejecting input due to ${criticalViolations.length} critical violations from ${entityInput.signerId}`);
      return entityOutbox; // Return empty, reject the malicious input
    }
  }

  // Handle view change requests first (before normal consensus)
  if (entityInput.viewChangeRequest) {
    console.log(`🔄 VIEW-CHANGE-REQUEST: ${entityReplica.signerId} received view change from ${entityInput.signerId} for view ${entityInput.viewChangeRequest.newView}`);

    if (processViewChangeRequest(entityReplica, entityInput.viewChangeRequest, entityInput.signerId)) {
      // View change completed, broadcast new view confirmation if we're the new proposer
      if (entityReplica.isProposer) {
        const newViewConfirmation: NewViewConfirmation = {
          newView: entityReplica.currentView,
          newProposer: entityReplica.signerId,
          viewChangeProofs: new Map(Array.from(entityReplica.viewChangeRequests.entries())
            .map(([signerId, req]) => [signerId, `viewchange_${signerId}_${req.newView}_${req.timestamp}`])),
          prepareCertificate: entityReplica.lockedFrame
        };

        // Send new view confirmation to all validators
        entityReplica.state.config.validators.forEach(validatorId => {
          if (validatorId !== entityReplica.signerId) {
            entityOutbox.push({
              entityId: entityInput.entityId,
              signerId: validatorId,
              newViewConfirmation
            });
          }
        });

        console.log(`🎯 NEW-VIEW-PROPOSER: ${entityReplica.signerId} became proposer for view ${entityReplica.currentView}, sent confirmations to ${entityReplica.state.config.validators.length - 1} validators`);
      }
    }
    // Don't process normal consensus messages during view change
    return entityOutbox;
  }

  // Handle new view confirmations
  if (entityInput.newViewConfirmation) {
    const confirmation = entityInput.newViewConfirmation;
    console.log(`🎯 NEW-VIEW-CONFIRMATION: ${entityReplica.signerId} received new view confirmation for view ${confirmation.newView} with proposer ${confirmation.newProposer}`);

    // Update to new view
    entityReplica.currentView = confirmation.newView;
    entityReplica.isProposer = (entityReplica.signerId === confirmation.newProposer);
    entityReplica.viewChangeRequests.clear();
    entityReplica.proposal = undefined;

    // Clear timer
    if (entityReplica.viewChangeTimer) {
      clearTimeout(entityReplica.viewChangeTimer);
      entityReplica.viewChangeTimer = undefined;
    }

    // Start timer if we're not the proposer
    if (!entityReplica.isProposer) {
      startViewChangeTimer(entityReplica);
    }

    console.log(`🎯 VIEW-UPDATED: ${entityReplica.signerId} updated to view ${entityReplica.currentView}, isProposer=${entityReplica.isProposer}`);
    return entityOutbox;
  }

  // Add transactions to mempool (mutable for performance)
  if (entityInput.entityTxs?.length) {
    // DEBUG: Track vote transactions specifically
    const voteTransactions = entityInput.entityTxs.filter(tx => tx.type === 'vote');
    if (voteTransactions.length > 0) {
      console.log(`🗳️ VOTE-MEMPOOL: ${entityReplica.signerId} receiving ${voteTransactions.length} vote transactions`);
      voteTransactions.forEach(tx => {
        console.log(`🗳️ VOTE-TX:`, tx);
      });
    }

    if (entityReplica.signerId === 'alice') {
      console.log(`🔥 ALICE-RECEIVES: Alice receiving ${entityInput.entityTxs.length} txs from input`);
      console.log(`🔥 ALICE-RECEIVES: Transaction types:`, entityInput.entityTxs.map(tx => tx.type));
      console.log(`🔥 ALICE-RECEIVES: Alice isProposer=${entityReplica.isProposer}, current mempool=${entityReplica.mempool.length}`);
    }
    entityReplica.mempool.push(...entityInput.entityTxs);
    if (DEBUG) console.log(`    → Added ${entityInput.entityTxs.length} txs to mempool (total: ${entityReplica.mempool.length})`);
    if (DEBUG && entityInput.entityTxs.length > 3) {
      console.log(`    ⚠️  CORNER CASE: Large batch of ${entityInput.entityTxs.length} transactions`);
    }
  } else if (entityInput.entityTxs && entityInput.entityTxs.length === 0) {
    if (DEBUG) console.log(`    ⚠️  CORNER CASE: Empty transaction array received - no mempool changes`);
  }

  // CRITICAL: Forward transactions to proposer BEFORE processing commits
  // This prevents race condition where commits clear mempool before forwarding
  if (!entityReplica.isProposer && entityReplica.mempool.length > 0) {
    if (DEBUG) console.log(`    → Non-proposer sending ${entityReplica.mempool.length} txs to proposer`);
    // Send mempool to proposer
    const proposerId = entityReplica.state.config.validators[0];
    console.log(`🔥 BOB-TO-ALICE: Bob sending ${entityReplica.mempool.length} txs to proposer ${proposerId}`);
    console.log(`🔥 BOB-TO-ALICE: Transaction types:`, entityReplica.mempool.map(tx => tx.type));
    entityOutbox.push({
      entityId: entityInput.entityId,
      signerId: proposerId,
      entityTxs: [...entityReplica.mempool]
    });
    // Clear mempool after sending
    entityReplica.mempool.length = 0;
  }

  // Handle commit notifications AFTER forwarding (when receiving finalized frame from proposer)
  if (entityInput.precommits?.size && entityInput.proposedFrame && !entityReplica.proposal) {
    const signers = Array.from(entityInput.precommits.keys());
    const totalPower = calculateQuorumPower(entityReplica.state.config, signers);

    if (totalPower >= entityReplica.state.config.threshold) {
      // This is a commit notification from proposer, apply the frame
      if (DEBUG) console.log(`    → Received commit notification with ${entityInput.precommits.size} signatures`);

      // Apply the committed frame with incremented height
      entityReplica.state = {
        ...entityInput.proposedFrame.newState,
        height: entityReplica.state.height + 1
      };
      entityReplica.mempool.length = 0;
      entityReplica.lockedFrame = undefined; // Release lock after commit
      if (DEBUG) console.log(`    → Applied commit, new state: ${entityReplica.state.messages.length} messages, height: ${entityReplica.state.height}`);

      // Return early - commit notifications don't trigger further processing
      return entityOutbox;
    }
  }

  // Handle proposed frame (PROPOSE phase) - only if not a commit notification
  if (entityInput.proposedFrame && (!entityReplica.proposal ||
      (entityReplica.state.config.mode === 'gossip-based' && entityReplica.isProposer))) {

    // Reset view change timer when we receive a valid proposal
    resetViewChangeTimer(entityReplica);
    const frameSignature = `sig_${entityReplica.signerId}_${entityInput.proposedFrame.hash}`;
    const config = entityReplica.state.config;

    // Lock to this frame (CometBFT style)
    entityReplica.lockedFrame = entityInput.proposedFrame;
    if (DEBUG) console.log(`    → Validator locked to frame ${entityInput.proposedFrame.hash.slice(0,10)}...`);

    if (config.mode === 'gossip-based') {
      // Send precommit to all validators
      config.validators.forEach(validatorId => {
        console.log(`🔍 GOSSIP: [${timestamp}] ${entityReplica.signerId} sending precommit to ${validatorId} for entity ${entityInput.entityId.slice(0,10)}, proposal ${frameHash}, sig: ${frameSignature.slice(0,20)}...`);
        entityOutbox.push({
          entityId: entityInput.entityId,
          signerId: validatorId,
          precommits: new Map([[entityReplica.signerId, frameSignature]])
        });
      });
      if (DEBUG) console.log(`    → Signed proposal, gossiping precommit to ${config.validators.length} validators`);
    } else {
      // Send precommit to proposer only
      const proposerId = config.validators[0];
      console.log(`🔍 PROPOSER: [${timestamp}] ${entityReplica.signerId} sending precommit to ${proposerId} for entity ${entityInput.entityId.slice(0,10)}, proposal ${frameHash}, sig: ${frameSignature.slice(0,20)}...`);
      console.log(`🔍 PROPOSER-REASON: Signed new proposal, current state: proposal=${currentProposalHash}, locked=${entityReplica.lockedFrame?.hash?.slice(0,10) || 'none'}`);
      entityOutbox.push({
        entityId: entityInput.entityId,
        signerId: proposerId,
        precommits: new Map([[entityReplica.signerId, frameSignature]])
      });
      if (DEBUG) console.log(`    → Signed proposal, sending precommit to ${proposerId}`);
    }
  }

  // Handle precommits (SIGN phase)
  if (entityInput.precommits?.size && entityReplica.proposal) {
    // SECURITY: Check for Byzantine faults before collecting signatures
    for (const [signerId, signature] of entityInput.precommits) {
      if (detectByzantineFault(entityReplica.proposal.signatures, signerId, signature)) {
        log.error(`❌ Rejecting Byzantine input from ${signerId}`);
        return entityOutbox; // Return early, don't process malicious input
      }
      entityReplica.proposal.signatures.set(signerId, signature);
    }
    if (DEBUG) console.log(`    → Collected ${entityInput.precommits.size} signatures (total: ${entityReplica.proposal.signatures.size})`);

    // Check threshold using shares
    const signers = Array.from(entityReplica.proposal.signatures.keys());
    const totalPower = calculateQuorumPower(entityReplica.state.config, signers);

    // SECURITY: Validate voting power
    if (!validateVotingPower(totalPower)) {
      log.error(`❌ Invalid voting power calculation: ${totalPower}`);
      return entityOutbox;
    }

    if (DEBUG) {
      const totalShares = Object.values(entityReplica.state.config.shares).reduce((sum, val) => sum + val, BigInt(0));
      const percentage = ((Number(totalPower) / Number(entityReplica.state.config.threshold)) * 100).toFixed(1);
      log.info(`    🔍 Threshold check: ${totalPower} / ${totalShares} [${percentage}% threshold${Number(totalPower) >= Number(entityReplica.state.config.threshold) ? '+' : ''}]`);
      if (entityReplica.state.config.mode === 'gossip-based') {
        console.log(`    ⚠️  CORNER CASE: Gossip mode - all validators receive precommits`);
      }
    }

    if (totalPower >= entityReplica.state.config.threshold) {
      // Commit phase - use pre-computed state with incremented height
      entityReplica.state = {
        ...entityReplica.proposal.newState,
        height: entityReplica.state.height + 1
      };
      if (DEBUG) console.log(`    → Threshold reached! Committing frame, height: ${entityReplica.state.height}`);

      // Save proposal data before clearing
      const sortedSignatures = sortSignatures(entityReplica.proposal.signatures, entityReplica.state.config);
      const committedFrame = entityReplica.proposal;

      // Clear state (mutable)
      entityReplica.mempool.length = 0;
      entityReplica.proposal = undefined;
      entityReplica.lockedFrame = undefined; // Release lock after commit

      // Only send commit notifications in proposer-based mode
      // In gossip mode, everyone already has all precommits via gossip
      if (entityReplica.state.config.mode === 'proposer-based') {
        const committedProposalHash = committedFrame.hash.slice(0,10);
        console.log(`🔍 COMMIT-START: [${timestamp}] ${entityReplica.signerId} reached threshold for proposal ${committedProposalHash}, sending commit notifications...`);

        // Notify all validators (except self - proposer already has all precommits)
        entityReplica.state.config.validators.forEach(validatorId => {
          if (validatorId !== entityReplica.signerId) {
            const precommitSigners = Array.from(sortedSignatures.keys());
            console.log(`🔍 COMMIT: [${timestamp}] ${entityReplica.signerId} sending commit notification to ${validatorId} for entity ${entityInput.entityId.slice(0,10)}, proposal ${committedProposalHash} (${sortedSignatures.size} precommits from: ${precommitSigners.join(', ')})`);
            entityOutbox.push({
              entityId: entityInput.entityId,
              signerId: validatorId,
              precommits: sortedSignatures,
              proposedFrame: committedFrame
            });
          }
        });
        const notifiedCount = entityReplica.state.config.validators.length - 1; // excluding self
        if (DEBUG) console.log(`    → Sending commit notifications to ${notifiedCount} validators (excluding self)`);
      } else {
        console.log(`🔍 GOSSIP-COMMIT: [${timestamp}] ${entityReplica.signerId} NOT sending commit notifications (gossip mode) for entity ${entityInput.entityId.slice(0,10)}...`);
        if (DEBUG) console.log(`    → Gossip mode: No commit notifications needed (everyone has precommits via gossip)`);
      }
    }
  }

  // Commit notifications are now handled at the top of the function

  // Auto-propose logic: ONLY proposer can propose (BFT requirement)
  if (entityReplica.isProposer && entityReplica.mempool.length > 0 && !entityReplica.proposal) {
    console.log(`🔥 ALICE-PROPOSES: Alice auto-propose triggered!`);
    console.log(`🔥 ALICE-PROPOSES: mempool=${entityReplica.mempool.length}, isProposer=${entityReplica.isProposer}, hasProposal=${!!entityReplica.proposal}`);
    console.log(`🔥 ALICE-PROPOSES: Mempool transaction types:`, entityReplica.mempool.map(tx => tx.type));

    // Check if this is a single signer entity (threshold = 1, only 1 validator)
    const isSingleSigner = entityReplica.state.config.validators.length === 1 &&
                           entityReplica.state.config.threshold === BigInt(1);

    if (isSingleSigner) {
      console.log(`🚀 SINGLE-SIGNER: Direct execution without consensus for single signer entity`);
      // For single signer entities, directly apply transactions without consensus
      const newEntityState = applyEntityFrame(env, entityReplica.state, entityReplica.mempool);
      entityReplica.state = {
        ...newEntityState,
        height: entityReplica.state.height + 1
      };

      // Clear mempool after direct application
      entityReplica.mempool.length = 0;

      if (DEBUG) console.log(`    ⚡ Single signer entity: transactions applied directly, height: ${entityReplica.state.height}`);
      return entityOutbox; // Skip the full consensus process
    }

    if (DEBUG) console.log(`    🚀 Auto-propose triggered: mempool=${entityReplica.mempool.length}, isProposer=${entityReplica.isProposer}, hasProposal=${!!entityReplica.proposal}`);
    // Compute new state once during proposal
    const newEntityState = applyEntityFrame(env, entityReplica.state, entityReplica.mempool);

    // Proposer creates new timestamp for this frame (always use current time for new proposals)
    const newTimestamp = Date.now();

    // SECURITY: Validate timestamp
    if (!validateTimestamp(newTimestamp, Date.now())) {
      log.error(`❌ Invalid proposal timestamp: ${newTimestamp}`);
      return entityOutbox;
    }

    const frameHash = `frame_${entityReplica.state.height + 1}_${newTimestamp}`;
    const selfSignature = `sig_${entityReplica.signerId}_${frameHash}`;

    entityReplica.proposal = {
      height: entityReplica.state.height + 1,
      txs: [...entityReplica.mempool],
      hash: frameHash,
      newState: {
        ...newEntityState,
        height: entityReplica.state.height + 1,
        timestamp: newTimestamp // Set new deterministic timestamp in proposed state
      },
      signatures: new Map<string, string>([[entityReplica.signerId, selfSignature]]) // Proposer signs immediately
    };

    if (DEBUG) console.log(`    → Auto-proposing frame ${entityReplica.proposal.hash} with ${entityReplica.proposal.txs.length} txs and self-signature.`);

    // Send proposal to all validators (except self)
    entityReplica.state.config.validators.forEach(validatorId => {
      if (validatorId !== entityReplica.signerId) {
        entityOutbox.push({
          entityId: entityInput.entityId,
          signerId: validatorId,
          proposedFrame: entityReplica.proposal!
          // Note: Don't send entityTxs separately - they're already in proposedFrame.txs
        });
      }
    });
  } else if (entityReplica.isProposer && entityReplica.mempool.length === 0 && !entityReplica.proposal) {
    if (DEBUG) console.log(`    ⚠️  CORNER CASE: Proposer with empty mempool - no auto-propose`);
  } else if (!entityReplica.isProposer && entityReplica.mempool.length > 0) {
    if (DEBUG) console.log(`    → Non-proposer sending ${entityReplica.mempool.length} txs to proposer`);
    // Send mempool to proposer
    const proposerId = entityReplica.state.config.validators[0];
    console.log(`🔥 BOB-TO-ALICE: Bob sending ${entityReplica.mempool.length} txs to proposer ${proposerId}`);
    console.log(`🔥 BOB-TO-ALICE: Transaction types:`, entityReplica.mempool.map(tx => tx.type));
    entityOutbox.push({
      entityId: entityInput.entityId,
      signerId: proposerId,
      entityTxs: [...entityReplica.mempool]
    });
    // Clear mempool after sending
    entityReplica.mempool.length = 0;
  } else if (entityReplica.isProposer && entityReplica.proposal) {
    if (DEBUG) console.log(`    ⚠️  CORNER CASE: Proposer already has pending proposal - no new auto-propose`);
  }

  // Debug: Log outputs being generated with detailed analysis
  console.log(`🔍 OUTPUT-GENERATED: [${timestamp}] Entity #${entityDisplay}:${formatSignerDisplay(entityReplica.signerId)} generating ${entityOutbox.length} outputs`);
  console.log(`🔍 OUTPUT-FINAL-STATE: proposal=${entityReplica.proposal?.hash?.slice(0,10) || 'none'}, mempool=${entityReplica.mempool.length}, locked=${entityReplica.lockedFrame?.hash?.slice(0,10) || 'none'}`);

  entityOutbox.forEach((output, index) => {
    const targetDisplay = formatEntityDisplay(output.entityId);
    const outputFrameHash = output.proposedFrame?.hash?.slice(0,10) || 'none';
    console.log(`🔍 OUTPUT-${index + 1}: [${timestamp}] To Entity #${targetDisplay}:${formatSignerDisplay(output.signerId)} - txs=${output.entityTxs?.length || 0}, precommits=${output.precommits?.size || 0}, frame=${outputFrameHash}`);

    if (output.precommits?.size) {
      const precommitSigners = Array.from(output.precommits.keys());
      console.log(`🔍 OUTPUT-${index + 1}-PRECOMMITS: Sending precommits from: ${precommitSigners.join(', ')}`);

      // Show the actual signature content to track duplicates
      output.precommits.forEach((sig, signer) => {
        const sigShort = sig.slice(0,20);
        const proposalFromSig = sig.split('_')[2]?.slice(0,10) || 'unknown';
        console.log(`🔍 OUTPUT-${index + 1}-SIG-DETAIL: ${signer} -> ${sigShort}... (proposal: ${proposalFromSig})`);
      });
    }

    // Classify output type for clarity
    if (output.proposedFrame && output.precommits?.size) {
      console.log(`🔍 OUTPUT-${index + 1}-TYPE: COMMIT_NOTIFICATION (frame + precommits)`);
    } else if (output.precommits?.size) {
      console.log(`🔍 OUTPUT-${index + 1}-TYPE: PRECOMMIT_VOTE (precommits only)`);
    } else if (output.proposedFrame) {
      console.log(`🔍 OUTPUT-${index + 1}-TYPE: PROPOSAL (frame only)`);
    } else if (output.entityTxs?.length) {
      console.log(`🔍 OUTPUT-${index + 1}-TYPE: TRANSACTION_FORWARD (txs only)`);
    } else {
      console.log(`🔍 OUTPUT-${index + 1}-TYPE: UNKNOWN (empty output)`);
    }
  });

  return entityOutbox;
};

export const applyEntityFrame = (env: Env, entityState: EntityState, entityTxs: EntityTx[]): EntityState => {
  return entityTxs.reduce((currentEntityState, entityTx) => applyEntityTx(env, currentEntityState, entityTx), entityState);
};

// === HELPER FUNCTIONS ===

/**
 * Calculate quorum power based on validator shares
 */
export const calculateQuorumPower = (config: ConsensusConfig, signers: string[]): bigint => {
  return signers.reduce((total, signerId) => {
    return total + (config.shares[signerId] || 0n);
  }, 0n);
};

export const sortSignatures = (signatures: Map<string, string>, config: ConsensusConfig): Map<string, string> => {
  const sortedEntries = Array.from(signatures.entries())
    .sort(([a], [b]) => {
      const indexA = config.validators.indexOf(a);
      const indexB = config.validators.indexOf(b);
      return indexA - indexB;
    });
  return new Map(sortedEntries);
};



// === ENTITY UTILITIES (existing) ===

/**
 * Merges duplicate entity inputs to reduce processing overhead
 */
export const mergeEntityInputs = (inputs: EntityInput[]): EntityInput[] => {
  const merged = new Map<string, EntityInput>();
  let duplicateCount = 0;
  const timestamp = Date.now();

  // Always log input count for debugging with detailed breakdown
  console.log(`🔍 MERGE-START: [${timestamp}] Processing ${inputs.length} entity inputs for merging`);

  // Pre-analysis: Show all inputs before merging to identify potential Carol duplicates
  const inputAnalysis = inputs.map((input, i) => {
    const entityShort = input.entityId.slice(0,10);
    const frameHash = input.proposedFrame?.hash?.slice(0,10) || 'none';
    const precommitCount = input.precommits?.size || 0;
    const precommitSigners = input.precommits ? Array.from(input.precommits.keys()).join(',') : 'none';
    return `${i+1}:${entityShort}:${input.signerId}(txs=${input.entityTxs?.length||0},pc=${precommitCount}[${precommitSigners}],f=${frameHash})`;
  });
  console.log(`🔍 MERGE-INPUTS: ${inputAnalysis.join(' | ')}`);

  // Look for potential Carol duplicates specifically
  const carolInputs = inputs.filter(input => input.signerId.includes('carol'));
  if (carolInputs.length > 1) {
    console.log(`🔍 MERGE-CAROL-ALERT: Found ${carolInputs.length} inputs from Carol - potential duplicate source!`);
    carolInputs.forEach((input, i) => {
      const entityShort = input.entityId.slice(0,10);
      const precommitSigners = input.precommits ? Array.from(input.precommits.keys()).join(',') : 'none';
      console.log(`🔍 MERGE-CAROL-${i+1}: ${entityShort}:${input.signerId} - precommits: ${precommitSigners}`);
    });
  }

  for (const input of inputs) {
    const key = `${input.entityId}:${input.signerId}`;
    const entityShort = input.entityId.slice(0, 10);

    if (merged.has(key)) {
      const existing = merged.get(key)!;
      duplicateCount++;

      console.log(`🔍 DUPLICATE-FOUND: Merging duplicate input ${duplicateCount} for ${entityShort}:${input.signerId}`);

      // Merge entity transactions
      if (input.entityTxs) {
        existing.entityTxs = [...(existing.entityTxs || []), ...input.entityTxs];
        console.log(`🔍 MERGE-TXS: Added ${input.entityTxs.length} transactions`);
      }

      // Merge precommits
      if (input.precommits) {
        const existingPrecommits = existing.precommits || new Map();
        console.log(`🔍 MERGE-PRECOMMITS: Merging ${input.precommits.size} precommits into existing ${existingPrecommits.size} for ${entityShort}:${input.signerId}`);
        input.precommits.forEach((signature, signerId) => {
          console.log(`🔍 MERGE-DETAIL: Adding precommit from ${signerId} (sig: ${signature.slice(0,20)}...)`);
          existingPrecommits.set(signerId, signature);
        });
        existing.precommits = existingPrecommits;
        console.log(`🔍 MERGE-RESULT: Total ${existingPrecommits.size} precommits after merge`);
      }

      // Keep the latest frame (simplified)
      if (input.proposedFrame) existing.proposedFrame = input.proposedFrame;

      console.log(`    🔄 Merging inputs for ${key}: txs=${input.entityTxs?.length || 0}, precommits=${input.precommits?.size || 0}, frame=${!!input.proposedFrame}`);
    } else {
      merged.set(key, { ...input });
    }
  }

  if (duplicateCount > 0) {
    console.log(`    ⚠️  CORNER CASE: Merged ${duplicateCount} duplicate inputs (${inputs.length} → ${merged.size})`);
  }

  return Array.from(merged.values());
};

/**
 * Gets entity state summary for debugging
 */
export const getEntityStateSummary = (replica: EntityReplica): string => {
  const hasProposal = replica.proposal ? '✓' : '✗';
  return `mempool=${replica.mempool.length}, messages=${replica.state.messages.length}, proposal=${hasProposal}`;
};

/**
 * Checks if entity should auto-propose (simplified version)
 */
export const shouldAutoPropose = (replica: EntityReplica, config: ConsensusConfig): boolean => {
  const hasMempool = replica.mempool.length > 0;
  const isProposer = replica.isProposer;
  const hasProposal = replica.proposal !== undefined;

  return hasMempool && isProposer && !hasProposal;
};

/**
 * Processes empty transaction arrays (corner case)
 */
export const handleEmptyTransactions = (): void => {
  console.log(`    ⚠️  CORNER CASE: Empty transaction array received - no mempool changes`);
};

/**
 * Logs large transaction batches (corner case)
 */
export const handleLargeBatch = (txCount: number): void => {
  if (txCount >= 8) {
    console.log(`    ⚠️  CORNER CASE: Large batch of ${txCount} transactions`);
  }
};

/**
 * Handles gossip mode precommit distribution
 */
export const handleGossipMode = (): void => {
  console.log(`    ⚠️  CORNER CASE: Gossip mode - all validators receive precommits`);
};

/**
 * Logs proposer with empty mempool corner case
 */
export const handleEmptyMempoolProposer = (): void => {
  console.log(`    ⚠️  CORNER CASE: Proposer with empty mempool - no auto-propose`);
};

// === VIEW CHANGE EXPORTS ===

/**
 * Initialize view change state for a replica
 */
export const initializeViewChangeState = (replica: EntityReplica, initialView: number = 0): void => {
  replica.currentView = initialView;
  replica.viewChangeRequests = new Map();
  replica.lastProposalTime = Date.now();

  // Initialize slashing state
  replica.slashingConditions = [];
  replica.signatureHistory = new Map();
  replica.votingHistory = new Map();
  replica.proposalHistory = [];

  // Determine initial proposer
  const initialProposer = getProposerForView(replica.state.config, initialView);
  replica.isProposer = (replica.signerId === initialProposer);

  // Start view change timer for non-proposers
  if (!replica.isProposer) {
    startViewChangeTimer(replica);
  }

  console.log(`🎯 VIEW-INIT: ${replica.signerId} initialized to view ${initialView}, proposer: ${initialProposer}, isProposer: ${replica.isProposer}`);
};

/**
 * Manually trigger view change (for testing or Byzantine fault detection)
 */
export const triggerViewChange = (replica: EntityReplica, reason: 'timeout' | 'byzantine' | 'network_partition'): EntityInput[] => {
  const viewChangeRequest = initiateViewChange(replica, reason);

  // Broadcast view change request to all validators
  const outputs: EntityInput[] = [];
  replica.state.config.validators.forEach(validatorId => {
    if (validatorId !== replica.signerId) {
      outputs.push({
        entityId: replica.entityId,
        signerId: validatorId,
        viewChangeRequest
      });
    }
  });

  return outputs;
};

/**
 * Get current view and proposer info
 */
export const getViewInfo = (replica: EntityReplica): { view: number; proposer: string; isProposer: boolean } => {
  const proposer = getProposerForView(replica.state.config, replica.currentView);
  return {
    view: replica.currentView,
    proposer,
    isProposer: replica.isProposer
  };
};

/**
 * Check if view change is in progress
 */
export const isViewChangeInProgress = (replica: EntityReplica): boolean => {
  return replica.viewChangeRequests.size > 0;
};

// === SLASHING EXPORTS ===

/**
 * Get slashing conditions for a validator
 */
export const getSlashingHistory = (replica: EntityReplica, validator?: string): SlashingCondition[] => {
  if (validator) {
    return replica.slashingConditions.filter(c => c.validator === validator);
  }
  return replica.slashingConditions;
};

/**
 * Check if a validator has been ejected due to slashing
 */
export const isValidatorEjected = (replica: EntityReplica, validator: string): boolean => {
  return !replica.state.config.validators.includes(validator) &&
         replica.slashingConditions.some(c => c.validator === validator && c.penalty === 'ejection');
};

/**
 * Get current validator stakes (after slashing adjustments)
 */
export const getValidatorStakes = (replica: EntityReplica): { [validator: string]: bigint } => {
  return { ...replica.state.config.shares };
};

/**
 * Manually trigger slashing for testing
 */
export const triggerSlashing = (
  replica: EntityReplica,
  validator: string,
  type: SlashingCondition['type'],
  evidence: SlashingEvidence,
  severity: SlashingCondition['severity'] = 'major'
): void => {
  const condition = createSlashingCondition(type, validator, evidence, severity);
  applySlashingPenalty(replica, condition);
};