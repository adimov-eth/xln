import { 
    validateCmd,
    applyCmd,
    formatError
} from './entity';
import { proposer as getCurrentProposer } from './quorum';
import { computeHash } from '../utils/hash';
import { Err, Ok, type Result } from '../types/result';
import type { 
    ServerState, 
    ServerTx, 
    EntityState,
    EntityMeta,
    Registry,
    OutboxMsg
} from '../types';
import { 
    toBlockHeight, 
    toEntityId, 
    type BlockHeight, 
    type EntityId, 
    type SignerIdx 
} from '../types';
import type { Storage } from '../storage';

// Server state management
export const createServerState = (
    height: BlockHeight,
    registry: Registry = new Map()
): ServerState => ({
    height,
    registry,
    entities: new Map(),
    mempool: [],
    lastBlockHash: undefined
});

// Helper for backward compatibility - get entities for a signer
export const entitiesForSigner = (
    server: ServerState,
    signer: SignerIdx
): Map<EntityId, EntityState> => {
    const result = new Map<EntityId, EntityState>();
    
    for (const [entityId, entity] of server.entities) {
        const meta = server.registry.get(entityId);
        if (meta && meta.quorum.includes(signer)) {
            result.set(entityId, entity);
        }
    }
    
    return result;
};

// Compute state hash from all entities
export const computeStateHash = (entities: Map<EntityId, EntityState>): string => {
    const sorted = Array.from(entities.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, state]) => `${id}:${JSON.stringify(state)}`);
    
    return computeHash(sorted.join('|'));
};

// Registry management
export const createRegistry = (): Registry => new Map();

// Maximum allowed quorum size to prevent performance issues
const MAX_QUORUM_SIZE = 1_000_000;

export const registerEntity = (
    registry: Registry,
    id: string,
    signers: SignerIdx[],
    timeoutMs?: number
): Registry => {
    // Validate quorum size to prevent performance issues
    if (signers.length > MAX_QUORUM_SIZE) {
        throw new Error(`Quorum size ${signers.length} exceeds maximum allowed size of ${MAX_QUORUM_SIZE}`);
    }
    
    // Validate quorum has at least one signer
    if (signers.length === 0) {
        throw new Error('Quorum must have at least one signer');
    }
    
    const newRegistry = new Map(registry);
    newRegistry.set(toEntityId(id), {
        id: toEntityId(id),
        quorum: signers,
        timeoutMs
    });
    return newRegistry;
};

// Create an entity in Idle state
export const createEntity = <T = any>(
    height: BlockHeight,
    initialState: T
): EntityState => ({
    tag: 'Idle',
    height,
    state: initialState,
    mempool: [],
    lastBlockHash: undefined,
    lastProcessedHeight: undefined
});

// Entity management
export const addEntityToServer = (
    server: ServerState,
    entityId: EntityId,
    meta: EntityMeta,
    entity: EntityState
): ServerState => {
    // Validate quorum size before adding
    if (meta.quorum.length > MAX_QUORUM_SIZE) {
        throw new Error(`Quorum size ${meta.quorum.length} exceeds maximum allowed size of ${MAX_QUORUM_SIZE}`);
    }
    
    if (meta.quorum.length === 0) {
        throw new Error('Quorum must have at least one signer');
    }
    
    const newEntities = new Map(server.entities);
    const newRegistry = new Map(server.registry);
    
    // Add to registry and entities (single source of truth)
    newRegistry.set(entityId, meta);
    newEntities.set(entityId, entity);
    
    return { 
        ...server, 
        registry: newRegistry,
        entities: newEntities 
    };
};

// Helper to get entity state
export const getEntityState = (
    server: ServerState,
    entityId: EntityId
): EntityState | undefined => {
    return server.entities.get(entityId);
};

// Helper to update entity state
export const updateEntityState = (
    server: ServerState,
    entityId: EntityId,
    newState: EntityState
): ServerState => {
    const newEntities = new Map(server.entities);
    newEntities.set(entityId, newState);
    return { ...server, entities: newEntities };
};

// ===============================
// Block Processing
// ===============================

// Simple storage interface that hides implementation details
export type SimpleStorage = {
    persist: (height: BlockHeight, state: ServerState) => Promise<void>;
    recover: (fromHeight: BlockHeight) => Promise<ServerState | undefined>;
};

// Core validation function - pure, no side effects
export const validateTransactions = (
    server: ServerState,
    transactions: ServerTx[]
): { valid: ServerTx[]; invalid: Array<{ tx: ServerTx; reason: string }> } => {
    const valid: ServerTx[] = [];
    const invalid: Array<{ tx: ServerTx; reason: string }> = [];
    
    for (const tx of transactions) {
        // Check entity exists
        const meta = server.registry.get(tx.entityId);
        if (!meta) {
            invalid.push({ tx, reason: 'Entity not found' });
            continue;
        }
        
        // Check signer authorization
        if (!meta.quorum.includes(tx.signer)) {
            invalid.push({ tx, reason: 'Signer not authorized' });
            continue;
        }
        
        // Get entity state
        const state = getEntityState(server, tx.entityId);
        if (!state) {
            invalid.push({ tx, reason: 'Entity state not found' });
            continue;
        }
        
        if (state.tag === 'Faulted') {
            invalid.push({ tx, reason: 'Entity is faulted' });
            continue;
        }
        
        // Special validation for propose_block
        if (tx.input.type === 'propose_block') {
            const currentProposer = getCurrentProposer(state.height, meta.quorum);
            if (currentProposer !== tx.signer) {
                invalid.push({ tx, reason: 'Not the current proposer' });
                continue;
            }
        }
        
        valid.push(tx);
    }
    
    return { valid, invalid };
};

/**
 * Process a block of transactions through 4 clear phases:
 * 1. Validate - Check authorization and business rules
 * 2. Write-Ahead Log - Persist valid transactions before processing
 * 3. Apply - Update entity states and collect messages
 * 4. Persist - Save state and route messages
 */
export const processBlock = async (
    server: ServerState,
    storage?: SimpleStorage | Storage
): Promise<Result<ServerState, string>> => {
    const nextHeight = toBlockHeight(Number(server.height) + 1);
    
    // 1. VALIDATE
    const { valid, invalid } = validateTransactions(server, server.mempool);
    
    if (invalid.length > 0) {
        console.warn('Invalid transactions:', invalid);
    }
    
    if (valid.length === 0) {
        // Just increment height if no valid transactions
        // But we need to update entity heights too for consistent state hash
        const newEntities = new Map(server.entities);
        for (const [entityId, entity] of newEntities) {
            // Only update height for entities in Idle state
            if (entity.tag === 'Idle') {
                newEntities.set(entityId, {
                    ...entity,
                    height: nextHeight
                });
            }
        }
        
        const newState = { 
            ...server, 
            height: nextHeight, 
            mempool: [],
            entities: newEntities
        };
        
        if (storage) {
            await persistState(storage, nextHeight, newState);
        }
        return Ok(newState);
    }
    
    // 2. WRITE AHEAD LOG - persist valid transactions before processing
    if (storage && 'wal' in storage && valid.length > 0) {
        try {
            await storage.wal.append(nextHeight, valid);
        } catch (error) {
            return Err(`Failed to write WAL: ${error}`);
        }
    }

    // 3. APPLY - use the two-phase validateCmd/applyCmd logic
    let intermediate = server;
    let outbox: OutboxMsg[] = [];
    const processed: ServerTx[] = [];

    for (const tx of valid) {
        const meta = intermediate.registry.get(tx.entityId)!;
        const prior = getEntityState(intermediate, tx.entityId)!;

        // Phase 1: validation
        const v = validateCmd(prior, tx.input, tx.signer, meta);
        if (!v.ok) {
            console.warn(`Transaction validation failed: ${formatError(v.error)}`);
            continue;
        }

        // Phase 2: apply
        const [nextState, msgs] = applyCmd(prior, v.value, meta);
        intermediate = updateEntityState(intermediate, tx.entityId, nextState);
        outbox.push(...msgs);
        processed.push(tx);
    }

    // Route outbox messages to signers
    const routedMessages = routeMessages(outbox, intermediate.registry);
    
    // Auto-propose for single-signer entities  
    const autoProposals = generateAutoProposals(intermediate);

    const newState = {
        ...intermediate,
        height: nextHeight,
        mempool: [...routedMessages, ...autoProposals]
    };

    // 4. PERSIST
    if (storage) {
        await persistState(storage, nextHeight, newState, processed);
    }
    
    return Ok(newState);
};

/**
 * Route outbox messages to appropriate signers.
 * 
 * Messages can be targeted to:
 * - A specific signer (when toSigner is set) - used for directed messages like commit_block
 * - All quorum members (when toSigner is undefined) - used for broadcasts like approve_block
 * 
 * This routing logic is critical for BFT consensus as it ensures all necessary
 * parties receive the messages they need to participate in the protocol.
 * 
 * @param messages - Outbox messages from entity state transitions
 * @param registry - Entity registry for looking up quorum members
 * @returns Array of server transactions to be added to mempool
 */
const routeMessages = (messages: OutboxMsg[], registry: Registry): ServerTx[] => {
    const routed: ServerTx[] = [];
    
    for (const msg of messages) {
        const meta = registry.get(msg.toEntity);
        if (!meta) continue;
        
        const signers = msg.toSigner !== undefined ? [msg.toSigner] : meta.quorum;
        
        for (const signer of signers) {
            routed.push({
                signer,
                entityId: msg.toEntity,
                input: msg.input
            });
        }
    }
    
    return routed;
};

/**
 * Generate automatic block proposals for single-signer entities.
 * 
 * Single-signer entities can skip the proposal/approval phases and move
 * directly to committing blocks. This function detects such entities
 * that have pending transactions and automatically generates propose_block
 * commands for them.
 * 
 * This optimization significantly improves throughput for single-signer
 * scenarios while maintaining the same security guarantees.
 * 
 * @param server - Current server state
 * @returns Array of propose_block transactions for eligible entities
 */
const generateAutoProposals = (server: ServerState): ServerTx[] => {
    const proposals: ServerTx[] = [];
    
    for (const [entityId, entity] of server.entities) {
        const meta = server.registry.get(entityId);
        if (!meta) continue;
        
        // Only auto-propose for single-signer entities in Idle state with pending txs
        if (entity.tag === 'Idle' && 
            entity.mempool.length > 0 && 
            meta.quorum.length === 1) {
            
            const proposer = getCurrentProposer(entity.height, meta.quorum);
            if (proposer !== undefined) {
                proposals.push({
                    signer: proposer,
                    entityId,
                    input: {
                        type: 'propose_block',
                        txs: entity.mempool
                    }
                });
            }
        }
    }
    
    return proposals;
};

// Persist state to storage (handles both SimpleStorage and full Storage)
const persistState = async (
    storage: SimpleStorage | Storage,
    height: BlockHeight,
    state: ServerState,
    transactions?: ServerTx[]
): Promise<void> => {
    if ('persist' in storage) {
        // SimpleStorage interface
        await storage.persist(height, state);
    } else {
        // Full Storage interface
        try {
            // Note: WAL has already been written in processBlock before state processing
            
            // Save block data
            const blockData = {
                height,
                timestamp: Date.now(),
                transactions: transactions || [],
                stateHash: computeStateHash(state.entities)
            };
            await storage.blocks.save(height, blockData);
            
            // Periodic snapshots
            if (Number(height) % 100 === 0) {
                await storage.state.save(state);
                await storage.wal.truncateBefore(height);
            }
        } catch (error) {
            throw new Error(`Storage error: ${error}`);
        }
    }
};

// Archive snapshot creation
export const createArchiveSnapshot = (
    server: ServerState, 
    height: BlockHeight, 
    parentHash?: string
): any => {
    return {
        height,
        timestamp: Date.now(),
        stateRoot: computeStateHash(server.entities),
        parentHash,
        entities: Array.from(server.entities.entries()).map(([id, state]) => ({
            id,
            state
        })),
        registry: Array.from(server.registry.entries())
    };
};

// Server recovery
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

// Replay blocks for debugging/recovery
export const replayBlocksFromTo = async (
    state: ServerState,
    storage: Storage,
    fromHeight: BlockHeight,
    toHeight: BlockHeight
): Promise<Result<ServerState, string>> => {
    let current = state;
    
    for (let h = Number(fromHeight); h <= Number(toHeight); h++) {
        const blockData = await storage.blocks.get(toBlockHeight(h));
        if (!blockData) {
            return Err(`Block ${h} not found`);
        }
        
        current = { ...current, mempool: blockData.transactions || [] };
        const result = await processBlock(current, storage);
        if (!result.ok) {
            return Err(`Failed to replay block ${h}: ${result.error}`);
        }
        current = result.value;
    }
    
    return Ok(current);
};