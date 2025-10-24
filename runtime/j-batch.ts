/**
 * J-Batch Aggregator System
 *
 * Accumulates entity operations into batches for atomic on-chain submission.
 * Pattern from 2019src.txt lines 3309-3399 (sharedState.batch + broadcastBatch)
 *
 * Design:
 * - Each entity accumulates operations in their jBatch
 * - Server periodically broadcasts batches (every 5s or when full)
 * - Batch is cleared after successful submission
 * - Failed batches are retried (with exponential backoff)
 */

import { safeStringify } from './serialization-utils';
import type { JurisdictionConfig } from './types';

/**
 * Batch structure matching Depository.sol (lines 203-231)
 */
export interface JBatch {
  // Reserve <-> External Token (deposits/withdrawals to/from blockchain)
  reserveToExternalToken: Array<{
    receivingEntity: string;
    tokenId: number;
    amount: bigint;
  }>;
  externalTokenToReserve: Array<{
    entity: string;
    packedToken: string;
    internalTokenId: number;
    amount: bigint;
  }>;

  // Reserve <-> Reserve (entity-to-entity transfers)
  reserveToReserve: Array<{
    receivingEntity: string;
    tokenId: number;
    amount: bigint;
  }>;

  // Reserve [RIGHTWARDS] Collateral (fund account)
  reserveToCollateral: Array<{
    tokenId: number;
    receivingEntity: string; // Which entity is depositing
    pairs: Array<{
      entity: string; // Counterparty in the account
      amount: bigint;
    }>;
  }>;

  // Settlements (simplified R<->C operations via settle())
  settlements: Array<{
    leftEntity: string;
    rightEntity: string;
    diffs: Array<{
      tokenId: number;
      leftDiff: bigint;
      rightDiff: bigint;
      collateralDiff: bigint;
      ondeltaDiff: bigint;
    }>;
  }>;

  // Dispute/Cooperative proofs (DEPRECATED in current Depository.sol - empty arrays for now)
  cooperativeUpdate: never[];
  cooperativeDisputeProof: never[];
  initialDisputeProof: never[];
  finalDisputeProof: never[];

  // Flashloans (for atomic batch execution)
  flashloans: Array<{
    tokenId: number;
    amount: bigint;
  }>;

  // Hub ID (for gas tracking)
  hub_id: number;
}

/**
 * JBatch state for an entity
 */
export interface JBatchState {
  batch: JBatch;
  jurisdiction: JurisdictionConfig | null; // Cached jurisdiction for this entity
  lastBroadcast: number; // Timestamp of last broadcast
  broadcastCount: number; // Total broadcasts
  failedAttempts: number; // Failed broadcast attempts (for exponential backoff)
}

/**
 * Create empty batch (2019src.txt line 3368)
 */
export function createEmptyBatch(): JBatch {
  return {
    reserveToExternalToken: [],
    externalTokenToReserve: [],
    reserveToReserve: [],
    reserveToCollateral: [],
    settlements: [],
    cooperativeUpdate: [],
    cooperativeDisputeProof: [],
    initialDisputeProof: [],
    finalDisputeProof: [],
    flashloans: [],
    hub_id: 0,
  };
}

/**
 * Initialize jBatch state for entity
 */
export function initJBatch(): JBatchState {
  return {
    batch: createEmptyBatch(),
    jurisdiction: null, // Will be set when first operation is added
    lastBroadcast: 0,
    broadcastCount: 0,
    failedAttempts: 0,
  };
}

/**
 * Check if batch has any operations
 */
export function isBatchEmpty(batch: JBatch): boolean {
  return (
    batch.reserveToExternalToken.length === 0 &&
    batch.externalTokenToReserve.length === 0 &&
    batch.reserveToReserve.length === 0 &&
    batch.reserveToCollateral.length === 0 &&
    batch.settlements.length === 0 &&
    batch.cooperativeUpdate.length === 0 &&
    batch.cooperativeDisputeProof.length === 0 &&
    batch.initialDisputeProof.length === 0 &&
    batch.finalDisputeProof.length === 0 &&
    batch.flashloans.length === 0
  );
}

/**
 * Add reserve [RIGHTWARDS] collateral operation to batch
 */
export function batchAddReserveToCollateral(
  jBatchState: JBatchState,
  entityId: string,
  counterpartyId: string,
  tokenId: number,
  amount: bigint
): void {
  // Check if we already have an R[RIGHTWARDS]C entry for this entity+counterparty+token
  // If yes, aggregate amounts
  const existing = jBatchState.batch.reserveToCollateral.find(
    op => op.receivingEntity === entityId && op.tokenId === tokenId
  );

  if (existing) {
    // Find the pair entry
    const pair = existing.pairs.find(p => p.entity === counterpartyId);
    if (pair) {
      pair.amount += amount; // Aggregate
    } else {
      existing.pairs.push({ entity: counterpartyId, amount });
    }
  } else {
    // Create new entry
    jBatchState.batch.reserveToCollateral.push({
      tokenId,
      receivingEntity: entityId,
      pairs: [{ entity: counterpartyId, amount }],
    });
  }

  console.log(`[PKG] jBatch: Added R[RIGHTWARDS]C ${amount} token ${tokenId} for ${entityId.slice(-4)}[RIGHTWARDS]${counterpartyId.slice(-4)}`);
}

/**
 * Add settlement operation to batch
 */
export function batchAddSettlement(
  jBatchState: JBatchState,
  leftEntity: string,
  rightEntity: string,
  diffs: Array<{
    tokenId: number;
    leftDiff: bigint;
    rightDiff: bigint;
    collateralDiff: bigint;
    ondeltaDiff: bigint;
  }>
): void {
  // Validate entities are in canonical order
  if (leftEntity >= rightEntity) {
    throw new Error(`Settlement entities must be ordered: ${leftEntity} >= ${rightEntity}`);
  }

  // Check if we already have a settlement for this pair
  const existing = jBatchState.batch.settlements.find(
    s => s.leftEntity === leftEntity && s.rightEntity === rightEntity
  );

  if (existing) {
    // Aggregate diffs by token
    for (const newDiff of diffs) {
      const existingDiff = existing.diffs.find(d => d.tokenId === newDiff.tokenId);
      if (existingDiff) {
        existingDiff.leftDiff += newDiff.leftDiff;
        existingDiff.rightDiff += newDiff.rightDiff;
        existingDiff.collateralDiff += newDiff.collateralDiff;
        existingDiff.ondeltaDiff += newDiff.ondeltaDiff;
      } else {
        existing.diffs.push(newDiff);
      }
    }
  } else {
    jBatchState.batch.settlements.push({
      leftEntity,
      rightEntity,
      diffs,
    });
  }

  console.log(`[PKG] jBatch: Added settlement ${leftEntity.slice(-4)}<->${rightEntity.slice(-4)}, ${diffs.length} tokens`);
}

/**
 * Add reserve [RIGHTWARDS] reserve transfer to batch
 */
export function batchAddReserveToReserve(
  jBatchState: JBatchState,
  receivingEntity: string,
  tokenId: number,
  amount: bigint
): void {
  jBatchState.batch.reserveToReserve.push({
    receivingEntity,
    tokenId,
    amount,
  });

  console.log(`[PKG] jBatch: Added R[RIGHTWARDS]R ${amount} token ${tokenId} to ${receivingEntity.slice(-4)}`);
}

/**
 * Get batch size (total operations)
 */
export function getBatchSize(batch: JBatch): number {
  return (
    batch.reserveToExternalToken.length +
    batch.externalTokenToReserve.length +
    batch.reserveToReserve.length +
    batch.reserveToCollateral.length +
    batch.settlements.length +
    batch.cooperativeUpdate.length +
    batch.cooperativeDisputeProof.length +
    batch.initialDisputeProof.length +
    batch.finalDisputeProof.length +
    batch.flashloans.length
  );
}

/**
 * Broadcast batch to Depository contract
 * Reference: 2019src.txt lines 3384-3399
 */
export async function broadcastBatch(
  entityId: string,
  jBatchState: JBatchState,
  jurisdiction: any // JurisdictionConfig
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (isBatchEmpty(jBatchState.batch)) {
    console.log('[PKG] jBatch: Empty batch, skipping broadcast');
    return { success: true };
  }

  const batchSize = getBatchSize(jBatchState.batch);
  console.log(`[OUT] Broadcasting batch for ${entityId.slice(-4)}: ${batchSize} operations`);
  console.log(`[OUT] Batch contents:`, safeStringify(jBatchState.batch, 2));

  try {
    const { connectToEthereum } = await import('./evm');

    // Connect to jurisdiction
    const { depository } = await connectToEthereum(jurisdiction);

    console.log(`[OUT] Submitting batch to Depository contract...`);
    console.log(`   Entity: ${entityId.slice(-4)}`);
    console.log(`   Operations: R[RIGHTWARDS]C=${jBatchState.batch.reserveToCollateral.length}, Settlements=${jBatchState.batch.settlements.length}, R[RIGHTWARDS]R=${jBatchState.batch.reserveToReserve.length}`);

    // Submit to Depository.processBatch (same pattern as evm.ts:338)
    const tx = await depository['processBatch']!(entityId, jBatchState.batch, {
      gasLimit: 5000000, // High limit for complex batches
    });

    console.log(`[WAIT] Waiting for batch transaction to mine: ${tx.hash}`);
    const receipt = await tx.wait();

    console.log(`[OK] Batch broadcasted successfully!`);
    console.log(`   Tx Hash: ${receipt.transactionHash}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);

    // Clear batch after successful broadcast
    jBatchState.batch = createEmptyBatch();
    jBatchState.lastBroadcast = receipt.blockNumber; // Use block number instead of Date.now() for determinism
    jBatchState.broadcastCount++;
    jBatchState.failedAttempts = 0;

    return {
      success: true,
      txHash: receipt.transactionHash,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[X] Batch broadcast failed for ${entityId.slice(-4)}:`, error);
    jBatchState.failedAttempts++;

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Check if batch should be broadcast
 * Triggers: batch full, timeout, or manual flush
 */
export function shouldBroadcastBatch(
  jBatchState: JBatchState,
  currentTimestamp: number
): boolean {
  if (isBatchEmpty(jBatchState.batch)) {
    return false;
  }

  const batchSize = getBatchSize(jBatchState.batch);
  const MAX_BATCH_SIZE = 50; // Max operations per batch
  const BATCH_TIMEOUT_MS = 5000; // Broadcast every 5s even if not full

  // Trigger 1: Batch is full
  if (batchSize >= MAX_BATCH_SIZE) {
    console.log(`[PKG] jBatch: Full (${batchSize}/${MAX_BATCH_SIZE}) - triggering broadcast`);
    return true;
  }

  // Trigger 2: Timeout since last broadcast
  const timeSinceLastBroadcast = currentTimestamp - jBatchState.lastBroadcast;
  if (timeSinceLastBroadcast >= BATCH_TIMEOUT_MS) {
    console.log(`[PKG] jBatch: Timeout (${timeSinceLastBroadcast}ms) - triggering broadcast`);
    return true;
  }

  return false;
}
