/**
 * Deposit Collateral Handler
 *
 * Entity moves own reserve [RIGHTWARDS] account collateral (unilateral on-chain action)
 * Reference: 2019src.txt lines 233-239 (reserveToChannel batchAdd)
 * Reference: Depository.sol reserveToCollateral() (line 1035)
 *
 * Flow:
 * 1. Entity validates sufficient reserve
 * 2. Add R[RIGHTWARDS]C operation to jBatch
 * 3. Wait for jBatch crontab to broadcast
 * 4. On-chain event triggers bilateral account state update
 */

import type { EntityState, EntityTx, EntityInput } from '../../types';
import { cloneEntityState, addMessage } from '../../state-helpers';

export async function handleDepositCollateral(
  entityState: EntityState,
  entityTx: Extract<EntityTx, { type: 'deposit_collateral' }>
): Promise<{ newState: EntityState; outputs: EntityInput[] }> {
  const { counterpartyId, tokenId, amount } = entityTx.data;
  const newState = cloneEntityState(entityState);
  const outputs: EntityInput[] = [];

  // Validate: Do we have enough reserve?
  const currentReserve = entityState.reserves.get(String(tokenId)) || 0n;
  if (currentReserve < amount) {
    addMessage(newState,
      `[X] Insufficient reserve for collateral deposit: have ${currentReserve}, need ${amount} token ${tokenId}`
    );
    return { newState, outputs };
  }

  // Validate: Does account exist?
  if (!entityState.accounts.has(counterpartyId)) {
    addMessage(newState,
      `[X] Cannot deposit collateral: no account with ${counterpartyId.slice(-4)}`
    );
    return { newState, outputs };
  }

  // CRITICAL: Do NOT update state here - wait for SettlementProcessed event from j-watcher
  // This is consensus-critical: both entities must update based on the on-chain event

  // Initialize jBatch on first use
  if (!newState.jBatchState) {
    const { initJBatch } = await import('../../j-batch');
    newState.jBatchState = initJBatch();
  }

  // Add to jBatch for on-chain submission
  const { batchAddReserveToCollateral } = await import('../../j-batch');
  batchAddReserveToCollateral(
    newState.jBatchState,
    entityState.entityId,
    counterpartyId,
    tokenId,
    amount
  );

  addMessage(newState,
    `[PKG] Queued R[RIGHTWARDS]C: ${amount} token ${tokenId} to account with ${counterpartyId.slice(-4)} (will broadcast in next batch)`
  );

  console.log(`[OK] deposit_collateral: Added to jBatch for ${entityState.entityId.slice(-4)}`);
  console.log(`   Counterparty: ${counterpartyId.slice(-4)}`);
  console.log(`   Token: ${tokenId}, Amount: ${amount}`);

  return { newState, outputs };
}
