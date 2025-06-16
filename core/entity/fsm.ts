import {
  EntityState, EntityInput, EntityTx, OutboxMsg, EntityMeta, SignerIdx,
  EntityId, BlockHeight, Result, Ok, Err, ProcessingError, 
  toEntityId, toBlockHash, toBlockHeight
} from '../types/primitives';

// Pure function to apply entity transaction to state
export const applyEntityTx = (state: any, tx: EntityTx): any => {
  switch (tx.op) {
    case 'mint': 
      return { ...state, balance: state.balance + BigInt(tx.data.amount) };
    case 'burn': 
      return { ...state, balance: state.balance - BigInt(tx.data.amount) };
    case 'transfer': 
      return { ...state, balance: state.balance - BigInt(tx.data.amount) };
    default: 
      return state;
  }
};

// Generate transfer messages from transactions
export const generateTransferMessages = (txs: EntityTx[], fromEntityId: EntityId): OutboxMsg[] => {
  const messages: OutboxMsg[] = [];
  
  txs.forEach(tx => {
    if (tx.op === 'transfer') {
      messages.push({
        from: fromEntityId,
        toEntity: toEntityId(tx.data.to),
        // No toSigner - let the server figure out routing
        input: { 
          type: 'add_tx', 
          tx: { op: 'mint', data: { amount: tx.data.amount } } 
        }
      });
    }
  });
  
  return messages;
};

// Helper to increment block height
const incrementHeight = (height: BlockHeight): BlockHeight => 
  toBlockHeight(Number(height) + 1);

// Pure FSM state transition function
export const transitionEntity = (
  entity: EntityState,
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta
): Result<[EntityState, OutboxMsg[]], ProcessingError> => {
  
  switch (entity.tag) {
    case 'Idle':
      return handleIdleState(entity, input, signer, meta);
    
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

// Handle inputs in Idle state
function handleIdleState(
  entity: EntityState & { tag: 'Idle' },
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta
): Result<[EntityState, OutboxMsg[]], ProcessingError> {
  
  switch (input.type) {
    case 'add_tx':
      return Ok([
        { ...entity, mempool: [...entity.mempool, input.tx] },
        []
      ]);
    
    case 'propose_block':
      const blockHash = toBlockHash(input.hash);
      const proposal = { 
        txs: input.txs, 
        hash: blockHash, 
        approves: new Set([signer]) 
      };
      
      // Single-signer: immediate commit
      if (meta.quorum.length === 1) {
        const newState = input.txs.reduce(applyEntityTx, entity.state);
        const transferMessages = generateTransferMessages(input.txs, meta.id);
        const newHeight = incrementHeight(entity.height);
        
        return Ok([{
          tag: 'Idle',
          height: newHeight,
          state: newState,
          mempool: [],
          lastBlockHash: blockHash
        }, transferMessages]);
      }
      
      // Multi-signer: broadcast to committee (excluding proposer)
      const broadcastMsgs = meta.quorum
        .filter(q => q !== signer)
        .map(q => ({
          from: meta.id,
          toEntity: meta.id,
          toSigner: q,
          input: { type: 'propose_block' as const, txs: input.txs, hash: input.hash }
        }));
      
      return Ok([
        { ...entity, tag: 'Proposed', proposal },
        broadcastMsgs
      ]);
    
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
function handleProposedState(
  entity: EntityState & { tag: 'Proposed' },
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta
): Result<[EntityState, OutboxMsg[]], ProcessingError> {
  
  switch (input.type) {
    case 'add_tx':
      // Queue transaction while proposed
      return Ok([
        { ...entity, mempool: [...entity.mempool, input.tx] },
        []
      ]);
    
    case 'propose_block':
      // If this is a broadcast from another signer
      if (signer !== meta.proposer && toBlockHash(input.hash) !== entity.proposal.hash) {
        // Accept new proposal and approve it
        const newProposal = {
          txs: input.txs,
          hash: toBlockHash(input.hash),
          approves: new Set([signer])
        };
        
        // Send approval to all signers
        const approvalMsgs = meta.quorum.map(s => ({
          from: meta.id,
          toEntity: meta.id,
          toSigner: s,
          input: { type: 'approve_block' as const, hash: input.hash, from: signer }
        }));
        
        return Ok([
          { ...entity, proposal: newProposal },
          approvalMsgs
        ]);
      }
      
      return Ok([entity, []]);
    
    case 'approve_block':
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
      if (approves.size * 3 >= meta.quorum.length * 2) {
        // Send commit to proposer
        const commitMsg = {
          from: meta.id,
          toEntity: meta.id,
          toSigner: meta.proposer,
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
    
    case 'commit_block':
      return Err({ 
        type: 'validation', 
        field: 'state', 
        message: 'Cannot commit while still in Proposed state' 
      });
  }
}

// Handle inputs in Committing state
function handleCommittingState(
  entity: EntityState & { tag: 'Committing' },
  input: EntityInput,
  signer: SignerIdx,
  meta: EntityMeta
): Result<[EntityState, OutboxMsg[]], ProcessingError> {
  
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
    
    case 'commit_block':
      if (entity.proposal.hash !== toBlockHash(input.hash)) {
        return Err({ 
          type: 'validation', 
          field: 'hash', 
          message: 'Hash mismatch' 
        });
      }
      
      if (signer !== meta.proposer) {
        return Err({ 
          type: 'unauthorized', 
          signer, 
          entity: meta.id 
        });
      }
      
      // Apply transactions and generate transfers
      const nextState = entity.proposal.txs.reduce(applyEntityTx, entity.state);
      const transferMessages = generateTransferMessages(entity.proposal.txs, meta.id);
      const newHeight = incrementHeight(entity.height);
      
      return Ok([{
        tag: 'Idle',
        height: newHeight,
        state: nextState,
        mempool: entity.mempool,
        lastBlockHash: entity.proposal.hash
      }, transferMessages]);
  }
}