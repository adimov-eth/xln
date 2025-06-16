import type {
    BlockContextData,
    BlockHeight,
    EntityId,
    EntityMeta,
    EntityState,
    OutboxMsg,
    PipelineContext,
    PipelineStep,
    Registry,
    Result,
    ServerState,
    ServerTx,
    SignerIdx,
    Storage
} from '../types';

import {
    Err,
    ErrorSeverity,
    Ok,
    toBlockHeight,
    toEntityId
} from '../types';

// Utils
import { computeHash, computeStateHash } from '../utils/hash';
import { createPipeline, ErrorCollectorImpl } from '../utils/pipeline';

// Core
import { transitionEntity } from './entity';
  
// Registry operations
export const createRegistry = (): Registry => new Map();

export const registerEntity = (
    registry: Registry,
    id: string,
    quorum: SignerIdx[],
    proposer: SignerIdx
  ): Registry => {
    const newRegistry = new Map(registry);
    newRegistry.set(toEntityId(id), { 
      id: toEntityId(id), 
      quorum, 
      proposer 
    });
    return newRegistry;
};
  
export const isSignerAuthorized = (
    registry: Registry,
    entityId: EntityId,
    signer: SignerIdx
  ): boolean => {
    const meta = registry.get(entityId);
    return meta ? meta.quorum.includes(signer) : false;
  };
  
  // Initialize server state
  export const createServerState = (
    height: BlockHeight,
    registry: Registry
  ): ServerState => ({
    height,
    registry,
    signers: new Map(),
    mempool: []
  });
  
  // Create entity instance
  export const createEntity = (
    height: BlockHeight,
    initialState: any = { balance: 0n }
  ): EntityState => ({
    tag: 'Idle',
    height,
    state: initialState,
    mempool: []
  });
  
  // Add entity to server
  export const addEntityToServer = (
    server: ServerState,
    entityId: EntityId,
    meta: EntityMeta,
    entity: EntityState
  ): ServerState => {
    const newSigners = new Map(server.signers);
    
    // Add entity to each signer in quorum
    for (const signerIdx of meta.quorum) {
      const signerEntities = new Map(newSigners.get(signerIdx) || []);
      signerEntities.set(entityId, entity);
      newSigners.set(signerIdx, signerEntities);
    }
    
    return { ...server, signers: newSigners };
  };



//server steps 
  
  export const validateTransactionsStep: PipelineStep<BlockContextData> = async (ctx) => {
    const { server, blockTxs, errors } = ctx;
    const validatedTxs: ServerTx[] = [];
    const stateChanges = new Map<string, any>();
    
    // If no transactions, nothing to validate
    if (blockTxs.length === 0) {
      return { ...ctx, validatedTxs: [], stateChanges: new Map() };
    }
    
    // Create a copy of server state for validation
    const tempSigners = new Map(server.signers);
    
    for (const tx of blockTxs) {
      const key = `${tx.signer}:${tx.entityId}`;
      
      // Check authorization
      const meta = server.registry.get(tx.entityId);
      if (!meta || !meta.quorum.includes(tx.signer)) {
        errors.addError({ type: 'unauthorized', signer: tx.signer, entity: tx.entityId }, {
          operation: 'validate',
          tx
        });
        continue;
      }
      
      // Get entity state
      const signerMap = tempSigners.get(tx.signer);
      const entity = signerMap?.get(tx.entityId);
      if (!entity) {
        errors.addCritical({ 
          type: 'not_found', 
          resource: 'entity_state', 
          id: tx.entityId 
        }, { signer: tx.signer });
        break; // Critical error - stop validation
      }
      
      // Validate transition
      const result = transitionEntity(entity, tx.input, tx.signer, meta);
      if (!result.ok) {
        const severity = result.error.type === 'validation' 
          ? ErrorSeverity.WARNING 
          : ErrorSeverity.ERROR;
        errors.add(result.error, severity, { entityId: tx.entityId, signer: tx.signer });
        continue;
      }
      
      const [newEntity, msgs] = result.value;
      
      // Track state change
      stateChanges.set(key, { signerIdx: tx.signer, entityId: tx.entityId, newEntity, msgs });
      
      // Update temp state for next validations
      const newSignerMap = new Map(signerMap);
      newSignerMap.set(tx.entityId, newEntity);
      tempSigners.set(tx.signer, newSignerMap);
      
      validatedTxs.push(tx);
    }
    
    return { ...ctx, validatedTxs, stateChanges };
  };
  
  // Phase 1: WAL write (atomic)
  export const writeWalStep = (storage?: Storage): PipelineStep<BlockContextData> => 
    async (ctx) => {
      if (!storage || !ctx.validatedTxs || ctx.validatedTxs.length === 0) {
        return ctx;
      }
      
      try {
        await storage.wal.append(ctx.targetHeight, ctx.validatedTxs);
        return ctx;
      } catch (error) {
        ctx.errors.addCritical(error, { 
          operation: 'wal.append', 
          height: ctx.targetHeight 
        });
        return ctx;
      }
    };
  
  // Phase 2: Apply validated changes
  export const applyChangesStep: PipelineStep<BlockContextData> = async (ctx) => {
    if (ctx.errors.hasCritical() || !ctx.stateChanges) {
      return ctx;
    }
    
    const newSigners = new Map(ctx.server.signers);
    const allMessages: OutboxMsg[] = [];
    
    for (const [key, change] of ctx.stateChanges) {
      const { signerIdx, entityId, newEntity, msgs } = change;
      
      // Apply state change
      const signerMap = new Map(newSigners.get(signerIdx)!);
      signerMap.set(entityId, newEntity);
      newSigners.set(signerIdx, signerMap);
      
      // Collect messages
      allMessages.push(...msgs);
      
      // Track touched entity
      ctx.touchedEntities.add(key);
    }
    
    return {
      ...ctx,
      server: { ...ctx.server, signers: newSigners, mempool: [] },
      messages: allMessages
    };
  };
  
  // Update lastProcessedHeight for touched entities
  export const updateProcessedHeightStep: PipelineStep<BlockContextData> = async (ctx) => {
    if (ctx.errors.hasCritical()) return ctx;
    
    const updatedSigners = new Map(ctx.server.signers);
    
    for (const [signerIdx, entities] of updatedSigners) {
      const updatedEntities = new Map(entities);
      for (const [entityId, entity] of updatedEntities) {
        if (ctx.touchedEntities.has(`${signerIdx}:${entityId}`)) {
          updatedEntities.set(entityId, { 
            ...entity, 
            lastProcessedHeight: ctx.targetHeight 
          });
        }
      }
      updatedSigners.set(signerIdx, updatedEntities);
    }
    
    return {
      ...ctx,
      server: { ...ctx.server, signers: updatedSigners }
    };
  };

  // Store block data
  export const storeBlockStep = (storage?: Storage): PipelineStep<BlockContextData> =>
    async (ctx) => {
      if (!storage || ctx.errors.hasCritical() || ctx.blockTxs.length === 0) {
        return ctx;
      }
      
      try {
        const blockData = {
          height: ctx.targetHeight,
          timestamp: Date.now(),
          transactions: ctx.blockTxs,
          stateHash: computeStateHash(ctx.server.signers)
        };
        
        await storage.blocks.save(ctx.targetHeight, blockData);
      } catch (error) {
        ctx.errors.addWarning(error, { 
          operation: 'block.save', 
          height: ctx.targetHeight 
        });
      }
      
      return ctx;
    };
  
  // Archive snapshot at intervals
  export const archiveSnapshotStep = (storage?: Storage, interval = 100): PipelineStep<BlockContextData> =>
    async (ctx) => {
      if (!storage || ctx.errors.hasCritical()) {
        return ctx;
      }
      
      if (Number(ctx.targetHeight) % interval === 0) {
        try {
          const parentHash = await storage.refs.get('HEAD').catch(() => undefined);
          const snapshot = createArchiveSnapshot(ctx.server, ctx.targetHeight, parentHash);
          const hash = computeHash(snapshot);
          
          await storage.archive.save(hash, snapshot);
          await storage.refs.put('HEAD', hash);
          
          // Also save mutable state for fast access
          await storage.state.save(ctx.server);
        } catch (error) {
          ctx.errors.addWarning(error, { 
            operation: 'archive.snapshot', 
            height: ctx.targetHeight 
          });
        }
      }
      
      return ctx;
    };
  
  // Route messages
  export const routeMessagesStep: PipelineStep<BlockContextData> = async (ctx) => {
    const routed: ServerTx[] = ctx.messages.map(msg => {
      // If toSigner is specified, use it; otherwise look up in registry
      if (msg.toSigner !== undefined) {
        return { signer: msg.toSigner, entityId: msg.toEntity, input: msg.input };
      }
      
      // Server knows which signer controls each entity
      const meta = ctx.server.registry.get(msg.toEntity);
      if (!meta) {
        ctx.errors.addWarning(
          { type: 'not_found', resource: 'entity', id: msg.toEntity },
          { operation: 'route_message' }
        );
        return null;
      }
      
      return {
        signer: meta.proposer,
        entityId: msg.toEntity,
        input: msg.input
      };
    }).filter(Boolean) as ServerTx[];
    
    return {
      ...ctx,
      server: { ...ctx.server, mempool: [...ctx.server.mempool, ...routed] }
    };
  };
  
  // Auto-propose for single signers
  export const autoProposeStep: PipelineStep<BlockContextData> = async (ctx) => {
    const candidates: ServerTx[] = [];
    
    for (const [signerIdx, entities] of ctx.server.signers) {
      for (const [entityId, entity] of entities) {
        const meta = ctx.server.registry.get(entityId);
        if (!meta) continue;
        
        if (entity.tag === 'Idle' && 
            entity.mempool.length > 0 && 
            meta.quorum.length === 1) {
          const txs = entity.mempool;
          const blockHash = computeHash([Number(entity.height) + 1, txs]);
          
          candidates.push({
            signer: signerIdx,
            entityId: entityId,
            input: { type: 'propose_block', txs, hash: blockHash }
          });
        }
      }
    }
    
    return {
      ...ctx,
      server: { 
        ...ctx.server, 
        mempool: [...ctx.server.mempool, ...candidates] 
      }
    };
  };
  
  // Update height
  export const updateHeightStep: PipelineStep<BlockContextData> = async (ctx) => {
    return {
      ...ctx,
      server: { ...ctx.server, height: ctx.targetHeight }
    };
  };

  export async function processBlock(
    server: ServerState,
    storage?: Storage,
    archiveInterval = 100
  ): Promise<Result<ServerState, string>> {
    const targetHeight = toBlockHeight(Number(server.height) + 1);
    const blockTxs = server.mempool;
    
    // If no transactions and no storage, just increment height
    if (blockTxs.length === 0 && !storage) {
      return Ok({ ...server, height: targetHeight });
    }
    
    const pipeline = createPipeline<BlockContextData>(
      validateTransactionsStep,
      writeWalStep(storage),
      applyChangesStep,
      updateProcessedHeightStep,
      storeBlockStep(storage),
      archiveSnapshotStep(storage, archiveInterval),
      routeMessagesStep,
      autoProposeStep,
      updateHeightStep
    );
    
    const initialContext: PipelineContext<BlockContextData> = {
      server,
      messages: [],
      touchedEntities: new Set(),
      targetHeight,
      blockTxs,
      errors: new ErrorCollectorImpl()
    };
    
    const result = await pipeline(initialContext);
    
    if (result.errors.hasCritical()) {
      return Err(result.errors.format());
    }
    
    // Log warnings if any
    if (result.errors.hasErrors()) {
      console.warn(`Block ${targetHeight} processed with warnings:`, result.errors.format());
    }
    
    return Ok(result.server);
  }

  export const createArchiveSnapshot = (server: ServerState, height: BlockHeight, parentHash?: string): any => {
    return {
      height,
      timestamp: Date.now(),
      stateRoot: computeStateHash(server.signers),
      parentHash,
      signers: server.signers,
      registry: server.registry
    };
  }

  export const recoverServer = async (
    storage: Storage,
    initialState: ServerState
  ): Promise<ServerState> => {
    // Try to load from snapshot
    let server = await storage.state.load() || initialState;
    
    // Replay WAL entries after snapshot height
    const walTxs = await storage.wal.getFromHeight(
      toBlockHeight(Number(server.height) + 1)
    );
    
    if (walTxs.length > 0) {
      server = { ...server, mempool: walTxs };
      const result = await processBlock(server, storage);
      if (!result.ok) {
        throw new Error(`Failed to recover: ${result.error}`);
      }
      server = result.value;
    }
    
    return server;
  };
  
  // Save periodic snapshot
  export const saveSnapshot = async (
    server: ServerState, 
    storage: Storage
  ): Promise<void> => {
    await storage.state.save(server);
    await storage.wal.truncateBefore(server.height);
  };


  export const replayBlocksFromTo = async (
    state: ServerState,
    storage: Storage,
    fromHeight: BlockHeight,
    toHeight: BlockHeight
  ): Promise<Result<ServerState, string>> => {
    let current = state;
    
    for (let h = Number(fromHeight); h <= Number(toHeight); h++) {
      const blockData = await storage.blocks.get(toBlockHeight(h));
      if (!blockData) break;
      
      current = { ...current, mempool: blockData.transactions || [] };
      const result = await processBlock(current, storage);
      if (!result.ok) {
        return Err(`Failed to replay block ${h}: ${result.error}`);
      }
      current = result.value;
    }
    
    return Ok(current);
  };