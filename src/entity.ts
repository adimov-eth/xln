// entity.ts
import { encode, hash } from './encoding';
import { type EntityBlock, type EntityInput, type EntityState, type EntityTx, type Hash, type OutboxMessage } from './types';

export function createEntity(id: string): EntityState {
  return {
    height: 0,
    nonce: 0,
    data: { counter: 0 },
    mempool: [],
    status: 'idle',
    // Default single-signer consensus
    quorum: [[0, 1]],
    threshold: 0.67,
    proposer: 0
  };
}

export function applyEntityInput(
  state: EntityState,
  input: EntityInput,
  outbox: OutboxMessage[],
  signerIndex: number,
  entityId: string
): EntityState {
  switch (input.type) {
    case 'import':
      return input.state;
    
    case 'add_tx': 
      if (state.status !== 'idle') return state;
      
      return {
        ...state,
        mempool: [...state.mempool, input.tx]
      };
    
    case 'propose_block':
      if (state.status !== 'idle' || state.mempool.length === 0) {
        return state;
      }
      
      // Create proposed block
      const block: EntityBlock = {
        height: state.height + 1,
        txs: [...state.mempool],
        prevHash: state.consensusBlock ? 
          hash(encode(state.consensusBlock)) : 
          Buffer.alloc(32),
        stateRoot: Buffer.alloc(32), // Will be computed after dry-run
        proposer: signerIndex,
        signatures: new Map()
      };
      
      // Dry-run to compute state root
      const dryRunState = applyBlockTransactions(state, block.txs);
      block.stateRoot = getEntityStateRoot(dryRunState);
      
      // For multi-signer, send to validators
      if (state.quorum && state.quorum.length > 1) {
        for (const [signer, _weight] of state.quorum) {
          if (signer !== signerIndex) {
            outbox.push({
              fromEntity: entityId,
              toEntity: entityId,
              toSigner: signer,
              payload: { type: 'validate_block', block }
            });
          }
        }
        
        return {
          ...state,
          status: 'awaiting_signatures',
          proposedBlock: block
        };
      }
      
      // Single-signer auto-commit
      return finalizeBlock(state, block);
    
    case 'validate_block':
      // Validator receives block
      if (!input.block || state.status !== 'idle') return state;
      
      // Verify block execution
      const testState = applyBlockTransactions(state, input.block.txs);
      const expectedRoot = getEntityStateRoot(testState);
      
      if (!expectedRoot.equals(input.block.stateRoot)) {
        console.error('Block validation failed: state root mismatch');
        return state;
      }
      
      // Send signature back
      outbox.push({
        fromEntity: entityId,
        toEntity: entityId,
        toSigner: input.block.proposer,
        payload: {
          type: 'block_signature',
          height: input.block.height,
          signature: Buffer.from('dummy-sig'), // Would be real signature
          signerIndex: signerIndex,
          quorum: [] // Would be passed from validation context
        }
      });
      
      return state;
    
    case 'block_signature':
      if (!state.proposedBlock || 
          state.proposedBlock.height !== input.height) {
        return state;
      }
      
      // Create new signatures map without mutation
      const newSignatures = new Map(state.proposedBlock.signatures);
      newSignatures.set(input.signerIndex, input.signature);
      
      // Create new block with updated signatures
      const updatedBlock: EntityBlock = {
        ...state.proposedBlock,
        signatures: newSignatures
      };
      
      // Check if we have quorum
      const totalWeight = state.quorum.reduce((sum, [_, w]) => sum + w, 0);
      let signedWeight = 0;
      
      for (const [signer, weight] of state.quorum) {
        if (newSignatures.has(signer)) {
          signedWeight += weight;
        }
      }
      
      if (signedWeight >= totalWeight * state.threshold) {
        // Finalize with signatures
        return finalizeBlock(state, updatedBlock);
      }
      
      return {
        ...state,
        proposedBlock: updatedBlock
      };
    
    case 'commit_block':
      // Handle explicit block commit
      if (state.proposedBlock && state.proposedBlock.height === input.height) {
        return finalizeBlock(state, state.proposedBlock);
      }
      return state;
    
    case 'vote':
      // Handle vote input for consensus
      if (!state.proposedBlock || state.proposedBlock.height !== input.blockHeight) {
        console.log(`Invalid vote: no proposed block at height ${input.blockHeight}`);
        return state;
      }
      
      // Create new signatures map without mutation
      const voteSignatures = new Map(state.proposedBlock.signatures);
      voteSignatures.set(signerIndex, Buffer.from('vote-sig'));
      
      // Create new block with updated signatures
      const votedBlock: EntityBlock = {
        ...state.proposedBlock,
        signatures: voteSignatures
      };
      
      // Check if we have enough votes (simplified: just count signatures)
      if (voteSignatures.size >= 2) {
        return finalizeBlock(state, votedBlock);
      }
      
      return {
        ...state,
        proposedBlock: votedBlock
      };
    
    case 'inbox':
      // Handle inter-entity messages
      console.log(`Entity ${entityId} received message from ${input.from}:`, input.message.type);
      
      // Process different message types
      switch (input.message.type) {
        case 'credit_line_update':
          return {
            ...state,
            data: {
              ...state.data,
              creditLine: input.message.newLimit,
              creditUtilization: input.message.utilizationRate,
              messageCount: (state.data.messageCount || 0) + 1
            }
          };
          
        case 'invoice':
          return {
            ...state,
            data: {
              ...state.data,
              pendingInvoiceCount: (state.data.pendingInvoiceCount || 0) + 1,
              invoiceTotal: (state.data.invoiceTotal || 0) + input.message.total,
              messageCount: (state.data.messageCount || 0) + 1
            }
          };
          
        case 'payment':
          return {
            ...state,
            data: {
              ...state.data,
              balance: (state.data.balance || 0) + input.message.amount,
              paymentCount: (state.data.paymentCount || 0) + 1,
              messageCount: (state.data.messageCount || 0) + 1
            }
          };
          
        case 'transfer_notification':
          return {
            ...state,
            data: {
              ...state.data,
              notificationCount: (state.data.notificationCount || 0) + 1,
              messageCount: (state.data.messageCount || 0) + 1
            }
          };
          
        default:
          // Unknown message type
          return {
            ...state,
            data: {
              ...state.data,
              messageCount: (state.data.messageCount || 0) + 1
            }
          };
      }
    
    default:
      return state;
  }
}

function applyBlockTransactions(state: EntityState, txs: EntityTx[]): EntityState {
  let newData = state.data;
  let maxNonce = state.nonce;
  
  for (const tx of txs) {
    newData = applyEntityTx(newData, tx);
    maxNonce = Math.max(maxNonce, tx.nonce);
  }
  
  return {
    ...state,
    data: newData,
    nonce: maxNonce
  };
}

function finalizeBlock(state: EntityState, block: EntityBlock): EntityState {
  const finalState = applyBlockTransactions(state, block.txs);
  
  return {
    ...finalState,
    height: block.height,
    mempool: [],
    status: 'idle',
    consensusBlock: block,
    proposedBlock: undefined
  };
}

function applyEntityTx(data: any, tx: EntityTx): any {
  switch (tx.op) {
    case 'increment':
      return { ...data, counter: (data.counter || 0) + 1 };
    
    case 'set':
      return { ...data, ...tx.data };
    
    case 'transfer':
      // Handle transfers between entities
      const amount = tx.data.amount || 0;
      const currentBalance = data.balance || 0;
      if (amount > currentBalance) {
        // Transaction would fail - don't update counters
        return data;
      }
      return {
        ...data,
        balance: currentBalance - amount,
        transferCount: (data.transferCount || 0) + 1
      };
    
    case 'loan_request':
      return {
        ...data,
        loanRequestCount: (data.loanRequestCount || 0) + 1
      };
    
    case 'loan_approval':
      const loanAmount = tx.data.amount || 0;
      const bankBalance = data.balance || 0;
      if (loanAmount > bankBalance) {
        // Bank doesn't have enough funds
        return data;
      }
      return {
        ...data,
        balance: bankBalance - loanAmount,
        loanCount: (data.loanCount || 0) + 1
      };
    
    case 'purchase':
      const totalCost = (tx.data.quantity || 0) * (tx.data.price || 0);
      const buyerBalance = data.balance || 0;
      if (totalCost > buyerBalance) {
        // Not enough funds for purchase
        return data;
      }
      return {
        ...data,
        balance: buyerBalance - totalCost,
        purchaseCount: (data.purchaseCount || 0) + 1
      };
    
    case 'restock':
      const restockCost = tx.data.cost || 0;
      const merchantBalance = data.balance || 0;
      if (restockCost > merchantBalance) {
        // Not enough funds to restock
        return data;
      }
      return {
        ...data,
        inventory: (data.inventory || 0) + (tx.data.quantity || 0),
        balance: merchantBalance - restockCost,
        restockCount: (data.restockCount || 0) + 1
      };
    
    default:
      console.log(`Unknown transaction type: ${tx.op}`);
      return data;
  }
}

export function getEntityStateRoot(state: EntityState): Hash {
  return hash(encode({
    height: state.height,
    nonce: state.nonce,
    data: state.data
  }));
}