import { calculateQuorumPower } from '../entity-consensus';
import { formatEntityId } from '../entity-helpers';
import { processProfileUpdate } from '../name-resolution';
import { db } from '../runtime';
import { EntityState, EntityTx, Env, Proposal, Delta, AccountTx, EntityInput } from '../types';
import { DEBUG, log } from '../utils';
import { safeStringify } from '../serialization-utils';
import { buildEntityProfile } from '../gossip-helper';
import { getDefaultCreditLimit } from '../account-utils';
// import { addToReserves, subtractFromReserves } from './financial'; // Currently unused
import { handleAccountInput } from './handlers/account';
import { handleJEvent } from './j-events';
import { executeProposal, generateProposalId } from './proposals';
import { validateMessage } from './validation';
import { cloneEntityState, addMessage } from '../state-helpers';
import { submitSettle } from '../evm';
import { logError } from '../logger';

export const applyEntityTx = async (env: Env, entityState: EntityState, entityTx: EntityTx): Promise<{ newState: EntityState, outputs: EntityInput[] }> => {
  if (!entityTx) {
    logError("ENTITY_TX", `[X] EntityTx is undefined!`);
    return { newState: entityState, outputs: [] };
  }

  //console.log(`[ALERT][ALERT] APPLY-ENTITY-TX: type="${entityTx?.type}" (typeof: ${typeof entityTx?.type})`);
  //console.log(`[ALERT][ALERT] APPLY-ENTITY-TX: data=`, safeStringify(entityTx?.data, 2));
  //console.log(`[ALERT][ALERT] APPLY-ENTITY-TX: Available types: profile-update, j_event, accountInput, openAccount, directPayment`);
  try {
    if (entityTx.type === 'chat') {
      const { from, message } = entityTx.data;

      if (!validateMessage(message)) {
        log.error(`[X] Invalid chat message from ${from}`);
        return { newState: entityState, outputs: [] }; // Return unchanged state
      }

      const currentNonce = entityState.nonces.get(from) || 0;
      const expectedNonce = currentNonce + 1;

      const newEntityState = cloneEntityState(entityState);

      newEntityState.nonces.set(from, expectedNonce);
      addMessage(newEntityState, `${from}: ${message}`);

      return { newState: newEntityState, outputs: [] };
    }

    if (entityTx.type === 'chatMessage') {
      // System-generated messages (e.g., from crontab dispute suggestions)
      const { message } = entityTx.data;
      const newEntityState = cloneEntityState(entityState);

      addMessage(newEntityState, message);

      return { newState: newEntityState, outputs: [] };
    }

    if (entityTx.type === 'propose') {
      const { action, proposer } = entityTx.data;
      const proposalId = generateProposalId(action, proposer, entityState);

      if (DEBUG) console.log(`    [MEMO] Creating proposal ${proposalId} by ${proposer}: ${action.data.message}`);

      const proposal: Proposal = {
        id: proposalId,
        proposer,
        action,
        // explicitly type votes map to match Proposal.vote value type
        votes: new Map<string, 'yes' | 'no' | 'abstain' | { choice: 'yes' | 'no' | 'abstain'; comment: string }>([
          [proposer, 'yes'],
        ]),
        status: 'pending',
        created: entityState.timestamp,
      };

      const proposerPower = entityState.config.shares[proposer] || BigInt(0);
      const shouldExecuteImmediately = proposerPower >= entityState.config.threshold;

      let newEntityState = cloneEntityState(entityState);

      if (shouldExecuteImmediately) {
        proposal.status = 'executed';
        newEntityState = executeProposal(newEntityState, proposal);
        if (DEBUG)
          console.log(
            `    [FAST] Proposal executed immediately - proposer has ${proposerPower} >= ${entityState.config.threshold} threshold`,
          );
      } else {
        if (DEBUG)
          console.log(
            `    [WAIT] Proposal pending votes - proposer has ${proposerPower} < ${entityState.config.threshold} threshold`,
          );
      }

      newEntityState.proposals.set(proposalId, proposal);
      return { newState: newEntityState, outputs: [] };
    }

    if (entityTx.type === 'vote') {
      console.log(`[VOTE] PROCESSING VOTE: entityTx.data=`, entityTx.data);
      const { proposalId, voter, choice, comment } = entityTx.data;
      const proposal = entityState.proposals.get(proposalId);

      console.log(`[VOTE] Vote lookup: proposalId=${proposalId}, found=${!!proposal}, status=${proposal?.status}`);
      console.log(`[VOTE] Available proposals:`, Array.from(entityState.proposals.keys()));

      if (!proposal || proposal.status !== 'pending') {
        console.log(`    [X] Vote ignored - proposal ${proposalId.slice(0, 12)}... not found or not pending`);
        return { newState: entityState, outputs: [] };
      }

      console.log(`    [VOTE]  Vote by ${voter}: ${choice} on proposal ${proposalId.slice(0, 12)}...`);

      const newEntityState = cloneEntityState(entityState);

      const updatedProposal = {
        ...proposal,
        votes: new Map(proposal.votes),
      };
      // Only create the object variant when comment is provided (comment must be string)
      const voteData: 'yes' | 'no' | 'abstain' | { choice: 'yes' | 'no' | 'abstain'; comment: string } =
        comment !== undefined ? ({ choice, comment } as { choice: 'yes' | 'no' | 'abstain'; comment: string }) : choice;
      updatedProposal.votes.set(voter, voteData);

      const yesVoters = Array.from(updatedProposal.votes.entries())
        .filter(([_voter, voteData]) => {
          const vote = typeof voteData === 'object' ? voteData.choice : voteData;
          return vote === 'yes';
        })
        .map(([voter, _voteData]) => voter);

      const totalYesPower = calculateQuorumPower(entityState.config, yesVoters);

      if (DEBUG) {
        const totalShares = Object.values(entityState.config.shares).reduce((sum, val) => sum + val, BigInt(0));
        const percentage = ((Number(totalYesPower) / Number(entityState.config.threshold)) * 100).toFixed(1);
        console.log(
          `    [FIND] Proposal votes: ${totalYesPower} / ${totalShares} [${percentage}% threshold${Number(totalYesPower) >= Number(entityState.config.threshold) ? '+' : ''}]`,
        );
      }

      if (totalYesPower >= entityState.config.threshold) {
        updatedProposal.status = 'executed';
        const executedState = executeProposal(newEntityState, updatedProposal);
        executedState.proposals.set(proposalId, updatedProposal);
        return { newState: executedState, outputs: [] };
      }

      newEntityState.proposals.set(proposalId, updatedProposal);
      return { newState: newEntityState, outputs: [] };
    }

    if (entityTx.type === 'profile-update') {
      console.log(`[TAG] Profile update transaction processing - data:`, entityTx.data);

      // Extract profile update data
      const profileData = entityTx.data.profile;
      console.log(`[TAG] Extracted profileData:`, profileData);

      if (profileData && profileData.entityId) {
        console.log(`[TAG] Calling processProfileUpdate for entity ${profileData.entityId}`);
        // Process profile update synchronously to ensure gossip is updated before snapshot
        try {
          await processProfileUpdate(db, profileData.entityId, profileData, profileData.hankoSignature || '', env);
        } catch (error) {
          logError("ENTITY_TX", `[X] Failed to process profile update for ${profileData.entityId}:`, error);
        }
      } else {
        console.warn(`[WARN] Invalid profile-update transaction data:`, entityTx.data);
        console.warn(`[WARN] ProfileData missing or invalid:`, profileData);
      }

      return { newState: entityState, outputs: [] };
    }

    if (entityTx.type === 'j_event') {
      const newState = handleJEvent(entityState, entityTx.data);
      return { newState, outputs: [] };
    }

    if (entityTx.type === 'accountInput') {
      const result = await handleAccountInput(entityState, entityTx.data, env);
      return result;
    }

    if (entityTx.type === 'openAccount') {
      console.log(`[CARD] OPEN-ACCOUNT: Opening account with ${entityTx.data.targetEntityId}`);

      const newState = cloneEntityState(entityState);
      const outputs: EntityInput[] = [];

      // Add chat message about account opening
      addMessage(newState, `[CARD] Opening account with Entity ${formatEntityId(entityTx.data.targetEntityId)}...`);

      // STEP 1: Create local account machine
      if (!newState.accounts.has(entityTx.data.targetEntityId)) {
        console.log(`[CARD] LOCAL-ACCOUNT: Creating local account with Entity ${formatEntityId(entityTx.data.targetEntityId)}...`);

        // CONSENSUS FIX: Start with empty deltas - let all delta creation happen through transactions
        // This ensures both sides have identical delta Maps (matches Channel.ts pattern)
        const initialDeltas = new Map<number, Delta>();

        newState.accounts.set(entityTx.data.targetEntityId, {
          counterpartyEntityId: entityTx.data.targetEntityId,
          mempool: [],
          currentFrame: {
            height: 0,
            timestamp: env.timestamp,
            accountTxs: [],
            prevFrameHash: '',
            tokenIds: [],
            deltas: [],
            stateHash: ''
          },
          sentTransitions: 0,
          ackedTransitions: 0,
          deltas: initialDeltas,
          globalCreditLimits: {
            ownLimit: getDefaultCreditLimit(1), // We extend 1M USDC credit to counterparty (token 1 = USDC)
            peerLimit: getDefaultCreditLimit(1), // Counterparty extends same USDC credit to us
          },
          // Frame-based consensus fields
          currentHeight: 0,
          pendingSignatures: [],
          rollbackCount: 0,
          // CHANNEL.TS REFERENCE: Proper message counters (NOT timestamps!)
          sendCounter: 0,    // Like Channel.ts line 131
          receiveCounter: 0, // Like Channel.ts line 132
          // Removed isProposer - use isLeft() function like old_src Channel.ts
          proofHeader: {
            fromEntity: entityState.entityId,
            toEntity: entityTx.data.targetEntityId,
            cooperativeNonce: 0,
            disputeNonce: 0,
          },
          proofBody: { tokenIds: [], deltas: [] },
          frameHistory: [],
          pendingWithdrawals: new Map(),
          requestedRebalance: new Map(),
        });
      }

      // STEP 2: Add transactions to LOCAL mempool only (Channel.ts pattern)
      // Frame proposal happens automatically on next tick via AUTO-PROPOSE
      console.log(`[CARD] Adding account setup transactions to local mempool for ${formatEntityId(entityTx.data.targetEntityId)}`);

      // Get the account machine we just created
      const localAccount = newState.accounts.get(entityTx.data.targetEntityId);
      if (!localAccount) {
        throw new Error(`CRITICAL: Account machine not found after creation`);
      }

      // Token 1 = USDC
      const usdcTokenId = 1;
      const defaultCreditLimit = getDefaultCreditLimit(1); // 1M USDC (token 1)

      // Determine canonical side (left/right) - DETERMINISTIC
      const isLeftEntity = entityState.entityId < entityTx.data.targetEntityId;
      const ourSide: 'left' | 'right' = isLeftEntity ? 'left' : 'right';

      // Add transactions to mempool - will be batched into frame #1 on next tick
      localAccount.mempool.push({
        type: 'add_delta',
        data: { tokenId: usdcTokenId }
      });

      localAccount.mempool.push({
        type: 'set_credit_limit',
        data: { tokenId: usdcTokenId, amount: defaultCreditLimit, side: ourSide }
      });

      console.log(`[MEMO] Queued 2 transactions to mempool (total: ${localAccount.mempool.length})`);
      console.log(`[ALARM] Frame #1 will be auto-proposed on next tick (100ms) via AUTO-PROPOSE`);
      console.log(`   Transactions: [add_delta, set_credit_limit(side=${ourSide}, amount=1M)]`);

      // Add success message to chat
      addMessage(newState, `[OK] Account opening request sent to Entity ${formatEntityId(entityTx.data.targetEntityId)}`);

      // Broadcast updated profile to gossip layer
      if (env.gossip) {
        const profile = buildEntityProfile(newState);
        env.gossip.announce(profile);
        console.log(`[ANTENNA] Broadcast profile for ${entityState.entityId} with ${newState.accounts.size} accounts`);
      }

      return { newState, outputs };
    }

    if (entityTx.type === 'directPayment') {
      console.log(`[$$] DIRECT-PAYMENT: Initiating payment to ${entityTx.data.targetEntityId}`);

      const newState = cloneEntityState(entityState);
      const outputs: EntityInput[] = [];

      // Extract payment details
      let { targetEntityId, tokenId, amount, route, description } = entityTx.data;

      // If no route provided, check for direct account or calculate route
      if (!route || route.length === 0) {
        // Check if we have a direct account with target
        if (newState.accounts.has(targetEntityId)) {
          console.log(`[$$] Direct account exists with ${formatEntityId(targetEntityId)}`);
          route = [entityState.entityId, targetEntityId];
        } else {
          // Find route through network using gossip
          console.log(`[$$] No direct account, finding route to ${formatEntityId(targetEntityId)}`);

          // Try to find a route through the network
          if (env.gossip) {
            const networkGraph = env.gossip.getNetworkGraph();
            const paths = networkGraph.findPaths(entityState.entityId, targetEntityId);

            if (paths.length > 0) {
              // Use the shortest path
              route = paths[0].path;
              console.log(`[$$] Found route: ${route.map(e => formatEntityId(e)).join(' [RIGHTWARDS] ')}`);
            } else {
              logError("ENTITY_TX", `[X] No route found to ${formatEntityId(targetEntityId)}`);
              addMessage(newState, `[X] Payment failed: No route to ${formatEntityId(targetEntityId)}`);
              return { newState, outputs: [] };
            }
          } else {
            logError("ENTITY_TX", `[X] Cannot find route: Gossip layer not available`);
            addMessage(newState, `[X] Payment failed: Network routing unavailable`);
            return { newState, outputs: [] };
          }
        }
      }

      // Validate route starts with current entity
      if (route.length < 2 || route[0] !== entityState.entityId) {
        logError("ENTITY_TX", `[X] Invalid route: doesn't start with current entity`);
        return { newState: entityState, outputs: [] };
      }

      // Determine next hop
      const nextHop = route[1];
      if (!nextHop) {
        logError("ENTITY_TX", `[X] Invalid route: no next hop specified in route`);
        return { newState: entityState, outputs: [] };
      }

      // Check if we have an account with next hop
      if (!newState.accounts.has(nextHop)) {
        logError("ENTITY_TX", `[X] No account with next hop: ${nextHop}`);
        addMessage(newState, `[X] Payment failed: No account with ${formatEntityId(nextHop)}`);
        return { newState, outputs: [] };
      }

      // Create AccountTx for the payment
      // CRITICAL: ALWAYS include fromEntityId/toEntityId for deterministic consensus
      const accountTx: AccountTx = {
        type: 'direct_payment',
        data: {
          tokenId,
          amount,
          route: route.slice(1), // Remove sender from route (next hop needs to see themselves in route[0])
          description: description || `Payment to ${formatEntityId(targetEntityId)}`,
          fromEntityId: entityState.entityId, // [OK] EXPLICIT direction
          toEntityId: nextHop,                 // [OK] EXPLICIT direction
        },
      };

      // Add to account machine mempool
      const accountMachine = newState.accounts.get(nextHop);
      if (accountMachine) {
        accountMachine.mempool.push(accountTx);
        console.log(`[$$] Added payment to mempool for account with ${formatEntityId(nextHop)}`);
        console.log(`[$$] Account mempool now has ${accountMachine.mempool.length} pending transactions`);
        const isLeft = accountMachine.proofHeader.fromEntity < accountMachine.proofHeader.toEntity;
        console.log(`[$$] Is left entity: ${isLeft}, Has pending frame: ${!!accountMachine.pendingFrame}`);

        // Message about payment initiation
        addMessage(newState,
          `[$$] Sending ${amount} (token ${tokenId}) to ${formatEntityId(targetEntityId)} via ${route.length - 1} hops`
        );

        // The payment is now in our local mempool with the next hop
        // It will be processed through bilateral consensus in the next round
        // The auto-propose logic in entity-consensus will handle proposing the frame
        console.log(`[$$] Payment queued for bilateral consensus with ${formatEntityId(nextHop)}`);
        console.log(`[$$] Account ${formatEntityId(nextHop)} should be added to proposableAccounts`);

        // Note: The entity-consensus applyEntityFrame will add this account to proposableAccounts
        // and trigger bilateral frame proposal at the end of the processing round

        // Return a trigger output to ensure process() continues
        // This ensures the AUTO-PROPOSE logic runs to process the payment
        const firstValidator = entityState.config.validators[0];
        if (firstValidator) {
          outputs.push({
            entityId: entityState.entityId,
            signerId: firstValidator,
            entityTxs: [] // Empty transaction array - just triggers processing
          });
        }
        console.log(`[$$] Added processing trigger to ensure bilateral consensus runs`);
      }

      return { newState, outputs };
    }

    if (entityTx.type === 'deposit_collateral') {
      const { handleDepositCollateral } = await import('./handlers/deposit-collateral');
      return await handleDepositCollateral(entityState, entityTx);
    }

    if (entityTx.type === 'requestWithdrawal') {
      const { handleRequestWithdrawal } = await import('./handlers/request-withdrawal');
      return { newState: handleRequestWithdrawal(entityState, entityTx), outputs: [] };
    }

    if (entityTx.type === 'settleDiffs') {
      console.log(`[BANK] SETTLE-DIFFS: Processing settlement with ${entityTx.data.counterpartyEntityId}`);

      const newState = cloneEntityState(entityState);
      const { counterpartyEntityId, diffs, description } = entityTx.data;

      // Step 1: Validate invariant for all diffs
      for (const diff of diffs) {
        const sum = diff.leftDiff + diff.rightDiff + diff.collateralDiff;
        if (sum !== 0n) {
          logError("ENTITY_TX", `[X] INVARIANT-VIOLATION: leftDiff + rightDiff + collateralDiff = ${sum} (must be 0)`);
          throw new Error(`Settlement invariant violation: ${sum} !== 0`);
        }
      }

      // Step 2: Validate account exists
      if (!newState.accounts.has(counterpartyEntityId)) {
        logError("ENTITY_TX", `[X] No account exists with ${formatEntityId(counterpartyEntityId)}`);
        throw new Error(`No account with ${counterpartyEntityId}`);
      }

      // Step 3: Determine canonical left/right order
      const isLeft = entityState.entityId < counterpartyEntityId;
      const leftEntity = isLeft ? entityState.entityId : counterpartyEntityId;
      const rightEntity = isLeft ? counterpartyEntityId : entityState.entityId;

      console.log(`[BANK] Canonical order: left=${leftEntity.slice(0,10)}..., right=${rightEntity.slice(0,10)}...`);
      console.log(`[BANK] We are: ${isLeft ? 'LEFT' : 'RIGHT'}`);

      // Step 4: Get jurisdiction config
      const jurisdiction = entityState.config.jurisdiction;
      if (!jurisdiction) {
        throw new Error('No jurisdiction configured for this entity');
      }

      // Step 5: Convert diffs to contract format (keep as bigint - ethers handles conversion)
      const contractDiffs = diffs.map(d => ({
        tokenId: d.tokenId,
        leftDiff: d.leftDiff,
        rightDiff: d.rightDiff,
        collateralDiff: d.collateralDiff,
        ondeltaDiff: d.ondeltaDiff || 0n,
      }));

      console.log(`[BANK] Calling submitSettle with diffs:`, safeStringify(contractDiffs, 2));

      // Step 6: Call Depository.settle() - fire and forget (j-watcher handles result)
      try {
        const result = await submitSettle(jurisdiction, leftEntity, rightEntity, contractDiffs);
        console.log(`[OK] Settlement transaction sent: ${result.txHash}`);

        // Add message to chat
        addMessage(newState,
          `[BANK] ${description || 'Settlement'} tx: ${result.txHash.slice(0, 10)}... (block ${result.blockNumber})`
        );
      } catch (error) {
        logError("ENTITY_TX", `[X] Settlement transaction failed:`, error);
        addMessage(newState, `[X] Settlement failed: ${(error as Error).message}`);
        throw error; // Re-throw to trigger outer catch
      }

      return { newState, outputs: [] };
    }

    return { newState: entityState, outputs: [] };
  } catch (error) {
    log.error(`[X] Transaction execution error: ${error}`);
    return { newState: entityState, outputs: [] }; // Return unchanged state on error
  }
};
