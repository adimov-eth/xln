import type {
  BlockHeight,
  EntityId,
  EntityInput,
  EntityMeta,
  EntityState,
  EntityTx,
  OutboxMsg,
  ProcessingError,
  Result,
  SignerIdx
} from '../types';
import { Err, Ok, toBlockHash, toBlockHeight, toEntityId } from '../types';
import { computeHash } from '../utils/hash';

// Compute deterministic hash for a block
export const computeEntityBlockHash = (
  txs: EntityTx[], 
  height: BlockHeight,
  entityId: EntityId
): string => {
  return computeHash({ txs, height, entityId });
};

// Check if proposal has timed out (default 30 seconds)
const isTimedOut = (timestamp: number, timeoutMs: number = 30000): boolean => {
  return Date.now() - timestamp > timeoutMs;
};

// Determine current proposer based on height and quorum
const getProposer = (height: BlockHeight, quorum: SignerIdx[]): SignerIdx => {
  if (quorum.length === 0) throw new Error('Empty quorum');
  return quorum[Number(height) % quorum.length]!;
};

// Format error for logging
export const formatError = (error: ProcessingError): string => {
  switch (error.type) {
    case 'validation':
      return `Validation error on ${error.field}: ${error.message}`;
    case 'not_found':
      return `${error.resource} not found: ${error.id}`;
    case 'unauthorized':
      return error.message 
        ? `Unauthorized: ${error.message}`
        : `Signer ${error.signer} unauthorized for entity ${error.entity}`;
  }
};

// Pure function to apply entity transaction to state
export const applyEntityTx = <T extends { balance: bigint }>(
  state: T, 
  tx: EntityTx
): Result<T, ProcessingError> => {
  switch (tx.op) {
    case 'mint': {
      const amount = BigInt(tx.data.amount);
      if (amount <= 0n) {
        return Err({ type: 'validation', field: 'amount', message: 'Amount must be positive' });
      }
      return Ok({ ...state, balance: state.balance + amount });
    }
    case 'burn': {
      const amount = BigInt(tx.data.amount);
      if (amount <= 0n) {
        return Err({ type: 'validation', field: 'amount', message: 'Amount must be positive' });
      }
      if (state.balance < amount) {
        return Err({ type: 'validation', field: 'balance', message: 'Insufficient balance' });
      }
      return Ok({ ...state, balance: state.balance - amount });
    }
    case 'transfer': {
      const amount = BigInt(tx.data.amount);
      if (amount <= 0n) {
        return Err({ type: 'validation', field: 'amount', message: 'Amount must be positive' });
      }
      if (state.balance < amount) {
        return Err({ type: 'validation', field: 'balance', message: 'Insufficient balance' });
      }
      if (!tx.data.to) {
        return Err({ type: 'validation', field: 'to', message: 'Transfer requires destination' });
      }
      return Ok({ ...state, balance: state.balance - amount });
    }
    default:
      return Err({ type: 'validation', field: 'op', message: `Unknown operation: ${tx.op}` });
  }
};

// Generate transfer messages from transactions
export const generateTransferMessages = (
  txs: EntityTx[], 
  fromEntityId: EntityId
): OutboxMsg[] => {
  return txs
    .filter(tx => tx.op === 'transfer' && tx.data.to)
    .map(tx => ({
      from: fromEntityId,
      toEntity: toEntityId(tx.data.to),
      input: { 
        type: 'add_tx' as const, 
        tx: { 
          op: 'mint', 
          data: { 
            amount: tx.data.amount,
            from: fromEntityId // Include source for validation
          } 
        } 
      }
    }));
};

// Helper to increment block height
const incrementHeight = (height: BlockHeight): BlockHeight => 
  toBlockHeight(Number(height) + 1);

// Check for timeout and auto-transition if needed
const checkTimeout = <T>(
  entity: EntityState<T>,
  meta: EntityMeta
): EntityState<T> => {
  if (entity.tag === 'Proposed' && entity.proposal.timestamp) {
    const timeoutMs = meta.timeoutMs || 30000;
    if (isTimedOut(entity.proposal.timestamp, timeoutMs)) {
      // Timeout - return to Idle, re-queue all txs
      return {
        tag: 'Idle',
        height: entity.height,
        state: entity.state,
        mempool: [...entity.proposal.txs, ...entity.mempool],
        lastBlockHash: entity.lastBlockHash,
        lastProcessedHeight: entity.lastProcessedHeight
      };
    }
  }
  return entity;
};

// Pure FSM state transition function
export const transitionEntity = <T extends { balance: bigint }>(
  entity: EntityState<T>,
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta,
  currentTime: number = Date.now()
): Result<[EntityState<T>, OutboxMsg[]], ProcessingError> => {
  
  // Check for timeouts first
  const timeoutChecked = checkTimeout(entity, meta);
  if (timeoutChecked !== entity) {
    return Ok([timeoutChecked, []]);
  }
  
  switch (entity.tag) {
    case 'Idle':
      return handleIdleState(entity, input, signer, meta, currentTime);
    
    case 'Proposed':
      return handleProposedState(entity, input, signer, meta);
    
    case 'Committing':
      return handleCommittingState(entity, input, signer, meta);
    
    case 'Faulted':
      return Err({ 
        type: 'validation', 
        field: 'state', 
        message: `Entity is faulted: ${entity.reason}` 
      });
  }
};

// State handlers
function handleIdleState<T extends { balance: bigint }>(
  entity: EntityState<T> & { tag: 'Idle' },
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta,
  currentTime: number
): Result<[EntityState<T>, OutboxMsg[]], ProcessingError> {
  
  switch (input.type) {
    case 'add_tx':
      return Ok([
        { ...entity, mempool: [...entity.mempool, input.tx] },
        []
      ]);
    
    case 'propose_block': {
      const currentProposer = getProposer(entity.height, meta.quorum);
      
      // Only the designated proposer can propose
      if (signer !== currentProposer) {
        return Err({ 
          type: 'unauthorized', 
          signer, 
          entity: meta.id,
          message: `Only signer ${currentProposer} can propose at height ${entity.height}`
        });
      }
      
      // Use provided txs or mempool
      const txs = input.txs && input.txs.length > 0 ? input.txs : entity.mempool;
      if (txs.length === 0) {
        return Err({ 
          type: 'validation', 
          field: 'txs', 
          message: 'No transactions to propose' 
        });
      }
      
      // Compute expected hash and validate against provided hash
      const computedHash = computeEntityBlockHash(txs, entity.height, meta.id);
      const providedHash = toBlockHash(input.hash);
      
      if (computedHash !== input.hash) {
        return Err({
          type: 'validation',
          field: 'hash',
          message: `Hash mismatch: expected ${computedHash}, got ${input.hash}`
        });
      }
      
      const proposal = { 
        txs, 
        hash: providedHash, 
        approves: new Set([signer]),
        timestamp: currentTime,
        proposer: signer
      };
      
      // Single-signer: immediate commit
      if (meta.quorum.length === 1) {
        // Apply all transactions, collecting errors
        let newState = entity.state;
        for (const tx of txs) {
          const result = applyEntityTx(newState, tx);
          if (!result.ok) {
            return Err(result.error);
          }
          newState = result.value;
        }
        
        const transferMessages = generateTransferMessages(txs, meta.id);
        const newHeight = incrementHeight(entity.height);
        
        return Ok([{
          tag: 'Idle',
          height: newHeight,
          state: newState,
          mempool: entity.mempool.filter(tx => !txs.includes(tx)), // Remove committed txs
          lastBlockHash: providedHash,
          lastProcessedHeight: entity.lastProcessedHeight
        }, transferMessages]);
      }
      
      // Multi-signer: broadcast to committee (excluding proposer)
      const broadcastMsgs: OutboxMsg[] = meta.quorum
        .filter(q => q !== signer)
        .map(q => ({
          from: meta.id,
          toEntity: meta.id,
          toSigner: q,
          input: { type: 'propose_block' as const, txs, hash: input.hash }
        }));
      
      return Ok([
        { 
          ...entity, 
          tag: 'Proposed', 
          proposal,
          mempool: entity.mempool.filter(tx => !txs.includes(tx)) // Remove proposed txs
        },
        broadcastMsgs
      ]);
    }
    
    case 'approve_block':
    case 'commit_block':
      return Err({ 
        type: 'validation', 
        field: 'input', 
        message: `Cannot ${input.type} in Idle state` 
      });
  }
}

// Handle inputs in Proposed state
function handleProposedState<T extends { balance: bigint }>(
  entity: EntityState<T> & { tag: 'Proposed' },
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta
): Result<[EntityState<T>, OutboxMsg[]], ProcessingError> {
  
  switch (input.type) {
    case 'add_tx':
      // Queue transaction while proposed
      return Ok([
        { ...entity, mempool: [...entity.mempool, input.tx] },
        []
      ]);
    
    case 'propose_block': {
      const proposedHash = toBlockHash(input.hash);
      
      // Validate the provided hash matches computed hash
      const computedHash = computeEntityBlockHash(input.txs || [], entity.height, meta.id);
      if (computedHash !== input.hash) {
        return Err({
          type: 'validation',
          field: 'hash',
          message: 'Invalid block hash'
        });
      }
      
      // If this is the same proposal we already have
      if (proposedHash === entity.proposal.hash) {
        // Add our approval if we haven't already
        if (!entity.proposal.approves.has(signer)) {
          const approves = new Set(entity.proposal.approves).add(signer);
          const updatedProposal = { ...entity.proposal, approves };
          
          // Broadcast our approval
          const approvalMsgs: OutboxMsg[] = meta.quorum.map(s => ({
            from: meta.id,
            toEntity: meta.id,
            toSigner: s,
            input: { type: 'approve_block' as const, hash: input.hash, from: signer }
          }));
          
          return Ok([
            { ...entity, proposal: updatedProposal },
            approvalMsgs
          ]);
        }
      } else {
        // Different proposal - reject as we're already considering one
        return Err({ 
          type: 'validation', 
          field: 'proposal', 
          message: 'Already considering a different proposal' 
        });
      }
      
      return Ok([entity, []]);
    }
    
    case 'approve_block': {
      if (entity.proposal.hash !== toBlockHash(input.hash)) {
        return Err({ 
          type: 'validation', 
          field: 'hash', 
          message: 'Hash mismatch' 
        });
      }
      
      const approvingSigner = input.from ?? signer;
      if (!meta.quorum.includes(approvingSigner)) {
        return Err({ 
          type: 'unauthorized', 
          signer: approvingSigner, 
          entity: meta.id 
        });
      }
      
      const approves = new Set(entity.proposal.approves).add(approvingSigner);
      const updatedProposal = { ...entity.proposal, approves };
      
      // Check if quorum reached (2/3 majority)
      const threshold = Math.ceil((meta.quorum.length * 2) / 3);
      if (approves.size >= threshold) {
        // Send commit to original proposer
        const commitMsg: OutboxMsg = {
          from: meta.id,
          toEntity: meta.id,
          toSigner: entity.proposal.proposer,
          input: { type: 'commit_block' as const, hash: input.hash }
        };
        
        return Ok([
          { ...entity, tag: 'Committing', proposal: updatedProposal },
          [commitMsg]
        ]);
      }
      
      return Ok([
        { ...entity, proposal: updatedProposal },
        []
      ]);
    }
    
    case 'commit_block':
      return Err({ 
        type: 'validation', 
        field: 'state', 
        message: 'Cannot commit while still in Proposed state' 
      });
  }
}

// Handle inputs in Committing state
function handleCommittingState<T extends { balance: bigint }>(
  entity: EntityState<T> & { tag: 'Committing' },
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta
): Result<[EntityState<T>, OutboxMsg[]], ProcessingError> {
  
  switch (input.type) {
    case 'add_tx':
      // Queue transaction while committing
      return Ok([
        { ...entity, mempool: [...entity.mempool, input.tx] },
        []
      ]);
    
    case 'propose_block':
    case 'approve_block':
      // Ignore new proposals/approvals while committing
      return Ok([entity, []]);
    
    case 'commit_block': {
      if (entity.proposal.hash !== toBlockHash(input.hash)) {
        return Err({ 
          type: 'validation', 
          field: 'hash', 
          message: 'Hash mismatch' 
        });
      }
      
      if (signer !== entity.proposal.proposer) {
        return Err({ 
          type: 'unauthorized', 
          signer, 
          entity: meta.id,
          message: 'Only proposer can commit block'
        });
      }
      
      // Apply all transactions
      let nextState = entity.state;
      for (const tx of entity.proposal.txs) {
        const result = applyEntityTx(nextState, tx);
        if (!result.ok) {
          // Fault the entity on invalid transaction
          return Ok([{
            tag: 'Faulted',
            reason: formatError(result.error),
            height: entity.height,
            lastProcessedHeight: entity.lastProcessedHeight
          }, []]);
        }
        nextState = result.value;
      }
      
      const transferMessages = generateTransferMessages(entity.proposal.txs, meta.id);
      const newHeight = incrementHeight(entity.height);
      
      return Ok([{
        tag: 'Idle',
        height: newHeight,
        state: nextState,
        mempool: entity.mempool,
        lastBlockHash: entity.proposal.hash,
        lastProcessedHeight: entity.lastProcessedHeight
      }, transferMessages]);
    }
  }
}